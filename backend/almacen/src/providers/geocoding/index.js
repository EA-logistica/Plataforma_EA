// Registro de proveedores de geocodificación. Para cambiar de proveedor (Google, Mapbox, HERE…),
// crear un archivo con la misma interfaz `{ id, geocode(address) -> {lat, lon, precision, etiqueta} | null }`
// y registrarlo aquí. El resto de la aplicación no cambia.
import { config } from '../../config/env.js';
import { createNominatimProvider } from './nominatim.js';

const factories = {
  nominatim: () =>
    createNominatimProvider({ baseUrl: config.geocoding.nominatimUrl, email: config.geocoding.nominatimEmail, userAgent: config.userAgent }),
};

export function getGeocodingProvider() {
  const factory = factories[config.geocoding.provider];
  if (!factory) throw new Error(`Proveedor de geocodificación desconocido: ${config.geocoding.provider}`);
  return factory();
}
