import { db, aCamel, enTransaccion } from '../conexion.js';
import { tocar } from './ajustes.js';

/**
 * Historial de requerimientos de compra del ERP (data/
 * requerimientosCompraHistorico.js): solo lectura, contraparte de
 * requerimientosCompra.js (que sí administra admin). Puede haber varias
 * filas por (numero_requerimiento, item) -una por cada atención parcial-;
 * `listar()` y `resumen()` trabajan sobre la ÚLTIMA fila de cada grupo (el
 * estado/saldo más reciente), no sobre el total de filas.
 *
 * `codigo_producto` enlaza con productos.codigo (ver data/
 * requerimientosCompraHistorico.js): listar()/resumen()/opciones() hacen LEFT
 * JOIN con productos para poder filtrar por familia/línea del producto, no
 * solo por su código.
 */

const COLUMNAS = [
  'clave', 'fecha_emision', 'numero_requerimiento_cabecera', 'numero_requerimiento', 'item',
  'codigo_producto', 'nombre_producto', 'unidad_medida', 'cantidad', 'atendida', 'saldo',
  'fecha_entrega_comprometida', 'estado', 'numero_oc', 'proveedor',
  'ref1_tipo', 'ref1_serie', 'ref1_numero', 'ref2_tipo', 'ref2_serie', 'ref2_numero',
  'fecha_atencion', 'cantidad_atendida', 'glosa'
];

export function cargarInicial(filas) {
  return enTransaccion(base => {
    const insertar = base.prepare(
      'INSERT INTO requerimientos_compra_detalle (' + COLUMNAS.join(', ') + ') VALUES (' +
      COLUMNAS.map(c => '@' + c).join(', ') + ') ON CONFLICT (clave) DO NOTHING'
    );
    let n = 0;
    filas.forEach(d => {
      n += insertar.run({
        clave: d.clave,
        fecha_emision: d.fechaEmision,
        numero_requerimiento_cabecera: d.numeroRequerimientoCabecera || '',
        numero_requerimiento: d.numeroRequerimiento,
        item: d.item || 0,
        codigo_producto: d.codigoProducto || '',
        nombre_producto: d.nombreProducto || '',
        unidad_medida: d.unidadMedida || '',
        cantidad: d.cantidad || 0,
        atendida: d.atendida || 0,
        saldo: d.saldo || 0,
        fecha_entrega_comprometida: d.fechaEntregaComprometida || '',
        estado: d.estado || '',
        numero_oc: d.numeroOc || '',
        proveedor: d.proveedor || '',
        ref1_tipo: d.ref1Tipo || '', ref1_serie: d.ref1Serie || '', ref1_numero: d.ref1Numero || '',
        ref2_tipo: d.ref2Tipo || '', ref2_serie: d.ref2Serie || '', ref2_numero: d.ref2Numero || '',
        fecha_atencion: d.fechaAtencion || '',
        cantidad_atendida: d.cantidadAtendida || 0,
        glosa: d.glosa || ''
      }).changes;
    });
    tocar();
    return n;
  });
}

export function total() {
  return db().prepare('SELECT COUNT(*) AS n FROM requerimientos_compra_detalle').get().n;
}

/** La fila más reciente (mayor id) de cada (numero_requerimiento, item): un requerimiento, no una atención. */
const ULTIMA_FILA_POR_GRUPO =
  'SELECT MAX(id) AS id FROM requerimientos_compra_detalle GROUP BY numero_requerimiento, item';

const DESDE = 'FROM requerimientos_compra_detalle d LEFT JOIN productos p ON p.codigo = d.codigo_producto';

function condiciones(f = {}) {
  const where = ['d.id IN (' + ULTIMA_FILA_POR_GRUPO + ')'];
  const params = {};
  if (f.proveedor) { where.push('d.proveedor = @proveedor'); params.proveedor = f.proveedor; }
  if (f.estado) { where.push('d.estado = @estado'); params.estado = f.estado; }
  if (f.codigoProducto) { where.push('d.codigo_producto = @codigoProducto'); params.codigoProducto = f.codigoProducto; }
  if (f.familia) { where.push('p.familia = @familia'); params.familia = f.familia; }
  if (f.linea) { where.push('p.linea = @linea'); params.linea = f.linea; }
  if (f.desde) { where.push('d.fecha_emision >= @desde'); params.desde = f.desde; }
  if (f.hasta) { where.push('d.fecha_emision <= @hasta'); params.hasta = f.hasta; }
  if (f.q) {
    where.push('(d.nombre_producto LIKE @q OR d.proveedor LIKE @q OR d.glosa LIKE @q OR d.numero_requerimiento LIKE @q OR d.codigo_producto LIKE @q)');
    params.q = '%' + f.q + '%';
  }
  return { sql: 'WHERE ' + where.join(' AND '), params };
}

export function listar(f = {}) {
  const { sql, params } = condiciones(f);
  const pagina = Math.max(1, Number(f.pagina) || 1);
  const porPagina = Math.min(200, Math.max(1, Number(f.porPagina) || 50));

  const totalFilas = db().prepare('SELECT COUNT(*) AS n ' + DESDE + ' ' + sql).get(params).n;
  const filas = db().prepare(
    'SELECT d.*, p.familia AS producto_familia, p.linea AS producto_linea ' + DESDE + ' ' + sql
    + ' ORDER BY d.fecha_emision DESC, d.id DESC LIMIT @limite OFFSET @offset'
  ).all({ ...params, limite: porPagina, offset: (pagina - 1) * porPagina }).map(aCamel);

  return { filas, total: totalFilas, pagina, porPagina };
}

export function resumen(f = {}) {
  const { sql, params } = condiciones(f);
  const totales = db().prepare(
    "SELECT COUNT(*) AS requerimientos, COALESCE(SUM(CASE WHEN d.estado = 'APROBADA' THEN 1 ELSE 0 END), 0) AS aprobados, "
    + "COALESCE(SUM(CASE WHEN d.estado = 'PARCIALMEN' THEN 1 ELSE 0 END), 0) AS parciales, "
    // "Pendiente" no es un estado propio del ERP -solo existen APROBADA y
    // PARCIALMEN-: es un aprobado al que todavía no se le atendió nada
    // (atendida = 0), o sea, en la cola sin tocar. Es subconjunto de
    // `aprobados`, no una cuarta categoría aparte.
    + "COALESCE(SUM(CASE WHEN d.estado = 'APROBADA' AND d.atendida <= 0 THEN 1 ELSE 0 END), 0) AS pendientes, "
    + 'COUNT(DISTINCT d.proveedor) AS proveedores, COUNT(DISTINCT d.codigo_producto) AS productos '
    + DESDE + ' ' + sql
  ).get(params);

  const porProveedor = db().prepare(
    'SELECT d.proveedor AS proveedor, COUNT(*) AS requerimientos ' + DESDE + ' ' + sql
    + " AND d.proveedor != '' GROUP BY d.proveedor ORDER BY requerimientos DESC LIMIT 10"
  ).all(params).map(aCamel);

  return { ...totales, porProveedor };
}

export function proveedores() {
  return db().prepare(
    "SELECT proveedor, COUNT(*) AS requerimientos FROM requerimientos_compra_detalle WHERE proveedor != '' "
    + 'GROUP BY proveedor ORDER BY requerimientos DESC'
  ).all().map(aCamel);
}

/** Familias y líneas de los productos que de verdad aparecen en el historial -no las 38 del catálogo completo-. */
export function opciones() {
  const distintos = campo => db().prepare(
    'SELECT DISTINCT p.' + campo + ' AS v ' + DESDE + " WHERE p." + campo + " IS NOT NULL AND p." + campo + " != '' ORDER BY v"
  ).all().map(r => r.v);
  return { familias: distintos('familia'), lineas: distintos('linea') };
}

/** Requerimientos históricos de un producto: el cruce que pide Productos → "dónde se pidió esto". */
export function porProducto(codigoProducto) {
  return db().prepare(
    'SELECT * FROM requerimientos_compra_detalle WHERE codigo_producto = ? AND id IN (' + ULTIMA_FILA_POR_GRUPO + ') '
    + 'ORDER BY fecha_emision DESC'
  ).all(codigoProducto).map(aCamel);
}
