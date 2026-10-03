import { esc } from '../../utils/dom.js';
import * as api from '../../api/radar.js';
import { usd, usdCorto, porKg, toneladas, entero, pct, delta, fecha, tarjeta, tabla, barras, vacio } from './comun.js';

/**
 * Histórico y métricas. La comparación actual vs. anterior solo da
 * porcentajes si ambos períodos están respaldados por bases semanales
 * completas, duran lo mismo y no se superponen; si no, dice por qué.
 */
const ESTADO = { backed: 'Completo', partial: 'Parcial', missing: 'Sin base' };
let grano = 'week';

export function granoRadar(g) { grano = g; }

export async function pintarHistorico(cont, filtros) {
  const h = await api.historicoRadar({ ...filtros, grain: grano });
  if (!h.current) { cont.innerHTML = vacio('Sin bases cargadas todavía', ' Usa "Actualizar datos".'); return; }
  const m = h.metrics, cmp = h.comparison, d = cmp.deltas;
  const etiqueta = p => grano === 'month' ? p.period.slice(5, 7) + '/' + p.period.slice(2, 4) : p.period.slice(8, 10) + '/' + p.period.slice(5, 7);
  cont.innerHTML = '<div class="filters ri-subfiltros">'
    + ['day', 'week', 'month'].map(g => '<button class="fchip' + (g === grano ? ' on' : '') + '" onclick="granoHistoricoRadar(\'' + g + '\')">'
      + { day: 'Diario', week: 'Semanal', month: 'Mensual' }[g] + '</button>').join('')
    + '</div>'
    + '<p class="mp-intro">Período actual <b>' + fecha(h.current.start) + ' – ' + fecha(h.current.end) + '</b> frente a <b>'
    + fecha(h.previous.start) + ' – ' + fecha(h.previous.end) + '</b>. '
    + (cmp.eligible ? 'Comparación válida: ambos períodos tienen todas sus bases semanales.'
      : '<span class="txt-bad">Sin porcentajes: ' + esc(cmp.reasons.join('; ').toLowerCase()) + '.</span>') + '</p>'
    + '<div class="kpis">'
    + tarjeta('primary', usdCorto(m.fob_usd), 'FOB del período', delta(d.fob_usd))
    + tarjeta('info', toneladas(m.tonnes), 'Volumen', delta(d.tonnes))
    + tarjeta('', porKg(m.usd_kg), 'FOB por kg', delta(d.usd_kg) + ' · mediana ' + porKg(m.median_usd_kg))
    + tarjeta('', entero(m.operations), 'Declaraciones', delta(d.operations) + ' · ticket ' + usdCorto(m.ticket_usd))
    + tarjeta('', entero(m.importers), 'Importadores', entero(m.first_observed_importers) + ' nuevos · ' + entero(m.repeat_importers) + ' recurrentes')
    + tarjeta(m.top5_share_percent > 60 ? 'warn' : '', pct(m.top5_share_percent), 'Concentración top 5', 'del FOB con importador identificado')
    + '</div>'
    + '<div class="panel"><h3>FOB por ' + { day: 'día', week: 'semana', month: 'mes' }[grano] + '</h3>'
    + '<p class="sub">Barra clara = período sin todas sus bases semanales cargadas (parcial): no se compara como si fuera completo.</p>'
    + barras(h.timeline, {
      etiqueta, valor: p => p.fob_usd, parcial: p => p.status !== 'backed',
      titulo: p => fecha(p.period) + ' – ' + fecha(p.end) + ' (' + ESTADO[p.status] + '): ' + (p.fob_usd == null ? 'sin datos' : usd(p.fob_usd)
        + ' · ' + toneladas(p.tonnes) + ' · ' + porKg(p.usd_kg)) + (p.fob_change_percent != null ? ' · ' + pct(p.fob_change_percent) + ' vs. anterior' : '')
    })
    + tabla(h.timeline.slice().reverse(), [
      { t: 'Período', h: p => fecha(p.period) + ' – ' + fecha(p.end) },
      { t: 'Cobertura', h: p => '<span class="chip ' + (p.status === 'backed' ? 'st-concluido' : p.status === 'partial' ? 'st-espera' : 'st-cancelado') + '">'
        + ESTADO[p.status] + '</span> <span class="muted small">' + p.coverage.backed_days + '/' + p.coverage.days + ' días</span>' },
      { t: 'FOB', num: true, h: p => (p.fob_usd == null ? '—' : usd(p.fob_usd)) },
      { t: 'Volumen', num: true, h: p => toneladas(p.tonnes) },
      { t: 'FOB/kg', num: true, h: p => porKg(p.usd_kg) },
      { t: 'Declaraciones', num: true, h: p => entero(p.operations) },
      { t: 'Var. FOB', num: true, h: p => (p.fob_change_percent == null ? '—' : delta(p.fob_change_percent)) }
    ])
    + '</div>'
    + '<div class="panel"><h3>Quiénes movieron el período</h3><p class="sub">Top 20 importadores del período actual y su cambio frente al anterior.</p>'
    + tabla(h.movers, [
      { t: 'Importador', h: r => '<div class="cell-2">' + esc(r.name || '—') + '<span>RUC ' + esc(r.ruc) + (r.first_observed ? ' · <b>primera vez</b>' : '') + '</span></div>' },
      { t: 'FOB', num: true, h: r => usd(r.fob_usd) },
      { t: 'Participación', num: true, h: r => pct(r.share_percent) },
      { t: 'Período anterior', num: true, h: r => usd(r.previous_fob_usd) },
      { t: 'Cambio', num: true, h: r => (r.change_percent == null ? '—' : delta(r.change_percent)) }
    ], { clic: i => 'verEmpresaRadar(\'' + h.movers[i].ruc + '\')' })
    + '</div>'
    + '<p class="muted small">' + esc(h.meta.coverage_note) + ' ' + esc(h.meta.price_note) + '</p>';
}
