// Carga de configuración: variables de entorno + archivo .env (sin dependencias externas).
// Las credenciales (ORS_API_KEY, etc.) solo viven aquí, en el servidor; nunca se envían al frontend.
//
// Variables del Mapa de almacenes / planificador de rutas (todas opcionales):
//   ROUTING_PROVIDER      osrm (predeterminado, gratis, sin key) | ors
//   OSRM_URL              servidor OSRM (predeterminado: demo pública router.project-osrm.org)
//   ORS_API_KEY / ORS_URL OpenRouteService (plan gratuito con key): habilita el perfil camión (driving-hgv)
//   ROUTE_CACHE_TTL_DAYS  días de caché de rutas (30)
//   NOMINATIM_URL / NOMINATIM_EMAIL  geocodificación y buscador de direcciones (OpenStreetMap)
//   TRAFFIC_FACTOR        si se define, reemplaza el perfil horario de Lima por un factor fijo (p. ej. 1.4)
//   TOMTOM_API_KEY        habilita la capa de tráfico EN VIVO (TomTom Traffic Flow + incidentes) vía el
//                         proxy /almacen/api/tiles/tomtom-flow|tomtom-incidentes/... Plan gratuito con
//                         registro en developer.tomtom.com; la key nunca sale del servidor.
//   TOMTOM_MAX_TILES_DIA  tope diario de teselas pedidas a TomTom para no agotar la cuota gratuita (15000)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Este módulo vino de un repositorio propio (ALMACEN-LOS-OLIVOS) donde vivía
// en <repo>/backend/src/config -tres niveles bajo la raíz-. Al integrarse
// dentro de Plataforma_EA quedó un nivel más profundo
// (backend/almacen/src/config), así que la cuenta de "../.." sube uno más.
// FRONTEND_DIR sigue apuntando al frontend/ compartido de Plataforma_EA
// -no a uno propio- porque assets/vendor/modules se instalaron ahí
// directamente (no chocan con nada existente); STORAGE_DIR sí es propio,
// namespaced bajo backend/almacen/, para no mezclarse con la base SQLite.
const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(here, '../../../..');
export const FRONTEND_DIR = path.join(ROOT_DIR, 'frontend');
export const STORAGE_DIR = path.join(ROOT_DIR, 'backend', 'almacen', 'storage');
export const CACHE_DIR = path.join(STORAGE_DIR, 'cache');

function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    const value = m[2].replace(/^(['"])(.*)\1$/, '$2');
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}
loadDotEnv(path.join(ROOT_DIR, '.env'));

const env = (k, d = '') => (process.env[k] ?? '').trim() || d;
const num = (k, d) => {
  const v = parseFloat(env(k));
  return Number.isFinite(v) ? v : d;
};

export const config = {
  port: num('PORT', 4173),
  host: env('HOST', '127.0.0.1'),
  legacyRadarFile: path.join(FRONTEND_DIR, 'modules', 'radar-naranjal', 'radar_naranjal.html'),
  routing: {
    provider: env('ROUTING_PROVIDER', 'osrm').toLowerCase(),
    osrmUrl: env('OSRM_URL', 'https://router.project-osrm.org').replace(/\/$/, ''),
    orsUrl: env('ORS_URL', 'https://api.openrouteservice.org').replace(/\/$/, ''),
    orsApiKey: env('ORS_API_KEY'),
    cacheTtlDays: num('ROUTE_CACHE_TTL_DAYS', 30),
  },
  geocoding: {
    provider: env('GEOCODING_PROVIDER', 'nominatim').toLowerCase(),
    nominatimUrl: env('NOMINATIM_URL', 'https://nominatim.openstreetmap.org').replace(/\/$/, ''),
    nominatimEmail: env('NOMINATIM_EMAIL'),
  },
  traffic: {
    factorOverride: num('TRAFFIC_FACTOR', null),
    tomtomApiKey: env('TOMTOM_API_KEY'),
    tomtomMaxTilesDia: num('TOMTOM_MAX_TILES_DIA', 15000),
  },
  userAgent: 'PLANSA-Plataforma-Logistica/1.0 (uso interno)',
};
