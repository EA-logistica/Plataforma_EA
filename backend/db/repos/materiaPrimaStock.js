import { todos, uno, ejecutar, insertarLote, aCamel, enTransaccion } from '../conexion.js';
import { tocar } from './ajustes.js';
import { SQL_FECHA_ALTA } from './productos.js';

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

export async function cargarInicial(filas) {
  return enTransaccion(async () => {
    await ejecutar('DELETE FROM materia_prima_stock');
    await insertarLote('materia_prima_stock', COLUMNAS, filas.map(f => ({
      almacen_codigo: f.almacenCodigo || '', almacen: f.almacen || '',
      categoria_nivel3: f.categoriaNivel3 || '', familia: f.familia || '', categoria: f.categoria || 'OTROS',
      codigo: f.codigo, codigo_alterno: f.codigoAlterno || '', descripcion: f.descripcion || '',
      unidad_medida: f.unidadMedida || '', ubicacion: f.ubicacion || '',
      stock: f.stock || 0, costo_promedio_usd: f.costoPromedioUsd || 0, valorizado_usd: f.valorizadoUsd || 0
    })));
    await tocar();
    return filas.length;
  });
}

export async function total() {
  return (await uno('SELECT COUNT(*) AS n FROM materia_prima_stock')).n;
}

/** SUM(stock) agrupado por unidad de medida: nunca se suma kg con unidades. */
async function stockPorUm(where, params, campoAgrupador) {
  const filas = await todos(
    'SELECT ' + campoAgrupador + ' AS grupo, unidad_medida AS um, SUM(stock) AS stock '
    + 'FROM materia_prima_stock ' + where + ' GROUP BY ' + campoAgrupador + ', unidad_medida',
    params
  );
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
export async function tipos() {
  return (await todos(
    'SELECT categoria_nivel3 AS tipo, COUNT(DISTINCT codigo) AS productos, '
    + 'COALESCE(SUM(valorizado_usd), 0) AS "valorizadoUsd" '
    + "FROM materia_prima_stock WHERE categoria_nivel3 != '' GROUP BY categoria_nivel3 ORDER BY tipo"
  )).map(aCamel);
}

/** Tarjetas generales: productos distintos, categorías, almacenes, valorizado y stock (por UM). Todo o un solo tipo. */
export async function resumen(tipo) {
  const { sql, params } = condicionTipo(tipo);
  const totales = await uno(
    'SELECT COUNT(DISTINCT codigo) AS productos, COUNT(DISTINCT categoria) AS categorias, '
    + 'COUNT(DISTINCT almacen) AS almacenes, COALESCE(SUM(valorizado_usd), 0) AS "valorizadoUsd" '
    + 'FROM materia_prima_stock ' + sql,
    params
  );
  const stock = await todos(
    'SELECT unidad_medida AS um, SUM(stock) AS stock FROM materia_prima_stock ' + sql + ' GROUP BY unidad_medida ORDER BY stock DESC',
    params
  );
  return { ...aCamel(totales), stockPorUm: stock.map(aCamel) };
}

/** Categorías dentro de un tipo: stock, valorizado y productos distintos de cada una. */
export async function categorias(tipo) {
  const { sql, params } = condicionTipo(tipo);
  const filas = (await todos(
    'SELECT categoria, COUNT(DISTINCT codigo) AS productos, COUNT(DISTINCT familia) AS lineas, '
    + 'COALESCE(SUM(valorizado_usd), 0) AS "valorizadoUsd" '
    + 'FROM materia_prima_stock ' + sql + ' GROUP BY categoria ORDER BY "valorizadoUsd" DESC',
    params
  )).map(aCamel);
  const porUm = await stockPorUm(sql, params, 'categoria');
  return filas.map(f => ({ ...f, stockPorUm: porUm.get(f.categoria) || [] }));
}

/**
 * Líneas (familia) dentro de una categoría. `tipo` es opcional pero hay que
 * mandarlo: categorías como ADITIVOS u OTROS existen en ambos tipos, y sin
 * él la línea mezclaba MATERIA PRIMA con TINTAS.
 */
export async function lineasDeCategoria(categoria, tipo) {
  const where = 'WHERE categoria = @categoria' + (tipo ? ' AND categoria_nivel3 = @tipo' : '');
  const params = tipo ? { categoria, tipo } : { categoria };
  const filas = (await todos(
    'SELECT familia, COUNT(DISTINCT codigo) AS productos, COUNT(DISTINCT almacen) AS almacenes, '
    + 'COALESCE(SUM(valorizado_usd), 0) AS "valorizadoUsd" '
    + 'FROM materia_prima_stock ' + where + ' GROUP BY familia ORDER BY "valorizadoUsd" DESC',
    params
  )).map(aCamel);
  const porUm = await stockPorUm(where, params, 'familia');
  return filas.map(f => ({ ...f, stockPorUm: porUm.get(f.familia) || [] }));
}

/** Productos dentro de una línea, con su stock y valorizado sumados en todos los almacenes donde está (opcionalmente acotado a un tipo). */
export async function productosDeLinea(familia, tipo) {
  return (await todos(
    'SELECT codigo, MAX(descripcion) AS descripcion, unidad_medida, COUNT(DISTINCT almacen) AS almacenes, '
    + 'SUM(stock) AS stock, COALESCE(SUM(valorizado_usd), 0) AS "valorizadoUsd" '
    + 'FROM materia_prima_stock WHERE familia = @familia' + (tipo ? ' AND categoria_nivel3 = @tipo' : '')
    + ' GROUP BY codigo, unidad_medida ORDER BY "valorizadoUsd" DESC',
    tipo ? { familia, tipo } : { familia }
  )).map(aCamel);
}

/** El corte por almacén de un producto puntual: "cuánta cantidad hay en los almacenes". */
export async function almacenesDeProducto(codigo) {
  return (await todos(
    'SELECT almacen, ubicacion, unidad_medida, stock, costo_promedio_usd, valorizado_usd '
    + 'FROM materia_prima_stock WHERE codigo = ? ORDER BY valorizado_usd DESC',
    [codigo]
  )).map(aCamel);
}

/** Vista global por almacén, para responder "cuánto de todo hay en cada almacén" sin entrar a un producto. */
export async function almacenes(tipo) {
  const { sql, params } = condicionTipo(tipo);
  // almacen_codigo va con MAX(): PostgreSQL no admite columnas sueltas fuera
  // del GROUP BY (cada almacén tiene un solo código, así que da lo mismo).
  const filas = (await todos(
    'SELECT almacen, MAX(almacen_codigo) AS almacen_codigo, COUNT(DISTINCT codigo) AS productos, '
    + 'COALESCE(SUM(valorizado_usd), 0) AS "valorizadoUsd" '
    + 'FROM materia_prima_stock ' + sql + ' GROUP BY almacen ORDER BY "valorizadoUsd" DESC',
    params
  )).map(aCamel);
  const porUm = await stockPorUm(sql, params, 'almacen');
  return filas.map(f => ({ ...f, stockPorUm: porUm.get(f.almacen) || [] }));
}

/** Clic directo en un almacén: qué SKU y cuánto stock/valorizado tiene, sin pasar por Categoría → Línea. */
export async function productosDeAlmacen(almacen, tipo) {
  return (await todos(
    'SELECT codigo, descripcion, categoria, familia, unidad_medida, stock, costo_promedio_usd, valorizado_usd '
    + 'FROM materia_prima_stock WHERE almacen = @almacen' + (tipo ? ' AND categoria_nivel3 = @tipo' : '')
    + ' ORDER BY valorizado_usd DESC',
    tipo ? { almacen, tipo } : { almacen }
  )).map(aCamel);
}

const MP = "('MATERIA PRIMA', 'MATERIA PRIMA - TINTAS')";

/**
 * Búsqueda por código o descripción. Primero lo que tiene stock; después,
 * los códigos de materia prima del catálogo que no tienen stock -los recién
 * dados de alta en el ERP, sobre todo-, para que también se encuentren.
 */
export async function buscarProductos(q) {
  const conStock = (await todos(
    'SELECT codigo, MAX(descripcion) AS descripcion, MAX(categoria) AS categoria, MAX(familia) AS familia, '
    + 'unidad_medida, COUNT(DISTINCT almacen) AS almacenes, SUM(stock) AS stock, COALESCE(SUM(valorizado_usd), 0) AS "valorizadoUsd" '
    + 'FROM materia_prima_stock WHERE codigo ILIKE @q OR descripcion ILIKE @q '
    + 'GROUP BY codigo, unidad_medida ORDER BY "valorizadoUsd" DESC LIMIT 50',
    { q: '%' + q + '%' }
  )).map(aCamel);
  if (conStock.length >= 50) return conStock;
  const sinStock = (await todos(
    "SELECT p.codigo, p.descripcion, 'SIN STOCK' AS categoria, p.linea AS familia, p.unidad_medida, "
    + '0 AS almacenes, 0 AS stock, 0 AS "valorizadoUsd" '
    + 'FROM productos p WHERE p.familia IN ' + MP + ' AND (p.codigo ILIKE @q OR p.descripcion ILIKE @q) '
    + 'AND NOT EXISTS (SELECT 1 FROM materia_prima_stock s WHERE s.codigo = p.codigo) '
    + 'ORDER BY p.codigo DESC LIMIT ' + (50 - conStock.length),
    { q: '%' + q + '%' }
  )).map(aCamel);
  return [...conStock, ...sinStock];
}

/**
 * Códigos de materia prima dados de alta en los últimos `dias` (fecha del
 * ERP o, si no la trae, la primera vez que la plataforma los vio), tengan o
 * no stock todavía, con la última muestra registrada para ese código.
 */
export async function codigosNuevos(dias = 90) {
  const n = Math.min(Math.max(Math.trunc(Number(dias)) || 90, 1), 730);
  const desde = new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
  return (await todos(
    'SELECT p.codigo, p.descripcion, p.familia AS tipo, p.linea, p.unidad_medida, ' + SQL_FECHA_ALTA + ' AS fecha_alta, '
    + 'COALESCE(s.stock, 0) AS stock, COALESCE(s.valorizado, 0) AS valorizado_usd, '
    + 'm.estado AS estado_muestra, m.fecha_llegada AS fecha_muestra '
    + 'FROM productos p LEFT JOIN productos_alta a ON a.codigo = p.codigo '
    + 'LEFT JOIN (SELECT codigo, SUM(stock) AS stock, SUM(valorizado_usd) AS valorizado FROM materia_prima_stock GROUP BY codigo) s ON s.codigo = p.codigo '
    + 'LEFT JOIN LATERAL (SELECT estado, fecha_llegada FROM muestras_mp WHERE codigo_producto = p.codigo '
    + '  ORDER BY fecha_llegada DESC, id DESC LIMIT 1) m ON true '
    + 'WHERE p.familia IN ' + MP + ' AND ' + SQL_FECHA_ALTA + ' >= @desde '
    + 'ORDER BY fecha_alta DESC, p.codigo DESC LIMIT 300',
    { desde }
  )).map(aCamel);
}
