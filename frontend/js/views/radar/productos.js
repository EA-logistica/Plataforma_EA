import { $, esc } from '../../utils/dom.js';
import { corta } from '../../utils/format.js';
import * as api from '../../api/radar.js';
import { usdCorto, porKg, toneladas, entero, fecha, tarjeta, tabla, vacio } from './comun.js';

/**
 * Productos: "hdpe soplado mi 0.35" → los grados (código de materia prima)
 * que cumplen, con su ficha y TODAS las empresas que los importaron. La
 * interpretación de la búsqueda se muestra, para que se vea qué se filtró.
 */
let pagina = 1;
let orden = 'tonnes';
const ORDENES = { tonnes: 'Volumen', cif_usd: 'CIF', importers: 'Importadores', cif_kg: 'CIF/kg', last: 'Más reciente' };

export function paginaProductosRadar(n) { pagina = n; }
export function ordenProductosRadar(o) { orden = o; pagina = 1; }
export function reiniciarProductosRadar() { pagina = 1; }

export async function pintarProductos(cont, filtros) {
  if (!$('riP')) {
    cont.innerHTML = '<div class="filters mp-filtros ri-subfiltros">'
      + '<label class="mp-campo mp-campo-q"><span>Producto</span><input class="input" id="riP" type="search" placeholder="Ej.: hdpe soplado mi 0.35 · pp inyeccion · certene · lldpe film mi 1-2" oninput="buscarProductosRadar()"></label>'
      + '<label class="mp-campo"><span>Ordenar por</span><select class="select" id="riOrdenP" onchange="ordenarProductosRadar(this.value)">'
      + Object.entries(ORDENES).map(([k, t]) => '<option value="' + k + '"' + (k === orden ? ' selected' : '') + '>' + t + '</option>').join('') + '</select></label>'
      + '</div><div id="riProductos"></div>';
  }
  const r = await api.productosRadar({ ...filtros, p: $('riP').value, sort: orden, page: pagina, page_size: 12 });
  const s = r.summary, i = r.interpretation, g = r.grades;
  const chips = [i.family && 'Familia ' + i.family, i.application && 'Aplicación ' + i.application,
    i.mi_min != null && i.mi_max != null ? 'MI ' + i.mi_min + ' a ' + i.mi_max : i.mi_min != null ? 'MI ≥ ' + i.mi_min : i.mi_max != null ? 'MI ≤ ' + i.mi_max : '',
    ...i.terms.map(t => '«' + t + '»')].filter(Boolean);
  const paginas = Math.max(1, Math.ceil(g.total / 12));
  $('riProductos').innerHTML = (chips.length ? '<p class="mp-intro">Se buscó: ' + chips.map(c => '<span class="chip">' + esc(c) + '</span>').join(' ') + '</p>' : '')
    + (!s.series ? vacio('Ningún producto cumple', ' Prueba con menos condiciones.')
      : '<div class="kpis">'
        + tarjeta('primary', entero(s.grades), 'Grados', entero(s.ungraded_series) + ' series sin grado identificado')
        + tarjeta('info', toneladas(s.tonnes), 'Volumen', entero(s.series) + ' series · ' + entero(s.operations) + ' declaraciones')
        + tarjeta('', porKg(s.cif_kg), 'CIF por kg', usdCorto(s.cif_usd) + ' CIF total')
        + tarjeta('', entero(s.importers), 'Importadores', fecha(s.start) + ' – ' + fecha(s.end))
        + '</div>'
        + '<div class="ri-grados">' + g.items.map(gr => '<div class="panel ri-grado">'
          + '<div class="ri-grado-cab"><div><h3>' + esc(gr.grade || gr.grade_key) + '</h3><p class="sub">' + esc([gr.brand, gr.product_name].filter(Boolean).join(' · ') || 'Marca no identificada') + '</p></div>'
          + '<div class="ri-grado-num"><b>' + toneladas(gr.tonnes) + '</b><span>' + porKg(gr.cif_kg) + ' CIF</span></div></div>'
          + '<p class="ri-grado-ficha">' + esc([gr.material, gr.application, ...(gr.applications || []).filter(a => a !== gr.application)].filter(Boolean).join(' · '))
          + (gr.melt_index != null ? ' · <b>MI ' + gr.melt_index + '</b>' + (gr.mi_min !== gr.mi_max && gr.mi_min != null ? ' (' + gr.mi_min + '–' + gr.mi_max + ')' : '') : '')
          + (gr.density != null ? ' · densidad ' + gr.density : '') + '</p>'
          + (gr.summary ? '<p class="muted small">' + esc(gr.summary) + '</p>' : '')
          + '<details><summary>' + entero(gr.importers) + ' importador' + (gr.importers === 1 ? '' : 'es') + ' · ' + entero(gr.operations) + ' declaraciones · último ' + fecha(gr.last) + '</summary>'
          + tabla(gr.buyers || [], [
            { t: 'Empresa', h: b => '<div class="cell-2">' + esc(corta(b.importer || '—', 40)) + '<span>RUC ' + esc(b.importer_ruc || '—') + ' · ' + esc(b.origins || '') + '</span></div>' },
            { t: 'Volumen', num: true, h: b => toneladas(b.tonnes) },
            { t: 'CIF/kg', num: true, h: b => porKg(b.cif_kg) },
            { t: 'Último', h: b => fecha(b.last) }
          ]) + '</details></div>').join('') + '</div>'
        + (paginas > 1 ? '<div class="mp-pie"><span class="muted small">Página ' + pagina + ' de ' + paginas + ' · ' + entero(g.total) + ' grados</span><span class="tools">'
          + '<button class="btn btn-sm btn-ghost"' + (pagina <= 1 ? ' disabled' : '') + ' onclick="irPaginaProductosRadar(' + (pagina - 1) + ')">‹ Anterior</button>'
          + '<button class="btn btn-sm btn-ghost"' + (pagina >= paginas ? ' disabled' : '') + ' onclick="irPaginaProductosRadar(' + (pagina + 1) + ')">Siguiente ›</button></span></div>' : '')
        + '<div class="grid2"><div class="panel"><h3>Marcas</h3>' + tabla(r.brands, [
          { t: 'Marca', h: b => esc(b.name) }, { t: 'Grados', num: true, h: b => entero(b.grades) },
          { t: 'Volumen', num: true, h: b => toneladas(b.tonnes) }, { t: 'CIF', num: true, h: b => usdCorto(b.cif_usd) }
        ]) + '</div>'
        + '<div class="panel"><h3>Quiénes lo importan</h3>' + tabla(r.importers.slice(0, 15), [
          { t: 'Empresa', h: b => '<div class="cell-2">' + esc(corta(b.name || '—', 36)) + '<span>' + esc(corta(b.grades || '', 50)) + '</span></div>' },
          { t: 'Volumen', num: true, h: b => toneladas(b.tonnes) }, { t: 'CIF/kg', num: true, h: b => porKg(b.cif_kg) }
        ], { clic: k => 'verEmpresaRadar(\'' + r.importers[k].ruc + '\')' }) + '</div></div>');
}
