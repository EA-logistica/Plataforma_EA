// Radar Naranjal — evaluación de almacenes candidatos (vista reestructurada).
// Fuente: la misma data original del Radar (const DATA en radar_naranjal.html), servida por /api/almacenes.
import { api } from '/assets/js/api/client.js';
import { adaptPayload } from '/assets/js/data/adapter.js';
import { BAND_BY_ID } from '/assets/js/data/bands.js';
import { escapeHtml, fmtKm, fmtMin, fmtMoney, fmtNum } from '/assets/js/ui/format.js';
import { COLUMNS, DEFAULT_HIDDEN, ESTADOS } from './columns.js';
import { createTable } from './table.js';
import { createTooltip, renderBandBar, renderDistrictPivot, renderKpis, renderScatter } from './analytics.js';

const $ = (id) => document.getElementById(id);
const tooltip = createTooltip();
let table;
let origin;
let allRows = [];

// ---------- calidad del dato: alertas derivadas del propio texto del anuncio ----------
function alertsFor(r) {
  const o = r.original;
  const out = [];
  const txt = `${o.m2 ?? ''} ${o.precio ?? ''} ${o.contacto ?? ''}`;
  if (/verificar|seg[uú]n el|dos contactos|\bo \d/i.test(txt)) out.push('Dato a verificar');
  if (!r.pricing.mensual && !r.pricing.porM2) out.push('Precio por consultar');
  if (/aproximad|sin direcci[oó]n/i.test(`${o.addr ?? ''} ${o.m2 ?? ''}`)) out.push('Ubicación aproximada');
  if (/sobre el rango/i.test(o.m2 ?? '')) out.push('Sobre el rango buscado');
  if (!o.contacto) out.push('Sin contacto directo');
  if (!r.url) out.push('Sin anuncio');
  return out;
}

function buildRows(items, reviews) {
  return items.map((it) => ({
    ...it,
    review: reviews[it.key] || { estado: 'pendiente', comentario: '' },
    alertas: alertsFor(it),
  }));
}

// ---------- detalle de fila ----------
function renderDetail(r) {
  const o = r.original;
  const u = r.ubicacion;
  const m = r.pricing.mensual, p = r.pricing.porM2;
  const phone = r.telefono;
  const dd = (k, v) => `<dt>${k}</dt><dd>${v ?? '<span class="na">No disponible</span>'}</dd>`;
  return `
    <div class="dtl">
      <section>
        <h4>Datos del anuncio</h4>
        <dl>
          ${dd('Dirección', escapeHtml(r.direccion))}
          ${dd('Área (texto original)', r.areaTexto && escapeHtml(r.areaTexto))}
          ${dd('Precio (texto original)', r.precioTexto && escapeHtml(r.precioTexto))}
          ${dd('Precio mensual', m && `${fmtMoney(m.valor, m.moneda)}${m.calculado ? ' <small class="derived">calculado</small>' : ''}`)}
          ${dd('Precio por m²', p && `${fmtMoney(p.valor, p.moneda)}${p.calculado ? ' <small class="derived">calculado: precio ÷ área principal</small>' : ''}`)}
          ${dd('Contacto', r.contacto && escapeHtml(r.contacto) + (phone ? ` <a href="https://wa.me/51${phone}" target="_blank" rel="noopener">WhatsApp ↗</a>` : ''))}
          ${dd('Fuente', r.fuenteAnuncio && escapeHtml(r.fuenteAnuncio))}
          ${dd('Tipo de registro', escapeHtml(r.tipoRegistro))}
        </dl>
      </section>
      <section>
        <h4>Acceso desde planta</h4>
        <dl>
          ${dd('Distancia vial', r.rutaRadar && fmtKm(r.rutaRadar.distanciaKm))}
          ${dd('Tiempo vía libre', r.rutaRadar && fmtMin(r.rutaRadar.duracionLibreMin))}
          ${dd('Tiempo estimado', r.rutaRadar && `<b>${fmtMin(r.rutaRadar.duracionAjustadaMin)}</b> <small class="derived">tráfico moderado ×1.4, no es tiempo real</small>`)}
          ${dd('Rango', BAND_BY_ID[r.band] && `${BAND_BY_ID[r.band].label} · ${BAND_BY_ID[r.band].rango}`)}
        </dl>
        <h4>Calidad del dato</h4>
        ${r.alertas.length ? `<ul class="alerts">${r.alertas.map((a) => `<li>⚠ ${escapeHtml(a)}</li>`).join('')}</ul>` : '<p class="ok-dato">✓ Sin alertas: el anuncio trae área, precio, contacto y enlace.</p>'}
        <div class="links">
          <button type="button" class="mini" data-action="mapa">Ver en mapa</button>
          ${r.url ? `<a class="mini" href="${escapeHtml(r.url)}" target="_blank" rel="noopener">Anuncio ↗</a>` : ''}
          ${u && origin?.ubicacion ? `<a class="mini" href="https://www.google.com/maps/dir/?api=1&origin=${origin.ubicacion.lat},${origin.ubicacion.lon}&destination=${u.lat},${u.lon}&travelmode=driving" target="_blank" rel="noopener">Cómo llegar ↗</a>` : ''}
          ${u ? `<a class="mini" href="https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${u.lat},${u.lon}" target="_blank" rel="noopener">Street View ↗</a>` : ''}
        </div>
      </section>
      <section class="review" data-key="${escapeHtml(r.key)}">
        <h4>Evaluación</h4>
        <div class="states" role="radiogroup" aria-label="Estado de evaluación">
          ${Object.entries(ESTADOS)
            .map(([id, e]) => `<button type="button" role="radio" aria-checked="${r.review.estado === id}" data-estado="${id}" class="st st-${id} ${r.review.estado === id ? 'on' : ''}"><i aria-hidden="true">${e.icon}</i>${e.label}</button>`)
            .join('')}
        </div>
        <textarea maxlength="2000" placeholder="¿Cumple con lo requerido? Notas de visita, negociación, restricciones de acceso…">${escapeHtml(r.review.comentario || '')}</textarea>
        <div class="save"><button type="button" class="btn-primary" data-save>Guardar evaluación</button><span class="save-msg">${r.review.actualizado ? 'Última actualización: ' + new Date(r.review.actualizado).toLocaleString('es-PE') : 'Sin evaluación registrada'}</span></div>
      </section>
    </div>`;
}

async function saveReviewFrom(section) {
  const key = section.dataset.key;
  const estado = section.querySelector('.states .on')?.dataset.estado || 'pendiente';
  const comentario = section.querySelector('textarea').value;
  const msg = section.querySelector('.save-msg');
  const btn = section.querySelector('[data-save]');
  btn.disabled = true;
  msg.textContent = 'Guardando…';
  try {
    const saved = await api.guardarRevision(key, { estado, comentario });
    const row = allRows.find((r) => r.key === key);
    row.review = saved;
    table.render();
  } catch (err) {
    msg.textContent = `No se pudo guardar: ${err.message}`;
    btn.disabled = false;
  }
}

// ---------- barra de herramientas ----------
function renderActiveFilters() {
  const act = table.activeFilters();
  const q = table.state.globalQ;
  const chips = act.map(({ col, f }) => {
    const desc = f.type === 'num'
      ? [f.min != null ? `≥ ${fmtNum(f.min, 2)}` : '', f.max != null ? `≤ ${fmtNum(f.max, 2)}` : ''].filter(Boolean).join(' y ')
      : f.type === 'text' ? `contiene “${f.q}”` : [...f.selected].slice(0, 3).join(', ') + (f.selected.size > 3 ? ` +${f.selected.size - 3}` : '') || 'ninguno';
    return `<button type="button" class="fchip" data-remove="${col.id}" title="Quitar filtro">${escapeHtml(col.label)}: ${escapeHtml(desc)} ✕</button>`;
  });
  $('activeFilters').innerHTML = chips.length || q
    ? `${chips.join('')}<button type="button" class="link" data-clear-all>Limpiar todo</button>`
    : '<span class="muted">Sin filtros. Usa ⏷ en cada encabezado para filtrar como en Excel.</span>';
}

function renderColumnsMenu() {
  $('colsMenu').innerHTML = COLUMNS.map(
    (c) => `<label><input type="checkbox" value="${c.id}" ${table.state.hidden.has(c.id) ? '' : 'checked'} ${c.sticky ? 'disabled' : ''}> ${escapeHtml(c.label)}</label>`
  ).join('');
}

function openInMap(key) {
  if (window.parent !== window) window.parent.location.hash = `#/mapa/${encodeURIComponent(key)}`;
  else location.href = `/modules/mapa-almacenes/#${encodeURIComponent(key)}`;
}

// ---------- ciclo de actualización ----------
function onTableChange(rows, state) {
  renderKpis($('kpis'), rows, allRows.length);
  renderBandBar($('bandBar'), rows, {
    tooltip,
    onPick: (band) => table.setCatFilter('band', [BAND_BY_ID[band].label]),
  });
  renderScatter($('scatter'), rows, { tooltip, selectedKey: state.expanded, onPick: (key) => table.expand(key) });
  renderDistrictPivot($('pivot'), rows, {
    activeDistricts: state.filters.distrito?.selected,
    onPick: (d) => table.setCatFilter('distrito', state.filters.distrito?.selected?.size === 1 && state.filters.distrito.selected.has(d) ? null : [d]),
  });
  renderActiveFilters();
  $('count').textContent = `${rows.length} de ${allRows.length}`;
}

async function boot() {
  let payload, reviews;
  try {
    [payload, reviews] = await Promise.all([api.almacenes(), api.revisiones().catch(() => ({ almacenes: {} }))]);
  } catch (err) {
    $('tableWrap').innerHTML = `<p class="error">No se pudo cargar la data: ${escapeHtml(err.message)}. ¿Está corriendo el servidor?</p>`;
    return;
  }
  const data = adaptPayload(payload);
  origin = data.origen;
  allRows = buildRows(data.almacenes, reviews.almacenes || {});
  $('originAddr').textContent = `${origin.direccion} — ${origin.distrito}`;
  $('source').innerHTML = `Fuente: <code>${escapeHtml(data.fuente.archivo)}</code> · ${data.fuente.registros} registros · data original sin modificar`;

  table = createTable({
    root: $('tableWrap'),
    columns: COLUMNS,
    storageKey: 'plansa.radar.vista.v1',
    renderDetail,
    onChange: onTableChange,
    onRowAction: (action, key) => action === 'mapa' && openInMap(key),
  });
  if (!table.hasSavedView()) table.state.hidden = new Set(DEFAULT_HIDDEN);
  table.setRows(allRows);
  renderColumnsMenu();

  // Eventos de la barra y del detalle
  let qTimer;
  $('q').addEventListener('input', (e) => {
    clearTimeout(qTimer);
    qTimer = setTimeout(() => table.setGlobalQuery(e.target.value.trim()), 200);
  });
  $('activeFilters').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.remove) table.removeFilter(b.dataset.remove);
    if ('clearAll' in b.dataset) {
      $('q').value = '';
      table.clearAll();
    }
  });
  $('colsMenu').addEventListener('change', () => {
    table.setHidden([...$('colsMenu').querySelectorAll('input:not(:checked)')].map((i) => i.value));
  });
  $('tableWrap').addEventListener('click', (e) => {
    const st = e.target.closest('.review [data-estado]');
    if (st) {
      st.parentElement.querySelectorAll('[data-estado]').forEach((b) => {
        b.classList.toggle('on', b === st);
        b.setAttribute('aria-checked', b === st);
      });
      return;
    }
    if (e.target.closest('.review [data-save]')) saveReviewFrom(e.target.closest('.review'));
    const inDetail = e.target.closest('.detail-row [data-action="mapa"]');
    if (inDetail) openInMap(e.target.closest('.detail-row').previousElementSibling.dataset.key);
  });
}

boot();
