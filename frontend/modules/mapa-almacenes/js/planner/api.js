// Llamadas del planificador de rutas / programación de camiones al backend del módulo (/almacen/api).
// Todo pasa por el servidor: Nominatim, OSRM/ORS y TomTom nunca se contactan desde el navegador.
const API_BASE = '/almacen/api';

async function parse(res) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Error ${res.status}`);
  return body;
}

const get = (path, params, signal) =>
  fetch(`${API_BASE}${path}${params ? '?' + new URLSearchParams(params) : ''}`, { headers: { Accept: 'application/json' }, signal }).then(parse);

const send = (method, path, body) =>
  fetch(`${API_BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then(parse);

export const plannerApi = {
  buscarLugares: (q, signal) => get('/lugares', { q }, signal),
  lugarInverso: ({ lat, lon }) => get('/lugar-inverso', { punto: `${lat.toFixed(6)},${lon.toFixed(6)}` }),
  rutaParadas: (payload) => send('POST', '/ruta-paradas', payload),
  viajes: () => get('/viajes'),
  crearViaje: (v) => send('POST', '/viajes', v),
  actualizarViaje: (id, v) => send('PUT', `/viajes/${encodeURIComponent(id)}`, v),
  eliminarViaje: (id) => send('DELETE', `/viajes/${encodeURIComponent(id)}`),
};
