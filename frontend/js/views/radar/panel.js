import { esc } from '../../utils/dom.js';
import * as api from '../../api/radar.js';
import { usd, usdCorto, porKg, toneladas, entero, pct, fecha, tarjeta, ranking, barras, vacio } from './comun.js';

/** Panel general: cuánto se importó en la selección, cómo evolucionó y quién/qué/de dónde. */
export async function pintarPanel(cont, filtros) {
  const d = await api.panelRadar(filtros);
  const s = d.summary;
  if (!s.series) { cont.innerHTML = vacio('Sin series con estos filtros', ' Prueba quitando alguno.'); return; }
  const c = d.costs || {};
  cont.innerHTML = '<div class="kpis">'
    + tarjeta('primary', usdCorto(s.fob_usd), 'FOB declarado', usd(s.fob_usd))
    + tarjeta('info', toneladas(s.tonnes), 'Volumen', entero(s.series) + ' series · ' + entero(s.operations) + ' declaraciones')
    + tarjeta('', porKg(s.usd_kg), 'FOB por kg', 'Ponderado; solo series con FOB y kg')
    + tarjeta('', entero(s.importers), 'Importadores (RUC)', entero(s.suppliers) + ' proveedores identificados')
    + tarjeta(s.pending_review ? 'warn' : 'ok', entero(s.pending_review), 'Por revisar', 'Clasificación de material dudosa')
    + '</div>'
    + '<div class="panel"><h3>FOB por semana</h3><p class="sub">Del ' + fecha(s.start) + ' al ' + fecha(s.end)
    + ' por fecha de numeración. Pasa el cursor sobre una barra para ver el detalle.</p>'
    + barras(d.trend, {
      etiqueta: p => p.period.slice(8, 10) + '/' + p.period.slice(5, 7), valor: p => p.fob_usd,
      titulo: p => 'Semana del ' + fecha(p.period) + ': ' + usd(p.fob_usd) + ' · ' + toneladas(p.tonnes) + ' · ' + porKg(p.usd_kg) + ' · ' + entero(p.series) + ' series'
    })
    + '</div>'
    + '<div class="panel"><h3>Costo declarado</h3><p class="sub">FOB, flete y seguro de las mismas series. CIF = FOB + flete + seguro; no es costo puesto en almacén.</p>'
    + '<div class="ri-costos">'
    + [['FOB', c.fob_usd, c.fob_kg], ['Flete', c.freight_usd, null, pct(c.freight_pct) + ' del FOB'], ['Seguro', c.insurance_usd, null, pct(c.insurance_pct) + ' del FOB'],
      ['CFR', c.cfr_usd, c.cfr_kg], ['CIF', c.cif_usd, c.cif_kg]]
      .map(([k, v, kg, extra]) => '<div><span>' + k + '</span><b>' + usdCorto(v) + '</b><small>' + (kg != null ? porKg(kg) : extra || '') + '</small></div>').join('')
    + '</div></div>'
    + '<div class="grid2">'
    + '<div class="panel"><h3>Por material</h3>' + ranking(d.materials) + '</div>'
    + '<div class="panel"><h3>Por país de origen</h3>' + ranking(d.countries, { nombre: f => f.name || 'Sin país' }) + '</div>'
    + '</div>'
    + '<div class="panel"><h3>Principales importadores</h3><p class="sub">Clic en uno para ver su ficha en Empresas.</p>'
    + ranking(d.importers, { nombre: f => f.name || 'Sin nombre', clic: i => 'verEmpresaRadarPorNombre(' + esc(JSON.stringify(d.importers[i].name || '')) + ')' })
    + '</div>'
    + (d.suppliers.some(x => x.name) ? '<div class="panel"><h3>Proveedores identificados</h3>' + ranking(d.suppliers.filter(x => x.name)) + '</div>'
      : '<p class="muted small">SUNAT oculta o no informa el proveedor en estas series; no se infiere a partir de marcas.</p>');
}
