// Rangos de tiempo a planta definidos por el Radar (campo `band` de la data original).
// Escala ordinal de un solo tono (validada para fondo oscuro: luminosidad monótona, pasos visibles,
// contraste >= 2:1). Siempre se muestra con su etiqueta de texto: el color nunca va solo.
export const BANDS = [
  { id: 'ideal', label: 'Ideal', rango: 'hasta 10 min', color: '#b7d3f6' },
  { id: 'moderado', label: 'Moderado', rango: '10–20 min', color: '#6da7ec' },
  { id: 'maximo', label: 'Máximo', rango: '20–30 min', color: '#2a78d6' },
  { id: 'fuera', label: 'Fuera de rango', rango: '+30 min', color: '#1c5cab' },
];
export const BAND_BY_ID = Object.fromEntries(BANDS.map((b) => [b.id, b]));
