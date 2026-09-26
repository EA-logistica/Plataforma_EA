// Estructura de información logística por almacén, preparada para análisis posterior.
// Los valores se cargan en backend/storage/logistica.json (vacío por diseño: sin datos ficticios).
// Los dos primeros campos se completan con datos que YA existen en la data del Radar.
export const LOGISTICS_FIELDS = [
  { key: 'tiempoDesdePlanta', label: 'Tiempo desde Plásticos Nacionales', grupo: 'Acceso desde planta', format: 'min' },
  { key: 'distanciaDesdePlanta', label: 'Distancia desde Plásticos Nacionales', grupo: 'Acceso desde planta', format: 'km' },
  { key: 'costoTransporteEstimado', label: 'Costo estimado de transporte', grupo: 'Acceso desde planta', format: 'text' },
  { key: 'zonaLogistica', label: 'Zona logística', grupo: 'Ubicación', format: 'text' },
  { key: 'cercaniaPanamericanaNorteKm', label: 'Cercanía a Panamericana Norte', grupo: 'Ubicación', format: 'km' },
  { key: 'cercaniaCallaoKm', label: 'Cercanía al Callao', grupo: 'Ubicación', format: 'km' },
  { key: 'cercaniaPuertosKm', label: 'Cercanía a puertos', grupo: 'Ubicación', format: 'km' },
  { key: 'cercaniaViasPrincipales', label: 'Cercanía a vías principales', grupo: 'Ubicación', format: 'text' },
  { key: 'capacidad', label: 'Capacidad del almacén', grupo: 'Infraestructura', format: 'text' },
  { key: 'alturaLibreM', label: 'Altura libre', grupo: 'Infraestructura', format: 'm' },
  { key: 'patioManiobras', label: 'Patio de maniobras', grupo: 'Infraestructura', format: 'bool' },
  { key: 'vehiculoPermitido', label: 'Tipo de vehículo permitido', grupo: 'Acceso vehicular', format: 'text' },
  { key: 'accesoTrailer', label: 'Acceso para tráiler', grupo: 'Acceso vehicular', format: 'bool' },
  { key: 'accesoCamion', label: 'Acceso para camión', grupo: 'Acceso vehicular', format: 'bool' },
];

// Combina: (1) valores cargados manualmente en logistica.json  (2) valores derivados de la data original.
export function buildLogistics(original, overlay = {}) {
  const derived = {};
  if (Number.isFinite(original.duration_adj_min)) {
    derived.tiempoDesdePlanta = {
      valor: original.duration_adj_min,
      nota: `Dato existente del Radar: ${original.duration_min} min en vía libre (OSRM) × factor de tráfico moderado. Ruta calculada almacén → planta.`,
    };
  }
  if (Number.isFinite(original.distance_km)) {
    derived.distanciaDesdePlanta = { valor: original.distance_km, nota: 'Dato existente del Radar: distancia vial (OSRM).' };
  }
  const out = {};
  for (const f of LOGISTICS_FIELDS) {
    if (overlay[f.key] !== undefined && overlay[f.key] !== null && overlay[f.key] !== '') out[f.key] = { valor: overlay[f.key], nota: 'Cargado en logistica.json' };
    else if (derived[f.key]) out[f.key] = derived[f.key];
    else out[f.key] = null;
  }
  return out;
}
