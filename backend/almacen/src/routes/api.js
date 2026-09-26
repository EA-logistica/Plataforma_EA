// Endpoints REST. Frontend -> Backend -> proveedores externos (las credenciales nunca salen del servidor).
import { HttpError, sendJson } from '../lib/http.js';
import { config } from '../config/env.js';
import { capabilities } from '../providers/routing/index.js';
import { geocode, isInPeru, PERU_BOUNDS } from '../services/locations.js';
import { computeRoute } from '../services/routing.js';
import { getOrigin, getWarehouses } from '../services/warehouses.js';
import { listReviews, saveReview } from '../services/reviews.js';
import { obtenerTesela } from '../services/tiles.js';

const MAX_BODY = 16 * 1024;

function parsePoint(value, name) {
  const [lat, lon] = String(value || '').split(',').map(Number);
  if (!isInPeru(lat, lon)) throw new HttpError(400, `Parámetro "${name}" inválido: se espera "lat,lon" dentro de Perú`);
  return { lat, lon };
}

// Solo JSON y solo desde la propia plataforma: un sitio externo no puede escribir (no se habilita CORS
// y se exige Content-Type application/json, que obliga al navegador a una verificación previa).
async function readJson(req) {
  if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) throw new HttpError(415, 'Se espera Content-Type: application/json');
  const origin = req.headers.origin;
  if (origin && new URL(origin).host !== req.headers.host) throw new HttpError(403, 'Origen no permitido');
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new HttpError(413, 'Solicitud demasiado grande');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw new HttpError(400, 'JSON inválido');
  }
}

const getRoutes = {
  '/api/salud': () => ({ ok: true, hora: new Date().toISOString() }),

  '/api/config': () => ({
    routing: { proveedorPreferido: config.routing.provider, perfiles: capabilities(), traficoTiempoReal: false },
    geocodificacion: { proveedor: config.geocoding.provider },
    limitesPeru: PERU_BOUNDS,
  }),

  '/api/almacenes': () => getWarehouses(),

  '/api/origen': () => getOrigin(),

  '/api/revisiones': () => listReviews(),

  '/api/geocodificar': async (q) => {
    const direccion = (q.get('direccion') || '').trim();
    if (direccion.length < 5 || direccion.length > 300) throw new HttpError(400, 'Parámetro "direccion" requerido (5–300 caracteres)');
    return geocode(direccion);
  },

  '/api/ruta': async (q) => {
    const origen = parsePoint(q.get('origen'), 'origen');
    const destino = parsePoint(q.get('destino'), 'destino');
    return computeRoute(origen, destino, q.get('perfil') || 'auto');
  },
};

export async function handleApi(req, res, url) {
  const pathname = url.pathname.replace(/\/$/, '');

  const review = pathname.match(/^\/api\/revisiones\/([A-Za-z0-9_-]{1,80})$/);
  if (review) {
    if (req.method !== 'PUT') throw new HttpError(405, 'Método no permitido');
    return sendJson(req, res, 200, saveReview(review[1], await readJson(req)));
  }

  // Teselas del mapa: el navegador ya no habla directo con OpenStreetMap/Esri
  // (ver services/tiles.js), así que esto no es JSON sino la imagen misma.
  const tesela = pathname.match(/^\/api\/tiles\/([a-z0-9-]+)\/(\d+)\/(\d+)\/(\d+)$/);
  if (tesela) {
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Método no permitido');
    const buffer = await obtenerTesela(tesela[1], tesela[2], tesela[3], tesela[4]);
    res.writeHead(200, {
      'Content-Type': 'image/png',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'public, max-age=604800', // el navegador también puede quedarse con su copia una semana
    });
    return res.end(req.method === 'HEAD' ? undefined : buffer);
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Método no permitido');
  const handler = getRoutes[pathname];
  if (!handler) throw new HttpError(404, 'Endpoint no encontrado');
  sendJson(req, res, 200, await handler(url.searchParams));
}
