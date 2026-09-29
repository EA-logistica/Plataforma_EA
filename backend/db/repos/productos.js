import { todos, uno, aCamel, enTransaccion, insertarLote } from '../conexion.js';
import { tocar } from './ajustes.js';

/**
 * Catálogo de productos (SKU) del ERP, cargado desde data/productos.js -ver
 * cargarInicial()-. A diferencia de ordenes_compra (un libro contable, nunca
 * cambia), el catálogo y el stock SÍ se refrescan en cada recarga: por eso
 * cargarInicial hace UPSERT y no ON CONFLICT DO NOTHING.
 *
 * Clasificación ABC de rotación: no hay ventas/consumo en este sistema, así
 * que "rotación" se lee por FRECUENCIA DE COMPRA -cuántas líneas de Orden de
 * Compra tuvo el SKU en los últimos 365 días (ordenes_compra_detalle)-, con
 * el criterio logístico estándar:
 *   - Sin ninguna compra registrada, o la última hace más de 365 días: 'C'
 *     (sin movimiento -candidato a obsoleto/dead stock-).
 *   - Con compras en el último año: se ordenan por frecuencia y se parten en
 *     quintiles (NTILE(5)); quintil 1 (20% más frecuente) = 'A', quintiles
 *     2-3 (30% siguiente) = 'B', el resto = 'C'. Es el recorte 20/30/50
 *     habitual de un ABC por frecuencia, no por valor -acá no hay costo
 *     unitario de compra confiable para todos los SKU, solo para materia
 *     prima-.
 */

const COLUMNAS = [
  'codigo', 'codigo_alterno', 'descripcion', 'unidad_medida', 'familia', 'linea', 'marca', 'modelo',
  'peso', 'origen', 'tipo_producto', 'estado', 'ubicacion', 'stock_minimo', 'lead_time', 'stock',
  'tiene_ficha_tecnica', 'tiene_materia_prima'
];

export function cargarInicial(filas) {
  return enTransaccion(async () => {
    // Un mismo INSERT multi-fila no puede actualizar dos veces el mismo código
    // (PostgreSQL lo rechaza en el DO UPDATE): si el ERP repite un código, se
    // queda la última aparición, que es lo que dejaba el UPSERT fila a fila.
    const porCodigo = new Map();
    for (const p of filas) {
      porCodigo.set(p.codigo, {
        codigo: p.codigo,
        codigo_alterno: p.codigoAlterno || '',
        descripcion: p.descripcion || '',
        unidad_medida: p.unidadMedida || '',
        familia: p.familia || '',
        linea: p.linea || '',
        marca: p.marca || '',
        modelo: p.modelo || '',
        peso: p.peso || 0,
        origen: p.origen || '',
        tipo_producto: p.tipoProducto || '',
        estado: p.estado || '',
        ubicacion: p.ubicacion || '',
        stock_minimo: p.stockMinimo || 0,
        lead_time: p.leadTime || 0,
        stock: p.stock || 0,
        tiene_ficha_tecnica: p.tieneFichaTecnica || 'NO',
        tiene_materia_prima: p.tieneMateriaPrima || 'NO'
      });
    }
    await insertarLote('productos', COLUMNAS, [...porCodigo.values()],
      'ON CONFLICT (codigo) DO UPDATE SET '
      + COLUMNAS.slice(1).map(c => c + ' = excluded.' + c).join(', ') + ', actualizado_en = ahora_txt()');
    await tocar();
    // Igual que antes: cuántas filas se procesaron (con repetidos incluidos).
    return filas.length;
  });
}

export async function total() {
  return (await uno('SELECT COUNT(*) AS n FROM productos')).n;
}

// Hace 365 días (UTC) como texto 'YYYY-MM-DD' -lo que era date('now', '-365
// days') en SQLite-: fecha_emision es TEXT, se compara texto con texto.
const HACE_UN_ANIO = "to_char((now() AT TIME ZONE 'UTC')::date - 365, 'YYYY-MM-DD')";

/**
 * CTE compartido por listar()/resumen(): agrega ordenes_compra_detalle por
 * producto y reparte en quintiles de frecuencia. `rango` solo cubre los
 * productos CON compras en el último año -los demás quedan 'C' por el CASE
 * de más abajo, sin necesitar estar en el quintil-.
 */
const CTE_ROTACION = `
  WITH compras AS (
    SELECT codigo_producto AS codigo,
           MAX(fecha_emision) AS ultima_compra,
           SUM(CASE WHEN fecha_emision >= ${HACE_UN_ANIO} THEN 1 ELSE 0 END) AS compras_ultimo_anio
    FROM ordenes_compra_detalle
    WHERE codigo_producto != ''
    GROUP BY codigo_producto
  ),
  rango AS (
    SELECT codigo, NTILE(5) OVER (ORDER BY compras_ultimo_anio DESC) AS quintil
    FROM compras WHERE compras_ultimo_anio > 0
  )
`;
const JOIN_ROTACION = 'LEFT JOIN compras c ON c.codigo = p.codigo LEFT JOIN rango r ON r.codigo = p.codigo';
const EXPR_CLASE_ABC = `
  CASE
    WHEN c.ultima_compra IS NULL THEN 'C'
    WHEN c.ultima_compra < ${HACE_UN_ANIO} THEN 'C'
    WHEN r.quintil = 1 THEN 'A'
    WHEN r.quintil IN (2, 3) THEN 'B'
    ELSE 'C'
  END
`;
const EXPR_ES_C = "(CASE WHEN " + EXPR_CLASE_ABC + " = 'C' THEN 1 ELSE 0 END)";

function condiciones(f = {}) {
  const where = [];
  const params = {};
  if (f.familia) { where.push('p.familia = @familia'); params.familia = f.familia; }
  if (f.tipoProducto) { where.push('p.tipo_producto = @tipoProducto'); params.tipoProducto = f.tipoProducto; }
  if (f.estado) { where.push('p.estado = @estado'); params.estado = f.estado; }
  if (f.origen) { where.push('p.origen = @origen'); params.origen = f.origen; }
  if (f.soloConStock === '1' || f.soloConStock === true) where.push('p.stock > 0');
  if (f.clase) { where.push(EXPR_CLASE_ABC + ' = @clase'); params.clase = f.clase; }
  if (f.q) {
    where.push('(p.codigo ILIKE @q OR p.codigo_alterno ILIKE @q OR p.descripcion ILIKE @q)');
    params.q = '%' + f.q + '%';
  }
  return { sql: where.length ? 'WHERE ' + where.join(' AND ') : '', params };
}

// Lista blanca: `orden` viene del navegador y va directo a un ORDER BY, así
// que no puede ser SQL libre. Solo estas claves son válidas.
const ORDEN = {
  descripcion_asc: 'p.descripcion ASC',
  stock_desc: 'p.stock DESC, p.descripcion ASC',
  stock_asc: 'p.stock ASC, p.descripcion ASC',
  rotacion_asc: "(CASE " + EXPR_CLASE_ABC + " WHEN 'A' THEN 1 WHEN 'B' THEN 2 ELSE 3 END), p.descripcion ASC",
  rotacion_desc: "(CASE " + EXPR_CLASE_ABC + " WHEN 'C' THEN 1 WHEN 'B' THEN 2 ELSE 3 END), p.descripcion ASC"
};

export async function listar(f = {}) {
  const { sql, params } = condiciones(f);
  const pagina = Math.max(1, Number(f.pagina) || 1);
  const porPagina = Math.min(200, Math.max(1, Number(f.porPagina) || 50));
  const orden = ORDEN[f.orden] || ORDEN.descripcion_asc;

  const totalFilas = (await uno(
    CTE_ROTACION + 'SELECT COUNT(*) AS n FROM productos p ' + JOIN_ROTACION + ' ' + sql, params
  )).n;
  const filas = (await todos(
    CTE_ROTACION + 'SELECT p.*, c.ultima_compra AS ultima_compra, COALESCE(c.compras_ultimo_anio, 0) AS compras_ultimo_anio, '
    + EXPR_CLASE_ABC + ' AS clase_abc '
    + 'FROM productos p ' + JOIN_ROTACION + ' ' + sql
    + ' ORDER BY ' + orden + ' LIMIT @limite OFFSET @offset',
    { ...params, limite: porPagina, offset: (pagina - 1) * porPagina }
  )).map(aCamel);

  return { filas, total: totalFilas, pagina, porPagina };
}

export async function porCodigo(codigo) {
  return aCamel(await uno('SELECT * FROM productos WHERE codigo = ?', [codigo]));
}

export async function resumen(f = {}) {
  const { sql, params } = condiciones(f);
  // condiciones() puede meter un filtro por `clase` (EXPR_CLASE_ABC), que
  // necesita el CTE y el JOIN de rotación -sin esto, filtrar por clase acá
  // rompía con "no such column: c.ultima_compra"-.
  const totales = await uno(
    CTE_ROTACION + 'SELECT COUNT(*) AS productos, SUM(CASE WHEN p.stock > 0 THEN 1 ELSE 0 END) AS "conStock", '
    + "SUM(CASE WHEN p.estado = 'ACTIVO' THEN 1 ELSE 0 END) AS activos, COUNT(DISTINCT p.familia) AS familias "
    + 'FROM productos p ' + JOIN_ROTACION + ' ' + sql,
    params
  );
  return {
    productos: totales.productos,
    conStock: totales.conStock || 0,
    activos: totales.activos || 0,
    familias: totales.familias
  };
}

/** Cuántos productos cayeron en cada clase de rotación, según el mismo filtro que la lista. */
export async function resumenRotacion(f = {}) {
  const { sql, params } = condiciones(f);
  const fila = await uno(
    CTE_ROTACION + 'SELECT '
    + "SUM(CASE WHEN " + EXPR_CLASE_ABC + " = 'A' THEN 1 ELSE 0 END) AS a, "
    + "SUM(CASE WHEN " + EXPR_CLASE_ABC + " = 'B' THEN 1 ELSE 0 END) AS b, "
    + "SUM(CASE WHEN " + EXPR_CLASE_ABC + " = 'C' THEN 1 ELSE 0 END) AS c, "
    + 'SUM(CASE WHEN c.ultima_compra IS NULL THEN 1 ELSE 0 END) AS "sinComprasRegistradas" '
    + 'FROM productos p ' + JOIN_ROTACION + ' ' + sql,
    params
  );
  return aCamel(fila);
}

/**
 * Cuántos productos de cada familia caen en clase C (baja o sin rotación),
 * para identificar de un vistazo qué familias tienen más SKU de rotación
 * baja. Respeta los mismos filtros que listar()/resumen() -salvo `clase`,
 * que no aplicaría acá porque el resultado siempre es sobre la clase C-.
 * Ordenado de mayor a menor cantidad de SKU en C, solo familias con al menos
 * uno.
 */
export async function resumenRotacionPorFamilia(f = {}) {
  const { sql, params } = condiciones({ ...f, clase: '' });
  // PostgreSQL no deja usar el alias `c` en el HAVING: se repite la expresión.
  const filas = (await todos(
    CTE_ROTACION + 'SELECT p.familia AS familia, COUNT(*) AS total, '
    + 'SUM' + EXPR_ES_C + ' AS c '
    + 'FROM productos p ' + JOIN_ROTACION + ' ' + sql
    + ' GROUP BY p.familia HAVING SUM' + EXPR_ES_C + ' > 0 ORDER BY 3 DESC, p.familia ASC',
    params
  )).map(aCamel);
  return filas;
}

/** Valores distintos para poblar los selectores de filtro. */
export async function opciones() {
  const distintos = async campo => (await todos(
    'SELECT DISTINCT ' + campo + ' AS v FROM productos WHERE ' + campo + " != '' ORDER BY v"
  )).map(r => r.v);
  return {
    familias: await distintos('familia'),
    tiposProducto: await distintos('tipo_producto'),
    estados: await distintos('estado'),
    origenes: await distintos('origen')
  };
}
