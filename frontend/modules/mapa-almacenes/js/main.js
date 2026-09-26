// Orquestador del módulo "Mapa de Almacenes".
// Flujo: almacén existente -> ubicación -> coordenadas -> marcador -> ficha -> filtros -> ruta.
import { api } from '/assets/js/api/client.js';
import { BAND_LABEL, BASE_LAYERS, COLORES, MAP_DEFAULTS, MAP_ENGINE, ZONAS } from './config.js';
import { adaptPayload } from '/assets/js/data/adapter.js';
import { createMap } from './map/map-adapter.js';
import { initialFilterState, matches, renderFilters } from './ui/filters.js';
import { initSearch } from './ui/search.js';
import { renderResults, renderStats, SORTS } from './ui/results.js';
import { renderOriginDetail, renderWarehouseDetail } from './ui/detail.js';
import { openFicha } from './ui/ficha.js';
import { escapeHtml, fmtMin } from '/assets/js/ui/format.js';

const $ = (id) => document.getElementById(id);
const ORIGIN_KEY = '__origen__';

const state = {
  items: [],
  byKey: new Map(),
  origin: null,
  fuente: null,
  filters: null,
  visible: [],
  selected: null,
  colorMode: 'modalidad',
  sort: 'tiempo',
  perfil: 'auto',
  perfiles: [{ id: 'auto', etiqueta: 'Automóvil', disponible: true }],
  route: { status: 'idle' },
  routeSeq: 0,
};
let map;

// ---------- apariencia de marcadores ----------
const shapeOf = (i) => (i.modalidad === 'Venta' ? 'ring' : i.modalidad === 'Referencia' ? 'diamond' : 'circle');
const colorOf = (i) =>
  state.colorMode === 'band' ? COLORES.band[i.band] || COLORES.band.fuera : COLORES.modalidad[i.modalidad] || COLORES.modalidad.Referencia;
const iconOf = (i) => ({ shape: shapeOf(i), color: colorOf(i), active: i.key === state.selected });
const labelOf = (i) =>
  `<b>${escapeHtml(i.nombre || i.key)}</b><br>${escapeHtml(i.distrito || '')}${i.rutaRadar ? ' · ' + fmtMin(i.rutaRadar.duracionAjustadaMin) + ' a planta' : ''}`;

function detailPadding() {
  const detailOpen = !$('detail').hidden;
  const wide = window.innerWidth > 760;
  return {
    paddingTopLeft: [40, 80],
    paddingBottomRight: [detailOpen && wide ? $('detail').offsetWidth + 40 : 40, detailOpen && !wide ? $('detail').offsetHeight + 30 : 40],
  };
}

// ---------- filtros / resultados ----------
function applyFilters({ fit = false } = {}) {
  state.visible = state.items.filter((i) => matches(i, state.filters)).sort(SORTS[state.sort].fn);
  const keys = new Set(state.visible.map((i) => i.key));
  map.showOnly(keys);
  renderStats($('stats'), state.visible, state.items.length);
  renderResults($('results'), state.visible, { selectedKey: state.selected, colorOf, onSelect: (k) => select(k, { focus: true }) });
  $('resultCount').textContent = `${state.visible.length} de ${state.items.length}`;
  if (fit && keys.size) map.fitToKeys(keys, detailPadding());
}

function renderLegend() {
  const shapes = `
    <span><i class="lg-shape lg-circle" style="--c:#9aa3b2"></i>Alquiler</span>
    <span><i class="lg-shape lg-ring" style="--c:#9aa3b2"></i>Venta (referencial)</span>
    <span><i class="lg-shape lg-diamond" style="--c:#9aa3b2"></i>Punto de referencia</span>`;
  const colors =
    state.colorMode === 'band'
      ? Object.entries(BAND_LABEL).map(([b, l]) => `<span><i class="lg-dot" style="background:${COLORES.band[b]}"></i>${escapeHtml(l)}</span>`).join('')
      : Object.entries(COLORES.modalidad).map(([m, c]) => `<span><i class="lg-dot" style="background:${c}"></i>${m}</span>`).join('');
  $('legend').innerHTML = `
    <div class="lg-row"><span><i class="lg-origin" style="background:${COLORES.origen}"></i>Plásticos Nacionales (planta)</span><span><i class="lg-route" style="background:${COLORES.ruta}"></i>Ruta</span></div>
    <div class="lg-row"><em>Color</em>${colors}</div>
    <div class="lg-row lg-shapes"><em>Forma</em>${shapes}</div>`;
}

// ---------- selección ----------
function openDetail() {
  $('detail').hidden = false;
  $('app').classList.add('has-detail');
}

function closeDetail() {
  state.selected = null;
  state.route = { status: 'idle' };
  state.routeSeq++;
  map.clearRoute();
  map.refreshIcons();
  $('detail').hidden = true;
  $('app').classList.remove('has-detail');
  history.replaceState(null, '', location.pathname + location.search);
  applyFilters();
}

function renderDetail() {
  const body = $('detailBody');
  if (state.selected === ORIGIN_KEY) return renderOriginDetail(body, state.origin, state.items.length);
  const item = state.byKey.get(state.selected);
  if (item) renderWarehouseDetail(body, item, state.origin, { route: state.route, perfil: state.perfil, perfiles: state.perfiles });
}

async function select(key, { focus = true } = {}) {
  const item = state.byKey.get(key);
  if (!item) return;
  state.selected = key;
  state.route = { status: 'idle' };
  state.routeSeq++;
  map.clearRoute();
  map.refreshIcons();
  openDetail();
  renderDetail();
  $('results').querySelectorAll('.res').forEach((b) => b.classList.toggle('active', b.dataset.key === key));
  history.replaceState(null, '', '#' + encodeURIComponent(key));
  if (window.innerWidth <= 1100) $('app').classList.remove('show-sidebar');
  if (focus && item.ubicacion) await map.focusWarehouse(key, { zoom: 15 });
}

function selectOrigin() {
  state.selected = ORIGIN_KEY;
  state.routeSeq++;
  map.clearRoute();
  map.refreshIcons();
  openDetail();
  renderDetail();
  const u = state.origin.ubicacion;
  if (u) map.flyTo([u.lat, u.lon], 15);
}

async function requestRoute() {
  const item = state.byKey.get(state.selected);
  if (!item?.ubicacion || !state.origin.ubicacion) return;
  const seq = ++state.routeSeq;
  state.route = { status: 'loading' };
  renderDetail();
  try {
    const data = await api.ruta(state.origin.ubicacion, item.ubicacion, state.perfil);
    if (seq !== state.routeSeq) return; // el usuario cambió de selección mientras se calculaba
    state.route = { status: 'ok', data };
    map.showRoute(data.geometria, { color: COLORES.ruta, padding: detailPadding() });
  } catch (err) {
    if (seq !== state.routeSeq) return;
    state.route = { status: 'error', error: err.message };
  }
  renderDetail();
}

function wireDetail() {
  $('detail').addEventListener('click', (e) => {
    const perfilBtn = e.target.closest('[data-perfil]');
    if (perfilBtn) {
      state.perfil = perfilBtn.dataset.perfil;
      if (state.route.status === 'ok' || state.route.status === 'error') requestRoute();
      else renderDetail();
      return;
    }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'close') closeDetail();
    else if (act === 'route') requestRoute();
    else if (act === 'locate') map.focusWarehouse(state.selected, { zoom: 17 });
    else if (act === 'ficha') openFicha($('ficha'), state.byKey.get(state.selected), state.fuente);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('ficha').open && !$('detail').hidden) closeDetail();
  });
}

// ---------- barra de herramientas del mapa ----------
function wireToolbar() {
  $('zoneSelect').innerHTML = '<option value="">Ir a zona…</option>' + ZONAS.map((z) => `<option value="${z.id}">${escapeHtml(z.nombre)}</option>`).join('');
  $('zoneSelect').addEventListener('change', (e) => {
    const z = ZONAS.find((x) => x.id === e.target.value);
    if (z) map.fitBounds(z.bounds, detailPadding());
    e.target.value = '';
  });
  $('toolbar').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.zone) map.fitBounds(ZONAS.find((z) => z.id === b.dataset.zone).bounds, detailPadding());
    if (b.dataset.act === 'origin') selectOrigin();
    if (b.dataset.act === 'all') map.fitToKeys(new Set(state.visible.map((i) => i.key)), detailPadding());
    if (b.dataset.color) {
      state.colorMode = b.dataset.color;
      $('toolbar').querySelectorAll('[data-color]').forEach((x) => x.classList.toggle('on', x === b));
      map.refreshIcons();
      renderLegend();
      applyFilters();
    }
  });
  $('toggleSidebar').addEventListener('click', () => {
    $('app').classList.toggle('show-sidebar');
  });
  $('sortSelect').innerHTML = Object.entries(SORTS).map(([k, s]) => `<option value="${k}">${s.label}</option>`).join('');
  $('sortSelect').addEventListener('change', (e) => {
    state.sort = e.target.value;
    applyFilters();
  });
}

// ---------- geocodificación diferida (solo registros sin coordenadas) ----------
async function geocodeMissing() {
  const pending = state.items.filter((i) => !i.ubicacion && i.direccion);
  for (const item of pending) {
    try {
      const r = await api.geocodificar(item.direccion);
      if (r.lat == null) continue;
      item.ubicacion = { lat: r.lat, lon: r.lon, fuente: 'geocodificacion', precision: r.precision, nota: r.etiqueta };
      map.addWarehouse(item, { labelOf, onClick: (k) => select(k) });
    } catch (err) {
      console.warn('[geocodificación]', item.key, err.message);
    }
  }
  if (pending.length) applyFilters();
}

function setStatus(msg, kind = 'info') {
  const el = $('status');
  el.hidden = !msg;
  el.className = `map-status ${kind}`;
  el.textContent = msg || '';
}

// ---------- inicio ----------
async function boot() {
  setStatus('Cargando almacenes…');
  map = createMap(MAP_ENGINE, $('map'), { ...MAP_DEFAULTS, originColor: COLORES.origen });
  map.setBaseLayers(BASE_LAYERS);
  wireToolbar();
  wireDetail();
  renderLegend();

  let payload;
  try {
    const [cfg, raw] = await Promise.all([api.config().catch(() => null), api.almacenes()]);
    if (cfg?.routing?.perfiles) state.perfiles = cfg.routing.perfiles;
    payload = adaptPayload(raw);
  } catch (err) {
    setStatus(`No se pudo cargar la data de almacenes: ${err.message}. ¿Está corriendo el servidor (npm start)?`, 'error');
    return;
  }

  state.items = payload.almacenes;
  state.byKey = new Map(state.items.map((i) => [i.key, i]));
  state.origin = payload.origen;
  state.fuente = payload.fuente;
  state.filters = initialFilterState(state.items);

  $('originAddr').textContent = `${state.origin.direccion} — ${state.origin.distrito}`;
  $('sourceNote').innerHTML = `Fuente: <code>${escapeHtml(payload.fuente.archivo)}</code> · ${payload.fuente.registros} registros · data original sin modificar`;

  map.setOrigin(state.origin, {
    label: `<b>${escapeHtml(state.origin.nombre)}</b><br>${escapeHtml(state.origin.rol)}`,
    onClick: selectOrigin,
  });
  map.setWarehouses(state.items, { iconOf, labelOf, onClick: (k) => select(k) });

  renderFilters($('filters'), state.items, state.filters, { onChange: () => applyFilters() });
  initSearch({
    input: $('q'),
    list: $('suggest'),
    items: state.items,
    onQuery: (q) => {
      state.filters.q = q;
      applyFilters({ fit: !!q });
    },
    onPick: (item) => select(item.key, { focus: true }),
  });
  applyFilters();
  setStatus(null);

  // Enlace directo: /modules/mapa-almacenes/#<código>. También lo usa el Radar ("Ver en mapa").
  const openFromHash = () => {
    const key = decodeURIComponent(location.hash.slice(1));
    if (state.byKey.has(key) && key !== state.selected) select(key);
  };
  window.addEventListener('hashchange', openFromHash);
  openFromHash();

  geocodeMissing();
}

boot();
