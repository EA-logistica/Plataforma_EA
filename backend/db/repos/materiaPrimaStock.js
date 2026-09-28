import { db, aCamel, enTransaccion } from '../conexion.js';
import { tocar } from './ajustes.js';

/**
 * Stock valorizado de materia prima (data/materiaPrimaStock.js): es una foto
 * del stock a la fecha del reporte, no un histórico, así que cargarInicial()
 * reemplaza todo en cada recarga. Navegación en cuatro niveles -Tipo (MATERIA
 * PRIMA / MATERIA PRIMA - TINTAS, columna cruda `categoria_nivel3` del ERP) →
 * Categoría (derivada) → Línea (familia) → Producto-, más el corte por
 * almacén, con drill-down directo (clic en un almacén trae sus productos).
 */

const COLUMNAS = [
  'almacen_codigo', 'almacen', 'categoria_nivel3', 'familia', 'categoria',
  'codigo', 'codigo_alterno', 'descripcion', 'unidad_medida', 'ubicacion',
  'stock', 'costo_promedio_usd', 'valorizado_usd'
];

export function cargarInicial(filas) {
  return enTransaccion(base => {
    base.exec('DELETE FROM materia_prima_stock');
    const insertar = base.prepare(
      'INSERT INTO materia_prima_stock (' + COLUMNAS.join(', ') + ') VALUES (' +
      COLUMNAS.map(c => '@' + c).join(', ') + ')'
    );
    filas.forEach(f => {
      insertar.run({
        almacen_codigo: f.almacenCodigo || '', almacen: f.almacen || '',
        categoria_nivel3: f.categoriaNivel3 || '', familia: f.familia || '', categoria: f.categoria || 'OTROS',
        codigo: f.codigo, codigo_alterno: f.codigoAlterno || '', descripcion: f.descripcion || '',
        unidad_medida: f.unidadMedida || '', ubicacion: f.ubicacion || '',
        stock: f.stock || 0, costo_promedio_usd: f.costoPromedioUsd || 0, valorizado_usd: f.valorizadoUsd || 0
      });
    });
    tocar();
    return filas.length;
  });
}

export function total() {
  return db().prepare('SELECT COUNT(*) AS n FROM materia_prima_stock').get().n;
}

/** SUM(stock) agrupado por unidad de medida: nunca se suma kg con unidades. */
function stockPorUm(where, params, campoAgrupador) {
  const filas = db().prepare(
    'SELECT ' + campoAgrupador + ' AS grupo, unidad_medida AS um, SUM(stock) AS stock '
    + 'FROM materia_prima_stock ' + where + ' GROUP BY ' + campoAgrupador + ', unidad_medida'
  ).all(params);
  const porGrupo = new Map();
  filas.forEach(f => {
    if (!porGrupo.has(f.grupo)) porGrupo.set(f.grupo, []);
    porGrupo.get(f.grupo).push({ um: f.um, stock: f.stock });
  });
  return porGrupo;
}

function condicionTipo(tipo) {
  return tipo ? { sql: 'WHERE categoria_nivel3 = @tipo', params: { tipo } } : { sql: '', params: {} };
}

/** Los dos tipos del ERP -MATERIA PRIMA y MATERIA PRIMA - TINTAS-, cada uno con lo suyo aparte. */
export function tipos() {
  return db().prepare(
    'SELECT categoria_nivel3 AS tipo, COUNT(DISTINCT codigo) AS productos, '
    + 'COALESCE(SUM(valorizado_usd), 0) AS valorizadoUsd '
    + "FROM materia_prima_stock WHERE categoria_nivel3 != '' GROUP BY categoria_nivel3 ORDER BY tipo"
  ).all().map(aCamel);
}

/** Tarjetas generales: productos distintos, categorías, almacenes, valorizado y stock (por UM). Todo o un solo tipo. */
export function resumen(tipo) {
  const { sql, params } = condicionTipo(tipo);
  const totales = db().prepare(
    'SELECT COUNT(DISTINCT codigo) AS productos, COUNT(DISTINCT categoria) AS categorias, '
    + 'COUNT(DISTINCT almacen) AS almacenes, COALESCE(SUM(valorizado_usd), 0) AS valorizadoUsd '
    + 'FROM materia_prima_stock ' + sql
  ).get(params);
  const stock = db().prepare(
    'SELECT unidad_medida AS um, SUM(stock) AS stock FROM materia_prima_stock ' + sql + ' GROUP BY unidad_medida ORDER BY stock DESC'
  ).all(params);
  return { ...aCamel(totales), stockPorUm: stock.map(aCamel) };
}

/** Categorías dentro de un tipo: stock, valorizado y productos distintos de cada una. */
export function categorias(tipo) {
  const { sql, params } = condicionTipo(tipo);
  const filas = db().prepare(
    'SELECT categoria, COUNT(DISTINCT codigo) AS productos, COUNT(DISTINCT familia) AS lineas, '
    + 'COALESCE(SUM(valorizado_usd), 0) AS valorizadoUsd '
    + 'FROM materia_prima_stock ' + sql + ' GROUP BY categoria ORDER BY valorizadoUsd DESC'
  ).all(params).map(aCamel);
  const porUm = stockPorUm(sql, params, 'categoria');
  return filas.map(f => ({ ...f, stockPorUm: porUm.get(f.categoria) || [] }));
}

/**
 * Líneas (familia) dentro de una categoría. `tipo` es opcional pero hay que
 * mandarlo: categorías como ADITIVOS u OTROS existen en ambos tipos, y sin
 * él la línea mezclaba MATERIA PRIMA con TINTAS.
 */
export function lineasDeCategoria(categoria, tipo) {
  const where = 'WHERE categoria = @categoria' + (tipo ? ' AND categoria_nivel3 = @tipo' : '');
  const params = tipo ? { categoria, tipo } : { categoria };
  const filas = db().prepare(
    'SELECT familia, COUNT(DISTINCT codigo) AS productos, COUNT(DISTINCT almacen) AS almacenes, '
    + 'COALESCE(SUM(valorizado_usd), 0) AS valorizadoUsd '
    + 'FROM materia_prima_stock ' + where + ' GROUP BY familia ORDER BY valorizadoUsd DESC'
  ).all(params).map(aCamel);
  const porUm = stockPorUm(where, params, 'familia');
  return filas.map(f => ({ ...f, stockPorUm: porUm.get(f.familia) || [] }));
}

/** Productos dentro de una línea, con su stock y valorizado sumados en todos los almacenes donde está (opcionalmente acotado a un tipo). */
export function productosDeLinea(familia, tipo) {
  return db().prepare(
    'SELECT codigo, MAX(descripcion) AS descripcion, unidad_medida, COUNT(DISTINCT almacen) AS almacenes, '
    + 'SUM(stock) AS stock, COALESCE(SUM(valorizado_usd), 0) AS valorizadoUsd '
    + 'FROM materia_prima_stock WHERE familia = @familia' + (tipo ? ' AND categoria_nivel3 = @tipo' : '')
    + ' GROUP BY codigo, unidad_medida ORDER BY valorizadoUsd DESC'
  ).all(tipo ? { familia, tipo } : { familia }).map(aCamel);
}

/** El corte por almacén de un producto puntual: "cuánta cantidad hay en los almacenes". */
export function almacenesDeProducto(codigo) {
  return db().prepare(
    'SELECT almacen, ubicacion, unidad_medida, stock, costo_promedio_usd, valorizado_usd '
    + 'FROM materia_prima_stock WHERE codigo = ? ORDER BY valorizado_usd DESC'
  ).all(codigo).map(aCamel);
}

/** Vista global por almacén, para responder "cuánto de todo hay en cada almacén" sin entrar a un producto. */
export function almacenes(tipo) {
  const { sql, params } = condicionTipo(tipo);
  const filas = db().prepare(
    'SELECT almacen, almacen_codigo, COUNT(DISTINCT codigo) AS productos, '
    + 'COALESCE(SUM(valorizado_usd), 0) AS valorizadoUsd '
    + 'FROM materia_prima_stock ' + sql + ' GROUP BY almacen ORDER BY valorizadoUsd DESC'
  ).all(params).map(aCamel);
  const porUm = stockPorUm(sql, params, 'almacen');
  return filas.map(f => ({ ...f, stockPorUm: porUm.get(f.almacen) || [] }));
}

/** Clic directo en un almacén: qué SKU y cuánto stock/valorizado tiene, sin pasar por Categoría → Línea. */
export function productosDeAlmacen(almacen, tipo) {
  return db().prepare(
    'SELECT codigo, descripcion, categoria, familia, unidad_medida, stock, costo_promedio_usd, valorizado_usd '
    + 'FROM materia_prima_stock WHERE almacen = @almacen' + (tipo ? ' AND categoria_nivel3 = @tipo' : '')
    + ' ORDER BY valorizado_usd DESC'
  ).all(tipo ? { almacen, tipo } : { almacen }).map(aCamel);
}

export function buscarProductos(q) {
  return db().prepare(
    'SELECT codigo, MAX(descripcion) AS descripcion, MAX(categoria) AS categoria, MAX(familia) AS familia, '
    + 'unidad_medida, COUNT(DISTINCT almacen) AS almacenes, SUM(stock) AS stock, COALESCE(SUM(valorizado_usd), 0) AS valorizadoUsd '
    + 'FROM materia_prima_stock WHERE codigo LIKE @q OR descripcion LIKE @q '
    + 'GROUP BY codigo, unidad_medida ORDER BY valorizadoUsd DESC LIMIT 50'
  ).all({ q: '%' + q + '%' }).map(aCamel);
}
