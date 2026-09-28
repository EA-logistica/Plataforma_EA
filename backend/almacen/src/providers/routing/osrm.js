// Proveedor de rutas: OSRM (Open Source Routing Machine) sobre OpenStreetMap.
// Gratuito y sin API key. Solo perfil automóvil. No incluye tráfico.
// El servidor público es de demostración: para uso intensivo, desplegar OSRM propio y cambiar OSRM_URL.
export function createOsrmProvider({ baseUrl, userAgent }) {
  async function call(service, points, query) {
    const coords = points.map((p) => `${p.lon},${p.lat}`).join(';');
    const url = `${baseUrl}/${service}/v1/driving/${coords}?${query}`;
    const res = await fetch(url, { headers: { 'User-Agent': userAgent }, signal: AbortSignal.timeout(15000) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok && !body.code) throw new Error(`OSRM respondió ${res.status}`);
    if (body.code !== 'Ok') throw new Error(`OSRM no encontró ruta (${body.message || body.code || res.status})`);
    return body;
  }

  return {
    id: 'osrm',
    nombre: 'OSRM · OpenStreetMap',
    perfiles: ['auto'],
    optimiza: true,

    async route(from, to) {
      const r = await this.routeMulti([from, to]);
      return { perfil: 'auto', distanciaM: r.distanciaM, duracionS: r.duracionS, geometria: r.geometria };
    },

    // Ruta que pasa por todos los puntos en el orden dado (2..25 puntos).
    async routeMulti(points) {
      const body = await call('route', points, 'overview=full&geometries=geojson&alternatives=false&steps=false');
      const r = body.routes?.[0];
      if (!r) throw new Error('OSRM no encontró ruta');
      return {
        perfil: 'auto',
        distanciaM: r.distance,
        duracionS: r.duration,
        geometria: r.geometry, // GeoJSON LineString [lon, lat]
        legs: r.legs.map((l) => ({ distanciaM: l.distance, duracionS: l.duration })),
      };
    },

    // Orden óptimo de visita (problema del viajante) con el primer punto fijo como salida.
    // Devuelve `orden`: índices de `points` en el orden de visita (orden[0] === 0).
    async optimize(points, { regreso = false } = {}) {
      const query = regreso ? 'roundtrip=true&source=first' : 'roundtrip=false&source=first&destination=any';
      let body;
      try {
        body = await call('trip', points, `${query}&overview=false&steps=false`);
      } catch (err) {
        if (regreso) throw err;
        // Algunas versiones de OSRM no admiten destination=any sin retorno: se optimiza en circuito
        // y se descarta el tramo de regreso (el orden resultante sigue siendo bueno).
        body = await call('trip', points, 'roundtrip=true&source=first&overview=false&steps=false');
      }
      const orden = body.waypoints
        .map((w, i) => ({ i, pos: w.waypoint_index }))
        .sort((a, b) => a.pos - b.pos)
        .map((x) => x.i);
      return { orden };
    },
  };
}
