// Resolución de coordenadas. Nunca reemplaza la dirección original: las coordenadas se entregan
// en un objeto `ubicacion` separado, indicando siempre su fuente y precisión.
//
// Orden de prioridad por registro:
//   1. manual         -> storage/coordenadas-manuales.json (coordenadas exactas verificadas por el equipo)
//   2. datos-existentes -> lat/lon que ya trae el registro en la data original
//   3. geocodificacion -> caché persistente de geocodificación (storage/cache/geocodificacion.json)
//   4. null           -> el frontend puede solicitar /api/geocodificar para completarlo
import path from 'node:path';
import { CACHE_DIR, STORAGE_DIR } from '../config/env.js';
import { JsonStore } from '../lib/json-store.js';
import { getGeocodingProvider } from '../providers/geocoding/index.js';

const manualStore = new JsonStore(path.join(STORAGE_DIR, 'coordenadas-manuales.json'), { defaults: { origen: null, almacenes: {} } });
const geocodeCache = new JsonStore(path.join(CACHE_DIR, 'geocodificacion.json'));
const geocoder = getGeocodingProvider();
const inflight = new Map();

// Rango geográfico válido: Perú (con margen). Evita coordenadas erróneas y uso de la API fuera de alcance.
export const PERU_BOUNDS = { minLat: -18.6, maxLat: 0.2, minLon: -81.6, maxLon: -68.4 };
export function isInPeru(lat, lon) {
  return Number.isFinite(lat) && Number.isFinite(lon) && lat >= PERU_BOUNDS.minLat && lat <= PERU_BOUNDS.maxLat && lon >= PERU_BOUNDS.minLon && lon <= PERU_BOUNDS.maxLon;
}

const normalize = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

function fromManual(entry) {
  if (!entry || !isInPeru(entry.lat, entry.lon)) return null;
  return { lat: entry.lat, lon: entry.lon, fuente: 'manual', precision: 'verificada', nota: entry.nota || null };
}

export function cachedGeocode(address) {
  if (!address) return null;
  const hit = geocodeCache.get(normalize(address));
  return hit && hit.lat != null ? { lat: hit.lat, lon: hit.lon, fuente: 'geocodificacion', precision: hit.precision, nota: hit.etiqueta } : null;
}

export function resolveLocation({ manual, lat, lon, address }) {
  return (
    fromManual(manual) ||
    (isInPeru(lat, lon) ? { lat, lon, fuente: 'datos-existentes', precision: 'según data original', nota: null } : null) ||
    cachedGeocode(address)
  );
}

export function manualFor(key) {
  return manualStore.load().almacenes?.[key] ?? null;
}
export function manualOrigin() {
  return manualStore.load().origen ?? null;
}

// Geocodifica una dirección (con caché persistente y deduplicación de solicitudes simultáneas).
export async function geocode(address) {
  const key = normalize(address);
  const hit = geocodeCache.get(key);
  if (hit) return { ...hit, cache: true };
  if (inflight.has(key)) return inflight.get(key);

  const job = (async () => {
    const r = await geocoder.geocode(address);
    const entry = r && isInPeru(r.lat, r.lon)
      ? { ...r, consulta: address, fecha: new Date().toISOString() }
      : { lat: null, lon: null, consulta: address, fecha: new Date().toISOString(), proveedor: geocoder.id, sinResultado: true };
    geocodeCache.set(key, entry); // también se cachea "sin resultado" para no repetir la consulta
    return { ...entry, cache: false };
  })();
  inflight.set(key, job);
  try {
    return await job;
  } finally {
    inflight.delete(key);
  }
}
