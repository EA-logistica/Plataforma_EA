// Proveedor de geocodificación: Nominatim (OpenStreetMap). Gratuito, sin API key.
// Política de uso: máx. 1 solicitud/segundo y User-Agent identificable -> se respeta con throttle + caché.
import { createThrottle } from '../../lib/throttle.js';

const throttle = createThrottle(1100);

// Traduce el tipo de resultado OSM a una precisión legible.
function precisionFrom(r) {
  const t = r.addresstype || r.type;
  if (['house', 'building', 'industrial', 'commercial', 'warehouse'].includes(t) || r.category === 'building') return 'exacta';
  if (['road', 'street', 'residential', 'highway'].includes(t) || r.category === 'highway') return 'calle';
  if (['neighbourhood', 'suburb', 'quarter', 'hamlet'].includes(t)) return 'urbanización / barrio';
  if (['city_district', 'district', 'town', 'village', 'city', 'municipality'].includes(t)) return 'distrito / ciudad';
  return 'aproximada';
}

export function createNominatimProvider({ baseUrl, email, userAgent }) {
  return {
    id: 'nominatim',
    async geocode(address) {
      const params = new URLSearchParams({ q: address, format: 'jsonv2', limit: '1', countrycodes: 'pe', 'accept-language': 'es' });
      if (email) params.set('email', email);
      const res = await throttle(() =>
        fetch(`${baseUrl}/search?${params}`, { headers: { 'User-Agent': userAgent }, signal: AbortSignal.timeout(10000) })
      );
      if (!res.ok) throw new Error(`Nominatim respondió ${res.status}`);
      const [r] = await res.json();
      if (!r) return null;
      return {
        lat: parseFloat(r.lat),
        lon: parseFloat(r.lon),
        precision: precisionFrom(r),
        etiqueta: r.display_name,
        proveedor: 'nominatim',
        atribucion: '© OpenStreetMap contributors',
      };
    },
  };
}
