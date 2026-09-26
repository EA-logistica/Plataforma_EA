// Seguimiento de evaluación por almacén (estado + comentario). Reemplaza el guardado del Radar original,
// que dependía del almacenamiento de claude.ai. Se guarda aparte: la data original no se modifica.
import path from 'node:path';
import { STORAGE_DIR } from '../config/env.js';
import { JsonStore } from '../lib/json-store.js';
import { HttpError } from '../lib/http.js';
import { readRadarData } from '../data/radar-source.js';

export const ESTADOS = ['pendiente', 'en_evaluacion', 'visitado', 'preseleccionado', 'descartado'];
const MAX_COMENTARIO = 2000;

const store = new JsonStore(path.join(STORAGE_DIR, 'revisiones.json'), { defaults: { almacenes: {} } });

export function listReviews() {
  return { estados: ESTADOS, almacenes: store.load().almacenes || {} };
}

export function saveReview(key, body) {
  if (!Object.hasOwn(readRadarData().data.warehouses, key)) throw new HttpError(404, `Almacén desconocido: ${key}`);
  const estado = body?.estado;
  const comentario = typeof body?.comentario === 'string' ? body.comentario.trim() : '';
  if (!ESTADOS.includes(estado)) throw new HttpError(400, `Estado inválido. Valores: ${ESTADOS.join(', ')}`);
  if (comentario.length > MAX_COMENTARIO) throw new HttpError(400, `Comentario demasiado largo (máx. ${MAX_COMENTARIO} caracteres)`);

  const data = store.load();
  data.almacenes ||= {};
  const entry = { estado, comentario, actualizado: new Date().toISOString() };
  data.almacenes[key] = entry;
  store.scheduleWrite();
  return entry;
}
