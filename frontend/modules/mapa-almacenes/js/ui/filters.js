// Filtros del mapa. Operan sobre la misma colección de almacenes (sin duplicarla): devuelven el
// conjunto de claves visibles, que se aplica a marcadores, lista y resumen.
import { BAND_LABEL, COLORES } from '../config.js';
import { normalize } from '/assets/js/data/parsers.js';
import { escapeHtml } from '/assets/js/ui/format.js';

const BANDS = ['ideal', 'moderado', 'maximo', 'fuera'];

const countBy = (items, fn) => items.reduce((m, it) => m.set(fn(it), (m.get(fn(it)) || 0) + 1), new Map());
const sorted = (map) => [...map.keys()].filter(Boolean).sort((a, b) => a.localeCompare(b, 'es'));

export function initialFilterState(items) {
  return {
    q: '',
    modalidades: new Set(items.map((i) => i.modalidad).filter(Boolean)),
    bands: new Set(BANDS),
    distritos: new Set(items.map((i) => i.distrito).filter(Boolean)),
    tipologias: new Set(items.map((i) => i.tipologia)),
    areaMin: null,
    areaMax: null,
    incluirSinArea: true,
    moneda: 'PEN',
    precioMax: null,
    precioM2Max: null,
    incluirSinPrecio: true,
  };
}

export function matches(item, f) {
  if (f.q) {
    const tokens = normalize(f.q).split(/\s+/).filter(Boolean);
    if (!tokens.every((t) => item.textoBusqueda.includes(t))) return false;
  }
  if (item.modalidad && !f.modalidades.has(item.modalidad)) return false;
  if (item.band && !f.bands.has(item.band)) return false;
  if (item.distrito && !f.distritos.has(item.distrito)) return false;
  if (!f.tipologias.has(item.tipologia)) return false;

  if (f.areaMin != null || f.areaMax != null) {
    if (!item.area) {
      if (!f.incluirSinArea) return false;
    } else {
      // Coincide si el rango de área del anuncio se superpone con el rango buscado.
      if (f.areaMin != null && item.area.max < f.areaMin) return false;
      if (f.areaMax != null && item.area.min > f.areaMax) return false;
    }
  }

  const priceCheck = (entry, max) => {
    if (max == null) return true;
    if (!entry || entry.moneda !== f.moneda) return f.incluirSinPrecio;
    return entry.valor <= max;
  };
  if (!priceCheck(item.pricing.mensual, f.precioMax)) return false;
  if (!priceCheck(item.pricing.porM2, f.precioM2Max)) return false;
  return true;
}

function chip(group, value, label, count, on, color) {
  const dot = color ? `<i class="dot" style="background:${color}"></i>` : '';
  return `<label class="chip ${on ? 'on' : ''}"><input type="checkbox" data-group="${group}" value="${escapeHtml(value)}" ${on ? 'checked' : ''}>${dot}<span>${escapeHtml(label)}</span><em>${count}</em></label>`;
}

export function renderFilters(container, items, state, { onChange }) {
  const byModalidad = countBy(items, (i) => i.modalidad);
  const byBand = countBy(items, (i) => i.band);
  const byDistrito = countBy(items, (i) => i.distrito);
  const byTipologia = countBy(items, (i) => i.tipologia);

  container.innerHTML = `
    <div class="f-group">
      <div class="f-label">Modalidad</div>
      <div class="chips">${sorted(byModalidad).map((m) => chip('modalidades', m, m, byModalidad.get(m), state.modalidades.has(m), COLORES.modalidad[m])).join('')}</div>
    </div>
    <div class="f-group">
      <div class="f-label">Tiempo a planta <span class="f-hint">dato del Radar</span></div>
      <div class="chips">${BANDS.filter((b) => byBand.has(b)).map((b) => chip('bands', b, BAND_LABEL[b].split(' · ')[0], byBand.get(b), state.bands.has(b), COLORES.band[b])).join('')}</div>
    </div>
    <div class="f-group">
      <div class="f-label">Distrito <span class="f-actions"><button type="button" data-all="distritos">Todos</button><button type="button" data-none="distritos">Ninguno</button></span></div>
      <div class="chips chips-list">${sorted(byDistrito).map((d) => chip('distritos', d, d, byDistrito.get(d), state.distritos.has(d))).join('')}</div>
    </div>
    <div class="f-group">
      <div class="f-label">Tipo de inmueble <span class="f-hint">según título del anuncio</span></div>
      <div class="chips">${sorted(byTipologia).map((t) => chip('tipologias', t, t, byTipologia.get(t), state.tipologias.has(t))).join('')}</div>
    </div>
    <div class="f-group">
      <div class="f-label">Área (m²)</div>
      <div class="range">
        <input type="number" min="0" step="50" inputmode="numeric" placeholder="Mínima" data-num="areaMin" value="${state.areaMin ?? ''}" aria-label="Área mínima">
        <span>–</span>
        <input type="number" min="0" step="50" inputmode="numeric" placeholder="Máxima" data-num="areaMax" value="${state.areaMax ?? ''}" aria-label="Área máxima">
      </div>
      <label class="check"><input type="checkbox" data-bool="incluirSinArea" ${state.incluirSinArea ? 'checked' : ''}> Incluir registros sin área</label>
    </div>
    <div class="f-group">
      <div class="f-label">Precio
        <span class="seg" role="group" aria-label="Moneda">
          <button type="button" data-moneda="PEN" class="${state.moneda === 'PEN' ? 'on' : ''}">S/</button>
          <button type="button" data-moneda="USD" class="${state.moneda === 'USD' ? 'on' : ''}">USD</button>
        </span>
      </div>
      <div class="range">
        <input type="number" min="0" step="100" inputmode="decimal" placeholder="Máx. mensual" data-num="precioMax" value="${state.precioMax ?? ''}" aria-label="Precio mensual máximo">
        <input type="number" min="0" step="0.5" inputmode="decimal" placeholder="Máx. por m²" data-num="precioM2Max" value="${state.precioM2Max ?? ''}" aria-label="Precio por m² máximo">
      </div>
      <label class="check"><input type="checkbox" data-bool="incluirSinPrecio" ${state.incluirSinPrecio ? 'checked' : ''}> Incluir “consultar precio” u otra moneda</label>
    </div>
    <button type="button" class="btn btn-ghost btn-block" data-reset>Limpiar filtros</button>
  `;

  const emit = () => onChange(state);

  container.onchange = (e) => {
    const t = e.target;
    if (t.dataset.group) {
      state[t.dataset.group][t.checked ? 'add' : 'delete'](t.value);
      t.closest('.chip').classList.toggle('on', t.checked);
      emit();
    } else if (t.dataset.bool) {
      state[t.dataset.bool] = t.checked;
      emit();
    }
  };
  let timer;
  container.oninput = (e) => {
    const t = e.target;
    if (!t.dataset.num) return;
    const v = parseFloat(t.value);
    state[t.dataset.num] = Number.isFinite(v) && v >= 0 ? v : null;
    clearTimeout(timer);
    timer = setTimeout(emit, 200);
  };
  container.onclick = (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.moneda) {
      state.moneda = t.dataset.moneda;
      container.querySelectorAll('[data-moneda]').forEach((b) => b.classList.toggle('on', b === t));
      emit();
    } else if (t.dataset.all || t.dataset.none) {
      const g = t.dataset.all || t.dataset.none;
      const on = !!t.dataset.all;
      container.querySelectorAll(`input[data-group="${g}"]`).forEach((cb) => {
        cb.checked = on;
        cb.closest('.chip').classList.toggle('on', on);
        state[g][on ? 'add' : 'delete'](cb.value);
      });
      emit();
    } else if ('reset' in t.dataset) {
      const q = state.q;
      Object.assign(state, initialFilterState(items), { q });
      renderFilters(container, items, state, { onChange });
      emit();
    }
  };
}
