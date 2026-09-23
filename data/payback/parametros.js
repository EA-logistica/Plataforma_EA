/**
 * Parámetros de entrada del análisis payback.
 *
 * Todo lo que se puede discutir con RR.HH., con Finanzas o con un proveedor
 * vive aquí, separado del cálculo (../backend/). Para simular otra hipótesis
 * se cambia un número de este archivo y nada más.
 *
 * ADVERTENCIA SOBRE LAS TASAS DE LEY: son las del régimen laboral común del
 * sector privado peruano y están puestas como referencia para ordenar la
 * decisión, no como asesoría legal ni contable. Las primas de Vida Ley y SCTR
 * varían por aseguradora y por nivel de riesgo. Antes de firmar nada, que
 * RR.HH. y el contador validen estos porcentajes.
 */

/** Jornada pedida para el motorizado, en los dos escenarios a tiempo completo. */
export const JORNADA = {
  // Lunes a viernes de 8:00 a 17:30 y sábados de 8:00 a 12:30.
  entreSemana: { desde: '08:00', hasta: '17:30' },
  sabado: { desde: '08:00', hasta: '12:30' },

  // El refrigerio no se computa como tiempo de trabajo (mínimo legal 45 min).
  // Con 60 min la semana queda en 47 h, debajo del tope de 48 h; con 45 min
  // se pasa a 48.25 h y ya habría que pagar sobretiempo. Ver ../backend/planilla.js
  refrigerioMin: 60,

  topeLegalSemanalHoras: 48,

  // Días trabajados al mes, promedio (52 semanas / 12).
  diasSemanaAlMes: 21.7,
  sabadosAlMes: 4.33
};

/**
 * Tasas y topes de ley. Régimen laboral común, sector privado.
 * Fuentes: D.Leg. 728, D.S. 001-97-TR (CTS), Ley 30334 (gratificaciones),
 * Ley 26790 (EsSalud), D.Leg. 688 (Vida Ley), D.S. 009-97-SA (SCTR).
 */
export const LEY = {
  /** Remuneración mínima vital vigente. */
  rmv: 1130,

  /** Aporte del empleador al seguro de salud, sobre la remuneración mensual. */
  essalud: 0.09,

  /** Gratificaciones de julio y diciembre: una remuneración cada una. */
  gratificacionesAlAnio: 2,

  /**
   * Bonificación extraordinaria de la Ley 30334: el 9% de EsSalud que no se
   * paga sobre la gratificación se entrega al trabajador. Es costo igual.
   */
  bonificacionExtraordinaria: 0.09,

  /**
   * CTS: dos depósitos al año (mayo y noviembre). La remuneración computable
   * incluye un sexto de la última gratificación, así que el año equivale a
   * 7/6 de sueldo, no a uno.
   */
  ctsSextoGratificacion: 1 / 6,

  /** Vacaciones: 30 días al año para jornada completa, 6 para part time. */
  vacacionesDiasCompleto: 30,
  vacacionesDiasPartTime: 6,

  /** Seguro Vida Ley, obligatorio desde el primer día. Prima referencial. */
  vidaLey: 0.0071,

  /**
   * SCTR (salud + pensión) para actividad de riesgo. Referencial: depende de
   * la aseguradora y de la clasificación de la actividad. Se incluye porque
   * manejar moto en Lima todo el día es exposición real.
   */
  sctr: 0.028,

  /** Asignación familiar: 10% de la RMV, solo si tiene hijos menores de 18. */
  asignacionFamiliarTasa: 0.10,

  /** Horas diarias por debajo de las cuales el contrato es part time legal. */
  umbralPartTimeHoras: 4
};

/** Impuesto General a las Ventas: se suma sobre cualquier cuota que facture un tercero. */
export const IGV = { tasa: 0.18 };

/**
 * Escenarios tal como los planteó logística. El bono se marca como
 * remunerativo o no, porque cambia mucho el costo: si es una condición de
 * trabajo (combustible y mantenimiento de su moto, contra comprobante) no
 * entra a la base de gratificaciones, CTS ni EsSalud.
 *
 * `modelo: 'tercero'` distingue al único escenario que no es personal propio:
 * escenarios.js lo arma aparte (sin planilla ni capacidad que evaluar, ver
 * construirTercero) porque es una cuota fija a un proveedor, no un puesto.
 */
export const ESCENARIOS = {
  tercero: {
    id: 'tercero',
    nombre: 'Tercerizar con un proveedor a cuota fija',
    detalle: 'Un proveedor externo se hace cargo de toda la mensajería por una cuota mensual fija de S/ 3 500 + IGV, sin importar cuántos encargos salgan. No es personal de la empresa: no hay planilla, moto que comprar ni vacaciones que cubrir. A cambio, la empresa depende de que el proveedor cumpla los viajes asignados del día.',
    modelo: 'tercero',
    cuotaMensualSinIgv: 3500
  },
  dosMotorizados: {
    id: 'dosMotorizados',
    nombre: 'Dos motorizados en planilla, tiempo completo',
    detalle: 'Dos personas contratadas a tiempo completo, S/ 900 de básico cada una y todos los beneficios de ley (gratificaciones, CTS, EsSalud, Vida Ley, SCTR). La moto, el combustible y el mantenimiento corren por cuenta de cada una.',
    personas: 2,
    sueldoBase: 900,
    bono: 0,
    bonoRemunerativo: true,
    jornadaCompleta: true
  },
  propia: {
    id: 'propia',
    nombre: 'Un motorizado con moto propia',
    detalle: 'Contrato a tiempo completo. La moto, el combustible y el mantenimiento corren por su cuenta, cubiertos por el bono.',
    personas: 1,
    sueldoBase: 1800,
    bono: 300,
    bonoRemunerativo: true,
    jornadaCompleta: true
  }
};

/**
 * Supuestos de operación. `minutosPorParada` es lo que toma entregar o recoger
 * una vez en el punto: estacionar, subir, esperar la firma y volver.
 */
export const OPERACION = {
  minutosPorParada: 12,
  maxParadasPorRuta: 4,

  /**
   * Holgura que se reserva del día para lo que no es ruta: cargar, papeleo,
   * imprevistos y las urgencias que sí se aceptan. Sobre el tiempo disponible.
   */
  holgura: 0.15
};
