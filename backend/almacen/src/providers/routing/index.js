// Selección de proveedor de rutas por perfil de vehículo.
// Interfaz de proveedor: `{ id, nombre, perfiles: [...], route(from, to, perfil) -> {perfil, distanciaM, duracionS, geometria} }`.
// Para agregar Google Routes, Mapbox, HERE, etc.: crear el archivo y registrarlo en `buildProviders`.
import { config } from '../../config/env.js';
import { createOsrmProvider } from './osrm.js';
import { createOrsProvider } from './openrouteservice.js';

function buildProviders() {
  const list = {};
  list.osrm = createOsrmProvider({ baseUrl: config.routing.osrmUrl, userAgent: config.userAgent });
  if (config.routing.orsApiKey) {
    list.ors = createOrsProvider({ baseUrl: config.routing.orsUrl, apiKey: config.routing.orsApiKey, userAgent: config.userAgent });
  }
  return list;
}

const providers = buildProviders();

export const PERFILES = {
  auto: { id: 'auto', etiqueta: 'Automóvil' },
  camion: { id: 'camion', etiqueta: 'Camión / vehículo de carga' },
};

// Devuelve el proveedor a usar para un perfil. Preferencia: el configurado en ROUTING_PROVIDER;
// si no soporta el perfil, cualquier otro disponible que sí lo soporte.
export function providerFor(perfil) {
  const preferred = providers[config.routing.provider] || providers.osrm;
  if (preferred.perfiles.includes(perfil)) return preferred;
  return Object.values(providers).find((p) => p.perfiles.includes(perfil)) || null;
}

export function capabilities() {
  return Object.values(PERFILES).map((p) => {
    const prov = providerFor(p.id);
    return { ...p, disponible: !!prov, proveedor: prov?.nombre ?? null };
  });
}
