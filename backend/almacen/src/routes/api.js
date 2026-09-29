// Endpoints REST. Frontend -> Backend -> proveedores externos (las credenciales nunca salen del servidor).
import { HttpError, sendJson } from '../lib/http.js';
import { config } from '../config/env.js';
import { capabilities } from '../providers/routing/index.js';
import { geocode, isInPeru, PERU_BOUNDS } from '../services/locations.js';
import { computeRoute, computeStopsRoute, MAX_PARADAS } from '../services/routing.js';
import { getOrigin, getWarehouses } from '../services/warehouses.js';
import { listReviews, saveReview } from '../services/reviews.js';
import { esTeselaEnVivo, estadoCuotaTrafico, obtenerTesela, traficoEnVivoDisponible } from '../services/tiles.js';
import { reversePlace, searchPlaces } from '../services/places.js';
import { actualizarViaje, crearViaje, eliminarViaje, listarViajes, validarParadas } from '../services/viajes.js';
import { PERFIL_LIMA } from '../providers/traffic/index.js';
import { getStockAlmacen } from '../services/stockAlmacen.js';
import * as metrajeAlmacen from '../services/metrajeAlmacen.js';

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
  // express.json(), montado más arriba para /api (ver backend/servidor.js),
  // corre para TODA request -incluida /almacen/*- antes de que esto se
  // ejecute, así que ya dejó el stream leído y el resultado en req.body.
  // Solo si algún día este módulo corriera sin ese middleware por delante
  // hace falta leer el stream a mano (rama de abajo).
  if (req.body && typeof req.body === 'object') return req.body;
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
    planificador: { maxParadas: MAX_PARADAS },
    trafico: {
      // Estimado para ETA (no tiempo real) + fuentes de visualización en vivo.
      estimado: { id: config.traffic.factorOverride ? 'factor-fijo' : 'perfil-horario-lima', factorFijo: config.traffic.factorOverride, perfil: PERFIL_LIMA },
      tomtom: { disponible: traficoEnVivoDisponible(), ...(traficoEnVivoDisponible() ? estadoCuotaTrafico() : {}) },
      waze: { disponible: true, embed: 'https://embed.waze.com/iframe' },
    },
  }),

  '/api/almacenes': () => getWarehouses(),

  '/api/origen': () => getOrigin(),

  '/api/revisiones': () => listReviews(),

  '/api/stock-almacen': (q) => getStockAlmacen(q.get('almacen') || '151'),

  '/api/metraje-almacen': () => metrajeAlmacen.listar(),

  '/api/metraje-almacen/resumen': () => metrajeAlmacen.resumen(),

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

  // Buscador de direcciones/lugares (Perú, con sesgo a Lima).
  '/api/lugares': async (q) => {
    const texto = (q.get('q') || '').trim();
    if (texto.length < 3 || texto.length > 200) throw new HttpError(400, 'Parámetro "q" requerido (3–200 caracteres)');
    return searchPlaces(texto);
  },

  // Dirección aproximada de un punto marcado en el mapa.
  '/api/lugar-inverso': async (q) => {
    const { lat, lon } = parsePoint(q.get('punto'), 'punto');
    return reversePlace(lat, lon);
  },

  '/api/viajes': () => listarViajes(),
};

export async function handleApi(req, res, url) {
  const pathname = url.pathname.replace(/\/$/, '');

  const review = pathname.match(/^\/api\/revisiones\/([A-Za-z0-9_-]{1,80})$/);
  if (review) {
    if (req.method !== 'PUT') throw new HttpError(405, 'Método no permitido');
    return sendJson(req, res, 200, saveReview(review[1], await readJson(req)));
  }

  // Metraje y costo del alquiler (Los Olivos): único recurso de este módulo
  // con escritura -ver services/metrajeAlmacen.js-, así que no entra en el
  // mapa `getRoutes` de solo GET de más abajo.
  if (pathname === '/api/metraje-almacen') {
    if (req.method === 'POST') return sendJson(req, res, 201, await metrajeAlmacen.crear(await readJson(req)));
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Método no permitido');
  }
  const metrajeItem = pathname.match(/^\/api\/metraje-almacen\/(\d+)$/);
  if (metrajeItem) {
    if (req.method === 'PATCH') return sendJson(req, res, 200, await metrajeAlmacen.actualizar(metrajeItem[1], await readJson(req)));
    // DELETE exige motivo en el cuerpo (auditoría, ver services/metrajeAlmacen.js) -no se confía
    // en que el frontend ya lo haya validado, se vuelve a exigir acá.
    if (req.method === 'DELETE') return sendJson(req, res, 200, await metrajeAlmacen.eliminar(metrajeItem[1], (await readJson(req))?.motivo));
    throw new HttpError(405, 'Método no permitido');
  }

  // Planificador: ruta por varias paradas + horario estimado. POST porque lleva la lista de paradas
  // (hasta MAX_PARADAS) en el cuerpo; no escribe nada salvo el caché de rutas.
  if (pathname === '/api/ruta-paradas') {
    if (req.method !== 'POST') throw new HttpError(405, 'Método no permitido');
    const body = await readJson(req);
    const paradas = validarParadas(body?.paradas);
    return sendJson(req, res, 200, await computeStopsRoute(paradas, {
      perfil: body.perfil,
      optimizar: !!body.optimizar,
      regreso: !!body.regreso,
      salida: body.salida,
      fecha: body.fecha,
      finJornada: body.finJornada,
    }));
  }

  // Programación de camiones: viajes guardados.
  if (pathname === '/api/viajes' && req.method === 'POST') return sendJson(req, res, 201, crearViaje(await readJson(req)));
  const viaje = pathname.match(/^\/api\/viajes\/([0-9a-f-]{36})$/);
  if (viaje) {
    if (req.method === 'PUT') return sendJson(req, res, 200, actualizarViaje(viaje[1], await readJson(req)));
    if (req.method === 'DELETE') return sendJson(req, res, 200, eliminarViaje(viaje[1]));
    throw new HttpError(405, 'Método no permitido');
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
      // Capas base: el navegador también puede quedarse con su copia una semana. Tráfico en vivo: 2 min.
      'Cache-Control': esTeselaEnVivo(tesela[1]) ? 'private, max-age=120' : 'public, max-age=604800',
    });
    return res.end(req.method === 'HEAD' ? undefined : buffer);
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Método no permitido');
  const handler = getRoutes[pathname];
  if (!handler) throw new HttpError(404, 'Endpoint no encontrado');
  sendJson(req, res, 200, await handler(url.searchParams));
}
