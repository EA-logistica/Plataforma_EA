// Cálculo de rutas con caché persistente. Las rutas entre dos puntos fijos casi no cambian, por lo que
// una misma consulta solo llega al proveedor externo una vez cada ROUTE_CACHE_TTL_DAYS días.
import path from 'node:path';
import { CACHE_DIR, config } from '../config/env.js';
import { JsonStore } from '../lib/json-store.js';
import { HttpError } from '../lib/http.js';
import { PERFILES, providerFor } from '../providers/routing/index.js';
import { createFixedFactorTraffic } from '../providers/traffic/index.js';
import { readRadarData } from '../data/radar-source.js';

const routeCache = new JsonStore(path.join(CACHE_DIR, 'rutas.json'));
const round = (n) => Math.round(n * 1e5) / 1e5;

function trafficModel() {
  const factor = config.traffic.factorOverride ?? readRadarData().data.trafficFactor ?? 1;
  return createFixedFactorTraffic(factor);
}

export async function computeRoute(from, to, perfilSolicitado = 'auto') {
  if (!PERFILES[perfilSolicitado]) throw new HttpError(400, `Perfil desconocido: ${perfilSolicitado}`);

  let provider = providerFor(perfilSolicitado);
  let advertencia = null;
  if (!provider) {
    provider = providerFor('auto');
    advertencia = 'El perfil camión requiere configurar ORS_API_KEY (OpenRouteService) en el servidor. Se muestra la ruta para automóvil.';
  }
  const perfil = provider.perfiles.includes(perfilSolicitado) ? perfilSolicitado : 'auto';

  const key = [provider.id, perfil, round(from.lat), round(from.lon), round(to.lat), round(to.lon)].join('|');
  const ttlMs = config.routing.cacheTtlDays * 86400000;
  let hit = routeCache.get(key);
  const fromCache = !!(hit && Date.now() - Date.parse(hit.calculadoEn) < ttlMs);

  if (!fromCache) {
    try {
      const r = await provider.route(from, to, perfil);
      hit = { ...r, proveedor: provider.id, proveedorNombre: provider.nombre, calculadoEn: new Date().toISOString() };
      routeCache.set(key, hit);
    } catch (err) {
      throw new HttpError(502, `No se pudo calcular la ruta con ${provider.nombre}: ${err.message}`);
    }
  }

  const duracionLibreMin = hit.duracionS / 60;
  return {
    proveedor: hit.proveedor,
    proveedorNombre: hit.proveedorNombre,
    perfilSolicitado,
    perfilAplicado: hit.perfil,
    advertencia,
    distanciaKm: hit.distanciaM / 1000,
    duracionLibreMin,
    trafico: trafficModel().estimate(duracionLibreMin),
    geometria: hit.geometria,
    calculadoEn: hit.calculadoEn,
    desdeCache: fromCache,
  };
}
