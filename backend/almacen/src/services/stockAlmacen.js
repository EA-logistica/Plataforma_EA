// Puente hacia la base principal de PLANSA (backend/db): el módulo de
// Almacén vive aparte (su propia sesión, su propio storage de reseñas y
// almacenes de Radar Naranjal), pero corre en el MISMO proceso Express -ver
// backend/servidor.js-, así que puede leer la misma base SQLite sin
// necesidad de otra API intermedia. Es de solo lectura: nada de este módulo
// escribe en las tablas de la app principal.
import * as stockValorizado from '../../../db/repos/stockValorizado.js';
import { HttpError } from '../lib/http.js';

/**
 * SKU y valorizado de un almacén puntual (por ejemplo "151", ALMACÉN LOS
 * OLIVOS - LOGISTICS), mezclando Producto Terminado (APT) y Materia Prima
 * (MP) -el corte real del plano físico del almacén, no por tipo de
 * producto-. Usado por la pestaña "Plano y Control" del módulo Almacén Los
 * Olivos.
 */
export function getStockAlmacen(almacenCodigo) {
  const codigo = String(almacenCodigo || '').trim();
  if (!/^\d{1,4}$/.test(codigo)) throw new HttpError(400, 'Parámetro "almacen" inválido: se espera un código numérico');
  const resumen = stockValorizado.resumenAlmacen(codigo);
  const productos = stockValorizado.productosDeAlmacen(codigo);
  return { almacenCodigo: codigo, resumen, productos };
}
