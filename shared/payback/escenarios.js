import { ESCENARIOS, JORNADA, OPERACION, IGV } from '#data/payback/parametros.js';
import { costoPersona, horasSemanales } from './planilla.js';
import { evaluar } from './capacidad.js';

/**
 * Arma los tres escenarios completos: costo, capacidad y riesgos.
 *
 * Cada escenario responde tres preguntas distintas y conviene no mezclarlas:
 *   1. ¿Cuánto cuesta al mes?            -> planilla.js (personal propio) o
 *                                            construirTercero, aquí abajo (proveedor)
 *   2. ¿Aguanta los viajes del día?      -> capacidad.js (no aplica al proveedor:
 *                                            eso lo compra la cuota fija)
 *   3. ¿Qué se rompe si algo sale mal?   -> riesgos()/riesgosTercero(), aquí abajo
 *
 * Un escenario puede ser el más barato y aun así no servir, si no cubre la
 * demanda o si deja a la operación colgada de una sola persona.
 */

const DIAS_LABORABLES_AL_MES = JORNADA.diasSemanaAlMes + JORNADA.sabadosAlMes;

/**
 * @param {object} demanda        salida de demanda.js
 * @param {object} [opciones]
 * @param {number} [opciones.asignacionFamiliar]
 * @param {boolean} [opciones.bonoRemunerativo]  fuerza el tratamiento del bono
 */
export function construir(demanda, opciones = {}) {
  // Se dimensiona contra el día laborable, que es el que aprieta: el sábado
  // mueve menos de la mitad de encargos.
  const viajesPorDia = demanda.viajesPorDia.entreSemana || demanda.viajesPorDia.promedio;

  return Object.values(ESCENARIOS).map(base => {
    if (base.modelo === 'tercero') return construirTercero(base, opciones);

    const cfg = {
      ...base,
      bonoRemunerativo: opciones.bonoRemunerativo !== undefined
        ? opciones.bonoRemunerativo : base.bonoRemunerativo,
      asignacionFamiliar: opciones.asignacionFamiliar || 0,
      // El básico del part time se elige en pantalla, solo entre las opciones planteadas.
      sueldoBase: (base.opcionesBasico || []).includes(opciones.basicoPartTime)
        ? opciones.basicoPartTime : base.sueldoBase,
      // Dos personas part time se reparten la jornada: media cada una.
      fraccionJornada: base.jornadaCompleta ? 1 : 1 / base.personas
    };

    const persona = costoPersona(cfg);
    const planilla = persona.total * cfg.personas;

    const capacidad = evaluar({
      personas: cfg.personas,
      fraccionJornada: cfg.fraccionJornada,
      viajesPorDia,
      viajesPico: demanda.viajesPorDia.p90,
      mezcla: demanda.mezcla
    });

    // Días al año sin motorizado por vacaciones, en equivalente de día
    // completo. Con dos part time el hueco es menor: cada ausencia deja fuera
    // media jornada, no la jornada entera.
    const diasSinCoberturaAlAnio = persona.diasVacaciones * cfg.personas * cfg.fraccionJornada;

    return {
      id: cfg.id,
      nombre: cfg.nombre,
      detalle: typeof cfg.detalle === 'function' ? cfg.detalle(cfg) : cfg.detalle,
      cfg,
      persona,
      planilla,
      capacidad,
      diasSinCoberturaAlAnio,
      riesgos: riesgos(cfg)
    };
  });
}

/**
 * El proveedor cobra la misma cuota mueva la empresa uno o cien encargos: no
 * hay personal que dimensionar ni capacidad que pueda no alcanzar, así que
 * este escenario no pasa por costoPersona/evaluar -esas cuentas son de
 * planilla propia- y arma su resultado aparte, con la forma mínima que
 * payback.js necesita para compararlo con los otros dos.
 *
 * @param {object} base
 * @param {object} [opciones]
 * @param {boolean} [opciones.creditoFiscalIgv]  ver la nota sobre `costoReal` abajo
 * @param {number} [opciones.plazoPagoDias]  30 o 45: a cuántos días se paga la factura del proveedor
 */
function construirTercero(base, opciones = {}) {
  // La cuota se elige en pantalla, solo entre las planteadas.
  const cuota = (base.opcionesCuota || []).includes(opciones.cuotaTercero) ? opciones.cuotaTercero : base.cuotaMensualSinIgv;
  const cfg = { ...base, cuotaMensualSinIgv: cuota };
  const igv = cuota * IGV.tasa;
  const total = cuota + igv;
  // El plazo de pago no cambia cuánto se debe -la cuota es la misma-, cambia
  // CUÁNDO sale de caja: a más días, más tiempo circula ese dinero en la
  // empresa antes de pagarlo. Es una condición de negociación con el
  // proveedor, no un costo, así que no toca costoReal ni costoMensual.
  const plazoPagoDias = [30, 45].includes(opciones.plazoPagoDias) ? opciones.plazoPagoDias : 30;
  // El IGV que factura un proveedor formal es crédito fiscal para una empresa
  // del Régimen General/MYPE Tributario que ya genera débito fiscal por sus
  // propias ventas: lo paga en la factura, pero ese mismo mes descuenta el
  // mismo monto de lo que le debe a SUNAT. No es una salida de caja neta, es
  // un traslado -por eso el costo que de verdad compite contra el gasto
  // actual en courier es la cuota SIN IGV, no el total facturado-.
  // El supuesto es editable (`creditoFiscalIgv`, por defecto activado) porque
  // solo vale si la empresa puede usar el crédito: no aplica bajo el Nuevo
  // RUS, ni si el débito fiscal del mes no alcanza para absorberlo.
  const creditoFiscalIgv = opciones.creditoFiscalIgv !== false;
  return {
    id: base.id,
    nombre: base.nombre,
    detalle: typeof cfg.detalle === 'function' ? cfg.detalle(cfg) : cfg.detalle,
    cfg,
    persona: null,
    tercero: {
      cuotaMensualSinIgv: cuota,
      igv,
      total,
      creditoFiscalIgv,
      /** El costo que de verdad se compara contra el courier: neto de IGV si se puede usar el crédito, bruto si no. */
      costoReal: creditoFiscalIgv ? cuota : total,
      plazoPagoDias
    },
    // No es nuestro que cubrir: el proveedor responde por su propia gente y
    // su propio vehículo. "Alcanza" siempre, que es justo lo que compra la
    // cuota fija.
    capacidad: { alcanza: true },
    diasSinCoberturaAlAnio: 0,
    riesgos: riesgosTercero(creditoFiscalIgv)
  };
}

function riesgosTercero(creditoFiscalIgv) {
  return [
    { nivel: 'ok', texto: 'Accidentes, seguros y contratar personal dejan de ser un problema de la empresa:'
      + ' son responsabilidad del proveedor, no de logística. Lo único que queda por vigilar es que cumpla los'
      + ' viajes asignados del día -esa es la única condición real de este escenario, no una entre varias.' },
    { nivel: 'ok', texto: 'La cuota es fija: cueste lo que cueste el volumen del mes, no cambia. El riesgo de'
      + ' la demanda lo asume el proveedor, no la empresa.' },
    creditoFiscalIgv
      ? { nivel: 'ok', texto: 'El IGV de la factura se está tratando como crédito fiscal: se descuenta del'
          + ' IGV que la empresa ya paga por sus propias ventas, así que el costo real de decisión es la cuota'
          + ' SIN IGV. Vale solo si la empresa está en Régimen General o MYPE Tributario y genera débito fiscal'
          + ' suficiente para absorberlo cada mes; si no, el costo real es el total facturado.' }
      : { nivel: 'aviso', texto: 'Se está contando el IGV como costo (no se puede usar como crédito fiscal en'
          + ' este caso), así que el costo real es el total facturado con IGV incluido.' },
    { nivel: 'aviso', texto: 'Justamente porque la responsabilidad es del proveedor, el control real se reduce a'
      + ' un solo indicador: viajes asignados contra viajes cumplidos, por día. Sin ese seguimiento explícito, un'
      + ' incumplimiento se nota recién cuando el área afectada se queja, no cuando ocurre.' },
    { nivel: 'aviso', texto: 'No hay activo ni personal propio que perder si el proveedor falla un día, pero'
      + ' tampoco hay control directo sobre quién reparte ni cómo. Conviene pedir referencias y una cláusula'
      + ' de salida sin permanencia larga.' },
    { nivel: 'aviso', texto: 'La cuota no baja si el volumen cae. Conviene revisarla contra el histórico cada'
      + ' cierto tiempo -no dejarla fija para siempre- y no pactar un contrato indefinido sin punto de salida.' }
  ];
}

/**
 * Lo que no se ve en el costo mensual pero decide el asunto. Va aparte del
 * cálculo porque son juicios operativos, no aritmética.
 */
function riesgos(cfg) {
  // Va primero porque es el que decide: un motorizado pasa el día en el tráfico
  // de Lima, y en planilla cada accidente es de la empresa.
  const lista = [{
    nivel: 'alto',
    texto: 'PLANSA es el empleador: un accidente del motorizado es un accidente de trabajo de la empresa'
      + ' (investigación, registro, fiscalización de SUNAFIL y posible indemnización si faltó una medida de'
      + ' prevención). El SCTR cubre salud y pensión, no esa responsabilidad. Si daña a un tercero, la empresa'
      + ' también puede responder por él. Contrato, faltas, vacaciones y reemplazos también son de la empresa.'
  }];

  if (cfg.personas === 1) {
    lista.push({
      nivel: 'alto',
      texto: 'Toda la mensajería queda en una sola persona. Si falta, se enferma o renuncia, no hay quien'
        + ' cubra y la operación vuelve al courier el mismo día, sin aviso.'
    });
  } else {
    lista.push({
      nivel: 'ok',
      texto: 'Con dos personas, la falta de una deja media jornada cubierta en vez de dejar el día entero'
        + ' sin servicio.'
    });
  }

  lista.push({
    nivel: 'aviso',
    texto: 'La moto es del trabajador. Si se le malogra, el problema de la empresa es el mismo: no hay reparto.'
      + ' Conviene dejar por escrito quién responde por la disponibilidad del vehículo y exigir SOAT vigente.'
  });

  if (!cfg.jornadaCompleta) {
    const horasDia = horasSemanales().total * cfg.fraccionJornada / 6;
    lista.push({
      nivel: 'aviso',
      texto: 'Part time significa por debajo de 4 horas diarias, y cada persona queda en '
        + horasDia.toFixed(2) + ' h: el margen es de unos ' + Math.round((4 - horasDia) * 60) + ' minutos al día. Si se les pide quedarse para un pico o una urgencia, el contrato pasa a jornada'
        + ' completa: CTS, 30 días de vacaciones y reintegros de meses anteriores (unos S/ 175 a 250 más al mes).'
    });
    lista.push({
      nivel: 'aviso',
      texto: 'Dos personas a media jornada cubren el mismo horario por turnos, no en paralelo: la capacidad'
        + ' total es la misma que con una a tiempo completo, no el doble.'
    });
  }

  lista.push({
    nivel: 'aviso',
    texto: 'El cálculo reserva un ' + (OPERACION.holgura * 100).toFixed(0) + '% del día para imprevistos y'
      + ' urgencias aceptadas. Si ese margen se usa para ruta, no queda colchón para nada.'
  });

  return lista;
}
