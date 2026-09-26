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
import { CACHE_DIR } from '../config/env.js';
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

export async function obtenerTesela(proveedor, zStr, xStr, yStr) {
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
