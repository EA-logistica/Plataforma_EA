// Indicadores y gráficos de apoyo a la decisión. Todo se calcula sobre las filas visibles
// (los filtros de la tabla gobiernan también los KPIs y gráficos).
import { BANDS } from '/assets/js/data/bands.js';
import { escapeHtml, fmtNum } from '/assets/js/ui/format.js';
import { ESTADOS, MODALIDAD_COLOR, MODALIDAD_SHAPE } from './columns.js';

const median = (arr) => {
  const v = arr.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};
const minOf = (arr) => (arr.length ? Math.min(...arr) : null);
const maxOf = (arr) => (arr.length ? Math.max(...arr) : null);
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

export function renderKpis(el, rows, total) {
  const times = rows.map((r) => r.rutaRadar?.duracionAjustadaMin).filter(Number.isFinite);
  const areas = rows.map((r) => r.area?.principal).filter(Number.isFinite);
  const penM2 = rows.map((r) => (r.pricing.porM2?.moneda === 'PEN' ? r.pricing.porM2.valor : null)).filter(Number.isFinite);
  const ideal = rows.filter((r) => r.band === 'ideal').length;
  const evaluated = rows.filter((r) => r.review.estado !== 'pendiente').length;
  const shortlisted = rows.filter((r) => r.review.estado === 'preseleccionado').length;
  const alq = rows.filter((r) => r.modalidad === 'Alquiler').length;
  const vta = rows.filter((r) => r.modalidad === 'Venta').length;

  const tile = (label, value, sub, cls = '') => `<div class="kpi ${cls}"><span class="k">${label}</span><b class="v">${value}</b><span class="s">${sub}</span></div>`;
  el.innerHTML = [
    tile('Almacenes en vista', `${rows.length}<small>/${total}</small>`, `${alq} alquiler · ${vta} venta`, 'kpi-main'),
    tile('Dentro de 10 min', `${ideal}`, `${pct(ideal, rows.length)}% de la vista · rango Ideal`),
    tile('Tiempo mediano a planta', times.length ? `${fmtNum(median(times))}<small> min</small>` : '—', times.length ? `mín. ${minOf(times)} · máx. ${maxOf(times)} min` : 'sin dato'),
    tile('Área mediana', areas.length ? `${fmtNum(median(areas))}<small> m²</small>` : '—', areas.length ? `${fmtNum(minOf(areas))} – ${fmtNum(maxOf(areas))} m² (valor principal)` : 'sin dato'),
    tile('S/ por m² mediano', penM2.length ? `${fmtNum(median(penM2), 2)}` : '—', penM2.length ? `${penM2.length} de ${rows.length} con precio comparable en S/` : 'sin precio comparable'),
    tile('Avance de evaluación', `${evaluated}<small>/${rows.length}</small>`, `${shortlisted} preseleccionado${shortlisted === 1 ? '' : 's'} · ${rows.filter((r) => r.review.estado === 'descartado').length} descartados`),
  ].join('');
}

// Barra apilada única: cuántos candidatos caen en cada rango de tiempo (escala ordinal de un tono).
export function renderBandBar(el, rows, { onPick, tooltip }) {
  const counts = BANDS.map((b) => ({ ...b, n: rows.filter((r) => r.band === b.id).length }));
  const total = counts.reduce((s, b) => s + b.n, 0);
  if (!total) {
    el.innerHTML = '<p class="viz-empty">Sin datos en la vista actual.</p>';
    return;
  }
  const W = 560, H = 30, GAP = 2;
  const segs = counts.filter((b) => b.n);
  const usable = W - GAP * (segs.length - 1);
  let x = 0;
  const rects = segs
    .map((b, i) => {
      const w = (b.n / total) * usable;
      const first = i === 0, last = i === segs.length - 1;
      const r = 4;
      // extremos redondeados solo en los bordes exteriores de la barra
      const d = `M${x + (first ? r : 0)},0 H${x + w - (last ? r : 0)} ${last ? `Q${x + w},0 ${x + w},${r} V${H - r} Q${x + w},${H} ${x + w - r},${H}` : `V${H}`} H${x + (first ? r : 0)} ${first ? `Q${x},${H} ${x},${H - r} V${r} Q${x},0 ${x + r},0` : `V0`} Z`;
      const out = `<path d="${d}" fill="${b.color}" data-band="${b.id}" data-tip="${escapeHtml(`${b.label} (${b.rango}): ${b.n} almacén${b.n === 1 ? '' : 'es'} · ${pct(b.n, total)}%`)}" class="seg"/>`;
      x += w + GAP;
      return out;
    })
    .join('');
  el.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" class="bandbar" role="img" aria-label="Distribución por rango de tiempo a planta">${rects}</svg>
    <div class="legend-row">${counts
      .map((b) => `<button type="button" class="lg" data-band="${b.id}" ${b.n ? '' : 'disabled'}><i style="background:${b.color}"></i><span>${b.label}</span><b>${b.n}</b><small>${b.rango}</small></button>`)
      .join('')}</div>`;
  el.onclick = (e) => {
    const t = e.target.closest('[data-band]');
    if (t) onPick(t.dataset.band);
  };
  tooltip.bind(el);
}

// Dispersión proximidad vs. capacidad: el trade-off principal al elegir almacén.
export function renderScatter(el, rows, { onPick, tooltip, selectedKey }) {
  const pts = rows.filter((r) => Number.isFinite(r.rutaRadar?.duracionAjustadaMin) && Number.isFinite(r.area?.principal));
  const W = 640, H = 300, L = 54, R = 16, T = 14, B = 38;
  const maxX = Math.max(60, Math.ceil((maxOf(pts.map((p) => p.rutaRadar.duracionAjustadaMin)) || 0) / 10) * 10);
  const yTicks = [500, 1000, 2000, 5000, 10000, 20000, 50000];
  const areas = pts.map((p) => p.area.principal);
  const yMin = Math.min(500, minOf(areas) || 500), yMax = Math.max(25000, maxOf(areas) || 25000);
  const sx = (v) => L + (v / maxX) * (W - L - R);
  const sy = (v) => T + (1 - (Math.log10(v) - Math.log10(yMin)) / (Math.log10(yMax) - Math.log10(yMin))) * (H - T - B);

  const grid = yTicks
    .filter((t) => t >= yMin && t <= yMax)
    .map((t) => `<line x1="${L}" x2="${W - R}" y1="${sy(t)}" y2="${sy(t)}" class="gl"/><text x="${L - 8}" y="${sy(t) + 4}" class="tk" text-anchor="end">${t >= 1000 ? fmtNum(t / 1000) + 'k' : t}</text>`)
    .join('');
  const xTicks = [];
  for (let t = 0; t <= maxX; t += 10) xTicks.push(`<text x="${sx(t)}" y="${H - B + 18}" class="tk" text-anchor="middle">${t}</text>`);
  // Umbrales de los rangos del Radar (10 / 20 / 30 min)
  const thresholds = [10, 20, 30]
    .map((t, i) => `<line x1="${sx(t)}" x2="${sx(t)}" y1="${T}" y2="${H - B}" class="th-line"/><text x="${sx(t) + 4}" y="${T + 10}" class="th-lbl">${['Ideal', 'Moderado', 'Máximo'][i]} ≤${t}</text>`)
    .join('');

  const shape = (p) => {
    const x = sx(p.rutaRadar.duracionAjustadaMin), y = sy(p.area.principal);
    const c = MODALIDAD_COLOR[p.modalidad] || '#888';
    const s = MODALIDAD_SHAPE[p.modalidad] || 'circle';
    const sel = p.key === selectedKey ? ' sel' : '';
    const tip = escapeHtml(`${p.nombre} · ${p.distrito} · ${p.rutaRadar.duracionAjustadaMin} min · ${fmtNum(p.area.principal)} m² · ${ESTADOS[p.review.estado].label}`);
    const common = `class="pt${sel}" data-key="${escapeHtml(p.key)}" data-tip="${tip}"`;
    if (s === 'diamond') return `<path ${common} d="M${x},${y - 7} L${x + 7},${y} L${x},${y + 7} L${x - 7},${y} Z" fill="${c}"/>`;
    // Anillo: el trazo ES la marca (estilo en línea para que no lo pise el anillo de superficie de .pt)
    if (s === 'ring') return `<circle ${common} cx="${x}" cy="${y}" r="5.5" fill="var(--bg-panel)" style="stroke:${c};stroke-width:3"/>`;
    return `<circle ${common} cx="${x}" cy="${y}" r="6" fill="${c}"/>`;
  };
  const excluded = rows.length - pts.length;

  el.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" class="scatter" role="img" aria-label="Tiempo a planta frente a área de cada almacén">
      ${grid}${thresholds}${xTicks.join('')}
      <line x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}" class="axis"/>
      <text x="${(L + W - R) / 2}" y="${H - 4}" class="ax-lbl" text-anchor="middle">Minutos estimados a planta (tráfico moderado)</text>
      <text x="14" y="${(T + H - B) / 2}" class="ax-lbl" text-anchor="middle" transform="rotate(-90 14 ${(T + H - B) / 2})">Área m² (escala log)</text>
      ${pts.map(shape).join('')}
    </svg>
    <div class="legend-row">
      ${Object.keys(MODALIDAD_COLOR).map((m) => `<span class="lg static"><i class="shape shape-${MODALIDAD_SHAPE[m]}" style="--c:${MODALIDAD_COLOR[m]}"></i><span>${m}</span><b>${pts.filter((p) => p.modalidad === m).length}</b></span>`).join('')}
      ${excluded ? `<span class="viz-note">${excluded} sin área o tiempo no se grafican</span>` : ''}
    </div>`;
  el.onclick = (e) => {
    const p = e.target.closest('.pt');
    if (p) onPick(p.dataset.key);
  };
  tooltip.bind(el);
}

// Tabla dinámica por distrito.
export function renderDistrictPivot(el, rows, { onPick, activeDistricts }) {
  const groups = new Map();
  rows.forEach((r) => {
    const k = r.distrito || '(Sin distrito)';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  });
  const data = [...groups.entries()]
    .map(([d, rs]) => ({
      d,
      n: rs.length,
      alq: rs.filter((r) => r.modalidad === 'Alquiler').length,
      vta: rs.filter((r) => r.modalidad === 'Venta').length,
      tMin: minOf(rs.map((r) => r.rutaRadar?.duracionAjustadaMin).filter(Number.isFinite)),
      aMax: maxOf(rs.map((r) => r.area?.max).filter(Number.isFinite)),
      pMin: minOf(rs.map((r) => (r.pricing.porM2?.moneda === 'PEN' ? r.pricing.porM2.valor : null)).filter(Number.isFinite)),
    }))
    .sort((a, b) => (a.tMin ?? 999) - (b.tMin ?? 999));
  const maxN = maxOf(data.map((x) => x.n)) || 1;
  el.innerHTML = `
    <table class="pivot">
      <thead><tr><th>Distrito</th><th class="r">Cand.</th><th class="r">Alq. / Vta.</th><th class="r">Mejor tiempo</th><th class="r">Área máx.</th><th class="r">S//m² mín.</th></tr></thead>
      <tbody>${data
        .map(
          (x) => `<tr data-d="${escapeHtml(x.d)}" class="${activeDistricts?.has(x.d) ? 'on' : ''}" title="Filtrar la tabla por ${escapeHtml(x.d)}">
          <td>${escapeHtml(x.d)}</td>
          <td class="r"><span class="bar" style="--w:${(x.n / maxN) * 100}%"></span>${x.n}</td>
          <td class="r">${x.alq} / ${x.vta}</td>
          <td class="r">${x.tMin != null ? x.tMin + ' min' : '—'}</td>
          <td class="r">${x.aMax != null ? fmtNum(x.aMax) : '—'}</td>
          <td class="r">${x.pMin != null ? fmtNum(x.pMin, 2) : '—'}</td></tr>`
        )
        .join('')}</tbody>
    </table>`;
  el.onclick = (e) => {
    const tr = e.target.closest('tr[data-d]');
    if (tr) onPick(tr.dataset.d);
  };
}

// Tooltip compartido: cualquier elemento con data-tip dentro de un contenedor enlazado.
export function createTooltip() {
  const tip = document.createElement('div');
  tip.className = 'tooltip';
  tip.hidden = true;
  document.body.appendChild(tip);
  const move = (e) => {
    const t = e.target.closest?.('[data-tip]');
    if (!t) return (tip.hidden = true);
    tip.textContent = t.dataset.tip;
    tip.hidden = false;
    const x = Math.min(e.clientX + 14, window.innerWidth - tip.offsetWidth - 8);
    tip.style.left = x + 'px';
    tip.style.top = e.clientY - tip.offsetHeight - 12 + 'px';
  };
  return {
    bind(el) {
      if (el.dataset.tipBound) return;
      el.dataset.tipBound = '1';
      el.addEventListener('mousemove', move);
      el.addEventListener('mouseleave', () => (tip.hidden = true));
    },
  };
}
