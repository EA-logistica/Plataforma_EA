import { $, esc } from '../../utils/dom.js';
import { soles, solesK } from '../../utils/format.js';
import { DB } from '../../api/estado.js';
import { OPERACION, JORNADA, ESCENARIOS, SUSTENTO_BASICO, COSTOS_PLANILLA } from '#data/payback/parametros.js';
import { analizarDemanda } from '#shared/payback/demanda.js';
import { horasSemanales } from '#shared/payback/planilla.js';
import { construir } from '#shared/payback/escenarios.js';
import { comparar } from '#shared/payback/payback.js';
import { alCambiar } from './simulador.js';
import { analizarPlan } from '#shared/payback/plan.js';
import { PUNTOS } from '#data/payback/rutas.js';
import { planHTML, montarPlan } from './rutas.js';
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
  creditoFiscalIgv: true,
  /** A cuántos días se paga la factura del proveedor: no cambia la cuota, cambia cuándo sale de caja. */
  plazoPagoDias: 30,
  /** Básico por persona del escenario de dos part time. */
  basicoPartTime: ESCENARIOS.dosMotorizados.sueldoBase,
  /** Cuota mensual sin IGV del proveedor: S/ 3 500 es el presupuesto ideal. */
  cuotaTercero: ESCENARIOS.tercero.cuotaMensualSinIgv
};

export function setBonoPayback(v) { estado.bonoRemunerativo = v === 'si'; renderPayback(); }
export function setAsignacionPayback(v) { estado.asignacionFamiliar = Number(v) || 0; renderPayback(); }
export function setInicioPayback(v) { if (v) estado.inicio = v; renderPayback(); }
export function setCreditoFiscalPayback(v) { estado.creditoFiscalIgv = v === 'si'; renderPayback(); }
export function setPlazoPagoPayback(v) { estado.plazoPagoDias = Number(v) || 30; renderPayback(); }
export function setCuotaPayback(v) { estado.cuotaTercero = Number(v) || estado.cuotaTercero; renderPayback(); }
export function setBasicoPayback(v) { estado.basicoPartTime = Number(v) || estado.basicoPartTime; renderPayback(); }

// Los controles del simulador de ruta se reexportan desde aquí para que main.js
// tenga un solo punto de entrada al módulo.
export {
  pbAgregarParada, pbQuitarParada, pbZonaParada, pbCuantasParadas, pbHoraSalida,
  pbDiaSimulado, pbMinutosParada, pbTiempoZona, pbOrdenarMejor, pbReiniciarSimulador
} from './simulador.js';
export {
  pbPlanDia, pbPlanSalida, pbPlanChilca, pbPlanParada, pbPlanQuitarExtra, pbPlanBuscar, pbPlanAgregar, pbPlanBuscarMapa, pbPlanAgregarHist
} from './rutas.js';

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
  const tercero = cmp.filas.find(f => f.escenario.cfg.modelo === 'tercero');

  // El plan de rutas va justo después de los escenarios: es lo que se le
  // pide al proveedor, y lo que hace que un solo motorizado alcance.
  $('pbCuerpo').innerHTML =
    controles()
    + veredicto(cmp, demanda, mejor)
    + situacionActual(demanda)
    + tarjetasEscenarios(cmp, mejor)
    + planHTML(analizarPlan(DB.solicitudes), { cuota: tercero ? tercero.escenario.tercero.cuotaMensualSinIgv : 0, solicitudes: DB.solicitudes })
    + sustentoBasicoHTML(demanda, cmp)
    + condicionesHTML(cmp)
    + calendarioHTML(cmp, estado.inicio)
    + capacidadHTML(cmp, demanda)
    + advertencia();
  montarPlan();
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
    + '<div class="field" style="margin:0"><label for="pbAsignacion">Asignación familiar mensual (S/, personal propio)</label>'
    + '<input class="input" id="pbAsignacion" type="number" min="0" step="0.5" value="' + estado.asignacionFamiliar
    + '" placeholder="0.00" onchange="setAsignacionPayback(this.value)"></div>'
    + '<div class="field" style="margin:0"><label for="pbCreditoFiscal">¿Se puede usar el IGV como crédito fiscal? (tercerizar)</label>'
    + '<select class="select" id="pbCreditoFiscal" onchange="setCreditoFiscalPayback(this.value)">'
    + opcion('si', 'Sí: Régimen General/MYPE Tributario, con débito fiscal suficiente', estado.creditoFiscalIgv)
    + opcion('no', 'No: se cuenta el IGV como costo real', !estado.creditoFiscalIgv)
    + '</select></div>'
    + '<div class="field" style="margin:0"><label for="pbPlazoPago">Plazo de pago al proveedor (tercerizar)</label>'
    + '<select class="select" id="pbPlazoPago" onchange="setPlazoPagoPayback(this.value)">'
    + opcion('30', '30 días', estado.plazoPagoDias === 30)
    + opcion('45', '45 días', estado.plazoPagoDias === 45)
    + '</select></div>'
    + '<div class="field" style="margin:0"><label for="pbCuota">Cuota mensual del proveedor (sin IGV)</label>'
    + '<select class="select" id="pbCuota" onchange="setCuotaPayback(this.value)">'
    + ESCENARIOS.tercero.opcionesCuota.map(c =>
        opcion(String(c), soles(c) + (c === ESCENARIOS.tercero.cuotaMensualSinIgv ? ' (presupuesto ideal)' : ''),
          estado.cuotaTercero === c)).join('')
    + '</select></div>'
    + '<div class="field" style="margin:0"><label for="pbBasico">Básico por persona (dos part time)</label>'
    + '<select class="select" id="pbBasico" onchange="setBasicoPayback(this.value)">'
    + ESCENARIOS.dosMotorizados.opcionesBasico.map(b =>
        opcion(String(b), soles(b) + (b === ESCENARIOS.dosMotorizados.sueldoBase ? ' (recomendado)' : ''),
          estado.basicoPartTime === b)).join('')
    + '</select></div>'
    + '</div>'
    + '<div class="hint">El tratamiento del bono lo define RR.HH.: si es condición de trabajo no entra a la'
    + ' base de beneficios y el costo baja. El del IGV lo define contabilidad: si la empresa puede usarlo como'
    + ' crédito fiscal, no es un costo real -se descuenta del IGV que ya paga por sus ventas- y el costo de'
    + ' tercerizar que compite contra el courier es la cuota sin IGV, no el total facturado. El plazo de pago no'
    + ' cambia la cuota, solo cuánto tiempo queda ese dinero en caja antes de pagarla.</div>'
    + '</div>';
}

// --------------------------------------------------------------- veredicto
function veredicto(cmp, demanda, mejor) {
  if (!mejor) {
    return '<div class="banner pb-veredicto"><div><b>Ningún escenario sale a cuenta.</b> Con el gasto actual de '
      + soles(cmp.gastoActual) + ' al mes, tercerizar sigue siendo más barato que tener motorizado propio.</div></div>';
  }
  const f = mejor;
  const esTercero = f.escenario.cfg.modelo === 'tercero';
  // La alternativa más barata que no ganó: se muestra al lado para que la
  // decisión se vea como lo que es, costo contra responsabilidad.
  const alterna = cmp.filas.filter(x => x !== f).sort((a, b) => a.costoMensual - b.costoMensual)[0];
  const comparativo = esTercero && alterna && alterna.escenario.persona
    ? '<p>Frente a "' + esc(alterna.escenario.nombre) + '" (' + esc(soles(alterna.costoMensual))
      + ' al mes con lo que no sale en la boleta), la diferencia es de '
      + esc(soles(Math.abs(f.costoMensual - alterna.costoMensual))) + ' al mes '
      + (f.costoMensual > alterna.costoMensual ? 'a favor de la planilla' : 'a favor del proveedor')
      + '. Se recomienda tercerizar para que PLANSA no se responsabilice: el proveedor es el empleador y'
      + ' responde por los accidentes, el contrato, las faltas, las vacaciones y los reemplazos. En planilla'
      + ' todo eso sería de PLANSA.</p>'
    : '';
  return '<div class="pb-veredicto">'
    + '<div class="pb-veredicto-tag">Escenario recomendado</div>'
    + '<h3>' + esc(f.escenario.nombre) + '</h3>'
    + '<p>' + esc(f.escenario.detalle) + '</p>'
    + comparativo
    + '<div class="kpis">'
    + kpi('ok', soles(f.costoMensual), 'Costo mensual',
        esTercero ? 'Cuota fija, sin planilla ni respaldo' : 'Todo incluido: planilla, ley y respaldo')
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
  return '<div class="section-head" style="margin-top:26px"><div><h2>Los dos escenarios</h2>'
    + '<p>Tercerizar con un proveedor a cuota fija, o dos motorizados part time en planilla.</p>'
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
  if (f.margen > 0) desglose += lineaDesglose('Margen de gasto', f.margen, 'Agregado por logística');

  const o = f.costosOcultos;
  desglose += '<tr class="pb-sep"><td colspan="2">Lo que no sale en la boleta</td></tr>';
  desglose += lineaDesglose('Faltas y descansos médicos', o.faltas, 'Se paga el sueldo y además courier para cubrir');
  desglose += lineaDesglose('Rotación y reemplazos', o.rotacion, 'Reclutamiento, examen médico, inducción');
  desglose += lineaDesglose('Gestión y seguridad en el trabajo', o.gestion, 'Planilla, supervisión, equipos de protección');

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
  desglose += '<tr><td>Plazo de pago<span class="pb-nota">No cambia la cuota, solo cuándo sale de caja</span></td>'
    + '<td class="mono">' + t.plazoPagoDias + ' días</td></tr>';
  desglose += '<tr class="pb-sep"><td colspan="2">Costo real</td></tr>';
  desglose += t.creditoFiscalIgv
    ? lineaDesglose('Costo real (con crédito fiscal)', t.costoReal, 'El IGV se descuenta del que la empresa ya paga por sus ventas')
    : lineaDesglose('Costo real (sin crédito fiscal)', t.costoReal, 'El IGV no se puede recuperar en este caso');
  return { desglose, avisos: e.riesgos };
}

// ------------------------------------------------- sustento del básico
/**
 * Por qué el básico del part time sube. Lo que retiene al motorizado no es el
 * bruto: es lo que le queda por hora después de su pensión y de pagar su
 * propia moto. Se pone al lado lo que cuesta cada opción para PLANSA, para
 * que la subida se vea contra la cuota del proveedor.
 */
function sustentoBasicoHTML(demanda, cmp) {
  const dos = ESCENARIOS.dosMotorizados;
  const s = SUSTENTO_BASICO;
  const horasMes = horasSemanales().total / dos.personas * 52 / 12;
  const gastoMoto = s.gastoMotoPorDia * s.diasAlMes;
  const tercero = cmp.filas.find(f => f.escenario.cfg.modelo === 'tercero');
  // Lo que cobraría el courier por la media jornada que cubre cada persona.
  const valorCourier = cmp.viajesPorDia / dos.personas * cmp.costoPorViaje * JORNADA.diasSemanaAlMes;

  const filas = dos.opcionesBasico.map(b => {
    const f = comparar(construir(demanda, { ...estado, basicoPartTime: b }), demanda)
      .filas.find(x => x.escenario.id === dos.id);
    const queda = b * (1 - s.aportePension) - gastoMoto;
    return { b, queda, porHora: queda / horasMes, costo: f.costoMensual };
  });
  const base = filas[0];
  const rec = filas.find(r => r.b === dos.sueldoBase) || filas[filas.length - 1];
  const dif = tercero ? tercero.costoMensual - rec.costo : 0;

  const tabla = filas.map(r => '<tr' + (r.b === estado.basicoPartTime ? ' class="pb-fila-on"' : '') + '>'
    + '<td>' + esc(soles(r.b)) + (r.b === dos.sueldoBase ? '<span class="pb-nota">Recomendado</span>' : '') + '</td>'
    + '<td class="mono">' + esc(soles(r.queda)) + '</td>'
    + '<td class="mono">' + esc(soles(r.porHora)) + '</td>'
    + '<td class="mono">' + (r === base ? '—' : '+' + ((r.porHora / base.porHora - 1) * 100).toFixed(0) + '%') + '</td>'
    + '<td class="mono">' + esc(soles(r.costo)) + '</td>'
    + '<td class="mono">' + (tercero ? esc((r.costo >= tercero.costoMensual ? '+' : '−')
        + soles(Math.abs(r.costo - tercero.costoMensual))) : '') + '</td>'
    + '</tr>').join('');

  return '<div class="panel" style="margin-top:22px">'
    + '<h3>Por qué el básico del part time sube a ' + esc(soles(dos.sueldoBase)) + '</h3>'
    + '<p class="sub">Con ' + esc(soles(base.b)) + ' de básico, al motorizado le quedan ' + esc(soles(base.queda))
    + ' al mes después de su pensión y de pagar su moto: ' + esc(soles(base.porHora)) + ' por hora. Cualquier otro'
    + ' servicio de reparto le paga más por la misma hora, así que falta o se va. Con ' + esc(soles(rec.b))
    + ' le quedan ' + esc(soles(rec.porHora)) + ' por hora, un ' + ((rec.porHora / base.porHora - 1) * 100).toFixed(0)
    + '% más.</p>'
    + '<div class="table-wrap"><table style="min-width:640px"><thead><tr>'
    + '<th>Básico por persona</th><th>Le queda al mes</th><th>Por hora</th><th>Frente a ' + esc(soles(base.b))
    + '</th><th>Costo del escenario para PLANSA</th><th>Frente al proveedor (+ = más cara)</th>'
    + '</tr></thead><tbody>' + tabla + '</tbody></table></div>'
    + '<div class="banner"><div>Subir de ' + esc(soles(base.b)) + ' a ' + esc(soles(rec.b)) + ' le cuesta a PLANSA '
    + esc(soles(rec.costo - base.costo)) + ' más al mes. Lo que compra es menos ausencias y menos rotación: cada'
    + ' media jornada sin motorizado se cubre con courier (' + esc(soles(cmp.viajesPorDia / dos.personas * cmp.costoPorViaje))
    + ' al día) y cada reemplazo cuesta unos ' + esc(soles(COSTOS_PLANILLA.costoPorReemplazo)) + '. Además, lo que'
    + ' hace cada persona en su media jornada costaría ' + esc(soles(valorCourier)) + ' al mes en courier.'
    + (tercero ? ' <b>Aun así, con el básico competitivo la planilla cuesta ' + esc(soles(rec.costo)) + ' al mes, '
      + (dif >= 0 ? esc(soles(dif)) + ' menos' : esc(soles(-dif)) + ' más') + ' que el proveedor a cuota fija, y PLANSA'
      + ' sigue siendo el empleador: responde por accidentes, contrato, faltas, vacaciones y reemplazos. Por eso la'
      + ' recomendación es tercerizar.</b>' : '')
    + '</div></div>'
    + '<div class="hint">Le queda al mes: básico menos ' + (s.aportePension * 100).toFixed(0) + '% de pensión y '
    + esc(soles(gastoMoto)) + ' de combustible y desgaste de su moto (' + esc(soles(s.gastoMotoPorDia)) + ' por día, '
    + s.diasAlMes + ' días). Por hora: sobre ' + horasMes.toFixed(0) + ' h al mes. Son estimaciones de logística.</div>'
    + '</div>';
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
// Con un motorizado del proveedor o con dos part time que se turnan, la moto en la calle es una sola:
// la capacidad es la que calcula el escenario de personal propio.
const unMotorizado = cmp => cmp.filas.find(f => f.escenario.capacidad && f.escenario.capacidad.conPrograma);

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

// ------------------------------------------------------------ advertencia
function advertencia() {
  return '<div class="banner" style="margin-top:22px"><div><b>Antes de decidir.</b> Las tasas de ley están'
    + ' puestas como referencia del régimen laboral común y las primas de Vida Ley y SCTR varían por'
    + ' aseguradora: que RR.HH. y contabilidad las validen. La cuota del proveedor (S/ 3 500 + IGV como'
    + ' presupuesto ideal, S/ 3 800 como tope) no es una cotización cerrada: conviene pedir al menos dos'
    + ' propuestas con el plan de rutas en la mano. Los costos que no salen en la boleta (faltas, reemplazos,'
    + ' gestión) son estimaciones de logística. Las rutas usan el tráfico típico de Lima por franja horaria,'
    + ' no tráfico en vivo, y ' + PUNTOS.filter(p => p.precision === 'distrito').length + ' de los puntos tienen ubicación aproximada (solo el distrito): conviene'
    + ' corregirlos con la dirección exacta. Los supuestos se editan en'
    + ' <span class="mono">data/payback/parametros.js</span> y el plan y sus coordenadas en'
    + ' <span class="mono">data/payback/rutas.js</span>, sin tocar el cálculo.</div></div>';
}
