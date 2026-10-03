import { JORNADA, COSTOS_PLANILLA } from '#data/payback/parametros.js';
import { calendario } from './devengos.js';

/**
 * Compara cada escenario contra lo que se gasta hoy en courier.
 *
 * Una precisión sobre la palabra "payback": ningún escenario actual tiene
 * desembolso inicial que recuperar -ni el personal propio (la moto es del
 * trabajador) ni el proveedor a cuota fija (no hay nada que comprar)-, así
 * que `inversion` y `mesesRetorno` siempre salen en cero. Se dejan en la
 * forma del resultado, en vez de quitarlas, porque son gasto contra gasto
 * real (o cuesta menos que el courier desde el primer mes, o no) y quitar el
 * campo obligaría a tocar cada pantalla que ya sabe mostrar "sin inversión".
 */

const DIAS_LABORABLES_AL_MES = JORNADA.diasSemanaAlMes + JORNADA.sabadosAlMes;

/**
 * @param {Array} escenarios  salida de escenarios.js
 * @param {object} demanda    salida de demanda.js
 * @param {object} [opciones]
 * @param {string} [opciones.inicio]  fecha de ingreso 'AAAA-MM-DD'; si viene, el
 *                                    retorno se calcula sobre el flujo real mes
 *                                    a mes en vez de sobre un promedio parejo
 */
export function comparar(escenarios, demanda, opciones = {}) {
  const gastoActual = demanda.recientes.gastoMensual;
  const costoPorViaje = demanda.recientes.costoPorViaje;
  const viajesPorDia = demanda.viajesPorDia.entreSemana || demanda.viajesPorDia.promedio;

  const filas = escenarios.map(e => {
    // El proveedor a cuota fija no pasa por planilla, courier residual ni
    // cobertura de vacaciones: cobra lo mismo mueva la empresa uno o cien
    // encargos, y esa es justamente la gracia de contratarlo así.
    if (e.cfg.modelo === 'tercero') {
      const costoMensual = e.tercero.costoReal;
      const ahorroMensual = gastoActual - costoMensual;
      return {
        escenario: e,
        excedenteDiario: 0,
        calendario: { valido: false },
        flujo: null,
        planilla: 0,
        gastoMoto: 0,
        coberturaVacaciones: 0,
        courierResidual: 0,
        margen: 0,
        costosOcultos: null,
        costoMensual,
        ahorroMensual,
        ahorroAnual: ahorroMensual * 12,
        inversion: 0,
        mesesRetorno: 0,
        resultadoPrimerAnio: ahorroMensual * 12
      };
    }

    // Los días de vacaciones no se pagan dos veces en planilla, pero esos días
    // igual hay que mover la carga: vuelve el courier. Se provisiona al mes.
    const diasHabilesSinCobertura = e.diasSinCoberturaAlAnio * (DIAS_LABORABLES_AL_MES * 12 / 365);
    const coberturaVacaciones = diasHabilesSinCobertura * viajesPorDia * costoPorViaje / 12;

    // Lo que la moto propia no alcanza a cubrir sigue saliendo por courier. Se
    // mide sobre la distribución real de días, no sobre el promedio: el
    // promedio cabe, pero los días cargados se desbordan igual.
    const excedenteDiario = demanda.viajesPorDia.excedenteSobre(e.capacidad.techoDiario);
    const courierResidual = excedenteDiario * DIAS_LABORABLES_AL_MES * costoPorViaje;

    const margen = e.cfg.margenGastoMensual || 0;
    const costosOcultos = ocultos(e, viajesPorDia, costoPorViaje);

    const costoMensual = e.planilla + coberturaVacaciones + courierResidual + margen + costosOcultos.total;
    const ahorroMensual = gastoActual - costoMensual;

    // Con fecha de ingreso, el flujo real: las gratificaciones y la CTS caen en
    // meses concretos y el primer año casi nunca se pagan completas.
    const otrosMensuales = coberturaVacaciones + courierResidual + margen + costosOcultos.total;
    const cal = opciones.inicio
      ? calendario(opciones.inicio, {
          base: e.persona.base,
          personas: e.cfg.personas,
          conCts: e.cfg.jornadaCompleta
        }, 24)
      : { valido: false };
    const flujo = cal.valido ? construirFlujo(cal, e, otrosMensuales, gastoActual, 0) : null;

    return {
      escenario: e,
      excedenteDiario,
      calendario: cal,
      flujo,
      planilla: e.planilla,
      gastoMoto: 0,
      coberturaVacaciones,
      courierResidual,
      margen,
      costosOcultos,
      costoMensual,
      ahorroMensual,
      ahorroAnual: ahorroMensual * 12,
      inversion: 0,
      mesesRetorno: 0,
      resultadoPrimerAnio: ahorroMensual * 12
    };
  });

  return {
    gastoActual,
    costoPorViaje,
    viajesPorDia,
    filas,
    condiciones: condiciones(filas, demanda),
    recomendacion: recomendar(filas)
  };
}

/**
 * Lo que cuesta ser el empleador y no sale en la boleta: faltas y descansos
 * médicos (se paga el sueldo y además courier para cubrir), reemplazos, y la
 * gestión y seguridad en el trabajo de cada persona. Estimaciones editables
 * en COSTOS_PLANILLA.
 */
function ocultos(e, viajesPorDia, costoPorViaje) {
  const c = COSTOS_PLANILLA;
  const personas = e.cfg.personas;
  const fraccion = e.cfg.fraccionJornada || 1;
  const faltas = c.diasFaltaPorPersonaAlAnio * personas * fraccion * viajesPorDia * costoPorViaje / 12;
  const rotacion = c.reemplazosAlAnio * c.costoPorReemplazo / 12;
  const gestion = c.gestionMensual + c.sstPorPersonaMensual * personas;
  return { faltas, rotacion, gestion, total: faltas + rotacion + gestion };
}

/**
 * Flujo mes a mes del primer par de años: lo que de verdad sale de caja.
 *
 * El promedio parejo sirve para comparar escenarios entre sí; este flujo sirve
 * para saber cuándo se recupera la inversión y qué meses aprietan. No son lo
 * mismo: diciembre, con gratificación, cuesta casi el doble que agosto.
 */
function construirFlujo(cal, e, otrosMensuales, gastoActual, inversion) {
  const fuera = e.persona.bonoFueraDePlanilla * e.cfg.personas;
  let acumulado = -inversion;
  let mesRecuperacion = null;

  const meses = cal.filas.map(f => {
    const costo = f.total + fuera + otrosMensuales;
    const ahorro = gastoActual - costo;
    acumulado += ahorro;
    if (mesRecuperacion === null && inversion > 0 && acumulado >= 0) mesRecuperacion = f.i + 1;
    return {
      ...f,
      otros: otrosMensuales,
      bonoFueraDePlanilla: fuera,
      costo,
      ahorro,
      acumulado
    };
  });

  const doce = meses.slice(0, 12);
  return {
    meses,
    costoPrimerAnio: doce.reduce((a, m) => a + m.costo, 0),
    ahorroPrimerAnio: doce.reduce((a, m) => a + m.ahorro, 0),
    /** Meses hasta recuperar la inversión, contando el flujo real. */
    mesRecuperacion,
    mesMasCaro: doce.slice().sort((a, b) => b.costo - a.costo)[0],
    mesMasBarato: doce.slice().sort((a, b) => a.costo - b.costo)[0]
  };
}

/**
 * Lo que tiene que ser cierto para que los escenarios de personal propio
 * funcionen. Va aparte de los riesgos de cada uno porque no depende de a
 * quién se contrate: depende de cómo se pidan los envíos.
 *
 * El proveedor a cuota fija (tercero) queda fuera de esta sección a
 * propósito: no tiene "capacidad" que agrupar por zona ni que se desborde
 * -eso es exactamente lo que compra la cuota fija-, así que estas
 * condiciones se calculan sobre el primer escenario que sí es personal
 * propio, no sobre `filas[0]` a ciegas.
 */
function condiciones(filas, demanda) {
  const lista = [];
  const personal = filas.filter(f => f.escenario.cfg.modelo !== 'tercero');
  const uno = personal[0];
  if (!uno) return lista;
  const cap = uno.escenario.capacidad;
  const viajes = demanda.viajesPorDia.entreSemana;

  lista.push({
    nivel: cap.alcanza ? 'ok' : 'alto',
    titulo: 'Los envíos se agrupan por zona',
    texto: 'Agrupando, la carga de un día promedio (' + viajes.toFixed(1) + ' encargos) ocupa el '
      + (cap.usoConPrograma * 100).toFixed(0) + '% del tiempo útil de "' + uno.escenario.nombre + '". Atendiendo'
      + ' cada pedido por separado, en cuanto llega, haría falta el ' + (cap.usoSinPrograma * 100).toFixed(0)
      + '%: más del doble de la jornada. La programación no es una mejora, es la condición para que esto exista.'
  });

  const pico = cap.pico;
  if (pico) {
    lista.push({
      nivel: pico.alcanza ? 'ok' : 'aviso',
      titulo: 'El día cargado se desborda',
      texto: 'El promedio es ' + viajes.toFixed(1) + ' encargos, pero el 10% de los días pasa de '
        + demanda.viajesPorDia.p90 + ' y hubo días de ' + demanda.viajesPorDia.maximo + '. Con '
        + pico.viajesPorDia + ' encargos el uso sube a ' + (pico.uso * 100).toFixed(0) + '%. '
        + (pico.alcanza
          ? 'Aun así entra.'
          : 'No entra: esos días el excedente tiene que seguir saliendo por courier, y así está previsto en el costo.')
    });
  }

  // Se calcula con el número real en vez de asumir una regla fija: dos
  // personas a tiempo completo sí duplicarían la capacidad de una, pero dos a
  // media jornada (como está planteado hoy) suman las mismas horas que una
  // completa. La comparación se adapta sola a lo que de verdad esté configurado.
  const otrosPersonal = personal.slice(1);
  if (otrosPersonal.length) {
    const mayor = personal.slice().sort((a, b) => b.escenario.capacidad.techoDiario - a.escenario.capacidad.techoDiario)[0];
    const menor = personal.slice().sort((a, b) => a.escenario.capacidad.techoDiario - b.escenario.capacidad.techoDiario)[0];
    const distintos = Math.abs(mayor.escenario.capacidad.techoDiario - menor.escenario.capacidad.techoDiario) > 0.05;

    lista.push(distintos ? {
      nivel: 'aviso',
      titulo: 'La capacidad sí cambia entre uno y dos motorizados',
      texto: '"' + mayor.escenario.nombre + '" aguanta ' + mayor.escenario.capacidad.techoDiario.toFixed(1)
        + ' encargos al día contra ' + menor.escenario.capacidad.techoDiario.toFixed(1) + ' de "'
        + menor.escenario.nombre + '". Más gente da más margen frente a un pico de demanda o para cubrir dos'
        + ' zonas el mismo día. El proveedor a cuota fija no tiene este límite: la capacidad la pone él, no la empresa.'
    } : {
      nivel: 'aviso',
      titulo: 'La capacidad es la misma entre uno y dos motorizados',
      texto: 'Una persona a tiempo completo y dos a media jornada suman las mismas horas de reparto a la semana:'
        + ' ambas aguantan ' + uno.escenario.capacidad.techoDiario.toFixed(1) + ' encargos al día. Dos motos no'
        + ' rinden el doble si se turnan para cubrir el mismo horario; rendirían el doble si salieran a la vez,'
        + ' y entonces cada una cubriría media jornada, no la jornada entera. El proveedor a cuota fija no tiene'
        + ' este límite: la capacidad la pone él, no la empresa.'
    });
  } else {
    // Un solo escenario de personal propio (dos part time): se compara contra
    // la moto única del proveedor, que es lo que de verdad está en la calle.
    lista.push({
      nivel: 'aviso',
      titulo: 'Dos part time rinden lo mismo que una sola moto',
      texto: 'Dos personas a media jornada que se turnan suman las mismas horas de reparto que un motorizado a'
        + ' tiempo completo: ' + uno.escenario.capacidad.techoDiario.toFixed(1) + ' encargos al día. Es la misma'
        + ' capacidad que da el proveedor con un motorizado y las rutas fijas del plan semanal; si el día se carga,'
        + ' el proveedor pone el refuerzo, no la empresa.'
    });
  }

  return lista;
}

/**
 * Ordena los escenarios por lo que importa, en este orden: primero que la
 * operación funcione, después que cueste menos. Un escenario que no cubre la
 * demanda no gana por ser barato.
 */
function recomendar(filas) {
  // El proveedor a cuota fija no tiene "avisos legales" -no es planilla-, así
  // que solo cuentan los suyos propios (riesgos).
  const avisosDe = f => f.escenario.persona ? f.escenario.persona.avisos : [];

  const viables = filas.filter(f => f.escenario.capacidad.alcanza);
  const sinRiesgoAlto = viables.filter(f =>
    !f.escenario.riesgos.some(r => r.nivel === 'alto') &&
    !avisosDe(f).some(a => a.nivel === 'alto'));

  const candidatos = sinRiesgoAlto.length ? sinRiesgoAlto : viables;
  const mejor = candidatos.slice().sort((a, b) => b.ahorroMensual - a.ahorroMensual)[0] || null;

  return {
    mejor,
    viables: viables.map(f => f.escenario.id),
    conRiesgoAlto: filas
      .filter(f => f.escenario.riesgos.some(r => r.nivel === 'alto') || avisosDe(f).some(a => a.nivel === 'alto'))
      .map(f => f.escenario.id),
    /** Ninguno conviene si el courier sale más barato que todos. */
    ningunoConviene: filas.every(f => f.ahorroMensual <= 0)
  };
}
