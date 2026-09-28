// Proveedor de rutas: OpenRouteService. Requiere ORS_API_KEY (plan gratuito disponible).
// Aporta el perfil de vehículo de carga (driving-hgv). La API key solo se usa aquí, en el servidor.
const PROFILE = { auto: 'driving-car', camion: 'driving-hgv' };

export function createOrsProvider({ baseUrl, apiKey, userAgent }) {
  return {
    id: 'ors',
    nombre: 'OpenRouteService',
    perfiles: ['auto', 'camion'],
    optimiza: false, // el orden óptimo se pide a OSRM (ver services/routing.js)

    async route(from, to, perfil = 'auto') {
      const r = await this.routeMulti([from, to], perfil);
      return { perfil, distanciaM: r.distanciaM, duracionS: r.duracionS, geometria: r.geometria };
    },

    // Ruta por varios puntos en orden (el plan gratuito admite hasta 50 puntos por consulta).
    async routeMulti(points, perfil = 'auto') {
      const res = await fetch(`${baseUrl}/v2/directions/${PROFILE[perfil]}/geojson`, {
        method: 'POST',
        headers: { Authorization: apiKey, 'Content-Type': 'application/json', 'User-Agent': userAgent },
        body: JSON.stringify({ coordinates: points.map((p) => [p.lon, p.lat]) }),
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) throw new Error(`OpenRouteService respondió ${res.status}`);
      const f = (await res.json()).features?.[0];
      if (!f) throw new Error('OpenRouteService no encontró ruta');
      const segs = f.properties.segments || [];
      return {
        perfil,
        distanciaM: f.properties.summary.distance,
        duracionS: f.properties.summary.duration,
        geometria: f.geometry,
        legs: segs.map((s) => ({ distanciaM: s.distance || 0, duracionS: s.duration || 0 })),
      };
    },
  };
}
