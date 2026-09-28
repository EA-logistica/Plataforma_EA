import { db, aCamel, enTransaccion } from '../conexion.js';
import { tocar } from './ajustes.js';

/**
 * Stock valorizado completo del ERP (data/stockValorizado.js): todos los
 * tipos de producto, no solo materia prima -ver materiaPrimaStock.js para
 * ese recorte-. Es una foto, se reemplaza entera en cada recarga.
 *
 * Pensado para consultas por almacén que mezclan Producto Terminado (APT) y
 * Materia Prima (MP), como el panel de Control de Almacenes para el almacén
 * 151 (ver backend/almacen/src/services/stockAlmacen.js).
 */

const COLUMNAS = [
  'tipo_codigo', 'tipo_producto', 'almacen_codigo', 'almacen', 'categoria_nivel3', 'familia',
  'codigo', 'codigo_alterno', 'descripcion', 'unidad_medida', 'ubicacion',
  'stock', 'costo_promedio_usd', 'valorizado_usd'
];

export function cargarInicial(filas) {
  return enTransaccion(base => {
    base.exec('DELETE FROM stock_valorizado');
    const insertar = base.prepare(
      'INSERT INTO stock_valorizado (' + COLUMNAS.join(', ') + ') VALUES (' +
      COLUMNAS.map(c => '@' + c).join(', ') + ')'
    );
    filas.forEach(f => {
      insertar.run({
        tipo_codigo: f.tipoCodigo || '', tipo_producto: f.tipoProducto || '',
        almacen_codigo: f.almacenCodigo || '', almacen: f.almacen || '',
        categoria_nivel3: f.categoriaNivel3 || '', familia: f.familia || '',
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
  return db().prepare('SELECT COUNT(*) AS n FROM stock_valorizado').get().n;
}

/**
 * Vista global (todos los almacenes, todos los tipos de producto): para el
 * Dashboard. `porTipo` es el quiebre más grueso del ERP (Producto Terminado
 * vs Materias Primas vs Activos Fijos, etc.); `porAlmacen` son los 6 más
 * valorizados, no todos -son 31 almacenes, ya hay un detalle completo en
 * Materia Prima y en Almacén Los Olivos-.
 */
export function resumenGlobal() {
  const totales = db().prepare(
    'SELECT COUNT(DISTINCT codigo) AS productos, COUNT(DISTINCT almacen_codigo) AS almacenes, '
    + 'COALESCE(SUM(valorizado_usd), 0) AS valorizadoUsd FROM stock_valorizado'
  ).get();
  const porTipo = db().prepare(
    'SELECT tipo_producto AS tipoProducto, COUNT(DISTINCT codigo) AS productos, '
    + 'COALESCE(SUM(valorizado_usd), 0) AS valorizadoUsd '
    + 'FROM stock_valorizado GROUP BY tipo_producto ORDER BY valorizadoUsd DESC'
  ).all().map(aCamel);
  const porAlmacen = db().prepare(
    'SELECT almacen, COALESCE(SUM(valorizado_usd), 0) AS valorizadoUsd '
    + 'FROM stock_valorizado GROUP BY almacen ORDER BY valorizadoUsd DESC LIMIT 6'
  ).all().map(aCamel);
  return { ...aCamel(totales), porTipo, porAlmacen };
}

/** Tarjetas de un almacén: SKU distintos, valorizado y stock por unidad de medida. */
export function resumenAlmacen(almacenCodigo) {
  const totales = db().prepare(
    'SELECT COUNT(DISTINCT codigo) AS productos, COALESCE(SUM(valorizado_usd), 0) AS valorizadoUsd, '
    + 'MAX(almacen) AS almacen '
    + 'FROM stock_valorizado WHERE almacen_codigo = ?'
  ).get(almacenCodigo);
  const stock = db().prepare(
    'SELECT unidad_medida AS um, SUM(stock) AS stock FROM stock_valorizado WHERE almacen_codigo = ? '
    + 'GROUP BY unidad_medida ORDER BY stock DESC'
  ).all(almacenCodigo);
  return { ...aCamel(totales), stockPorUm: stock.map(aCamel) };
}

/** Los SKU de un almacén, con su tipo (Producto Terminado / Materias Primas / etc.), familia y línea. */
export function productosDeAlmacen(almacenCodigo) {
  return db().prepare(
    'SELECT codigo, descripcion, tipo_producto, categoria_nivel3, familia, unidad_medida, '
    + 'stock, costo_promedio_usd, valorizado_usd '
    + 'FROM stock_valorizado WHERE almacen_codigo = ? ORDER BY valorizado_usd DESC'
  ).all(almacenCodigo).map(aCamel);
}
