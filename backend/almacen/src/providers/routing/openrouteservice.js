// Proveedor de rutas: OpenRouteService. Requiere ORS_API_KEY (plan gratuito disponible).
// Aporta el perfil de vehículo de carga (driving-hgv). La API key solo se usa aquí, en el servidor.
const PROFILE = { auto: 'driving-car', camion: 'driving-hgv' };

export function createOrsProvider({ baseUrl, apiKey, userAgent }) {
  return {
    id: 'ors',
    nombre: 'OpenRouteService',
    perfiles: ['auto', 'camion'],
    async route(from, to, perfil = 'auto') {
      const res = await fetch(`${baseUrl}/v2/directions/${PROFILE[perfil]}/geojson`, {
        method: 'POST',
        headers: { Authorization: apiKey, 'Content-Type': 'application/json', 'User-Agent': userAgent },
        body: JSON.stringify({ coordinates: [[from.lon, from.lat], [to.lon, to.lat]] }),
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw new Error(`OpenRouteService respondió ${res.status}`);
      const f = (await res.json()).features?.[0];
      if (!f) throw new Error('OpenRouteService no encontró ruta');
      return {
        perfil,
        distanciaM: f.properties.summary.distance,
        duracionS: f.properties.summary.duration,
        geometria: f.geometry,
      };
    },
  };
}
