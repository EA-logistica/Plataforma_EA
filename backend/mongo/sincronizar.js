import { createHash } from 'node:crypto';
import { db, configurado } from './conexion.js';
import { ejecutar, enTransaccion } from '../db/conexion.js';
import * as ordenesCompraDetalle from '../db/repos/ordenesCompraDetalle.js';
import * as requerimientosHistorico from '../db/repos/requerimientosCompraHistorico.js';
import * as productos from '../db/repos/productos.js';
import * as materiaPrima from '../db/repos/materiaPrimaStock.js';
import * as stockValorizado from '../db/repos/stockValorizado.js';
import * as ajustes from '../db/repos/ajustes.js';
import * as muestras from '../db/repos/muestrasMp.js';
import * as importaciones from '../db/repos/importaciones.js';
import * as mpPlaneacion from '../db/repos/mpPlaneacion.js';
import { normalizar as normalizarImportacion } from '#shared/importaciones.js';

/**
 * Trae del MongoDB del bot de logística las fotos del ERP que antes llegaban
 * como data/*.js (productos.js, materiaPrimaStock.js, stockValorizado.js) y
 * las carga con el MISMO cargarInicial() de cada repositorio. Así las vistas
 * de Productos, Materia Prima, Dashboard y Almacén Los Olivos no cambian:
 * siguen leyendo PostgreSQL, solo cambió de dónde viene la foto.
 *
 * De dónde sale cada cosa en Mongo:
 *   - productos_maestro  catálogo completo (26 mil SKU): stock total, costo
 *                        unitario, tipo de producto, categoría de MP (cat3).
 *   - stock_mp_almacen   stock POR ALMACÉN (Mezcla MP, Infantas, Los
 *                        Olivos…), MP y también PT del almacén 151.
 *   - ordenes_compra     ítems de OC del ERP → ordenes_compra_detalle
 *                        (historial de OC, proveedores y rotación ABC).
 *   - requerimientos_compra_detalle → historial de requerimientos de compra.
 *   - importaciones (+ importaciones_tracking_eventos) → apartado
 *                        Importaciones: seguimiento de cada OC importada.
 *   - productos_maestro, otra vez: consumo, lead time y compra sugerida de
 *                        cada materia prima → mp_planeacion (ABC y reorden).
 *
 * Cada tabla se recarga solo si su contenido cambió (huella en ajustes,
 * mismo criterio que backend/db/sembrar.js): la copia corre cada 30 minutos
 * y no tiene sentido reescribir 48 mil ítems de OC idénticos.
 *
 * Moneda: costo_unitario y total_valorizado de productos_maestro están en
 * SOLES (una resina comprada a 1.10 USD/kg figura a 4.52/kg con
 * tc_utilizado 3.44). Las vistas muestran USD, así que se divide por el tipo
 * de cambio que trae cada producto.
 */

const MP = new Set(['MATERIA PRIMA', 'MATERIA PRIMA - TINTAS']);
const TIPO_CODIGO = { 'PRODUCTO TERMINADO': 'APT', 'MATERIAS PRIMAS': 'MP' };
const OTROS_ALMACENES = 'OTROS ALMACENES (sin detalle)';
const CADA_MS = 30 * 60 * 1000;
const REINTENTO_MS = 2 * 60 * 1000;

const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0);
const txt = v => (v == null || v === 'nan' ? '' : String(v).trim());
const redondear = v => Math.round(v * 100) / 100;

/** Costo unitario en USD de un producto del maestro (0 si no tiene costo). */
function costoUsd(p) {
  const tc = num(p?.tc_utilizado) || 3.44;
  return num(p?.costo_unitario) / tc;
}

function categoriaMp(p) {
  const c = txt(p?.cat3).toUpperCase();
  if (!c || c === 'OTROS_MP') return 'OTROS';
  return c;
}

/**
 * Fecha del ERP como texto 'YYYY-MM-DD', que es como la guardan y comparan
 * las tablas (TEXT). Acepta Date, ISO y 'dd/mm/yyyy'; 'nan' y vacío → ''.
 */
function fechaTxt(v) {
  if (v == null || v === '' || v === 'nan') return '';
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : v.toISOString().slice(0, 10);
  const t = String(v).trim();
  const dmy = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (dmy) return dmy[3] + '-' + dmy[2].padStart(2, '0') + '-' + dmy[1].padStart(2, '0');
  const iso = t.match(/^\d{4}-\d{2}-\d{2}/);
  if (iso) return iso[0];
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

/**
 * Un SKU real del ERP: 8 dígitos que empiezan en 1 (10003717), con sufijo
 * opcional de variante (-02, -A1, -MS09). productos_maestro trae además ~480
 * filas basura -una hoja de Excel mal leída el 2025-10-06: "125", "0.84",
 * "Mar-2025", con números en la descripción y en la UM y sin familia- que no
 * son productos y no deben llegar a ninguna vista.
 */
const SKU = /^1\d{7}(-[A-Z0-9]+)?$/;
function esSku(p) {
  const descripcion = txt(p.descripcion) || txt(p.nombre);
  // Con familia es un producto del ERP aunque su descripción sea solo un
  // número (10007291 "90249"): es un dato mal cargado en el ERP, no basura.
  return SKU.test(txt(p.codigo)) && descripcion !== ''
    && (txt(p.familia) !== '' || !/^[\d.,\s-]+$/.test(descripcion));
}

/** Códigos del ERP que llegan como "91517.0" o 10480440043.0: sin el ".0" de Excel. */
const codigoTxt = v => txt(v).replace(/\.0+$/, '');

async function leerMongo() {
  const d = await db();
  const [maestro, porAlmacen, oc, requerimientos, almacenesErp] = await Promise.all([
    d.collection('productos_maestro').find({}, { projection: {
      _id: 0, codigo: 1, codigo_alterno: 1, descripcion: 1, nombre: 1, unidad_medida: 1,
      familia: 1, familia_nombre: 1, linea: 1, linea_nombre: 1, marca: 1, modelo: 1, peso: 1,
      origen: 1, tipo_producto: 1, estado_erp: 1, ubicacion: 1, stock_seguridad: 1,
      lead_time_dias: 1, lead_time_promedio: 1, stock_actual: 1, tiene_ficha_tecnica: 1,
      tiene_materia_prima: 1, costo_unitario: 1, tc_utilizado: 1, total_valorizado: 1, cat3: 1,
      ultimo_update: 1, fecha_registro: 1,
      // Planeación (mp_planeacion): lo calcula el bot en cada corrida.
      prom_12m: 1, p95_12m: 1, lt_meses: 1, safety_pct: 1, on_order: 1, compra_sugerida: 1,
      valor_compra_sugerida_usd: 1, status: 1, proveedor_ultima_compra: 1, fecha_ultima_compra: 1,
      ultimo_costo_compra: 1, moneda_ultimo_costo: 1
    } }).toArray(),
    d.collection('stock_mp_almacen').find({}, { projection: { _id: 0 } }).toArray(),
    d.collection('ordenes_compra').find({}, { projection: { _id: 0 } }).toArray(),
    d.collection('requerimientos_compra_detalle').find({}, { projection: { _id: 0 } }).toArray(),
    d.collection('salidas_almacen').aggregate([
      { $match: { almacen_codigo: { $nin: [null, ''] } } },
      { $group: { _id: '$almacen_codigo', nombre: { $last: '$almacen_nombre' } } }
    ], { allowDiskUse: true }).toArray()
  ]);
  // Importaciones aparte: si el usuario de Mongo todavía no puede leerlas,
  // el resto de la copia sigue igual.
  const [imp, eventos] = await Promise.all([
    d.collection('importaciones').find({}).toArray().catch(() => null),
    d.collection('importaciones_tracking_eventos').find({}, { projection: { _id: 0 } }).toArray().catch(() => [])
  ]);
  return {
    maestro: maestro.filter(esSku),
    porAlmacen,
    oc,
    requerimientos,
    importaciones: imp,
    eventosImportacion: eventos,
    nombresAlmacen: new Map(almacenesErp.filter(a => txt(a.nombre)).map(a => [codigoTxt(a._id), txt(a.nombre)]))
  };
}

/**
 * stock_mp_almacen trae nombres abreviados por el bot ("Alm Mezcla MP"); el
 * ERP los llama "ALMACEN DE  MEZCLA MP", "ALMACEN LOS OLIVOS - LOGISTICS"…
 * Se usa el nombre oficial, que es el que la gente reconoce y el que ya
 * mostraba la plataforma con los reportes del ERP. Si un almacén no tiene
 * salidas registradas (p. ej. 127 Sandpol), queda el nombre del bot.
 */
let nombresAlmacen = new Map();
const nombreAlmacen = s => nombresAlmacen.get(codigoTxt(s.codigo_almacen)) || txt(s.nombre_almacen);

/**
 * Ítems de OC. La clave es OC + producto + orden de aparición: como la tabla
 * se reemplaza entera en cada recarga, nunca queda duplicada.
 *
 * El bot renombró varios campos (usuario_oc, oc_tipo, oc_area, doc_ref /
 * serie_ref / numero_ref, glosa_cabecera_req_compras…): se lee el nombre
 * antiguo y, si no viene, el nuevo.
 */
function aOrdenesCompraDetalle(oc) {
  const vistos = new Map();
  // ELIMINADO_ORIGEN: ítems que el ERP ya borró; el bot los conserva marcados.
  return oc.filter(o => txt(o.oc_numero) && txt(o.estado_sincronizacion) !== 'ELIMINADO_ORIGEN').map(o => {
    const numeroOc = codigoTxt(o.oc_numero);
    const base = numeroOc + '|' + codigoTxt(o.codigo);
    const n = (vistos.get(base) || 0) + 1;
    vistos.set(base, n);
    return {
      clave: 'mongo:' + base + '|' + n,
      codigoArea: codigoTxt(o.codigo_area), area: txt(o.area) || txt(o.area_nombre) || txt(o.oc_area),
      fechaEntrega: fechaTxt(o.entrega),
      docSerie: txt(o.doc_serie), docNumero: txt(o.doc_numero),
      numeroOc,
      fechaEmision: fechaTxt(o.emision),
      rucProveedor: codigoTxt(o.proveedor_ruc) || codigoTxt(o.proveedor_codigo),
      proveedor: txt(o.proveedor_razon),
      tipoOrden: txt(o.tipo_orden) || txt(o.oc_tipo),
      refTipo: txt(o.ref_tipo) || txt(o.doc_ref), refSerie: txt(o.ref_serie) || txt(o.serie_ref),
      refNumero: codigoTxt(o.ref_numero) || codigoTxt(o.numero_ref),
      estado: txt(o.oc_estado),
      tipoCambio: num(o.tc),
      codigoProducto: codigoTxt(o.codigo), descripcionProducto: txt(o.producto),
      vencimiento: fechaTxt(o.vcmto),
      cantidad: num(o.cantidad), saldo: num(o.saldo),
      moneda: txt(o.moneda).toUpperCase() === 'USD' ? 'USD' : 'PEN',
      costoUnitario: num(o.costo_unit), valorCompra: num(o.valor_compra),
      procDescuento: num(o.pct_dscto), montoIgv: num(o.monto_igv),
      montoNeto: num(o.total_compra) || num(o.valor_compra) + num(o.monto_igv),
      montoSaldo: num(o.monto_saldo),
      valorCompraMn: num(o.v_compra_mn), valorCompraMe: num(o.v_compra_me),
      codMolde: codigoTxt(o.codigo_molde), nombreMolde: txt(o.nombre_molde),
      glosaCabReqCompra: txt(o.glosa_cabecera_req_compras) || txt(o.glosa_oc),
      glosaDetReqCompra: txt(o.glosa_detalle_req_compras) || txt(o.observacion),
      incoterm: txt(o.incoterm), tipoTransporte: txt(o.tipo_trans),
      agenteAduana: txt(o.agente_aduana), numeroContrato: txt(o.nro_contrato),
      usuario: txt(o.usuario) || txt(o.usuario_oc)
    };
  });
}

function aRequerimientosHistorico(requerimientos) {
  return requerimientos.filter(r => txt(r.id_detalle) && txt(r.id_requerimiento)).map(r => ({
    clave: 'mongo:' + txt(r.id_detalle),
    fechaEmision: fechaTxt(r.fecha_emision),
    numeroRequerimientoCabecera: [txt(r.doc_serie), txt(r.doc_numero)].filter(Boolean).join('-'),
    numeroRequerimiento: txt(r.id_requerimiento),
    item: Math.trunc(num(r.item_nro)),
    codigoProducto: codigoTxt(r.codigo_producto),
    nombreProducto: txt(r.nombre_producto),
    unidadMedida: txt(r.unidad_medida),
    cantidad: num(r.cantidad),
    atendida: num(r.atendida),
    saldo: num(r.saldo),
    fechaEntregaComprometida: fechaTxt(r.fecha_entrega_doc),
    // El código crudo del ERP (APROBADA, PARCIALMEN…): es el que usan la vista y el resumen.
    estado: txt(r.estado) || txt(r.estado_normalizado),
    numeroOc: txt(r.oc_numero),
    proveedor: txt(r.proveedor),
    ref1Tipo: txt(r.doc_tipo), ref1Serie: txt(r.doc_serie), ref1Numero: txt(r.doc_numero),
    ref2Tipo: txt(r.ot_numero) ? 'OT' : '', ref2Serie: '', ref2Numero: codigoTxt(r.ot_numero),
    fechaAtencion: fechaTxt(r.fecha_entrega),
    cantidadAtendida: num(r.cantidad_entrega),
    glosa: txt(r.glosa)
  }));
}

const huella = filas => createHash('sha1').update(JSON.stringify(filas)).digest('hex');

/**
 * Carga una foto solo si cambió desde la última vez. Con `vaciar`, la tabla
 * se borra antes, en la misma transacción: quien consulte en medio ve la
 * foto anterior completa, nunca una tabla a medio llenar.
 */
async function recargarSiCambio(nombre, filas, cargar, vaciar = null) {
  const h = huella(filas);
  const clave = 'huella_mongo_' + nombre;
  if ((await ajustes.leer(clave, '')) === h) return false;
  await enTransaccion(async () => {
    if (vaciar) await ejecutar('DELETE FROM ' + vaciar);
    await cargar(filas);
  });
  await ajustes.escribir(clave, h);
  return true;
}

function aProductos(maestro) {
  const siNo = v => (v === true || /^(si|sí|s|true|1)$/i.test(txt(v)) ? 'SI' : 'NO');
  return maestro.filter(p => txt(p.codigo)).map(p => ({
    codigo: txt(p.codigo),
    codigoAlterno: txt(p.codigo_alterno),
    descripcion: txt(p.descripcion) || txt(p.nombre),
    unidadMedida: txt(p.unidad_medida),
    familia: txt(p.familia) || txt(p.familia_nombre),
    linea: txt(p.linea) || txt(p.linea_nombre),
    marca: txt(p.marca),
    modelo: txt(p.modelo),
    peso: num(p.peso),
    origen: txt(p.origen),
    tipoProducto: txt(p.tipo_producto),
    estado: txt(p.estado_erp),
    ubicacion: txt(p.ubicacion),
    stockMinimo: num(p.stock_seguridad),
    leadTime: num(p.lead_time_dias) || num(p.lead_time_promedio),
    stock: num(p.stock_actual),
    tieneFichaTecnica: siNo(p.tiene_ficha_tecnica),
    tieneMateriaPrima: siNo(p.tiene_materia_prima),
    fechaRegistro: fechaTxt(p.fecha_registro)
  }));
}

/** Una fila de stock_mp_almacen con los campos comunes a las dos fotos de stock. */
function filaAlmacen(s, p) {
  const stock = num(s.stock);
  const costo = costoUsd(p);
  return {
    almacenCodigo: txt(s.codigo_almacen),
    almacen: nombreAlmacen(s),
    categoriaNivel3: txt(s.familia),
    // En el ERP, "familia" es lo que Mongo llama línea (HDPE SOPLADO, MASTERBATCH…).
    familia: txt(s.linea),
    codigo: txt(s.codigo),
    codigoAlterno: txt(s.codigo_alterno),
    descripcion: txt(s.nombre_producto),
    unidadMedida: txt(s.unidad_medida),
    ubicacion: txt(s.ubicacion),
    stock,
    costoPromedioUsd: redondear(costo * 10000) / 10000,
    valorizadoUsd: redondear(stock * costo)
  };
}

/**
 * Un producto del maestro con stock pero sin detalle por almacén en
 * stock_mp_almacen: entra con su total bajo un almacén genérico, para que
 * los totales no queden por debajo de lo real.
 */
function filaMaestro(p) {
  const tc = num(p.tc_utilizado) || 3.44;
  return {
    almacenCodigo: '', almacen: OTROS_ALMACENES,
    categoriaNivel3: txt(p.familia) || txt(p.familia_nombre),
    familia: txt(p.linea) || txt(p.linea_nombre),
    codigo: txt(p.codigo), codigoAlterno: txt(p.codigo_alterno),
    descripcion: txt(p.descripcion) || txt(p.nombre),
    unidadMedida: txt(p.unidad_medida), ubicacion: txt(p.ubicacion),
    stock: num(p.stock_actual),
    costoPromedioUsd: redondear(costoUsd(p) * 10000) / 10000,
    valorizadoUsd: redondear(num(p.total_valorizado) / tc)
  };
}

/** Productos del maestro con stock que no tienen ninguna fila en stock_mp_almacen. */
function sinDetalle(maestro, conDetalle) {
  return maestro.filter(p => txt(p.codigo) && !conDetalle.has(txt(p.codigo)) && num(p.stock_actual) > 0);
}

/**
 * Materia prima por almacén. stock_mp_almacen no trae las TINTAS (ni alguna
 * MP suelta): esas salen de productos_maestro bajo "otros almacenes".
 */
function aMateriaPrima(porAlmacen, maestro, porCodigo) {
  const conDetalle = new Set(porAlmacen.map(s => txt(s.codigo)));
  const conCategoria = (fila, p) => ({ ...fila, categoria: categoriaMp(p) });
  return [
    ...porAlmacen.filter(s => MP.has(txt(s.familia)))
      .map(s => conCategoria(filaAlmacen(s, porCodigo.get(txt(s.codigo))), porCodigo.get(txt(s.codigo)))),
    ...sinDetalle(maestro, conDetalle).filter(p => MP.has(txt(p.familia) || txt(p.familia_nombre)))
      .map(p => conCategoria(filaMaestro(p), p))
  ];
}

/**
 * Stock valorizado de TODOS los tipos. El detalle por almacén existe solo
 * para los almacenes de stock_mp_almacen; el resto (p. ej. PT del almacén de
 * producto terminado) va como filaMaestro(), para que el Dashboard no
 * muestre un valorizado global menor al real.
 */
function aStockValorizado(porAlmacen, maestro, porCodigo) {
  const conDetalle = new Set(porAlmacen.map(s => txt(s.codigo)));
  const conTipo = (fila, p) => {
    const tipo = txt(p?.tipo_producto);
    return { ...fila, tipoCodigo: TIPO_CODIGO[tipo] || '', tipoProducto: tipo };
  };
  return [
    ...porAlmacen.map(s => conTipo(filaAlmacen(s, porCodigo.get(txt(s.codigo))), porCodigo.get(txt(s.codigo)))),
    ...sinDetalle(maestro, conDetalle).map(p => conTipo(filaMaestro(p), p))
  ];
}

/** Importaciones normalizadas (sin las excluidas ni fusionadas) y sus hitos de rastreo. */
function aImportaciones(docs, eventos) {
  return {
    importaciones: docs.map(normalizarImportacion).filter(Boolean),
    eventos: eventos.map(e => ({
      importacionId: txt(e.importacion_id), oc: codigoTxt(e.oc_numero), fecha: txt(e.fecha_evento instanceof Date ? e.fecha_evento.toISOString() : e.fecha_evento),
      hito: txt(e.hito), descripcion: txt(e.descripcion), transportista: txt(e.transportista),
      referencia: txt(e.referencia), ubicacion: txt(e.ubicacion)
    }))
  };
}

/**
 * Planeación de cada materia prima (incluye tintas), con montos en US$: el
 * costo del maestro viene en soles; si un código no tiene costo (sin stock),
 * se usa el de su última compra.
 */
function aPlaneacion(maestro) {
  return maestro.filter(p => MP.has(txt(p.familia) || txt(p.familia_nombre))).map(p => {
    const tc = num(p.tc_utilizado) || 3.44;
    const ultimo = num(p.ultimo_costo_compra) / (txt(p.moneda_ultimo_costo).toUpperCase() === 'PEN' ? tc : 1);
    return {
      codigo: txt(p.codigo),
      descripcion: txt(p.descripcion) || txt(p.nombre),
      tipo: txt(p.familia) || txt(p.familia_nombre),
      linea: txt(p.linea) || txt(p.linea_nombre),
      unidadMedida: txt(p.unidad_medida),
      stock: num(p.stock_actual),
      consumoMes: num(p.prom_12m),
      consumoP95: num(p.p95_12m),
      costoUsd: costoUsd(p) || ultimo,
      leadTimeMeses: num(p.lt_meses),
      seguridadPct: num(p.safety_pct),
      enCamino: num(p.on_order),
      compraSugerida: num(p.compra_sugerida),
      compraSugeridaUsd: num(p.valor_compra_sugerida_usd),
      estadoDemanda: txt(p.status),
      proveedorUltima: txt(p.proveedor_ultima_compra),
      fechaUltimaCompra: fechaTxt(p.fecha_ultima_compra),
      ultimoCostoUsd: ultimo
    };
  });
}

/** La fecha más reciente de carga en Mongo: es "de cuándo es la foto", no de cuándo se copió. */
function fechaDatos(porAlmacen, maestro) {
  // Mongo trae unas como Date y otras como texto ISO: se comparan en milisegundos.
  const ms = v => (v ? new Date(v).getTime() || 0 : 0);
  let max = 0;
  for (const s of porAlmacen) max = Math.max(max, ms(s.fecha_carga));
  for (const p of maestro) max = Math.max(max, ms(p.ultimo_update));
  return max ? new Date(max).toISOString() : '';
}

let enCurso = null;

export function sincronizar() {
  enCurso ??= (async () => {
    const inicio = Date.now();
    try {
      const leido = await leerMongo();
      const { maestro, porAlmacen, oc, requerimientos } = leido;
      nombresAlmacen = leido.nombresAlmacen;
      if (!maestro.length) throw new Error('productos_maestro vino vacío: no se reemplaza la foto actual.');
      const porCodigo = new Map(maestro.map(p => [txt(p.codigo), p]));

      const filasProductos = aProductos(maestro);
      const filasMp = aMateriaPrima(porAlmacen, maestro, porCodigo);
      const filasSv = aStockValorizado(porAlmacen, maestro, porCodigo);

      const filasOc = aOrdenesCompraDetalle(oc);
      const filasRq = aRequerimientosHistorico(requerimientos);

      // productos también se vacía antes (ninguna tabla lo referencia): su
      // cargarInicial es UPSERT y, sin vaciar, un código que ya no viene -las
      // filas basura de arriba- se quedaría para siempre.
      const recargadas = [];
      if (await recargarSiCambio('productos_sku', filasProductos, productos.cargarInicial, 'productos')) recargadas.push('productos');
      if (await recargarSiCambio('materia_prima', filasMp, materiaPrima.cargarInicial)) recargadas.push('materia prima');
      if (await recargarSiCambio('stock_valorizado', filasSv, stockValorizado.cargarInicial)) recargadas.push('stock valorizado');
      // Con compras vacías en Mongo no se borra lo que ya hay: mejor una foto
      // vieja que un historial de OC que desaparece por un fallo del bot.
      if (filasOc.length && await recargarSiCambio('ordenes_compra', filasOc, ordenesCompraDetalle.cargarInicial, 'ordenes_compra_detalle')) recargadas.push('órdenes de compra');
      if (filasRq.length && await recargarSiCambio('requerimientos', filasRq, requerimientosHistorico.cargarInicial, 'requerimientos_compra_detalle')) recargadas.push('requerimientos');
      const filasPlan = aPlaneacion(maestro);
      if (filasPlan.length && await recargarSiCambio('mp_planeacion', filasPlan, mpPlaneacion.cargarInicial)) recargadas.push('planeación MP');
      // null = no se pudo leer la colección (permiso): se deja la última copia.
      const imp = leido.importaciones ? aImportaciones(leido.importaciones, leido.eventosImportacion) : null;
      if (imp && imp.importaciones.length && await recargarSiCambio('importaciones', imp, importaciones.cargarInicial)) recargadas.push('importaciones');

      // Códigos que llegaron con esta foto (Materia Prima → "Códigos nuevos",
      // Homologados) y muestras sin código que ahora sí tienen con quién
      // emparejarse: el material de una muestra suele darse de alta después.
      const codigosNuevos = await productos.registrarAltas();
      const muestrasConCodigo = await muestras.completarCodigos();

      const resultado = {
        ok: true,
        sincronizado: new Date().toISOString(),
        fechaDatos: fechaDatos(porAlmacen, maestro),
        productos: filasProductos.length,
        materiaPrima: filasMp.length,
        stockValorizado: filasSv.length,
        ordenesCompra: filasOc.length,
        requerimientos: filasRq.length,
        importaciones: imp ? imp.importaciones.length : null,
        planeacionMp: filasPlan.length,
        codigosNuevos,
        muestrasConCodigo,
        recargadas,
        ms: Date.now() - inicio
      };
      await ajustes.escribir('mongo_sync', JSON.stringify(resultado));
      return resultado;
    } catch (e) {
      const previo = await estado();
      await ajustes.escribir('mongo_sync', JSON.stringify({ ...previo, ok: false, error: e.message, intento: new Date().toISOString() }));
      throw e;
    } finally {
      enCurso = null;
    }
  })();
  return enCurso;
}

/** Lo último que se sabe de la sincronización (sin tocar Mongo). */
export async function estado() {
  try { return JSON.parse(await ajustes.leer('mongo_sync', '{}')) || {}; } catch (_) { return {}; }
}

/**
 * Sincroniza al arrancar y luego cada 30 minutos. Nunca bloquea el arranque
 * ni lo tumba: sin Tailscale o sin MONGO_URI, las vistas siguen con la
 * última foto que haya en PostgreSQL.
 */
export function programarSincronizacion({ silencioso = false } = {}) {
  if (!configurado()) return;
  // Tras un fallo (la PC de Mongo apagada o fuera de Tailscale) se reintenta
  // a los 2 minutos, no a los 30: si no, el indicador seguía en "sin
  // conexión" media hora después de que la conexión ya había vuelto.
  const siguiente = ms => setTimeout(correr, ms).unref();
  const correr = () => sincronizar()
    .then(r => { siguiente(CADA_MS); return r; }, e => { siguiente(REINTENTO_MS); throw e; })
    .then(r => { if (!silencioso) console.log('  mongo        ' + r.productos + ' productos, ' + r.materiaPrima + ' filas MP, ' + r.stockValorizado + ' filas valorizado, '
      + r.ordenesCompra + ' ítems de OC, ' + r.requerimientos + ' requerimientos, '
      + (r.importaciones ?? 0) + ' importaciones · '
      + (r.recargadas.length ? 'actualizado: ' + r.recargadas.join(', ') : 'sin cambios') + ' (' + r.ms + ' ms)'); })
    .catch(e => console.error('[mongo] sincronización fallida:', e.message));
  correr();
}
