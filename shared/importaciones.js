/**
 * Importaciones del bot de logística (colección `importaciones` de Mongo):
 * normalización y todos los cálculos del apartado Importaciones. Puro, sin
 * E/S: lo usan la sincronización (normalizar), el servidor (analizar,
 * resumir) y los tests.
 *
 * Un registro es una OC de importación -o una solicitud que todavía no tiene
 * OC- con su recorrido: emisión → zarpe (ETD) → puerto (ETA) →
 * nacionalización → planta. El bot lo va llenando a mano y con el rastreo
 * automático de la naviera, así que muchos campos llegan vacíos: los cálculos
 * nunca suponen un dato que no está, y la completitud se mide aparte.
 *
 * Montos en US$ y SIN IGV, el mismo criterio que el resto de la plataforma:
 * el "impuesto" del bot es el 18% de IGV de importación, crédito fiscal y no
 * costo, así que va como pago pendiente pero no suma al costo puesto en planta.
 */

export const ESTADOS = [
  { k: 'COTIZACION_SOLICITADA', t: 'Cotizando', corto: 'Cotizando' },
  { k: 'ORDEN_CONFIRMADA', t: 'Orden confirmada', corto: 'Por embarcar' },
  { k: 'EN_TRANSITO', t: 'En tránsito', corto: 'En tránsito' },
  { k: 'ARRIBADO', t: 'Arribado a puerto', corto: 'En puerto' },
  { k: 'NACIONALIZADO', t: 'Nacionalizado', corto: 'Nacionalizado' },
  { k: 'EN_PLANTA', t: 'En planta', corto: 'En planta' },
  { k: 'ANULADO', t: 'Anulado', corto: 'Anulado' }
];
export const ETIQUETA_ESTADO = Object.fromEntries(ESTADOS.map(e => [e.k, e.t]));
/** Ya tiene OC y todavía no llega a planta: lo que un logístico tiene que mover. */
export const EN_CURSO = new Set(['ORDEN_CONFIRMADA', 'EN_TRANSITO', 'ARRIBADO', 'NACIONALIZADO']);
/** Hasta aquí la carga todavía no llegó al puerto de destino. */
const ANTES_DE_PUERTO = new Set(['ORDEN_CONFIRMADA', 'EN_TRANSITO']);

export const PRIORIDADES = ['CRÍTICO', 'URGENTE', 'ALTA', 'NORMAL', 'BAJA'];
export const ENVIOS = { MAR: 'Marítimo', AIRE: 'Aéreo', TERRESTRE: 'Terrestre' };

const DIA = 86400000;
const txt = v => (v == null || v === 'nan' || v === 'PENDIENTE_' ? '' : String(v).trim());
const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0);
const codigo = v => txt(v).replace(/\.0+$/, '');

/** 'YYYY-MM-DD' de un Date, un ISO o un 'dd/mm/yyyy'; '' si no hay fecha. */
export function fecha(v) {
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

/** Días de `a` a `b` (ambas 'YYYY-MM-DD'); null si falta alguna. */
export function dias(a, b) {
  if (!a || !b) return null;
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / DIA);
}

export function sumarDias(f, n) {
  return new Date(Date.parse(f + 'T00:00:00Z') + n * DIA).toISOString().slice(0, 10);
}

/** "PENDIENTE", "N/A" y parecidos que el bot usa como relleno: no son un dato. */
const relleno = v => /^(pendiente|n\/?a|-+|sin dato)$/i.test(txt(v));
const dato = v => (relleno(v) ? '' : txt(v));

/**
 * Un documento de Mongo → la fila que guarda la plataforma. Devuelve null
 * para lo que no es una importación a seguir: lo que el bot excluyó (no
 * era importación) o fusionó dentro de otro registro.
 */
export function normalizar(d) {
  if (!d || d.excluido === true || d.fusionada_en) return null;
  const erp = d.erp || {};
  const items = Array.isArray(erp.items) ? erp.items.map(i => ({
    codigo: codigo(i.codigo), descripcion: txt(i.descripcion), cantidad: num(i.cantidad),
    um: txt(i.um), costoUnit: num(i.costo_unit), valor: num(i.valor_compra), moneda: txt(i.moneda) || 'USD'
  })) : [];
  const moneda = (txt(d.moneda) || txt(erp.moneda_default) || 'USD').toUpperCase() === 'PEN' ? 'PEN' : 'USD';
  const tc = num(d.tc_compra) || num((erp.items || []).find(i => num(i.tc))?.tc) || 0;
  const historial = Array.isArray(d.historial) ? d.historial.slice(-12).reverse().map(h => ({
    fecha: txt(h.fecha instanceof Date ? h.fecha.toISOString() : h.fecha),
    campo: txt(h.campo), anterior: h.valor_anterior == null ? '' : txt(typeof h.valor_anterior === 'object' ? JSON.stringify(h.valor_anterior) : h.valor_anterior),
    nuevo: h.valor_nuevo == null ? '' : txt(typeof h.valor_nuevo === 'object' ? JSON.stringify(h.valor_nuevo) : h.valor_nuevo),
    por: txt(h.por), motivo: txt(h.motivo)
  })) : [];
  return {
    id: String(d._id),
    oc: codigo(d.oc_numero),
    esSolicitud: d.es_solicitud === true || !codigo(d.oc_numero),
    // "17 ítems consolidados" no identifica nada: con varias líneas, la
    // descripción es la de la primera y cuántas más vienen.
    descripcion: items.length > 1 && (/consolidad/i.test(txt(d.descripcion)) || !txt(d.descripcion))
      ? items[0].descripcion + ' (+' + (items.length - 1) + (items.length === 2 ? ' ítem)' : ' ítems)')
      : txt(d.descripcion),
    proveedor: txt(d.proveedor) || txt(erp.proveedor),
    codigo: codigo(d.codigo_producto),
    familia: txt(d.familia_nombre) || txt(erp.items?.[0]?.familia_nombre),
    linea: txt(d.linea_nombre) || txt(erp.items?.[0]?.linea_nombre),
    items,
    moneda,
    tc,
    valor: num(d.valor_compra),
    impuesto: num(d.impuesto),
    servLogistico: num(d.serv_logistico),
    cantidad: num(d.cantidad_kg),
    um: txt(d.um) || 'KG',
    contenedores: num(d.contenedores),
    costoUnit: num(d.costo_unit),
    estado: txt(d.estado_comercial) || 'ORDEN_CONFIRMADA',
    estadoLogistico: txt(d.estado_logistico),
    estadoPago: txt(d.estado_pago) || txt(d.pago_proveedor),
    estadoDocs: txt(d.estado_documentario),
    pagoImpuestos: txt(d.pago_impuestos),
    prioridad: txt(d.prioridad) || 'NORMAL',
    envio: dato(d.envio_por),
    pais: dato(d.pais_origen),
    naviera: dato(d.naviera),
    bl: dato(d.bl_booking),
    incoterm: dato(d.incoterm),
    agente: dato(d.agente_logistico),
    almacen: dato(d.almacen_destino),
    tipoPago: dato(d.tipo_pago_oc),
    ocEstadoErp: txt(d.oc_estado) || txt(erp.oc_estado),
    emision: fecha(d.fecha_emision),
    confirmada: fecha(d.fecha_orden_confirmada),
    etd: fecha(d.etd),
    eta: fecha(d.eta),
    etaPlanificada: fecha(d.eta_planificada),
    nacionalizacion: fecha(d.fecha_nacionalizacion_proy),
    planta: fecha(d.fecha_llegada_planta),
    plantaPlanificada: fecha(d.fecha_llegada_planta_planificada),
    plantaReal: fecha(d.fecha_llegada_planta_real),
    vencFactura: fecha(d.vencimiento_factura),
    vencFacturaTexto: txt(d.vencimiento_factura_texto),
    pagoServLog: fecha(d.fecha_pago_serv_log_proy),
    revisionesEta: Array.isArray(d.revisiones_eta) ? d.revisiones_eta.length : 0,
    trackingEstado: txt(d.tracking_estado),
    trackingDescripcion: txt(d.tracking_estado_desc),
    trackingFecha: fecha(d.tracking_fecha_ultimo_evento),
    sugerencias: Array.isArray(d.tracking_sugerencias)
      ? d.tracking_sugerencias.filter(s => txt(s.estado) === 'PENDIENTE').map(s => txt(s.motivo)) : [],
    avisos: Array.isArray(d.warnings_coherencia) ? d.warnings_coherencia.map(txt).filter(Boolean) : [],
    comentarios: txt(typeof d.comentarios === 'string' ? d.comentarios : ''),
    nota: txt(d.nota),
    actualizado: txt(d.fecha_actualizacion instanceof Date ? d.fecha_actualizacion.toISOString() : d.fecha_actualizacion),
    actualizadoPor: txt(d.actualizado_por),
    historial
  };
}

/** Monto en US$ de la importación (valor de compra; las pocas en soles, al tipo de cambio). */
function usd(i, monto) {
  if (i.moneda !== 'PEN') return monto;
  return i.tc ? monto / i.tc : monto / 3.75;
}

/** Datos que un logístico necesita para mover una importación en curso. */
function faltantes(i) {
  if (!EN_CURSO.has(i.estado)) return [];
  const f = [];
  if (!i.envio) f.push('vía de envío');
  if (!i.eta) f.push('ETA');
  if (!i.pais) f.push('país de origen');
  if (!i.incoterm) f.push('incoterm');
  if (i.envio === 'MAR') {
    if (!i.naviera) f.push('naviera');
    if (!i.bl && i.estado !== 'ORDEN_CONFIRMADA') f.push('BL / booking');
  } else if (!i.agente) f.push('agente / courier');
  if (!i.almacen) f.push('almacén destino');
  return f;
}
const CAMPOS_REQUERIDOS = 7;

/**
 * Lo que se calcula sobre una fila a una fecha dada (`hoy`, 'YYYY-MM-DD'):
 * etapa, atrasos, costo puesto en planta y avisos. `ratioServicio` es el
 * servicio logístico / valor de compra típico por vía de envío (de resumir),
 * para estimar el costo de las que todavía no tienen el servicio cotizado.
 */
export function analizar(i, hoy, ratioServicio = {}) {
  const enCurso = EN_CURSO.has(i.estado);
  const atrasoPuerto = ANTES_DE_PUERTO.has(i.estado) && i.eta && i.eta < hoy ? dias(i.eta, hoy) : 0;
  const atrasoPlanta = enCurso && i.planta && i.planta < hoy ? dias(i.planta, hoy) : 0;
  // El ERP ya recibió la mercadería (OC ATENDIDA) pero el bot sigue con la
  // importación abierta: casi siempre es que nadie actualizó el estado, no un
  // atraso real. Se avisa aparte para no inflar los atrasos.
  const posibleLlegada = enCurso && /ATENDIDA|CERRADA/.test(i.ocEstadoErp);
  const valorUsd = usd(i, i.valor);
  const servicio = usd(i, i.servLogistico);
  const ratio = ratioServicio[i.envio || 'OTRO'] ?? ratioServicio.OTRO ?? 0;
  const servicioEstimado = !servicio && valorUsd > 0 && ratio > 0;
  const servicioUsd = servicio || (servicioEstimado ? valorUsd * ratio : 0);
  const costoPlanta = valorUsd + servicioUsd;
  // Por kg solo para materias primas: el bot pone "1 KG" a una máquina o un
  // repuesto, y "US$ 8,270/kg" no le dice nada a nadie.
  const porKg = /^KG/i.test(i.um) && /MATERIA PRIMA/i.test(i.familia) && i.cantidad > 0 && valorUsd > 0 ? costoPlanta / i.cantidad : null;
  const falta = faltantes(i);
  const llegada = i.plantaReal || (i.estado === 'EN_PLANTA' ? i.planta || i.eta : '');
  const proxima = enCurso ? (ANTES_DE_PUERTO.has(i.estado) ? i.eta || i.planta : i.planta || i.nacionalizacion) : '';
  return {
    ...i,
    etiquetaEstado: ETIQUETA_ESTADO[i.estado] || i.estado,
    enCurso,
    atrasoPuerto,
    atrasoPlanta,
    atraso: posibleLlegada ? 0 : Math.max(atrasoPuerto, atrasoPlanta),
    posibleLlegada,
    valorUsd,
    impuestoUsd: usd(i, i.impuesto),
    servicioUsd,
    servicioEstimado,
    costoPlanta,
    porKg,
    faltantes: falta,
    completitud: enCurso ? Math.round((CAMPOS_REQUERIDOS - Math.min(falta.length, CAMPOS_REQUERIDOS)) / CAMPOS_REQUERIDOS * 100) : 100,
    llegada,
    leadTime: llegada && i.emision ? dias(i.emision, llegada) : null,
    proxima,
    diasParaProxima: proxima ? dias(hoy, proxima) : null
  };
}

const mediana = xs => {
  const v = xs.filter(x => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};

/** Servicio logístico / valor de compra (mediana) por vía de envío, de las que sí lo tienen. */
export function ratiosServicio(lista) {
  const por = {};
  for (const i of lista) {
    if (!(i.servLogistico > 0) || !(i.valor > 0)) continue;
    const r = i.servLogistico / i.valor;
    if (r > 1.5) continue; // un servicio mayor que la mercadería es un dato mal cargado
    (por[i.envio || 'OTRO'] ||= []).push(r);
    (por.OTRO_TODOS ||= []).push(r);
  }
  const salida = {};
  for (const [k, v] of Object.entries(por)) if (k !== 'OTRO_TODOS' && v.length >= 3) salida[k] = mediana(v);
  if (por.OTRO_TODOS?.length) salida.OTRO = mediana(por.OTRO_TODOS);
  return salida;
}

const mes = f => f.slice(0, 7);
function sumarPor(lista, clave, valor = x => x.valorUsd) {
  const m = new Map();
  for (const x of lista) {
    const k = clave(x) || '(sin dato)';
    const e = m.get(k) || { k, n: 0, valor: 0 };
    e.n++; e.valor += valor(x);
    m.set(k, e);
  }
  return [...m.values()].sort((a, b) => b.valor - a.valor);
}

/**
 * Pagos que quedan por hacer, con su fecha: proveedor (vencimiento de la
 * factura), impuestos de importación (al nacionalizar) y servicio logístico
 * (fecha proyectada del bot). Sin fecha van al final con `fecha: ''`.
 */
export function pagosPendientes(lista, hoy) {
  const pagos = [];
  for (const i of lista) {
    if (i.estado === 'ANULADO' || i.estado === 'COTIZACION_SOLICITADA') continue;
    const ref = { id: i.id, oc: i.oc, proveedor: i.proveedor, descripcion: i.descripcion };
    if (i.estadoPago && i.estadoPago !== 'PAGADO' && i.valorUsd > 0) {
      pagos.push({ ...ref, tipo: 'Proveedor', fecha: i.vencFactura, monto: i.valorUsd, parcial: i.estadoPago === 'PARCIAL', nota: i.vencFacturaTexto });
    }
    if (i.pagoImpuestos === 'PENDIENTE' && i.impuestoUsd > 0 && i.estado !== 'EN_PLANTA') {
      pagos.push({ ...ref, tipo: 'Impuestos (IGV)', fecha: i.nacionalizacion || i.eta, monto: i.impuestoUsd });
    }
    if (i.servLogistico > 0 && i.pagoServLog && dias(i.pagoServLog, hoy) <= 30 && i.estado !== 'EN_PLANTA') {
      pagos.push({ ...ref, tipo: 'Servicio logístico', fecha: i.pagoServLog, monto: usd(i, i.servLogistico) });
    }
  }
  return pagos
    .map(p => {
      const diasParaPago = p.fecha ? dias(hoy, p.fecha) : null;
      // Vencido hace más de DIAS_POR_CONFIRMAR: casi siempre es un pago hecho
      // que nadie marcó en el bot. Se separa para no inflar los vencidos.
      const porConfirmar = diasParaPago != null && diasParaPago < -DIAS_POR_CONFIRMAR;
      return { ...p, diasParaPago, porConfirmar, vencido: diasParaPago != null && diasParaPago < 0 && !porConfirmar };
    })
    .sort((a, b) => (a.fecha || '9999').localeCompare(b.fecha || '9999'));
}
export const DIAS_POR_CONFIRMAR = 60;

/**
 * Lista ya analizada → todo lo que pinta el apartado: indicadores, etapas,
 * llegadas por mes (6 pasados + el actual + 5 próximos), pagos, rankings y
 * tiempos de ciclo.
 */
export function resumir(lista, hoy) {
  const activas = lista.filter(i => i.estado !== 'ANULADO');
  const enCurso = activas.filter(i => i.enCurso);
  const atrasadas = enCurso.filter(i => i.atraso > 0);
  const en30 = enCurso.filter(i => i.diasParaProxima != null && i.diasParaProxima >= 0 && i.diasParaProxima <= 30);
  const todosLosPagos = pagosPendientes(activas, hoy);
  const pagos = todosLosPagos.filter(p => !p.porConfirmar);
  const porConfirmar = todosLosPagos.filter(p => p.porConfirmar);
  const pagos30 = pagos.filter(p => p.fecha && p.diasParaPago <= 30);
  const suma = (xs, f = x => x.valorUsd) => xs.reduce((a, x) => a + f(x), 0);

  const hace12 = sumarDias(hoy, -365);
  const llegadas12 = activas.filter(i => i.llegada && i.llegada >= hace12 && i.leadTime != null && i.leadTime >= 0);
  const leadTime = {
    todas: mediana(llegadas12.map(i => i.leadTime)),
    MAR: mediana(llegadas12.filter(i => i.envio === 'MAR').map(i => i.leadTime)),
    AIRE: mediana(llegadas12.filter(i => i.envio === 'AIRE').map(i => i.leadTime)),
    n: llegadas12.length
  };
  // Puntualidad: de las que ya llegaron con una ETA planificada, cuántas
  // llegaron a puerto a más tardar 3 días después de lo planificado.
  const conPlan = activas.filter(i => i.estado === 'EN_PLANTA' && i.etaPlanificada && i.eta);
  const puntuales = conPlan.filter(i => dias(i.etaPlanificada, i.eta) <= 3).length;

  const meses = [];
  const base = new Date(Date.parse(hoy.slice(0, 7) + '-01T00:00:00Z'));
  for (let k = -6; k <= 5; k++) {
    const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + k, 1));
    meses.push({ mes: d.toISOString().slice(0, 7), futuro: k > 0, actual: k === 0, valor: 0, n: 0 });
  }
  const porMes = new Map(meses.map(m => [m.mes, m]));
  for (const i of activas) {
    const f = i.enCurso ? (i.planta || i.eta) : i.llegada;
    const m = f && porMes.get(mes(f));
    if (m && (i.enCurso || i.estado === 'EN_PLANTA')) { m.valor += i.costoPlanta; m.n++; }
  }

  const completitud = enCurso.length ? Math.round(suma(enCurso, i => i.completitud) / enCurso.length) : 100;
  return {
    hoy,
    kpis: {
      enCurso: enCurso.length, valorEnCurso: suma(enCurso, i => i.costoPlanta),
      porEmbarcar: enCurso.filter(i => i.estado === 'ORDEN_CONFIRMADA').length,
      enTransito: enCurso.filter(i => i.estado === 'EN_TRANSITO').length,
      enPuerto: enCurso.filter(i => i.estado === 'ARRIBADO' || i.estado === 'NACIONALIZADO').length,
      atrasadas: atrasadas.length, valorAtrasado: suma(atrasadas, i => i.costoPlanta),
      atrasoMediano: mediana(atrasadas.map(i => i.atraso)),
      posiblesLlegadas: enCurso.filter(i => i.posibleLlegada).length,
      llegan30: en30.length, valorLlegan30: suma(en30, i => i.costoPlanta),
      cotizando: activas.filter(i => i.estado === 'COTIZACION_SOLICITADA').length,
      pagosPendientes: suma(pagos, p => p.monto), pagos30: suma(pagos30, p => p.monto), pagosVencidos: suma(pagos.filter(p => p.vencido), p => p.monto),
      nPagosVencidos: pagos.filter(p => p.vencido).length,
      pagosPorConfirmar: suma(porConfirmar, p => p.monto), nPagosPorConfirmar: porConfirmar.length,
      docsPendientes: enCurso.filter(i => i.estadoDocs === 'PENDIENTE' || !i.estadoDocs).length,
      completitud,
      puntualidad: conPlan.length ? Math.round(puntuales / conPlan.length * 100) : null, nPuntualidad: conPlan.length,
      sugerencias: enCurso.filter(i => i.sugerencias.length).length
    },
    leadTime,
    etapas: ESTADOS.filter(e => e.k !== 'ANULADO').map(e => {
      const xs = activas.filter(i => i.estado === e.k);
      return { k: e.k, t: e.corto, n: xs.length, valor: suma(xs, i => i.costoPlanta) };
    }),
    meses,
    pagos,
    pagosPorConfirmar: porConfirmar,
    porFamilia: sumarPor(enCurso, i => i.familia, i => i.costoPlanta),
    porProveedor: sumarPor(enCurso, i => i.proveedor, i => i.costoPlanta).slice(0, 8),
    porEnvio: sumarPor(enCurso, i => ENVIOS[i.envio] || 'Sin definir', i => i.costoPlanta),
    porPais: sumarPor(enCurso, i => i.pais || 'Sin país', i => i.costoPlanta)
  };
}
