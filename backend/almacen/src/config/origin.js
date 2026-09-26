// Ubicación base de referencia: Origen / Planta principal.
// No se fijan coordenadas aquí: se resuelven en services/locations.js con este orden:
//   1) storage/coordenadas-manuales.json  -> "origen"  (coordenadas exactas verificadas)
//   2) data existente del Radar            -> DATA.plant.lat / lon
//   3) geocodificación de `direccion`      (con caché persistente)
export const ORIGIN = {
  id: 'plasticos-nacionales',
  nombre: 'PLÁSTICOS NACIONALES',
  rol: 'Origen / Planta principal',
  direccion: 'Av. Los Talleres 4898, Urb. Ind. El Naranjal',
  distrito: 'Independencia',
  provincia: 'Lima',
  pais: 'Perú',
  direccionGeocodificable: 'Av. Los Talleres 4898, Urb. Industrial El Naranjal, Independencia, Lima, Perú',
};
