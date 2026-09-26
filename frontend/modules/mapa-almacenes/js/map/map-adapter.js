// Contrato del motor de mapa. La aplicación solo usa estos métodos, por lo que se puede cambiar
// Leaflet por otro motor (MapLibre, Google Maps JS, Mapbox GL…) implementando la misma interfaz.
//
//   setBaseLayers(defs)                        capas base seleccionables (ver config.BASE_LAYERS)
//   setOrigin(origin, { onClick })             marcador diferenciado de la planta
//   setWarehouses(items, { iconOf, labelOf, onClick })  marcadores agrupados (clustering)
//   showOnly(keySet)                           actualiza los marcadores visibles (filtros)
//   refreshIcons()                             repinta iconos (cambio de modo de color / selección)
//   focusWarehouse(key, { zoom }) -> Promise   desagrupa y centra un almacén
//   showRoute(geojsonLineString, style)        dibuja una ruta
//   clearRoute()
//   fitBounds([[lat,lon],[lat,lon]], padding) / fitToKeys(keySet, padding) / flyTo([lat,lon], zoom)
//   invalidateSize()
import { createLeafletMap } from './leaflet-adapter.js';

const ENGINES = { leaflet: createLeafletMap };

export function createMap(engine, container, options) {
  const factory = ENGINES[engine];
  if (!factory) throw new Error(`Motor de mapa no soportado: ${engine}`);
  return factory(container, options);
}
