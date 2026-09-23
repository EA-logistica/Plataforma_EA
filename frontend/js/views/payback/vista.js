import { $, esc } from '../../utils/dom.js';
import { soles, solesK } from '../../utils/format.js';
import { DB } from '../../api/estado.js';
import { OPERACION, JORNADA } from '#data/payback/parametros.js';
import { analizarDemanda } from '#shared/payback/demanda.js';
import { horasSemanales } from '#shared/payback/planilla.js';
import { construir } from '#shared/payback/escenarios.js';
import { comparar } from '#shared/payback/payback.js';
import { simuladorHTML, alCambiar } from './simulador.js';
import { calendarioHTML } from './calendario.js';

// El simulador se repinta a través de la pantalla completa: así el resto del
// análisis y la ruta simulada nunca quedan mostrando cosas distintas.
alCambiar(() => renderPayback());

/**
 * Pantalla del módulo payback. Es la única capa que toca el DOM: todo el
 * cálculo vive en ../backend/ y no sabe que existe una pantalla.
 *
 * El módulo no guarda nada en la base. Lee el histórico de servicios para
 * saber cuánto se gasta hoy y recalcula en cada render, así que a medida que
 * se registren tickets reales el análisis se actualiza solo.
 */

/** Primer día del mes que viene: el arranque más realista para una contratación. */
function proximoMes() {
  const h = new Date();
  const d = new Date(h.getFullYear(), h.getMonth() + 1, 1);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-01';
}

/** Opciones que el usuario puede mover desde la pantalla. */
const estado = {
  bonoRemunerativo: true,
  asignacionFamiliar: 0,
  inicio: proximoMes(),
  // Por defecto activado: una empresa en Régimen General o MYPE Tributario
  // que genera débito fiscal por sus propias ventas usa el IGV de la factura
  // del proveedor como crédito fiscal, así que no es un costo real. Se puede
  // apagar si no aplica (Nuevo RUS, o débito fiscal insuficiente ese mes).
  creditoFiscalIgv: true
};

export function setBonoPayback(v) { estado.bonoRemunerativo = v === 'si'; renderPayback(); }
export function setAsignacionPayback(v) { estado.asignacionFamiliar = Number(v) || 0; renderPayback(); }
export function setInicioPayback(v) { if (v) estado.inicio = v; renderPayback(); }
export function setCreditoFiscalPayback(v) { estado.creditoFiscalIgv = v === 'si'; renderPayback(); }

// Los controles del simulador de ruta se reexportan desde aquí para que main.js
// tenga un solo punto de entrada al módulo.
export {
  pbAgregarParada, pbQuitarParada, pbZonaParada, pbCuantasParadas, pbHoraSalida,
  pbDiaSimulado, pbMinutosParada, pbTiempoZona, pbOrdenarMejor, pbReiniciarSimulador
} from './simulador.js';

const pct = n => (n * 100).toFixed(0) + '%';
const nivelChip = n => n === 'alto' ? 'st-espera' : n === 'ok' ? 'st-concluido' : 'st-transito';

export function renderPayback() {
  const demanda = analizarDemanda(DB.solicitudes);
  if (!demanda.hay) {
    $('pbCuerpo').innerHTML = '<div class="empty"><strong>Todavía no hay servicios registrados</strong>'
      + 'El análisis se arma sobre el histórico de mensajería; sin viajes no hay con qué compararlo.</div>';
    return;
  }

  const escenarios = construir(demanda, estado);
  const cmp = comparar(escenarios, demanda, { inicio: estado.inicio });
  const mejor = cmp.recomendacion.mejor;

  $('pbCuerpo').innerHTML =
    controles()
    + veredicto(cmp, demanda, mejor)
    + situacionActual(demanda)
    + tarjetasEscenarios(cmp, mejor)
    + condicionesHTML(cmp)
    + calendarioHTML(cmp, estado.inicio)
    + capacidadHTML(cmp, demanda)
    + simuladorHTML()
    + politicaUrgencias(cmp, demanda)
    + advertencia();
}

// --------------------------------------------------------------- controles
function controles() {
  const opcion = (v, txt, activo) =>
    '<option value="' + v + '"' + (activo ? ' selected' : '') + '>' + esc(txt) + '</option>';
  return '<div class="card card-pad pb-controles">'
    + '<div class="row">'
    + '<div class="field" style="margin:0"><label for="pbBono">¿El bono es remunerativo? (escenarios con personal propio)</label>'
    + '<select class="select" id="pbBono" onchange="setBonoPayback(this.value)">'
    + opcion('si', 'Sí: paga gratificaciones, CTS y EsSalud', estado.bonoRemunerativo)
    + opcion('no', 'No: es condición de trabajo (combustible contra comprobante)', !estado.bonoRemunerativo)
    + '</select></div>'
    + '<div class="field" style="margin:0"><label for="pbCreditoFiscal">¿Se puede usar el IGV como crédito fiscal? (tercerizar)</label>'
    + '<select class="select" id="pbCreditoFiscal" onchange="setCreditoFiscalPayback(this.value)">'
    + opcion('si', 'Sí: Régimen General/MYPE Tributario, con débito fiscal suficiente', estado.creditoFiscalIgv)
    + opcion('no', 'No: se cuenta el IGV como costo real', !estado.creditoFiscalIgv)
    + '</select></div>'
    + '</div>'
    + '<div class="hint">El tratamiento del bono lo define RR.HH.: si es condición de trabajo no entra a la'
    + ' base de beneficios y el costo baja. El del IGV lo define contabilidad: si la empresa puede usarlo como'
    + ' crédito fiscal, no es un costo real -se descuenta del IGV que ya paga por sus ventas- y el costo de'
    + ' tercerizar que compite contra el courier es la cuota sin IGV, no el total facturado.</div>'
    + '</div>';
}

// --------------------------------------------------------------- veredicto
function veredicto(cmp, demanda, mejor) {
  if (!mejor) {
    return '<div class="banner pb-veredicto"><div><b>Ningún escenario sale a cuenta.</b> Con el gasto actual de '
      + soles(cmp.gastoActual) + ' al mes, tercerizar sigue siendo más barato que tener motorizado propio.</div></div>';
  }
  const f = mejor;
  return '<div class="pb-veredicto">'
    + '<div class="pb-veredicto-tag">Escenario recomendado</div>'
    + '<h3>' + esc(f.escenario.nombre) + '</h3>'
    + '<p>' + esc(f.escenario.detalle) + '</p>'
    + '<div class="kpis">'
    + kpi('ok', soles(f.costoMensual), 'Costo mensual', 'Todo incluido: planilla, ley y respaldo')
    + kpi('primary', soles(f.ahorroMensual), 'Ahorro frente al courier', 'Hoy se gastan ' + soles(cmp.gastoActual) + ' al mes')
    + kpi('', solesK(f.ahorroAnual), 'Ahorro al año', 'Manteniendo el volumen actual')
    + kpi('info', f.inversion ? soles(f.inversion) : 'Sin inversión',
        f.inversion ? 'Inversión inicial' : 'No requiere compra',
        f.inversion ? 'Se recupera en ' + f.mesesRetorno.toFixed(1) + ' meses' : 'El ahorro es desde el primer mes')
    + '</div></div>';
}

const kpi = (clase, v, k, d) =>
  '<div class="kpi ' + clase + '"><div class="v">' + esc(v) + '</div><div class="k">' + esc(k)
  + '</div><div class="d">' + esc(d) + '</div></div>';

// ------------------------------------------------------- situación actual
function situacionActual(d) {
  const h = horasSemanales();
  return '<div class="panel">'
    + '<h3>De dónde salen estos números</h3>'
    + '<p class="sub">Del histórico real de mensajería, no de supuestos. '
    + d.totalViajes.toLocaleString('es-PE') + ' servicios registrados.</p>'
    + '<div class="ticket-facts" style="border-top:none">'
    + fact('Gasto mensual en courier', soles(d.recientes.gastoMensual),
        'Promedio de ' + d.recientes.meses.join(', '))
    + fact('Costo por viaje', soles(d.recientes.costoPorViaje), 'Tarifa promedio pagada')
    + fact('Encargos por día', d.viajesPorDia.entreSemana.toFixed(1),
        'Lunes a viernes. Sábados ' + d.viajesPorDia.sabado.toFixed(1))
    + fact('Día cargado', d.viajesPorDia.p90 + ' encargos',
        'El 10% de los días lo supera. Máximo medido: ' + d.viajesPorDia.maximo)
    + fact('Jornada del motorizado', h.total.toFixed(1) + ' h/semana',
        'Lun-vie ' + JORNADA.entreSemana.desde + ' a ' + JORNADA.entreSemana.hasta
        + ', sáb ' + JORNADA.sabado.desde + ' a ' + JORNADA.sabado.hasta)
    + fact('Tope legal', JORNADA.topeLegalSemanalHoras + ' h/semana',
        'Con ' + JORNADA.refrigerioMin + ' min de refrigerio no computable')
    + '</div></div>';
}

const fact = (k, v, d) => '<div class="fact">' + esc(k) + ' <b>' + esc(v) + '</b>'
  + (d ? '<span class="pb-fact-nota">' + esc(d) + '</span>' : '') + '</div>';

// ------------------------------------------------------------- escenarios
function tarjetasEscenarios(cmp, mejor) {
  return '<div class="section-head" style="margin-top:26px"><div><h2>Los tres escenarios</h2>'
    + '<p>Dos formas de tener motorizado propio y una de tercerizarlo a cuota fija.</p>'
    + '</div></div>'
    + '<div class="pb-escenarios">' + cmp.filas.map(f => tarjeta(f, mejor && f === mejor)).join('') + '</div>';
}

function tarjeta(f, esMejor) {
  const e = f.escenario;
  const { desglose, avisos } = e.cfg.modelo === 'tercero' ? desgloseTercero(e) : desglosePersonal(e, f);

  return '<article class="pb-card' + (esMejor ? ' on' : '') + '">'
    + (esMejor ? '<div class="pb-card-tag">Recomendado</div>' : '')
    + '<h3>' + esc(e.nombre) + '</h3>'
    + '<p class="pb-card-detalle">' + esc(e.detalle) + '</p>'
    + '<div class="pb-total"><span>Costo mensual</span><b>' + esc(soles(f.costoMensual)) + '</b></div>'
    + '<div class="pb-ahorro ' + (f.ahorroMensual > 0 ? 'bien' : 'mal') + '">'
    + (f.ahorroMensual > 0 ? 'Ahorra ' : 'Cuesta ') + esc(soles(Math.abs(f.ahorroMensual)))
    + ' al mes frente al courier</div>'
    + '<div class="pb-inversion">Sin inversión inicial</div>'
    + '<table class="pb-desglose">' + desglose + '</table>'
    + '<div class="pb-avisos">' + avisos.map(a =>
        '<div class="pb-aviso"><span class="chip ' + nivelChip(a.nivel) + '"><i class="dot"></i>'
        + (a.nivel === 'alto' ? 'Cuidado' : a.nivel === 'ok' ? 'En regla' : 'A tener en cuenta')
        + '</span><p>' + esc(a.texto) + '</p></div>').join('')
    + '</div></article>';
}

const lineaDesglose = (k, v, nota) => '<tr><td>' + esc(k) + (nota ? '<span class="pb-nota">' + esc(nota) + '</span>' : '')
  + '</td><td class="mono">' + esc(soles(v)) + '</td></tr>';

/** Desglose de un puesto propio: sueldo, ley social y el respaldo de courier para lo que no cubre. */
function desglosePersonal(e, f) {
  const p = e.persona;
  let desglose = lineaDesglose('Sueldo base' + (e.cfg.personas > 1 ? ' (x' + e.cfg.personas + ')' : ''),
      e.cfg.sueldoBase * e.cfg.personas);
  if (e.cfg.bono) {
    desglose += lineaDesglose('Bono' + (e.cfg.personas > 1 ? ' (x' + e.cfg.personas + ')' : ''),
      e.cfg.bono * e.cfg.personas, e.cfg.bonoRemunerativo ? 'Remunerativo' : 'Condición de trabajo');
  }
  desglose += lineaDesglose('Gratificaciones', p.gratificaciones * e.cfg.personas, 'Julio y diciembre');
  desglose += lineaDesglose('Bonif. extraordinaria', p.bonificacionExtraordinaria * e.cfg.personas, 'Ley 30334');
  desglose += lineaDesglose('CTS', p.cts * e.cfg.personas,
    p.cts ? 'Mayo y noviembre' : 'No aplica al part time');
  desglose += lineaDesglose('EsSalud', p.essalud * e.cfg.personas, '9%');
  desglose += lineaDesglose('Vida Ley + SCTR', (p.vidaLey + p.sctr) * e.cfg.personas, 'Primas referenciales');

  desglose += '<tr class="pb-sep"><td colspan="2">Respaldo</td></tr>';
  desglose += lineaDesglose('Cobertura de vacaciones', f.coberturaVacaciones,
    e.diasSinCoberturaAlAnio.toFixed(0) + ' días al año sin motorizado');
  if (f.courierResidual > 0) {
    desglose += lineaDesglose('Courier para los días cargados', f.courierResidual,
      f.excedenteDiario.toFixed(1) + ' encargos al día por encima del techo');
  }

  return { desglose, avisos: p.avisos.concat(e.riesgos) };
}

/**
 * Desglose del proveedor a cuota fija: no hay planilla, solo la cuota, el IGV
 * y -si aplica- el costo real ya neto de crédito fiscal. Se muestran las tres
 * líneas siempre, para que se vea de dónde sale el "costo mensual" del
 * encabezado y no parezca un número que aparece de la nada.
 */
function desgloseTercero(e) {
  const t = e.tercero;
  let desglose = lineaDesglose('Cuota del proveedor', t.cuotaMensualSinIgv, 'Fija, pactada por contrato');
  desglose += lineaDesglose('IGV (18%)', t.igv);
  desglose += lineaDesglose('Total facturado', t.total, 'Lo que cobra el proveedor');
  desglose += '<tr class="pb-sep"><td colspan="2">Costo real</td></tr>';
  desglose += t.creditoFiscalIgv
    ? lineaDesglose('Costo real (con crédito fiscal)', t.costoReal, 'El IGV se descuenta del que la empresa ya paga por sus ventas')
    : lineaDesglose('Costo real (sin crédito fiscal)', t.costoReal, 'El IGV no se puede recuperar en este caso');
  return { desglose, avisos: e.riesgos };
}

// ------------------------------------------------------------ condiciones
function condicionesHTML(cmp) {
  return '<div class="panel" style="margin-top:22px">'
    + '<h3>Lo que tiene que cumplirse, sea cual sea el escenario</h3>'
    + '<p class="sub">No depende de a quién se contrate: depende de cómo se pidan los envíos.</p>'
    + cmp.condiciones.map(c =>
      '<div class="pb-condicion"><span class="chip ' + nivelChip(c.nivel) + '"><i class="dot"></i>'
      + (c.nivel === 'alto' ? 'Crítico' : c.nivel === 'ok' ? 'Se cumple' : 'Atención') + '</span>'
      + '<div><b>' + esc(c.titulo) + '</b><p>' + esc(c.texto) + '</p></div></div>').join('')
    + '</div>';
}

// -------------------------------------------------------------- capacidad
/** El escenario de UN motorizado: es del único del que tiene sentido preguntar "¿alcanza una sola moto?". */
const unMotorizado = cmp => cmp.filas.find(f => f.escenario.cfg.personas === 1);

function capacidadHTML(cmp, demanda) {
  const cap = unMotorizado(cmp).escenario.capacidad;
  const filas = cap.conPrograma.porZona
    .filter(z => z.viajesSemana > 0)
    .sort((a, b) => b.minutosSemana - a.minutosSemana)
    .map(z => '<tr>'
      + '<td>' + esc(z.zona.nombre) + '<span class="pb-nota">' + esc(z.zona.detalle) + '</span></td>'
      + '<td class="mono">' + z.viajesSemana.toFixed(1) + '</td>'
      + '<td class="mono">' + z.zona.minutosIdaVuelta + ' min</td>'
      + '<td class="mono">' + z.visitasSemana + '</td>'
      + '<td class="mono">' + z.paradasPorVisita.toFixed(1) + '</td>'
      + '<td class="mono">' + (z.minutosSemana / 60).toFixed(1) + ' h</td>'
      + '</tr>').join('');

  return '<div class="panel" style="margin-top:22px">'
    + '<h3>¿Alcanza una sola moto?</h3>'
    + '<p class="sub">Sí, con los encargos agrupados por zona: ocupa el ' + pct(cap.usoConPrograma)
    + ' del tiempo útil de la semana. El techo son ' + cap.techoDiario.toFixed(1)
    + ' encargos al día y hoy se hacen ' + cmp.viajesPorDia.toFixed(1) + '.</p>'
    + '<div class="banner"><div>Lo que satura al motorizado no es el número de encargos, es el número de'
    + ' <b>salidas</b>. Diez encargos a Lima norte en una salida caben; cuatro encargos a cuatro zonas'
    + ' distintas, no. Por eso el mismo volumen pasa de ' + pct(cap.usoConPrograma) + ' a '
    + pct(cap.usoSinPrograma) + ' de la jornada si cada pedido se atiende por separado.</div></div>'
    + '<div class="table-wrap"><table style="min-width:640px"><thead><tr>'
    + '<th>Zona</th><th>Encargos/sem</th><th>Ida y vuelta</th><th>Salidas/sem</th>'
    + '<th>Paradas/salida</th><th>Tiempo/sem</th>'
    + '</tr></thead><tbody>' + filas + '</tbody></table></div>'
    + '<div class="hint">Tiempo disponible: ' + (cap.disponible.neto / 60).toFixed(1)
    + ' h netas a la semana, de ' + (cap.disponible.bruto / 60).toFixed(1) + ' h de jornada, reservando un '
    + pct(OPERACION.holgura) + ' para imprevistos. Los minutos de viaje son estimaciones: el primer mes de'
    + ' operación real los corrige.</div>'
    + '</div>';
}

// ------------------------------------------------- política de urgencias
function politicaUrgencias(cmp, demanda) {
  const cap = unMotorizado(cmp).escenario.capacidad;
  const medidas = [
    ['Hora de corte diaria',
      'Lo que entra hasta las 16:00 se programa en la ruta del día siguiente. Después de esa hora, salvo'
      + ' excepción aprobada, va a la ruta siguiente. La plataforma ya obliga a un margen de 4 horas: la hora'
      + ' de corte es la misma idea, pero fijada a una hora concreta y conocida por todos.'],
    ['Días fijos por zona',
      'Las zonas lejanas no se visitan todos los días. Publicar el calendario convierte "necesito ir a Chilca'
      + ' hoy" en "Chilca sale los martes", que es una conversación distinta. Las zonas cercanas y las de más'
      + ' volumen sí tienen salida diaria.'],
    ['Cupo reservado para urgencias reales',
      'El ' + pct(OPERACION.holgura) + ' de la jornada queda libre a propósito: son unos '
      + (cap.disponible.holgura / 60).toFixed(1) + ' h a la semana para lo que de verdad no puede esperar.'
      + ' Tener el cupo explícito evita que cada urgencia rompa la ruta completa.'],
    ['La urgencia se carga al área que la pide',
      'Mientras el sobrecosto de un envío urgente lo absorba logística, no hay motivo para programar. Si el'
      + ' costo aparece en el centro de costo de quien lo pidió, la urgencia se vuelve cara para quien la'
      + ' genera y se vuelve rara. La columna de costo por servicio ya está en el histórico.'],
    ['Medir quién genera urgencias',
      'El módulo de indicadores ya muestra quién solicita más servicios. Añadir el conteo de pedidos fuera'
      + ' de la hora de corte, publicado por área cada mes, suele bastar: casi nadie quiere aparecer primero'
      + ' en esa lista.'],
    ['Encargos recurrentes en calendario',
      'Buena parte de los viajes se repiten: ' + esc(unMotorizado(cmp).escenario.capacidad.conPrograma.porZona
        .slice().sort((a, b) => b.viajesSemana - a.viajesSemana)[0].zona.nombre)
      + ' concentra el grueso. Lo que se repite todas las semanas no debería pedirse cada vez: se programa'
      + ' una vez y se repite solo.']
  ];

  return '<div class="panel" style="margin-top:22px">'
    + '<h3>Cómo se dejan de tener urgencias</h3>'
    + '<p class="sub">Con un solo motorizado la programación deja de ser una buena práctica y pasa a ser la'
    + ' condición para que el servicio exista. Estas son las seis medidas, de la más simple a la más de fondo.</p>'
    + '<div class="pb-medidas">' + medidas.map(([t, d], i) =>
      '<div class="pb-medida"><div class="pb-medida-n">' + (i + 1) + '</div>'
      + '<div><b>' + esc(t) + '</b><p>' + esc(d) + '</p></div></div>').join('')
    + '</div></div>';
}

// ------------------------------------------------------------ advertencia
function advertencia() {
  return '<div class="banner" style="margin-top:22px"><div><b>Antes de decidir.</b> Las tasas de ley están'
    + ' puestas como referencia del régimen laboral común y las primas de Vida Ley y SCTR varían por'
    + ' aseguradora: que RR.HH. y contabilidad las validen. La cuota del proveedor (S/ 3 500 + IGV) es la'
    + ' que se planteó para este análisis, no una cotización cerrada: conviene pedir al menos dos'
    + ' propuestas antes de firmar. Los minutos de viaje por zona son estimaciones y se ajustan en el'
    + ' simulador.'
    + ' Todo eso se edita en <span class="mono">payback/data/parametros.js</span> sin tocar el cálculo.</div></div>';
}
