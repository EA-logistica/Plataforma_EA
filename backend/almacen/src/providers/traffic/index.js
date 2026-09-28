// Capa de tráfico. NO es tráfico en tiempo real: son factores sobre el tiempo en vía libre que da el
// proveedor de rutas (OSRM/ORS no conocen el tráfico).
//
//  - createFixedFactorTraffic: factor fijo (mismo criterio del Radar, DATA.trafficFactor = ×1.4).
//    Lo sigue usando la ruta simple planta -> almacén.
//  - createLimaTimeOfDayTraffic: perfil por hora del día y tipo de día para Lima Metropolitana,
//    usado por el planificador de paradas / programación de camiones: cada tramo se multiplica por
//    el factor de la hora en que EMPIEZA ese tramo. Valores de referencia (estimados a partir de la
//    experiencia operativa de reparto en Lima; se ajustan editando PERFIL_LIMA).
//
// Para tráfico real en el cálculo de ETA (TomTom Routing, HERE, Google Routes…), agregar aquí un
// proveedor que devuelva la misma forma con `tiempoReal: true`. La visualización en vivo (TomTom
// Traffic Flow, Waze Live Map) es independiente de esto: ver services/tiles.js y el frontend.
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

// [desdeHora, hastaHora, factor, etiqueta]. Hora local de Lima (UTC-5, sin horario de verano).
export const PERFIL_LIMA = {
  laborable: [
    [0, 5, 1.1, 'Noche'],
    [5, 7, 1.3, 'Madrugada / inicio de jornada'],
    [7, 10, 1.75, 'Hora punta mañana'],
    [10, 13, 1.35, 'Valle'],
    [13, 15, 1.45, 'Mediodía'],
    [15, 17, 1.4, 'Valle tarde'],
    [17, 20, 1.8, 'Hora punta tarde'],
    [20, 22, 1.35, 'Noche temprana'],
    [22, 24, 1.15, 'Noche'],
  ],
  sabado: [
    [0, 7, 1.1, 'Noche / madrugada'],
    [7, 10, 1.35, 'Mañana'],
    [10, 14, 1.5, 'Mediodía de sábado'],
    [14, 19, 1.45, 'Tarde de sábado'],
    [19, 24, 1.25, 'Noche'],
  ],
  domingo: [
    [0, 9, 1.05, 'Madrugada'],
    [9, 20, 1.2, 'Domingo'],
    [20, 24, 1.1, 'Noche'],
  ],
};

export function tipoDeDia(fecha) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha || '')) return 'laborable';
  const d = new Date(`${fecha}T12:00:00Z`).getUTCDay();
  return d === 0 ? 'domingo' : d === 6 ? 'sabado' : 'laborable';
}

export function createLimaTimeOfDayTraffic({ perfil = PERFIL_LIMA, factorFijo = null } = {}) {
  return {
    id: factorFijo ? 'factor-fijo' : 'perfil-horario-lima',
    tiempoReal: false,
    descripcion: factorFijo
      ? `Factor fijo ×${factorFijo} (TRAFFIC_FACTOR). Estimado, no tiempo real.`
      : 'Perfil horario de Lima (hora punta 7–10 y 17–20 ≈ ×1.75–1.8; valle ≈ ×1.35; noche ≈ ×1.1). Estimado, no tiempo real.',
    perfil,
    // minutoDelDia: 0..∞ (se toma módulo 24 h; un viaje que cruza medianoche usa la franja correcta).
    factorAt(minutoDelDia, dia = 'laborable') {
      if (factorFijo) return { factor: factorFijo, franja: 'Factor fijo' };
      const h = ((minutoDelDia / 60) % 24 + 24) % 24;
      const f = (perfil[dia] || perfil.laborable).find(([a, b]) => h >= a && h < b);
      return f ? { factor: f[2], franja: f[3] } : { factor: 1.3, franja: 'Sin dato' };
    },
  };
}
