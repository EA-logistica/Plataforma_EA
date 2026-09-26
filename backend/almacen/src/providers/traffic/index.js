// Capa de tráfico. Hoy: factor fijo sobre el tiempo en vía libre (mismo criterio que ya usa el Radar,
// DATA.trafficFactor = ×1.4 "tráfico moderado"). NO es tráfico en tiempo real.
// Para tráfico real (Google Routes, TomTom, HERE…), agregar un proveedor que devuelva la misma forma
// con `tiempoReal: true` y seleccionarlo aquí.
export function createFixedFactorTraffic(factor) {
  return {
    id: 'factor-fijo',
    estimate(duracionLibreMin) {
      return {
        tiempoReal: false,
        factor,
        duracionEstimadaMin: duracionLibreMin * factor,
        metodo: `Tiempo en vía libre × ${factor} (tráfico moderado estimado, mismo criterio del Radar Naranjal)`,
      };
    },
  };
}
