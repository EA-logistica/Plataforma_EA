// Buscador de direcciones/lugares y geocodificación inversa para el planificador de rutas.
// Mismo criterio que services/locations.js: caché persistente (Nominatim pide no repetir consultas)
// y solo se devuelven puntos dentro de Perú.
import path from 'node:path';
import { CACHE_DIR } from '../config/env.js';
import { JsonStore } from '../lib/json-store.js';
import { HttpError } from '../lib/http.js';
import { getGeocodingProvider } from '../providers/geocoding/index.js';
import { isInPeru } from './locations.js';

const searchCache = new JsonStore(path.join(CACHE_DIR, 'lugares.json'));
const reverseCache = new JsonStore(path.join(CACHE_DIR, 'geocodificacion-inversa.json'));
const TTL_MS = 30 * 86400000;
const geocoder = getGeocodingProvider();
const inflight = new Map();

const normalize = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const fresh = (hit) => hit && Date.now() - Date.parse(hit.fecha) < TTL_MS;

function dedupe(key, fn) {
  if (inflight.has(key)) return inflight.get(key);
  const job = fn().finally(() => inflight.delete(key));
  inflight.set(key, job);
  return job;
}

export async function searchPlaces(query) {
  if (typeof geocoder.search !== 'function') throw new HttpError(501, 'El proveedor de geocodificación no admite búsqueda de lugares');
  const key = normalize(query);
  const hit = searchCache.get(key);
  if (fresh(hit)) return { consulta: query, resultados: hit.resultados, cache: true };
  return dedupe('s|' + key, async () => {
    let resultados;
    try {
      resultados = (await geocoder.search(query, 6)).filter((r) => isInPeru(r.lat, r.lon));
    } catch (err) {
      throw new HttpError(502, `No se pudo buscar la dirección: ${err.message}`);
    }
    searchCache.set(key, { resultados, fecha: new Date().toISOString() });
    return { consulta: query, resultados, cache: false };
  });
}

export async function reversePlace(lat, lon) {
  if (typeof geocoder.reverse !== 'function') return { lat, lon, nombre: null, etiqueta: null };
  // ~11 m de redondeo: dos clics casi en el mismo sitio comparten la consulta.
  const key = `${lat.toFixed(4)},${lon.toFixed(4)}`;
  const hit = reverseCache.get(key);
  if (fresh(hit)) return { ...hit.lugar, lat, lon, cache: true };
  return dedupe('r|' + key, async () => {
    let lugar;
    try {
      lugar = await geocoder.reverse(lat, lon);
    } catch (err) {
      throw new HttpError(502, `No se pudo obtener la dirección del punto: ${err.message}`);
    }
    lugar = lugar || { nombre: null, etiqueta: null, precision: 'aproximada' };
    reverseCache.set(key, { lugar, fecha: new Date().toISOString() });
    return { ...lugar, lat, lon, cache: false };
  });
}
