// Resumen de resultados y lista lateral.
import { COLORES } from '../config.js';
import { escapeHtml, fmtArea, fmtMin, fmtNum } from '/assets/js/ui/format.js';

export const SORTS = {
  tiempo: { label: 'Tiempo a planta', fn: (a, b) => (a.rutaRadar?.duracionAjustadaMin ?? 1e9) - (b.rutaRadar?.duracionAjustadaMin ?? 1e9) },
  areaDesc: { label: 'Mayor área', fn: (a, b) => (b.area?.principal ?? -1) - (a.area?.principal ?? -1) },
  areaAsc: { label: 'Menor área', fn: (a, b) => (a.area?.principal ?? 1e12) - (b.area?.principal ?? 1e12) },
  nombre: { label: 'Nombre', fn: (a, b) => (a.nombre || '').localeCompare(b.nombre || '', 'es') },
};

export function renderStats(container, visible, total) {
  const n = (m) => visible.filter((i) => i.modalidad === m).length;
  const times = visible.map((i) => i.rutaRadar?.duracionAjustadaMin).filter(Number.isFinite);
  const range = times.length ? `${Math.min(...times)}–${Math.max(...times)}` : '—';
  container.innerHTML = `
    <div class="stat stat-main"><b>${visible.length}<small>/${total}</small></b><span>Resultados</span></div>
    <div class="stat"><b style="color:${COLORES.modalidad.Alquiler}">${n('Alquiler')}</b><span>Alquiler</span></div>
    <div class="stat"><b style="color:${COLORES.modalidad.Venta}">${n('Venta')}</b><span>Venta</span></div>
    <div class="stat"><b>${range}</b><span>Min a planta</span></div>`;
}

export function renderResults(container, visible, { selectedKey, colorOf, onSelect }) {
  if (!visible.length) {
    container.innerHTML = '<li class="empty">Ningún almacén coincide con los filtros.</li>';
    return;
  }
  container.innerHTML = visible
    .map((i) => {
      const t = i.rutaRadar ? fmtMin(i.rutaRadar.duracionAjustadaMin) : '—';
      const area = i.area && (i.area.min === i.area.max ? fmtArea(i.area.min) : `${fmtNum(i.area.min)}–${fmtArea(i.area.max)}`);
      const meta = [i.distrito, area].filter(Boolean).join(' · ');
      return `<li>
        <button type="button" class="res ${i.key === selectedKey ? 'active' : ''}" data-key="${escapeHtml(i.key)}">
          <i class="dot" style="background:${colorOf(i)}"></i>
          <span class="res-name"><b>${escapeHtml(i.nombre || i.key)}</b><span>${escapeHtml(meta)}</span></span>
          <span class="res-side">
            <span class="tag tag-${escapeHtml((i.modalidad || '').toLowerCase())}">${escapeHtml(i.modalidad || '—')}</span>
            <span class="res-time" title="Tiempo estimado a planta (dato del Radar)">${t}</span>
          </span>
          ${i.ubicacion ? '' : '<span class="res-warn" title="Sin coordenadas">sin ubicación</span>'}
        </button>
      </li>`;
    })
    .join('');
  container.onclick = (e) => {
    const b = e.target.closest('button.res');
    if (b) onSelect(b.dataset.key);
  };
}
