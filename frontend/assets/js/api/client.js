// Cliente de la API del backend. Todas las llamadas a servicios externos (rutas, geocodificación)
// pasan por el backend, que aplica caché y mantiene las credenciales fuera del navegador.
// '/almacen/api' porque este módulo se integró dentro de Plataforma_EA, que
// ya tiene su propio '/api' -distinto y protegido por su propia sesión-: sin
// este prefijo, las dos APIs chocarían en la misma ruta.
const API_BASE = '/almacen/api';

const memo = new Map(); // caché en memoria por sesión: evita repetir la misma consulta

async function parse(res) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Error ${res.status}`);
  return body;
}

async function get(path, params, { fresh = false } = {}) {
  const qs = params ? '?' + new URLSearchParams(params) : '';
  const url = `${API_BASE}${path}${qs}`;
  if (fresh) return fetch(url, { headers: { Accept: 'application/json' }, cache: 'no-store' }).then(parse);
  if (memo.has(url)) return memo.get(url);
  const job = fetch(url, { headers: { Accept: 'application/json' } }).then(parse);
  memo.set(url, job);
  job.catch(() => memo.delete(url)); // no memorizar errores
  return job;
}

export const api = {
  config: () => get('/config'),
  almacenes: () => get('/almacenes'),
  ruta: (origen, destino, perfil) =>
    get('/ruta', { origen: `${origen.lat},${origen.lon}`, destino: `${destino.lat},${destino.lon}`, perfil }),
  geocodificar: (direccion) => get('/geocodificar', { direccion }),
  revisiones: () => get('/revisiones', null, { fresh: true }),
  guardarRevision: (key, { estado, comentario }) =>
    fetch(`${API_BASE}/revisiones/${encodeURIComponent(key)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ estado, comentario }),
    }).then(parse),
};
