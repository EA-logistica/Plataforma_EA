// Tabla con filtro en cada encabezado (estilo Excel), orden por columna, columnas visibles y fila de detalle.
// Los valores disponibles en cada filtro son los que quedan tras aplicar los DEMÁS filtros (filtro en cascada).
import { normalize } from '/assets/js/data/parsers.js';
import { escapeHtml, fmtNum } from '/assets/js/ui/format.js';

const EMPTY = '(Vacío)';
const valuesOf = (col, row) => {
  const v = col.get(row);
  if (col.type === 'multi') return v && v.length ? v : [col.empty || EMPTY];
  return [v == null || v === '' ? EMPTY : String(v)];
};

export function isActive(f) {
  if (!f) return false;
  if (f.type === 'num') return f.min != null || f.max != null;
  if (f.type === 'text') return !!f.q;
  return f.selected instanceof Set;
}

function passes(col, f, row) {
  if (!isActive(f)) return true;
  if (f.type === 'num') {
    const v = col.get(row);
    if (v == null) return false;
    return (f.min == null || v >= f.min) && (f.max == null || v <= f.max);
  }
  if (f.type === 'text') {
    const hay = normalize(col.search ? col.search(row) : col.get(row));
    return normalize(f.q).split(/\s+/).every((t) => hay.includes(t));
  }
  return valuesOf(col, row).some((v) => f.selected.has(v));
}

export function createTable({ root, columns, onChange, renderDetail, onRowAction, storageKey }) {
  const state = { rows: [], filters: {}, sort: { id: 'min', dir: 1 }, hidden: new Set(), expanded: null, globalQ: '' };
  restore();

  const popover = document.createElement('div');
  popover.className = 'popover';
  popover.hidden = true;
  document.body.appendChild(popover);
  let popCol = null;

  const colById = (id) => columns.find((c) => c.id === id);
  const visibleCols = () => columns.filter((c) => !state.hidden.has(c.id));

  function filtered(exceptId) {
    const q = normalize(state.globalQ);
    return state.rows.filter((r) => {
      if (q && !q.split(/\s+/).every((t) => r.textoBusqueda.includes(t))) return false;
      return columns.every((c) => c.id === exceptId || passes(c, state.filters[c.id], r));
    });
  }

  function sorted(rows) {
    const col = colById(state.sort.id);
    if (!col) return rows;
    const key = col.sortValue || col.get;
    return [...rows].sort((a, b) => {
      const va = key(a), vb = key(b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1; // vacíos siempre al final
      if (vb == null) return -1;
      return (typeof va === 'number' ? va - vb : String(va).localeCompare(String(vb), 'es')) * state.sort.dir;
    });
  }

  function render() {
    const rows = sorted(filtered());
    const cols = visibleCols();
    root.innerHTML = `
      <table class="grid">
        <thead><tr>${cols.map((c) => th(c)).join('')}<th class="th-act" aria-label="Acciones"></th></tr></thead>
        <tbody>${rows.length ? rows.map((r) => tr(r, cols)).join('') : `<tr><td class="empty" colspan="${cols.length + 1}">Ningún almacén cumple los filtros. <button type="button" data-clear-all>Limpiar filtros</button></td></tr>`}</tbody>
      </table>`;
    fitDetailWidth();
    persist();
    onChange(rows, state);
  }

  // El detalle se fija al ancho visible del contenedor (la tabla puede ser más ancha y desplazarse).
  function fitDetailWidth() {
    root.style.setProperty('--wrap-w', root.clientWidth - 30 + 'px');
  }
  window.addEventListener('resize', fitDetailWidth);

  function th(c) {
    const f = state.filters[c.id];
    const sort = state.sort.id === c.id ? (state.sort.dir > 0 ? '▲' : '▼') : '';
    return `<th class="${c.sticky ? 'sticky ' : ''}${c.align === 'right' ? 'r' : ''}" data-col="${c.id}" aria-sort="${sort ? (state.sort.dir > 0 ? 'ascending' : 'descending') : 'none'}">
      <div class="th"><button type="button" class="th-sort" data-sort="${c.id}" title="Ordenar">${escapeHtml(c.label)}<span class="arrow">${sort}</span></button>
      ${c.type !== 'none' ? `<button type="button" class="th-filter ${isActive(f) ? 'on' : ''}" data-filter="${c.id}" aria-label="Filtrar ${escapeHtml(c.label)}" title="Filtrar">⏷</button>` : ''}</div></th>`;
  }

  function tr(r, cols) {
    const open = state.expanded === r.key;
    return `<tr class="row ${open ? 'open' : ''} ${r.review.estado === 'descartado' ? 'discarded' : ''}" data-key="${escapeHtml(r.key)}" tabindex="0" aria-expanded="${open}">
      ${cols.map((c) => `<td class="${c.sticky ? 'sticky ' : ''}${c.align === 'right' ? 'r' : ''}">${c.render ? c.render(r) : escapeHtml(c.get(r) ?? '—')}</td>`).join('')}
      <td class="act"><button type="button" class="mini" data-action="mapa" title="Ver en el mapa">Mapa</button>${r.url ? `<a class="mini" href="${escapeHtml(r.url)}" target="_blank" rel="noopener" title="Anuncio original">↗</a>` : ''}</td>
    </tr>${open ? `<tr class="detail-row"><td colspan="${cols.length + 1}">${renderDetail(r)}</td></tr>` : ''}`;
  }

  // ---------- popover de filtro ----------
  function openPopover(colId, anchor) {
    popCol = colById(colId);
    const f = state.filters[colId];
    const rows = filtered(colId);
    let body = '';
    if (popCol.type === 'num') {
      const vals = rows.map(popCol.get).filter((v) => v != null);
      const lo = vals.length ? Math.min(...vals) : '', hi = vals.length ? Math.max(...vals) : '';
      body = `<div class="pf-range">
          <label>Mínimo<input type="number" step="any" data-num="min" value="${f?.min ?? ''}" placeholder="${lo !== '' ? fmtNum(lo, lo % 1 ? 2 : 0) : ''}"></label>
          <label>Máximo<input type="number" step="any" data-num="max" value="${f?.max ?? ''}" placeholder="${hi !== '' ? fmtNum(hi, hi % 1 ? 2 : 0) : ''}"></label>
        </div><p class="pf-hint">${vals.length} con dato · rango ${lo !== '' ? `${fmtNum(lo, 2)} – ${fmtNum(hi, 2)}` : '—'}. Las filas sin dato se ocultan al filtrar.</p>`;
    } else if (popCol.type === 'text') {
      body = `<input type="search" class="pf-text" data-text value="${escapeHtml(f?.q ?? '')}" placeholder="Contiene…">`;
    } else {
      const counts = new Map();
      rows.forEach((r) => valuesOf(popCol, r).forEach((v) => counts.set(v, (counts.get(v) || 0) + 1)));
      // Incluye valores ya seleccionados que quedaron sin filas por otros filtros.
      state.rows.forEach((r) => valuesOf(popCol, r).forEach((v) => counts.has(v) || counts.set(v, 0)));
      const order = popCol.order || [];
      const values = [...counts.keys()].sort((a, b) => {
        const ia = order.indexOf(a), ib = order.indexOf(b);
        if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
        return a.localeCompare(b, 'es');
      });
      const sel = f?.selected;
      body = `<input type="search" class="pf-search" placeholder="Buscar valor…" data-search>
        <label class="pf-all"><input type="checkbox" data-all ${!sel ? 'checked' : ''}> (Seleccionar todo)</label>
        <div class="pf-list">${values
          .map((v) => `<label class="${counts.get(v) ? '' : 'zero'}"><input type="checkbox" value="${escapeHtml(v)}" ${!sel || sel.has(v) ? 'checked' : ''}><span>${escapeHtml(v)}</span><em>${counts.get(v)}</em></label>`)
          .join('')}</div>`;
    }
    popover.innerHTML = `
      <div class="pf-head"><b>${escapeHtml(popCol.label)}</b>
        <span class="pf-sort"><button type="button" data-dir="1">▲ Asc.</button><button type="button" data-dir="-1">▼ Desc.</button></span></div>
      ${body}
      <div class="pf-foot"><button type="button" data-clear>Quitar filtro</button><button type="button" class="pf-ok" data-close>Listo</button></div>`;
    popover.hidden = false;
    const rect = anchor.getBoundingClientRect();
    const w = popover.offsetWidth;
    popover.style.left = Math.max(8, Math.min(rect.right - w, window.innerWidth - w - 8)) + 'px';
    popover.style.top = rect.bottom + 6 + 'px';
    popover.querySelector('input')?.focus();
  }

  function closePopover() {
    popover.hidden = true;
    popCol = null;
  }

  function setCat(values, allValues) {
    const all = allValues.every((v) => values.has(v));
    if (all) delete state.filters[popCol.id];
    else state.filters[popCol.id] = { type: popCol.type, selected: values };
  }

  let numTimer;
  popover.addEventListener('input', (e) => {
    const t = e.target;
    if (t.dataset.num !== undefined) {
      const f = state.filters[popCol.id] || { type: 'num', min: null, max: null };
      const v = parseFloat(t.value);
      f[t.dataset.num] = Number.isFinite(v) ? v : null;
      state.filters[popCol.id] = f;
      clearTimeout(numTimer);
      numTimer = setTimeout(render, 220);
    } else if (t.dataset.text !== undefined) {
      state.filters[popCol.id] = { type: 'text', q: t.value.trim() };
      clearTimeout(numTimer);
      numTimer = setTimeout(render, 220);
    } else if (t.dataset.search !== undefined) {
      const q = normalize(t.value);
      popover.querySelectorAll('.pf-list label').forEach((l) => (l.hidden = !normalize(l.textContent).includes(q)));
    }
  });
  popover.addEventListener('change', (e) => {
    const t = e.target;
    if (t.type !== 'checkbox') return;
    const boxes = [...popover.querySelectorAll('.pf-list input')];
    if (t.dataset.all !== undefined) boxes.forEach((b) => (b.checked = t.checked));
    const all = boxes.map((b) => b.value);
    const sel = new Set(boxes.filter((b) => b.checked).map((b) => b.value));
    popover.querySelector('[data-all]').checked = sel.size === all.length;
    setCat(sel, all);
    render();
  });
  popover.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.dir) {
      state.sort = { id: popCol.id, dir: +b.dataset.dir };
      render();
    } else if ('clear' in b.dataset) {
      delete state.filters[popCol.id];
      render();
      closePopover();
    } else if ('close' in b.dataset) closePopover();
  });
  document.addEventListener('mousedown', (e) => {
    if (!popover.hidden && !popover.contains(e.target) && !e.target.closest('[data-filter]')) closePopover();
  });
  document.addEventListener('keydown', (e) => e.key === 'Escape' && closePopover());
  window.addEventListener('resize', closePopover);
  root.addEventListener('scroll', closePopover, { passive: true });

  // ---------- eventos de la tabla ----------
  root.addEventListener('click', (e) => {
    const sortBtn = e.target.closest('[data-sort]');
    if (sortBtn) {
      const id = sortBtn.dataset.sort;
      state.sort = { id, dir: state.sort.id === id ? -state.sort.dir : 1 };
      return render();
    }
    const fBtn = e.target.closest('[data-filter]');
    if (fBtn) return popCol?.id === fBtn.dataset.filter ? closePopover() : openPopover(fBtn.dataset.filter, fBtn);
    if (e.target.closest('[data-clear-all]')) return api.clearAll();
    const action = e.target.closest('[data-action]');
    const row = e.target.closest('tr.row');
    if (action && row) return onRowAction(action.dataset.action, row.dataset.key, action);
    if (e.target.closest('a, button, input, textarea, select, .detail-row')) return;
    if (row) api.toggle(row.dataset.key);
  });
  root.addEventListener('keydown', (e) => {
    const row = e.target.closest?.('tr.row');
    if (row && (e.key === 'Enter' || e.key === ' ') && e.target === row) {
      e.preventDefault();
      api.toggle(row.dataset.key);
    }
  });

  // ---------- persistencia de la vista (solo preferencias de este navegador) ----------
  function persist() {
    try {
      const filters = Object.fromEntries(Object.entries(state.filters).map(([k, f]) => [k, f.selected ? { ...f, selected: [...f.selected] } : f]));
      localStorage.setItem(storageKey, JSON.stringify({ filters, sort: state.sort, hidden: [...state.hidden] }));
    } catch {}
  }
  function restore() {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
      if (!saved) return false;
      state.sort = saved.sort || state.sort;
      state.hidden = new Set(saved.hidden || []);
      state.filters = Object.fromEntries(Object.entries(saved.filters || {}).map(([k, f]) => [k, f.selected ? { ...f, selected: new Set(f.selected) } : f]));
      return true;
    } catch {
      return false;
    }
  }

  const api = {
    state,
    hasSavedView: () => { try { return !!localStorage.getItem(storageKey); } catch { return false; } },
    setRows(rows) { state.rows = rows; render(); },
    render,
    visibleRows: () => sorted(filtered()),
    visibleColumns: visibleCols,
    setGlobalQuery(q) { state.globalQ = q; render(); },
    setCatFilter(colId, values) {
      if (!values) delete state.filters[colId];
      else state.filters[colId] = { type: colById(colId).type, selected: new Set(values) };
      render();
    },
    clearAll() { state.filters = {}; state.globalQ = ''; render(); },
    activeFilters: () => Object.entries(state.filters).filter(([, f]) => isActive(f)).map(([id, f]) => ({ col: colById(id), f })),
    removeFilter(id) { delete state.filters[id]; render(); },
    setHidden(ids) { state.hidden = new Set(ids); render(); },
    toggle(key) { state.expanded = state.expanded === key ? null : key; render(); },
    expand(key) {
      state.expanded = key;
      render();
      root.querySelector(`tr.row[data-key="${CSS.escape(key)}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    },
  };
  return api;
}
