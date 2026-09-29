import { todos, uno, aCamel, enTransaccion, insertarLote } from '../conexion.js';
import { tocar } from './ajustes.js';

/**
 * Órdenes de compra: el registro de compras de SUNAT (facturas ya emitidas y
 * contabilizadas), cargado una sola vez desde data/compras.js -ver
 * cargarInicial() y backend/db/sembrar.js-. A diferencia de
 * requerimientos_compra (que sí administra admin, alta/edición/baja), esto es
 * de solo lectura: la fuente de verdad es la contabilidad, no la app.
 *
 * El registro mezcla comprobantes en soles y en dólares: sumarlos tal cual da
 * un número sin sentido, así que todo lo que agrega dinero (resumen,
 * proveedores, meses) separa PEN de USD explícitamente. Para RANKEAR
 * proveedores y meses sí hace falta un solo número comparable, y ahí se usa
 * el equivalente en soles (`total * tipo_cambio` para lo que está en USD,
 * columna que cada comprobante ya trae) -solo para ordenar, nunca para
 * mostrarlo como si fuera un monto real-.
 */

const COLUMNAS = [
  'fecha_emision', 'codigo_sunat', 'tipo_comprobante', 'serie', 'numero_doc', 'numero_registro',
  'ruc', 'tipo_cambio', 'proveedor', 'moneda', 'monto_me', 'base_gravada', 'base_no_gravada',
  'igv', 'igv_no_gravado', 'otros', 'percepcion', 'total', 'glosa'
];

const EXPR_EQUIVALENTE_PEN = "(CASE WHEN moneda = 'USD' THEN total * tipo_cambio ELSE total END)";

// Hoy en UTC como texto 'YYYY-MM-DD' (lo que era date('now') en SQLite):
// fecha_emision es TEXT, así que se compara texto con texto.
const HOY = "to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD')";

/** Carga inicial idempotente: una fila con el mismo numero_registro no se duplica. */
export function cargarInicial(filas) {
  return enTransaccion(async () => {
    const n = await insertarLote('ordenes_compra', COLUMNAS, filas.map(f => ({
      fecha_emision: f.fechaEmision,
      codigo_sunat: f.codigoSunat || '',
      tipo_comprobante: f.tipoComprobante || '',
      serie: f.serie || '',
      numero_doc: f.numeroDoc || '',
      numero_registro: f.numeroRegistro,
      ruc: f.ruc || '',
      tipo_cambio: f.tipoCambio || 0,
      proveedor: f.proveedor || '',
      moneda: f.moneda === 'USD' ? 'USD' : 'PEN',
      monto_me: f.montoMe || 0,
      base_gravada: f.baseGravada || 0,
      base_no_gravada: f.baseNoGravada || 0,
      igv: f.igv || 0,
      igv_no_gravado: f.igvNoGravado || 0,
      otros: f.otros || 0,
      percepcion: f.percepcion || 0,
      total: f.total || 0,
      glosa: f.glosa || ''
    })), 'ON CONFLICT (numero_registro) DO NOTHING');
    await tocar();
    return n;
  });
}

export async function total() {
  return (await uno('SELECT COUNT(*) AS n FROM ordenes_compra')).n;
}

/** Filtros comunes a listar() y a los resúmenes: proveedor, rango de fechas, moneda y texto libre. */
function condiciones(f = {}) {
  const where = [];
  const params = {};
  if (f.proveedor) { where.push('proveedor = @proveedor'); params.proveedor = f.proveedor; }
  if (f.desde) { where.push('fecha_emision >= @desde'); params.desde = f.desde; }
  if (f.hasta) { where.push('fecha_emision <= @hasta'); params.hasta = f.hasta; }
  if (f.moneda) { where.push('moneda = @moneda'); params.moneda = f.moneda; }
  if (f.q) {
    where.push('(proveedor ILIKE @q OR glosa ILIKE @q OR numero_doc ILIKE @q OR ruc ILIKE @q)');
    params.q = '%' + f.q + '%';
  }
  return { sql: where.length ? 'WHERE ' + where.join(' AND ') : '', params };
}

/** Listado paginado, más reciente primero. */
export async function listar(f = {}) {
  const { sql, params } = condiciones(f);
  const pagina = Math.max(1, Number(f.pagina) || 1);
  const porPagina = Math.min(200, Math.max(1, Number(f.porPagina) || 50));

  const totalFilas = (await uno('SELECT COUNT(*) AS n FROM ordenes_compra ' + sql, params)).n;
  const filas = (await todos(
    'SELECT * FROM ordenes_compra ' + sql + ' ORDER BY fecha_emision DESC, id DESC LIMIT @limite OFFSET @offset',
    { ...params, limite: porPagina, offset: (pagina - 1) * porPagina }
  )).map(aCamel);

  return { filas, total: totalFilas, pagina, porPagina };
}

async function agregadoPorMoneda(sql, params) {
  const f = await uno(
    `SELECT SUM(CASE WHEN moneda = 'PEN' THEN 1 ELSE 0 END) AS "comprobantesPen", `
    + `COALESCE(SUM(CASE WHEN moneda = 'PEN' THEN total ELSE 0 END), 0) AS "totalPen", `
    + `SUM(CASE WHEN moneda = 'USD' THEN 1 ELSE 0 END) AS "comprobantesUsd", `
    + `COALESCE(SUM(CASE WHEN moneda = 'USD' THEN total ELSE 0 END), 0) AS "totalUsd" `
    + 'FROM ordenes_compra ' + sql,
    params
  );
  return {
    pen: { comprobantes: f.comprobantesPen || 0, total: f.totalPen, ticketPromedio: f.comprobantesPen ? f.totalPen / f.comprobantesPen : 0 },
    usd: { comprobantes: f.comprobantesUsd || 0, total: f.totalUsd, ticketPromedio: f.comprobantesUsd ? f.totalUsd / f.comprobantesUsd : 0 }
  };
}

/** Tarjetas (separadas por moneda) y ranking de proveedores y meses (ordenados por el equivalente en soles). */
export async function resumen(f = {}) {
  const { sql, params } = condiciones(f);
  // Una consulta tras otra (sin Promise.all): dentro de una transacción todas
  // comparten un mismo cliente de pg, que no admite consultas simultáneas.
  const totales = await uno(
    'SELECT COUNT(*) AS comprobantes, COUNT(DISTINCT proveedor) AS proveedores FROM ordenes_compra ' + sql, params
  );
  const porMoneda = await agregadoPorMoneda(sql, params);

  const porProveedor = (await todos(
    'SELECT proveedor, COUNT(*) AS comprobantes, '
    + `COALESCE(SUM(CASE WHEN moneda = 'PEN' THEN total ELSE 0 END), 0) AS "totalPen", `
    + `COALESCE(SUM(CASE WHEN moneda = 'USD' THEN total ELSE 0 END), 0) AS "totalUsd", `
    + 'COALESCE(SUM(' + EXPR_EQUIVALENTE_PEN + '), 0) AS "totalEquivalente" '
    + 'FROM ordenes_compra ' + sql + ' GROUP BY proveedor ORDER BY "totalEquivalente" DESC LIMIT 15',
    params
  )).map(aCamel);

  const porMes = (await todos(
    'SELECT substr(fecha_emision, 1, 7) AS mes, COUNT(*) AS comprobantes, '
    + `COALESCE(SUM(CASE WHEN moneda = 'PEN' THEN total ELSE 0 END), 0) AS "totalPen", `
    + `COALESCE(SUM(CASE WHEN moneda = 'USD' THEN total ELSE 0 END), 0) AS "totalUsd" `
    + 'FROM ordenes_compra ' + sql + ' GROUP BY mes ORDER BY mes',
    params
  )).map(aCamel);

  return {
    comprobantes: totales.comprobantes,
    proveedores: totales.proveedores,
    pen: porMoneda.pen,
    usd: porMoneda.usd,
    porProveedor,
    porMes
  };
}

/** Los proveedores de la lista, para el selector de filtro/evolución (ordenados por el equivalente en soles). */
export async function proveedores() {
  // ruc/primera/ultima: para el buscador de la sección Proveedores. "ultima"
  // ignora fechas futuras (hay comprobantes mal digitados, p. ej. año 2062).
  return (await todos(
    'SELECT proveedor, MAX(ruc) AS ruc, COUNT(*) AS comprobantes, '
    + `COALESCE(SUM(CASE WHEN moneda = 'PEN' THEN total ELSE 0 END), 0) AS "totalPen", `
    + `COALESCE(SUM(CASE WHEN moneda = 'USD' THEN total ELSE 0 END), 0) AS "totalUsd", `
    + 'COALESCE(SUM(' + EXPR_EQUIVALENTE_PEN + '), 0) AS "totalEquivalente", '
    + 'MIN(fecha_emision) AS primera, MAX(CASE WHEN fecha_emision <= ' + HOY + ' THEN fecha_emision END) AS ultima '
    + 'FROM ordenes_compra GROUP BY proveedor ORDER BY "totalEquivalente" DESC'
  )).map(aCamel);
}

/**
 * Ficha de un proveedor en el registro SUNAT: RUC, primera/última compra y
 * cuántos meses distintos tuvo comprobantes. Las fechas posteriores a hoy
 * (errores de digitación en el registro) no cuentan como "última compra":
 * se informan aparte en `fechasFuturas`.
 */
export async function perfilProveedor(proveedor) {
  const f = await uno(
    'SELECT MAX(ruc) AS ruc, COUNT(*) AS comprobantes, MIN(fecha_emision) AS primera, '
    + 'MAX(CASE WHEN fecha_emision <= ' + HOY + ' THEN fecha_emision END) AS ultima, '
    + 'SUM(CASE WHEN fecha_emision > ' + HOY + ' THEN 1 ELSE 0 END) AS "fechasFuturas", '
    + 'COUNT(DISTINCT substr(fecha_emision, 1, 7)) AS "mesesActivos" '
    + 'FROM ordenes_compra WHERE proveedor = ?',
    [proveedor]
  );
  return {
    ruc: f.ruc || '', comprobantes: f.comprobantes || 0, primera: f.primera || null, ultima: f.ultima || null,
    fechasFuturas: f.fechasFuturas || 0, mesesActivos: f.mesesActivos || 0
  };
}

/**
 * Evolución de precio de un proveedor: promedio del monto neto por
 * comprobante, mes a mes. Es el dato disponible en el registro de compras
 * -no hay precio unitario ni cantidad, solo el total facturado-, así que
 * "evolución de precio" se lee como "cuánto cuesta en promedio cada
 * comprobante de este proveedor a lo largo del tiempo".
 */
export async function evolucionProveedor(proveedor) {
  return (await todos(
    'SELECT substr(fecha_emision, 1, 7) AS mes, COUNT(*) AS comprobantes, '
    + 'COALESCE(SUM(total), 0) AS "totalNeto", COALESCE(AVG(total), 0) AS "promedioNeto", moneda '
    + 'FROM ordenes_compra WHERE proveedor = ? GROUP BY mes, moneda ORDER BY mes',
    [proveedor]
  )).map(aCamel);
}
