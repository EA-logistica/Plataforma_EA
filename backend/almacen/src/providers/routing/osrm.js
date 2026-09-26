// Proveedor de rutas: OSRM (Open Source Routing Machine) sobre OpenStreetMap.
// Gratuito y sin API key. Solo perfil automóvil. No incluye tráfico.
// El servidor público es de demostración: para uso intensivo, desplegar OSRM propio y cambiar OSRM_URL.
export function createOsrmProvider({ baseUrl, userAgent }) {
  return {
    id: 'osrm',
    nombre: 'OSRM · OpenStreetMap',
    perfiles: ['auto'],
    async route(from, to) {
      const coords = `${from.lon},${from.lat};${to.lon},${to.lat}`;
      const url = `${baseUrl}/route/v1/driving/${coords}?overview=full&geometries=geojson&alternatives=false&steps=false`;
      const res = await fetch(url, { headers: { 'User-Agent': userAgent }, signal: AbortSignal.timeout(12000) });
      if (!res.ok) throw new Error(`OSRM respondió ${res.status}`);
      const body = await res.json();
      const r = body.routes?.[0];
      if (body.code !== 'Ok' || !r) throw new Error(`OSRM no encontró ruta (${body.code || 'sin código'})`);
      return {
        perfil: 'auto',
        distanciaM: r.distance,
        duracionS: r.duration,
        geometria: r.geometry, // GeoJSON LineString [lon, lat]
      };
    },
  };
}
