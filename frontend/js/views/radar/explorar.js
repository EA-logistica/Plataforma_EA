import { $, esc } from '../../utils/dom.js';
import { corta } from '../../utils/format.js';
import { toast } from '../../utils/toast.js';
import * as api from '../../api/radar.js';
import { abrirModal, cerrarModal } from '../dispatch.js';
import { usd, porKg, entero, fecha, tabla, vacio } from './comun.js';

/**
 * Explorar: las series una por una, con la búsqueda por conceptos ("hdpe
 * soplado mi 0.35": deben aparecer todos; admite sinónimos como BLOW
 * MOLDING), filtros propios y exportación a CSV de toda la selección.
 */
const POR_PAGINA = 25;
let pagina = 1;
let opciones = null;

const propios = () => ({
  q: $('riQ')?.value || '', ruc: $('riRuc')?.value || '', hs: $('riHs')?.value || '',
  brand: $('riMarca')?.value || '', application: $('riAplicacion')?.value || '', review: $('riRevisar')?.checked || false
});

export function paginaExplorarRadar(n) { pagina = n; }
export function reiniciarPaginaRadar() { pagina = 1; }

export async function pintarExplorar(cont, filtros, opc) {
  opciones = opc;
  // La barra propia se pinta una vez y se conserva lo escrito al refrescar.
  if (!$('riQ')) {
    cont.innerHTML = '<div class="filters mp-filtros ri-subfiltros">'
      + '<label class="mp-campo mp-campo-q"><span>Buscar</span><input class="input" id="riQ" type="search" placeholder="Ej.: hdpe soplado mi 0.35, PP rafia, BRASKEM" oninput="buscarExplorarRadar()"></label>'
      + '<label class="mp-campo"><span>RUC</span><input class="input" id="riRuc" inputmode="numeric" maxlength="11" placeholder="11 dígitos" oninput="buscarExplorarRadar()"></label>'
      + '<label class="mp-campo"><span>Subpartida</span><input class="input" id="riHs" inputmode="numeric" maxlength="10" placeholder="3901…" oninput="buscarExplorarRadar()"></label>'
      + '<label class="mp-campo"><span>Marca</span><select class="select" id="riMarca" onchange="buscarExplorarRadar()"><option value="">Todas</option>'
      + opc.brands.map(b => '<option>' + esc(b) + '</option>').join('') + '</select></label>'
      + '<label class="mp-campo"><span>Aplicación</span><select class="select" id="riAplicacion" onchange="buscarExplorarRadar()"><option value="">Todas</option>'
      + opc.applications.map(b => '<option>' + esc(b) + '</option>').join('') + '</select></label>'
      + '<label class="muted small"><input type="checkbox" id="riRevisar" onchange="buscarExplorarRadar()"> Solo por revisar</label>'
      + '<button class="btn btn-sm btn-ghost" onclick="exportarExplorarRadar()">Exportar CSV</button>'
      + '</div><div id="riExplorarTabla"></div>';
  }
  const r = await api.operacionesRadar({ ...filtros, ...propios(), page: pagina, page_size: POR_PAGINA });
  const paginas = Math.max(1, Math.ceil(r.total / POR_PAGINA));
  $('riExplorarTabla').innerHTML = !r.total ? vacio('Sin coincidencias', ' Una búsqueda vacía es válida: no se rellenan ejemplos.')
    : tabla(r.items, [
      { t: 'Fecha', h: o => '<span class="nowrap">' + fecha(o.numbered_on) + '</span>' },
      { t: 'Importador', h: o => '<div class="cell-2">' + esc(corta(o.importer || '—', 34)) + '<span>RUC ' + esc(o.importer_ruc || '—') + '</span></div>' },
      { t: 'Descripción', h: o => '<div class="cell-2">' + esc(corta(o.description, 70)) + '<span>' + esc([o.material, o.brand, o.grade, o.melt_index != null ? 'MI ' + o.melt_index : '', o.hs_code].filter(Boolean).join(' · '))
        + (o.needs_review ? ' · <b class="txt-bad">por revisar</b>' : '') + '</span></div>' },
      { t: 'Origen', h: o => esc(o.origin || '—') },
      { t: 'Kg', num: true, h: o => entero(o.net_kg == null ? null : Math.round(o.net_kg)) },
      { t: 'FOB', num: true, h: o => usd(o.fob_usd) },
      { t: 'FOB/kg', num: true, h: o => porKg(o.usd_kg) }
    ], { clic: i => 'verSerieRadar(' + r.items[i].id + ')' })
    + '<div class="mp-pie"><span class="muted small">' + entero(r.total) + ' series' + (paginas > 1 ? ' · página ' + pagina + ' de ' + entero(paginas) : '') + '</span>'
    + (paginas > 1 ? '<span class="tools"><button class="btn btn-sm btn-ghost"' + (pagina <= 1 ? ' disabled' : '') + ' onclick="irPaginaExplorarRadar(' + (pagina - 1) + ')">‹ Anterior</button>'
      + '<button class="btn btn-sm btn-ghost"' + (pagina >= paginas ? ' disabled' : '') + ' onclick="irPaginaExplorarRadar(' + (pagina + 1) + ')">Siguiente ›</button></span>' : '')
    + '</div>';
}

export async function exportarExplorar(filtros) {
  try {
    const blob = await api.exportarRadar({ ...filtros, ...propios() });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'radar-importaciones.csv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  } catch (e) { toast('No se pudo exportar', e.message, 'bad'); }
}

/** Detalle de una serie: valores, ficha del grado, original SUNAT y corrección de clasificación. */
export async function verSerie(id) {
  let o;
  try { o = await api.operacionRadar(id); } catch (e) { toast('No se pudo abrir', e.message, 'bad'); return; }
  const fila = (k, v) => '<tr><th>' + esc(k) + '</th><td>' + v + '</td></tr>';
  const materiales = (opciones?.materials || []).map(m => '<option' + (m === o.material ? ' selected' : '') + '>' + esc(m) + '</option>').join('');
  abrirModal('Serie ' + o.customs + '-' + o.year + '-' + o.declaration + ' / ' + o.series,
    '<div class="table-wrap"><table class="ri-ficha"><tbody>'
    + fila('Fecha de numeración', fecha(o.numbered_on))
    + fila('Importador', esc(o.importer || '—') + ' · RUC ' + esc(o.importer_ruc || '—'))
    + fila('Proveedor', o.supplier ? esc(o.supplier) : '<span class="muted">No informado por SUNAT (' + esc(o.supplier_status) + ')</span>')
    + fila('Descripción', esc(o.description))
    + fila('Subpartida', esc(o.hs_code))
    + fila('Material', esc(o.material) + ' <span class="muted small">' + esc(o.classification_reason) + '</span>')
    + fila('Marca / grado', esc([o.brand, o.grade, o.product_name].filter(Boolean).join(' · ') || '—') + (o.melt_index != null ? ' · MI ' + o.melt_index : ''))
    + fila('Origen / adquisición', esc((o.origin || '—') + ' / ' + (o.acquisition_country || '—')))
    + fila('Peso neto', entero(o.net_kg) + ' kg <span class="muted small">' + esc(o.kg_method || '') + '</span>')
    + fila('FOB · flete · seguro', usd(o.fob_usd) + ' · ' + usd(o.freight_usd) + ' · ' + usd(o.insurance_usd))
    + fila('CIF · FOB/kg', usd(o.cif_usd) + ' · ' + porKg(o.usd_kg))
    + fila('Fuente', '<a href="' + esc(o.source_url) + '" target="_blank" rel="noopener">' + esc(corta(o.source_url, 60)) + '</a>'
      + (o.artifact ? ' <span class="muted small">archivo ' + esc(o.artifact.id.slice(0, 12)) + '…, ' + esc((o.artifact.period?.start || '') + ' a ' + (o.artifact.period?.end || '')) + '</span>' : ''))
    + fila('Revisiones del original', entero(o.revisions.length))
    + '</tbody></table></div>'
    + (o.reviews.length ? '<p class="muted small">Corregida a mano: ' + o.reviews.map(r => esc(r.previous_material + ' → ' + r.material + ' (' + r.actor + ': ' + r.note + ')')).join('; ') + '</p>' : '')
    + '<h4>Corregir la clasificación</h4><p class="muted small">Queda bloqueada: la próxima carga no la sobrescribe.</p>'
    + '<div class="row"><div class="field"><label for="riMatRev">Material</label><select class="select" id="riMatRev">' + materiales + '</select></div>'
    + '<div class="field"><label for="riNotaRev">Motivo</label><input class="input" id="riNotaRev" placeholder="Ej.: ficha técnica indica LLDPE"></div></div>'
    + '<div class="err" id="eRevRadar"></div>'
    + '<div style="display:flex;gap:8px"><button class="btn" onclick="guardarRevisionRadar(' + o.id + ')">Guardar corrección</button>'
    + '<button class="btn btn-ghost" onclick="cerrarModal()">Cerrar</button></div>', { ancho: 'wide' });
}

export async function guardarRevision(id, alTerminar) {
  try {
    await api.revisarOperacionRadar(id, { material: $('riMatRev').value, note: $('riNotaRev').value });
  } catch (e) { $('eRevRadar').textContent = e.message; $('eRevRadar').classList.add('on'); return; }
  toast('Clasificación corregida', 'La serie quedó bloqueada para el ETL.');
  cerrarModal();
  alTerminar();
}

