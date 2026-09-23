import { esc } from '../../utils/dom.js';
import { soles } from '../../utils/format.js';

/**
 * Sección del calendario de beneficios sociales según la fecha de ingreso.
 *
 * El costo mensual de régimen reparte gratificaciones y CTS en doce partes
 * iguales, que es lo correcto para comparar escenarios entre sí. Pero la caja
 * no funciona así, y el primer año menos: quien entra en octubre no cobra la
 * gratificación de julio y la de diciembre la cobra a medias.
 *
 * Esta sección muestra el flujo real mes a mes para el escenario recomendado,
 * de modo que Finanzas sepa qué meses aprietan y cuándo se recupera de verdad
 * la inversión.
 */

const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'set', 'oct', 'nov', 'dic'];

export function calendarioHTML(fila, inicio, gastoActual) {
  if (fila && fila.escenario.cfg.modelo === 'tercero') {
    return '<div class="panel" style="margin-top:22px">'
      + '<h3>Beneficios sociales según la fecha de ingreso</h3>'
      + '<p class="sub">No aplica: el proveedor a cuota fija no es personal en planilla, así que no hay'
      + ' gratificación ni CTS que calendarizar.</p></div>';
  }
  if (!fila || !fila.flujo) {
    return '<div class="panel" style="margin-top:22px">'
      + '<h3>Beneficios sociales según la fecha de ingreso</h3>'
      + '<p class="sub">Elige una fecha válida para ver el calendario.</p></div>';
  }

  const f = fila.flujo;
  const e = fila.escenario;
  const doce = f.meses.slice(0, 12);
  const maximo = Math.max(...doce.map(m => m.costo));

  return '<div class="panel" style="margin-top:22px">'
    + '<h3>Beneficios sociales según la fecha de ingreso</h3>'
    + '<p class="sub">La gratificación es un sueldo completo por semestre entero, y proporcional si se'
    + ' trabajó menos: un sexto por cada mes completo. Se paga en julio (por enero-junio) y en diciembre'
    + ' (por julio-diciembre). La CTS se deposita en mayo y noviembre. Cambiando la fecha de ingreso,'
    + ' todo el calendario se recalcula.</p>'

    + '<div class="pb-cal-controles">'
    + '<div class="field" style="margin:0"><label for="pbInicio">Fecha de ingreso del motorizado</label>'
    + '<input class="input" type="date" id="pbInicio" value="' + esc(inicio)
    + '" onchange="setInicioPayback(this.value)"></div>'
    + '<div class="pb-cal-atajos">'
    + atajo('Este mes', primerDiaRelativo(0))
    + atajo('El próximo', primerDiaRelativo(1))
    + atajo('En enero', primerDeEnero())
    + '</div></div>'

    + '<div class="kpis" style="margin-top:18px">'
    + kpi('', soles(f.costoPrimerAnio), 'Costo del primer año',
        'Contra ' + soles(fila.costoMensual * 12) + ' en un año de régimen')
    + kpi('ok', soles(f.ahorroPrimerAnio), 'Ahorro del primer año',
        'Frente a ' + soles(gastoActual * 12) + ' de courier')
    + kpi('info', f.mesMasCaro.etiqueta, 'El mes que más aprieta',
        soles(f.mesMasCaro.costo) + ', por la gratificación')
    + (fila.inversion
      ? kpi('primary', f.mesRecuperacion ? f.mesRecuperacion + ' meses' : 'No se recupera',
          'Retorno de la inversión', 'Contando el flujo real, no el promedio')
      : kpi('primary', 'Sin inversión', 'Nada que recuperar', 'El ahorro es desde el primer mes'))
    + '</div>'

    + '<p class="hint" style="margin:4px 0 14px">Escenario mostrado: <b>' + esc(e.nombre) + '</b>.'
    + (e.cfg.jornadaCompleta ? '' : ' Part time por debajo de 4 horas: no genera CTS, solo gratificaciones.')
    + '</p>'

    + '<div class="table-wrap"><table style="min-width:720px"><thead><tr>'
    + '<th>Mes</th><th>Sueldos</th><th>Gratificación</th><th>Bonif. 9%</th><th>CTS</th>'
    + '<th>Otros costos</th><th>Total del mes</th><th>Acumulado vs courier</th>'
    + '</tr></thead><tbody>'
    + doce.map(m => filaMes(m, maximo)).join('')
    + '</tbody></table></div>'

    + notas(doce)
    + '</div>';
}

function filaMes(m, maximo) {
  const aporte = m.essalud + m.vidaLey + m.sctr;
  const destacado = m.extraordinario > 0;
  return '<tr' + (destacado ? ' class="pb-cal-hito"' : '') + '>'
    + '<td>' + esc(m.etiqueta) + (m.diasDelMes < 30
        ? '<span class="pb-nota">' + m.diasDelMes + ' días trabajados</span>' : '') + '</td>'
    + '<td class="num">' + soles(m.sueldo + aporte + m.bonoFueraDePlanilla) + '</td>'
    + '<td class="num">' + (m.gratificacion ? soles(m.gratificacion) : '—') + '</td>'
    + '<td class="num">' + (m.bonificacion ? soles(m.bonificacion) : '—') + '</td>'
    + '<td class="num">' + (m.cts ? soles(m.cts) : '—') + '</td>'
    + '<td class="num muted">' + soles(m.otros) + '</td>'
    + '<td class="num"><b>' + soles(m.costo) + '</b>'
    + '<span class="pb-barra"><i style="width:' + ((m.costo / maximo) * 100).toFixed(0) + '%"></i></span></td>'
    + '<td class="num ' + (m.acumulado >= 0 ? 'pb-verde' : 'pb-rojo') + '">' + soles(m.acumulado) + '</td>'
    + '</tr>';
}

function notas(doce) {
  const conNota = doce.filter(m => m.notas.length);
  if (!conNota.length) return '';
  return '<div class="pb-cal-notas">'
    + conNota.map(m => '<div><b>' + esc(m.etiqueta) + '.</b> ' + esc(m.notas.join(' ')) + '</div>').join('')
    + '</div>';
}

const kpi = (clase, v, k, d) =>
  '<div class="kpi ' + clase + '"><div class="v">' + esc(v) + '</div><div class="k">' + esc(k)
  + '</div><div class="d">' + esc(d) + '</div></div>';

const atajo = (texto, iso) =>
  '<button class="fchip" onclick="setInicioPayback(\'' + iso + '\')">' + esc(texto) + '</button>';

function primerDiaRelativo(mesesAdelante) {
  const h = new Date();
  const d = new Date(h.getFullYear(), h.getMonth() + mesesAdelante, 1);
  return iso(d);
}

function primerDeEnero() {
  const h = new Date();
  // Si ya pasó enero, se apunta al de el año siguiente.
  return iso(new Date(h.getFullYear() + (h.getMonth() > 0 ? 1 : 0), 0, 1));
}

const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')
  + '-' + String(d.getDate()).padStart(2, '0');

export { MESES_CORTOS };
