import { todos, uno, aCamel, enTransaccion, insertarLote } from '../conexion.js';
import { tocar } from './ajustes.js';

/**
 * Historial de Órdenes de Compra del ERP (data/ordenesCompraDetalle.js):
 * solo lectura, una fila por ítem de OC. `resumenPorOC()` agrupa por
 * numero_oc -eso es "el historial completo de OC": OC, proveedor, valorizado,
 * fecha de emisión-; `porOC()` trae los ítems de una sola OC para el
 * detalle.
 *
 * Filtro único: proveedor, fecha y moneda -todo lo demás (resumen, ranking
 * de proveedores, evolución mensual, listado) se recalcula sobre ese mismo
 * filtro, igual que ordenes_compra.js (registro SUNAT)-. Mezcla soles y
 * dólares, así que lo que suma dinero siempre separa moneda; para RANKEAR
 * proveedores y meses se usa el equivalente en soles (valor_compra_mn, ya
 * calculado por el propio ERP al tipo de cambio de cada línea).
 */

const COLUMNAS = [
  'clave', 'codigo_area', 'area', 'fecha_entrega', 'doc_serie', 'doc_numero', 'numero_oc', 'fecha_emision',
  'ruc_proveedor', 'proveedor', 'tipo_orden', 'ref_tipo', 'ref_serie', 'ref_numero', 'estado', 'tipo_cambio',
  'codigo_producto', 'descripcion_producto', 'vencimiento', 'cantidad', 'saldo', 'moneda', 'costo_unitario',
  'valor_compra', 'proc_descuento', 'monto_igv', 'monto_neto', 'monto_saldo', 'valor_compra_mn', 'valor_compra_me',
  'cod_molde', 'nombre_molde', 'glosa_cab_req_compra', 'glosa_det_req_compra', 'incoterm', 'tipo_transporte',
  'agente_aduana', 'numero_contrato', 'usuario'
];

export function cargarInicial(filas) {
  return enTransaccion(async () => {
    const n = await insertarLote('ordenes_compra_detalle', COLUMNAS, filas.map(d => ({
      clave: d.clave,
      codigo_area: d.codigoArea || '', area: d.area || '',
      fecha_entrega: d.fechaEntrega || '',
      doc_serie: d.docSerie || '', doc_numero: d.docNumero || '', numero_oc: d.numeroOc,
      fecha_emision: d.fechaEmision || '',
      ruc_proveedor: d.rucProveedor || '', proveedor: d.proveedor || '',
      tipo_orden: d.tipoOrden || '',
      ref_tipo: d.refTipo || '', ref_serie: d.refSerie || '', ref_numero: d.refNumero || '',
      estado: d.estado || '',
      tipo_cambio: d.tipoCambio || 0,
      codigo_producto: d.codigoProducto || '', descripcion_producto: d.descripcionProducto || '',
      vencimiento: d.vencimiento || '',
      cantidad: d.cantidad || 0, saldo: d.saldo || 0,
      moneda: d.moneda === 'USD' ? 'USD' : 'PEN',
      costo_unitario: d.costoUnitario || 0, valor_compra: d.valorCompra || 0,
      proc_descuento: d.procDescuento || 0, monto_igv: d.montoIgv || 0,
      monto_neto: d.montoNeto || 0, monto_saldo: d.montoSaldo || 0,
      valor_compra_mn: d.valorCompraMn || 0, valor_compra_me: d.valorCompraMe || 0,
      cod_molde: d.codMolde || '', nombre_molde: d.nombreMolde || '',
      glosa_cab_req_compra: d.glosaCabReqCompra || '', glosa_det_req_compra: d.glosaDetReqCompra || '',
      incoterm: d.incoterm || '', tipo_transporte: d.tipoTransporte || '',
      agente_aduana: d.agenteAduana || '', numero_contrato: d.numeroContrato || '',
      usuario: d.usuario || ''
    })), 'ON CONFLICT (clave) DO NOTHING');
    await tocar();
    return n;
  });
}

export async function total() {
  return (await uno('SELECT COUNT(*) AS n FROM ordenes_compra_detalle')).n;
}

function condiciones(f = {}) {
  const where = [];
  const params = {};
  if (f.proveedor) { where.push('proveedor = @proveedor'); params.proveedor = f.proveedor; }
  if (f.moneda) { where.push('moneda = @moneda'); params.moneda = f.moneda; }
  if (f.desde) { where.push('fecha_emision >= @desde'); params.desde = f.desde; }
  if (f.hasta) { where.push('fecha_emision <= @hasta'); params.hasta = f.hasta; }
  if (f.area) { where.push('area = @area'); params.area = f.area; }
  if (f.estado) { where.push('estado = @estado'); params.estado = f.estado; }
  if (f.codigoProducto) { where.push('codigo_producto = @codigoProducto'); params.codigoProducto = f.codigoProducto; }
  if (f.q) {
    where.push('(numero_oc ILIKE @q OR proveedor ILIKE @q OR descripcion_producto ILIKE @q OR codigo_producto ILIKE @q)');
    params.q = '%' + f.q + '%';
  }
  return { sql: where.length ? 'WHERE ' + where.join(' AND ') : '', params };
}

/**
 * El historial completo de OC: una fila por orden de compra (no por ítem),
 * con lo que pidió el usuario -OC, proveedor, valorizado, fecha de emisión-
 * más área y estado. `estado` de la cabecera es el de su primer ítem: en la
 * práctica todos los ítems de una misma OC comparten estado (verificado:
 * ninguna OC mezcla estado, moneda, proveedor ni fecha entre sus líneas).
 * Por eso proveedor, RUC, área y moneda se toman con MIN(): PostgreSQL no
 * admite columnas sueltas fuera del GROUP BY y, siendo iguales en todas las
 * líneas, da lo mismo cuál se elija.
 */
export async function resumenPorOC(f = {}) {
  const { sql, params } = condiciones(f);
  const pagina = Math.max(1, Number(f.pagina) || 1);
  const porPagina = Math.min(200, Math.max(1, Number(f.porPagina) || 30));

  const totalOC = (await uno(
    'SELECT COUNT(*) AS n FROM (SELECT numero_oc FROM ordenes_compra_detalle ' + sql + ' GROUP BY numero_oc) t',
    params
  )).n;

  const filas = (await todos(
    'SELECT numero_oc, MIN(fecha_emision) AS fecha_emision, MIN(proveedor) AS proveedor, '
    + 'MIN(ruc_proveedor) AS ruc_proveedor, MIN(area) AS area, '
    + 'MIN(estado) AS estado, MIN(moneda) AS moneda, COUNT(*) AS items, '
    + 'COALESCE(SUM(monto_neto), 0) AS valorizado, COALESCE(SUM(valor_compra_mn), 0) AS "valorizadoEquivalente" '
    + 'FROM ordenes_compra_detalle ' + sql
    + ' GROUP BY numero_oc ORDER BY fecha_emision DESC, numero_oc DESC LIMIT @limite OFFSET @offset',
    { ...params, limite: porPagina, offset: (pagina - 1) * porPagina }
  )).map(aCamel);

  return { filas, total: totalOC, pagina, porPagina };
}

async function agregadoPorMoneda(sql, params) {
  const f = await uno(
    `SELECT COUNT(DISTINCT CASE WHEN moneda = 'PEN' THEN numero_oc END) AS "ordenesPen", `
    + `COALESCE(SUM(CASE WHEN moneda = 'PEN' THEN monto_neto ELSE 0 END), 0) AS "totalPen", `
    + `COUNT(DISTINCT CASE WHEN moneda = 'USD' THEN numero_oc END) AS "ordenesUsd", `
    + `COALESCE(SUM(CASE WHEN moneda = 'USD' THEN monto_neto ELSE 0 END), 0) AS "totalUsd" `
    + 'FROM ordenes_compra_detalle ' + sql,
    params
  );
  return {
    pen: { ordenes: f.ordenesPen || 0, total: f.totalPen },
    usd: { ordenes: f.ordenesUsd || 0, total: f.totalUsd }
  };
}

/** Tarjetas: número de OC, ítems, proveedores, y valorizado separado en soles y dólares (más el equivalente para el ranking). */
export async function resumen(f = {}) {
  const { sql, params } = condiciones(f);
  const totales = await uno(
    'SELECT COUNT(DISTINCT numero_oc) AS ordenes, COUNT(*) AS items, COUNT(DISTINCT proveedor) AS proveedores, '
    + 'COALESCE(SUM(valor_compra_mn), 0) AS "valorizadoEquivalente" '
    + 'FROM ordenes_compra_detalle ' + sql,
    params
  );
  const porMoneda = await agregadoPorMoneda(sql, params);
  // Lo que sigue abierto: OC aprobadas o recién registradas que todavía no se
  // atendieron del todo. Es lo accionable -lo atendido ya es historia-.
  const y = sql ? sql + ' AND ' : 'WHERE ';
  const pend = await uno(
    "SELECT COUNT(DISTINCT numero_oc) AS ordenes, "
    + "COALESCE(SUM(CASE WHEN moneda = 'PEN' THEN monto_saldo ELSE 0 END), 0) AS \"saldoPen\", "
    + "COALESCE(SUM(CASE WHEN moneda = 'USD' THEN monto_saldo ELSE 0 END), 0) AS \"saldoUsd\" "
    + 'FROM ordenes_compra_detalle ' + y + "estado IN ('APROBADA', 'REGISTRA') AND saldo > 0",
    params
  );
  const rango = await uno('SELECT MIN(fecha_emision) AS desde, MAX(fecha_emision) AS hasta FROM ordenes_compra_detalle ' + sql, params);
  return {
    ...aCamel(totales), pen: porMoneda.pen, usd: porMoneda.usd,
    pendientes: { ordenes: pend.ordenes || 0, saldoPen: pend.saldoPen, saldoUsd: pend.saldoUsd },
    desde: rango.desde || '', hasta: rango.hasta || ''
  };
}

/** Los ítems de una sola OC, para el detalle. */
export async function porOC(numeroOc) {
  return (await todos('SELECT * FROM ordenes_compra_detalle WHERE numero_oc = ? ORDER BY id', [numeroOc])).map(aCamel);
}

export async function opciones() {
  const distintos = async campo => (await todos(
    'SELECT DISTINCT ' + campo + ' AS v FROM ordenes_compra_detalle WHERE ' + campo + " != '' ORDER BY v"
  )).map(r => r.v);
  return { areas: await distintos('area'), estados: await distintos('estado') };
}

/**
 * Ranking de proveedores según el filtro activo (fecha/moneda; si además hay
 * un proveedor elegido, esto no aporta nada nuevo -da un solo resultado-, así
 * que el llamador solo lo pide sin proveedor). Ordenado por el equivalente en
 * soles, igual criterio que ordenes_compra.js.
 */
export async function proveedores(f = {}) {
  const { sql, params } = condiciones(f);
  return (await todos(
    'SELECT proveedor, COUNT(DISTINCT numero_oc) AS ordenes, COUNT(*) AS items, '
    + `COALESCE(SUM(CASE WHEN moneda = 'PEN' THEN monto_neto ELSE 0 END), 0) AS "totalPen", `
    + `COALESCE(SUM(CASE WHEN moneda = 'USD' THEN monto_neto ELSE 0 END), 0) AS "totalUsd", `
    + 'COALESCE(SUM(valor_compra_mn), 0) AS "totalEquivalente" '
    + 'FROM ordenes_compra_detalle ' + (sql ? sql + " AND proveedor != ''" : "WHERE proveedor != ''")
    + ' GROUP BY proveedor ORDER BY "totalEquivalente" DESC',
    params
  )).map(aCamel);
}

/** Todos los proveedores sin filtrar, solo para poblar el selector del filtro (con su conteo global de OC). */
export async function todosLosProveedores() {
  return (await todos(
    'SELECT proveedor, MAX(ruc_proveedor) AS ruc, COUNT(DISTINCT numero_oc) AS ordenes, '
    + 'COALESCE(SUM(valor_compra_mn), 0) AS "totalEquivalente", MAX(fecha_emision) AS ultima '
    + "FROM ordenes_compra_detalle WHERE proveedor != '' "
    + 'GROUP BY proveedor ORDER BY ordenes DESC'
  )).map(aCamel);
}

/**
 * Ficha de un proveedor en el historial de OC: RUC, primera/última OC, y lo
 * que más se le compra -por ítem (código + moneda, nunca se mezcla S/ con
 * US$)- con su costo unitario promedio ponderado por cantidad, mínimo,
 * máximo y último, más su costo unitario mes a mes
 * (la "evolución de precio" de verdad, a nivel de producto).
 */
export async function perfilProveedor(proveedor) {
  const cab = await uno(
    'SELECT MAX(ruc_proveedor) AS ruc, COUNT(DISTINCT numero_oc) AS ordenes, COUNT(*) AS items, '
    + 'MIN(fecha_emision) AS primera, MAX(fecha_emision) AS ultima, '
    + 'COUNT(DISTINCT substr(fecha_emision, 1, 7)) AS "mesesActivos", COUNT(DISTINCT codigo_producto) AS productos '
    + 'FROM ordenes_compra_detalle WHERE proveedor = ?',
    [proveedor]
  );
  const productos = await todos(
    'SELECT codigo_producto AS codigo, MAX(descripcion_producto) AS descripcion, moneda, '
    + 'COUNT(DISTINCT numero_oc) AS ordenes, COALESCE(SUM(cantidad), 0) AS cantidad, '
    + 'COALESCE(SUM(monto_neto), 0) AS total, COALESCE(SUM(valor_compra_mn), 0) AS "totalEquivalente", '
    + 'CASE WHEN SUM(cantidad) > 0 THEN SUM(costo_unitario * cantidad) / SUM(cantidad) ELSE AVG(costo_unitario) END AS "costoPromedio", '
    + 'MIN(costo_unitario) AS "costoMin", MAX(costo_unitario) AS "costoMax", '
    + 'MIN(fecha_emision) AS primera, MAX(fecha_emision) AS ultima '
    + "FROM ordenes_compra_detalle WHERE proveedor = ? AND estado != 'ANULADA' "
    + 'GROUP BY codigo_producto, moneda ORDER BY "totalEquivalente" DESC LIMIT 12',
    [proveedor]
  );
  const SQL_ULTIMO_COSTO =
    'SELECT costo_unitario FROM ordenes_compra_detalle WHERE proveedor = ? AND codigo_producto = ? AND moneda = ? '
    + "AND estado != 'ANULADA' ORDER BY fecha_emision DESC, id DESC LIMIT 1";
  const SQL_SERIE =
    'SELECT substr(fecha_emision, 1, 7) AS mes, '
    + 'CASE WHEN SUM(cantidad) > 0 THEN SUM(costo_unitario * cantidad) / SUM(cantidad) ELSE AVG(costo_unitario) END AS costo, '
    + 'COALESCE(SUM(cantidad), 0) AS cantidad '
    + 'FROM ordenes_compra_detalle WHERE proveedor = ? AND codigo_producto = ? AND moneda = ? '
    + "AND estado != 'ANULADA' GROUP BY mes ORDER BY mes";

  // En serie y no con Promise.all: si esto corre dentro de una transacción,
  // todas las consultas van por un mismo cliente de pg, que no admite dos a
  // la vez. Son como mucho 12 productos × 2 consultas.
  const topProductos = [];
  for (const p of productos) {
    const claves = [proveedor, p.codigo, p.moneda];
    const ultimo = await uno(SQL_ULTIMO_COSTO, claves);
    const serie = await todos(SQL_SERIE, claves);
    topProductos.push({ ...p, ultimoCosto: (ultimo || {}).costo_unitario ?? null, serie });
  }

  return {
    ruc: cab.ruc || '', ordenes: cab.ordenes || 0, items: cab.items || 0, productos: cab.productos || 0,
    primera: cab.primera || null, ultima: cab.ultima || null, mesesActivos: cab.mesesActivos || 0,
    topProductos
  };
}

/** Evolución mensual (soles y dólares por separado) según el filtro activo: la pregunta "cómo cambia esto en el tiempo". */
export async function porMes(f = {}) {
  const { sql, params } = condiciones(f);
  return (await todos(
    'SELECT substr(fecha_emision, 1, 7) AS mes, COUNT(DISTINCT numero_oc) AS ordenes, '
    + `COALESCE(SUM(CASE WHEN moneda = 'PEN' THEN monto_neto ELSE 0 END), 0) AS "totalPen", `
    + `COALESCE(SUM(CASE WHEN moneda = 'USD' THEN monto_neto ELSE 0 END), 0) AS "totalUsd" `
    + 'FROM ordenes_compra_detalle ' + sql + ' GROUP BY mes ORDER BY mes',
    params
  )).map(aCamel);
}
