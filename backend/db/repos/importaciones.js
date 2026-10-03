import { todos, ejecutar, insertarLote, aCamel, enTransaccion } from '../conexion.js';
import { tocar } from './ajustes.js';
import { analizar, resumir, ratiosServicio } from '#shared/importaciones.js';

/**
 * Importaciones del bot de logística (colección `importaciones` de Mongo),
 * copiadas por backend/mongo/sincronizar.js. Cada fila guarda el registro ya
 * normalizado (shared/importaciones.js → normalizar) en `datos`; los cálculos
 * -atrasos, costo puesto en planta, pagos- se hacen al leer, porque dependen
 * de la fecha de hoy.
 */

export async function cargarInicial({ importaciones, eventos }) {
  return enTransaccion(async () => {
    await ejecutar('DELETE FROM importaciones');
    await ejecutar('DELETE FROM importaciones_eventos');
    await insertarLote('importaciones', ['id', 'oc_numero', 'datos'],
      importaciones.map(i => ({ id: i.id, oc_numero: i.oc, datos: JSON.stringify(i) })));
    await insertarLote('importaciones_eventos',
      ['importacion_id', 'oc_numero', 'fecha', 'hito', 'descripcion', 'transportista', 'referencia', 'ubicacion'],
      eventos.map(e => ({
        importacion_id: e.importacionId, oc_numero: e.oc, fecha: e.fecha, hito: e.hito,
        descripcion: e.descripcion, transportista: e.transportista, referencia: e.referencia, ubicacion: e.ubicacion
      })));
    await tocar();
    return importaciones.length;
  });
}

/** Fecha de hoy en Lima (UTC-5), 'YYYY-MM-DD': un atraso se cuenta por días calendario de acá. */
export function hoyLima(ahora = new Date()) {
  return new Date(ahora.getTime() - 5 * 3600000).toISOString().slice(0, 10);
}

async function crudas() {
  return (await todos('SELECT datos FROM importaciones')).map(r => r.datos);
}

/** Todas, analizadas a la fecha, más el resumen del apartado. */
export async function listar(hoy = hoyLima()) {
  const filas = await crudas();
  const ratios = ratiosServicio(filas);
  const lista = filas.map(i => analizar(i, hoy, ratios))
    .sort((a, b) => (b.atraso - a.atraso) || (b.emision || '').localeCompare(a.emision || ''));
  return { hoy, ratiosServicio: ratios, filas: lista, resumen: resumir(lista, hoy) };
}

/** Una importación con sus eventos de rastreo, para el detalle. */
export async function detalle(id, hoy = hoyLima()) {
  const filas = await crudas();
  const i = filas.find(x => x.id === id);
  if (!i) throw Object.assign(new Error('No existe la importación ' + id + '.'), { status: 404 });
  const eventos = (await todos(
    'SELECT fecha, hito, descripcion, transportista, referencia, ubicacion FROM importaciones_eventos '
    + 'WHERE importacion_id = ? OR (oc_numero <> \'\' AND oc_numero = ?) ORDER BY fecha DESC', [id, i.oc]
  )).map(aCamel);
  return { ...analizar(i, hoy, ratiosServicio(filas)), eventos };
}
