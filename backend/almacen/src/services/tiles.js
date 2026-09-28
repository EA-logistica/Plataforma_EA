// Proxy con caché para las teselas del mapa (OpenStreetMap/Esri).
//
// Antes el navegador pedía las teselas directo a tile.openstreetmap.org: sin
// caché, cada apertura del mapa volvía a bajar las mismas imágenes, y la
// política de uso de OSM (operations.osmfoundation.org/policies/tiles) es
// clara en que un uso así -sin caché propio- termina bloqueado, que es
// justo lo que pasó ("Access blocked... osm.wiki/Blocked" en cada tesela).
//
// Ahora el pedido pasa por acá: se guarda en disco la primera vez y de ahí en
// más se sirve del caché, igual que ya se hace con las rutas
// (ROUTE_CACHE_TTL_DAYS). Esto también saca a los proveedores externos de la
// lista de quien el navegador contacta directo, así que la CSP del lado de
// PLANSA no necesita abrirles la puerta.
import fs from 'node:fs';
import path from 'node:path';
import { CACHE_DIR, config } from '../config/env.js';
import { HttpError } from '../lib/http.js';

const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services';

// Única lista de proveedores permitidos: el proxy nunca reenvía una URL que
// venga del cliente, arma la URL él mismo a partir de este mapa. Así no hay
// forma de usar este endpoint para pedir una URL arbitraria (SSRF).
const PROVEEDORES = {
  osm: (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`,
  'esri-calles': (z, x, y) => `${ESRI}/World_Street_Map/MapServer/tile/${z}/${y}/${x}`,
  'esri-gris-base': (z, x, y) => `${ESRI}/Canvas/World_Light_Gray_Base/MapServer/tile/${z}/${y}/${x}`,
  'esri-gris-ref': (z, x, y) => `${ESRI}/Canvas/World_Light_Gray_Reference/MapServer/tile/${z}/${y}/${x}`,
  'esri-oscuro-base': (z, x, y) => `${ESRI}/Canvas/World_Dark_Gray_Base/MapServer/tile/${z}/${y}/${x}`,
  'esri-oscuro-ref': (z, x, y) => `${ESRI}/Canvas/World_Dark_Gray_Reference/MapServer/tile/${z}/${y}/${x}`,
  'esri-satelite-img': (z, x, y) => `${ESRI}/World_Imagery/MapServer/tile/${z}/${y}/${x}`,
  'esri-satelite-ref': (z, x, y) => `${ESRI}/Reference/World_Boundaries_and_Places/MapServer/tile/${z}/${y}/${x}`,
};

const TILE_DIR = path.join(CACHE_DIR, 'tiles');
const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 días: el mapa casi no cambia, igual que el caché de rutas.
const UA = 'PLANSA-Plataforma-Logistica/1.0 (uso interno, Plasticos Nacionales; una sola PC de oficina)';

function archivoDe(proveedor, z, x, y) {
  return path.join(TILE_DIR, proveedor, String(z), String(x), `${y}.tile`);
}

// ---------- Tráfico en vivo (TomTom Traffic Flow / Incidents, plan gratuito con API key) ----------
// A diferencia de las capas base, estas teselas cambian cada pocos minutos: caché SOLO en memoria con
// TTL corto, sin validar tamaño mínimo (una tesela sin tráfico es un PNG transparente casi vacío) y
// limitada al rectángulo de Perú y a un tope diario de pedidos para no agotar la cuota gratuita.
const TOMTOM = 'https://api.tomtom.com/traffic/map/4/tile';
const EN_VIVO = {
  'tomtom-flow': (z, x, y, key) => `${TOMTOM}/flow/relative0/${z}/${x}/${y}.png?key=${encodeURIComponent(key)}&tileSize=256`,
  'tomtom-incidentes': (z, x, y, key) => `${TOMTOM}/incidents/s3/${z}/${x}/${y}.png?key=${encodeURIComponent(key)}&tileSize=256`,
};
const VIVO_TTL_MS = 3 * 60 * 1000;
const vivoCache = new Map(); // clave -> { buffer, t }
const cuota = { dia: '', usadas: 0 };

export const esTeselaEnVivo = (proveedor) => Object.hasOwn(EN_VIVO, proveedor);
export const traficoEnVivoDisponible = () => !!config.traffic.tomtomApiKey;
export function estadoCuotaTrafico() {
  const hoy = new Date().toISOString().slice(0, 10);
  return { usadasHoy: cuota.dia === hoy ? cuota.usadas : 0, maximoDia: config.traffic.tomtomMaxTilesDia };
}

// Rectángulo de Perú en coordenadas de tesela (con margen): fuera de él no se gasta cuota.
function teselaEnPeru(z, x, y) {
  const n = 2 ** z;
  const lon = (px) => (px / n) * 360 - 180;
  const lat = (py) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * py) / n))) * 180) / Math.PI;
  const oeste = lon(x), este = lon(x + 1), norte = lat(y), sur = lat(y + 1);
  return este >= -82 && oeste <= -68 && norte >= -19 && sur <= 0.5;
}

async function obtenerTeselaEnVivo(proveedor, z, x, y) {
  const key = config.traffic.tomtomApiKey;
  if (!key) throw new HttpError(404, 'Tráfico en vivo no configurado (falta TOMTOM_API_KEY en el servidor)');
  if (z < 6 || z > 18) throw new HttpError(400, 'Nivel de zoom fuera del rango de tráfico (6–18)');
  if (!teselaEnPeru(z, x, y)) throw new HttpError(400, 'Tesela fuera de Perú');
  const clave = `${proveedor}/${z}/${x}/${y}`;
  const hit = vivoCache.get(clave);
  if (hit && Date.now() - hit.t < VIVO_TTL_MS) return hit.buffer;

  const hoy = new Date().toISOString().slice(0, 10);
  if (cuota.dia !== hoy) Object.assign(cuota, { dia: hoy, usadas: 0 });
  if (cuota.usadas >= config.traffic.tomtomMaxTilesDia) {
    if (hit) return hit.buffer; // mejor una tesela de hace minutos que nada
    throw new HttpError(429, 'Se alcanzó el tope diario de teselas de tráfico (TOMTOM_MAX_TILES_DIA)');
  }
  cuota.usadas++;
  const res = await fetch(EN_VIVO[proveedor](z, x, y, key), { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new HttpError(res.status === 404 ? 404 : 502, `TomTom respondió ${res.status}${res.status === 403 ? ' (revise TOMTOM_API_KEY)' : ''}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  vivoCache.set(clave, { buffer, t: Date.now() });
  if (vivoCache.size > 3000) vivoCache.delete(vivoCache.keys().next().value); // tope de memoria (FIFO)
  return buffer;
}

export async function obtenerTesela(proveedor, zStr, xStr, yStr) {
  if (esTeselaEnVivo(proveedor)) {
    const z = Number(zStr), x = Number(xStr), y = Number(yStr);
    if (![z, x, y].every(Number.isInteger) || x < 0 || y < 0 || x >= 2 ** z || y >= 2 ** z) throw new HttpError(400, 'Coordenadas de tesela inválidas');
    return obtenerTeselaEnVivo(proveedor, z, x, y);
  }
  const armar = PROVEEDORES[proveedor];
  if (!armar) throw new HttpError(404, 'Proveedor de teselas desconocido');

  const z = Number(zStr), x = Number(xStr), y = Number(yStr);
  if (![z, x, y].every(Number.isInteger) || z < 0 || z > 20 || x < 0 || y < 0) {
    throw new HttpError(400, 'Coordenadas de tesela inválidas');
  }

  const archivo = archivoDe(proveedor, z, x, y);
  try {
    const stat = fs.statSync(archivo);
    if (Date.now() - stat.mtimeMs < TTL_MS) return fs.readFileSync(archivo);
  } catch { /* no está en caché todavía */ }

  const res = await fetch(armar(z, x, y), { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new HttpError(res.status === 404 ? 404 : 502, `El proveedor de teselas respondió ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());

  // Una tesela real pesa varios KB; el aviso de "Access blocked" de OSM es un
  // PNG chico (~unos cientos de bytes). No se guarda: si se cacheara, el
  // bloqueo quedaría "pegado" 30 días aunque el proveedor ya lo hubiera
  // levantado. Se sirve igual esta vez (falla arriba, no rompe el mapa entero).
  if (buffer.length < 800) throw new HttpError(503, 'El proveedor de teselas no respondió con una imagen válida');

  fs.mkdirSync(path.dirname(archivo), { recursive: true });
  fs.writeFileSync(archivo, buffer);
  return buffer;
}
