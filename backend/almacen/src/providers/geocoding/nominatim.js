// Proveedor de geocodificación: Nominatim (OpenStreetMap). Gratuito, sin API key.
// Política de uso: máx. 1 solicitud/segundo y User-Agent identificable -> se respeta con throttle + caché.
// Las tres operaciones (geocode, search, reverse) comparten el MISMO throttle: el límite es por cliente.
import { createThrottle } from '../../lib/throttle.js';

const throttle = createThrottle(1100);

// Sesgo (no límite) hacia Lima Metropolitana: los resultados de Lima salen primero, pero una búsqueda
// en provincia (Arequipa, Trujillo…) sigue funcionando porque `bounded=0`.
const LIMA_VIEWBOX = '-77.25,-11.65,-76.75,-12.35';

// Traduce el tipo de resultado OSM a una precisión legible.
function precisionFrom(r) {
  const t = r.addresstype || r.type;
  if (['house', 'building', 'industrial', 'commercial', 'warehouse'].includes(t) || r.category === 'building') return 'exacta';
  if (['road', 'street', 'residential', 'highway'].includes(t) || r.category === 'highway') return 'calle';
  if (['neighbourhood', 'suburb', 'quarter', 'hamlet'].includes(t)) return 'urbanización / barrio';
  if (['city_district', 'district', 'town', 'village', 'city', 'municipality'].includes(t)) return 'distrito / ciudad';
  return 'aproximada';
}

// Nombre corto legible ("Av. Alfredo Mendiola 3900, Los Olivos") a partir del detalle de dirección.
function shortName(r) {
  const a = r.address || {};
  const calle = [a.road || a.pedestrian || a.industrial, a.house_number].filter(Boolean).join(' ');
  const primero = r.name || calle || r.display_name?.split(',')[0] || '';
  const zona = a.city_district || a.suburb || a.city || a.town || a.county || '';
  return [primero, zona && zona !== primero ? zona : ''].filter(Boolean).join(', ');
}

function toPlace(r) {
  return {
    lat: parseFloat(r.lat),
    lon: parseFloat(r.lon),
    nombre: shortName(r),
    etiqueta: r.display_name,
    precision: precisionFrom(r),
    tipo: r.addresstype || r.type || null,
    proveedor: 'nominatim',
    atribucion: '© OpenStreetMap contributors',
  };
}

export function createNominatimProvider({ baseUrl, email, userAgent }) {
  async function call(pathname, params) {
    params.set('format', 'jsonv2');
    params.set('accept-language', 'es');
    if (email) params.set('email', email);
    const res = await throttle(() =>
      fetch(`${baseUrl}${pathname}?${params}`, { headers: { 'User-Agent': userAgent }, signal: AbortSignal.timeout(10000) })
    );
    if (!res.ok) throw new Error(`Nominatim respondió ${res.status}`);
    return res.json();
  }

  return {
    id: 'nominatim',
    async geocode(address) {
      const [r] = await call('/search', new URLSearchParams({ q: address, limit: '1', countrycodes: 'pe' }));
      if (!r) return null;
      const p = toPlace(r);
      return { lat: p.lat, lon: p.lon, precision: p.precision, etiqueta: p.etiqueta, proveedor: p.proveedor, atribucion: p.atribucion };
    },

    // Varias coincidencias para el buscador de direcciones/lugares del planificador.
    async search(query, limit = 6) {
      const params = new URLSearchParams({ q: query, limit: String(limit), countrycodes: 'pe', addressdetails: '1', viewbox: LIMA_VIEWBOX, bounded: '0' });
      const list = await call('/search', params);
      return (Array.isArray(list) ? list : []).map(toPlace);
    },

    // Dirección aproximada de un punto marcado en el mapa.
    async reverse(lat, lon) {
      const r = await call('/reverse', new URLSearchParams({ lat: String(lat), lon: String(lon), zoom: '18', addressdetails: '1' }));
      if (!r || r.error) return null;
      return toPlace(r);
    },
  };
}
