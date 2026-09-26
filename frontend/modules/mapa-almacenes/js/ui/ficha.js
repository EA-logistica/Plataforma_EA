// Ficha completa: TODOS los campos del registro original (tal cual existen), la ubicación resuelta
// y la estructura logística preparada para análisis posterior.
import { LOGISTICS_FIELDS } from '/assets/js/data/logistics-schema.js';
import { escapeHtml, FUENTE_UBICACION, fmtNum, NA, orNA } from '/assets/js/ui/format.js';
import { gmapsPin, pricingRows, streetView } from './detail.js';

// Etiquetas legibles para los campos que ya existen en la data del Radar.
const FIELD_LABELS = {
  name: 'Nombre',
  addr: 'Dirección',
  distrito: 'Distrito',
  categoria: 'Categoría / modalidad',
  tipo: 'Tipo de registro',
  m2: 'Área (m²)',
  precio: 'Precio',
  contacto: 'Contacto',
  url: 'Enlace del anuncio',
  fuente: 'Fuente',
  lat: 'Latitud',
  lon: 'Longitud',
  distance_km: 'Distancia vial a planta (km)',
  duration_min: 'Tiempo vía libre a planta (min)',
  duration_adj_min: 'Tiempo estimado con tráfico (min)',
  band: 'Rango de tiempo',
};
// Campos internos del esquema SVG del Radar: se muestran aparte.
const TECH_FIELDS = new Set(['x', 'y', 'path', 'n_path_pts']);

function fmtValue(key, v) {
  if (v == null || v === '') return `<span class="na">${NA}</span>`;
  if (key === 'url') return `<a class="inline-link" href="${escapeHtml(v)}" target="_blank" rel="noopener">${escapeHtml(v)}</a>`;
  if (key === 'path') return `trazo SVG (${fmtNum(String(v).length)} caracteres)`;
  return escapeHtml(v);
}

function fmtLogistic(field, entry) {
  if (!entry) return `<span class="na">${NA}</span>`;
  const v = entry.valor;
  const txt =
    field.format === 'bool' ? (v ? 'Sí' : 'No') : field.format === 'km' ? `${fmtNum(v, 1)} km` : field.format === 'min' ? `${fmtNum(v)} min` : field.format === 'm' ? `${fmtNum(v, 1)} m` : String(v);
  return `${escapeHtml(txt)}${entry.nota ? ` <small class="derived">${escapeHtml(entry.nota)}</small>` : ''}`;
}

export function openFicha(dialog, item, sourceMeta) {
  const o = item.original;
  const keys = Object.keys(o);
  const main = keys.filter((k) => !TECH_FIELDS.has(k));
  const tech = keys.filter((k) => TECH_FIELDS.has(k));
  const u = item.ubicacion;

  const groups = {};
  for (const f of LOGISTICS_FIELDS) (groups[f.grupo] ||= []).push(f);

  dialog.innerHTML = `
    <form method="dialog" class="ficha">
      <header class="fc-head">
        <div>
          <span class="eyebrow">Ficha de almacén · <code>${escapeHtml(item.key)}</code></span>
          <h2>${escapeHtml(item.nombre || item.key)}</h2>
          <p>${orNA(item.direccion)}</p>
        </div>
        <button class="icon-btn" value="close" aria-label="Cerrar">✕</button>
      </header>
      <div class="fc-body">
        <section>
          <h3>Datos del registro original</h3>
          <p class="fc-src">Fuente: <code>${escapeHtml(sourceMeta.archivo)}</code> → <code>${escapeHtml(sourceMeta.variable)}.warehouses.${escapeHtml(item.key)}</code> (sin modificar)</p>
          <dl class="kv">${main.map((k) => `<dt>${escapeHtml(FIELD_LABELS[k] || k)}</dt><dd>${fmtValue(k, o[k])}</dd>`).join('')}</dl>
          <h3>Precio (interpretado)</h3>
          <dl class="kv">${pricingRows(item)}</dl>
        </section>
        <section>
          <h3>Ubicación</h3>
          <dl class="kv">
            <dt>Dirección original</dt><dd>${orNA(item.direccion)}</dd>
            <dt>Coordenadas</dt><dd>${u ? `${fmtNum(u.lat, 6)}, ${fmtNum(u.lon, 6)}` : orNA(null)}</dd>
            <dt>Fuente</dt><dd>${u ? escapeHtml(FUENTE_UBICACION[u.fuente] || u.fuente) : orNA(null)}</dd>
            <dt>Precisión</dt><dd>${orNA(u?.precision)}</dd>
          </dl>
          ${u ? `<div class="dt-links"><a href="${gmapsPin(u)}" target="_blank" rel="noopener">Google Maps ↗</a><a href="${streetView(u)}" target="_blank" rel="noopener">Street View ↗</a></div>` : ''}
          <h3>Información logística</h3>
          <p class="fc-src">Estructura preparada para análisis. Se completa en <code>backend/storage/logistica.json</code>.</p>
          ${Object.entries(groups)
            .map(([g, fields]) => `<h4>${escapeHtml(g)}</h4><dl class="kv">${fields.map((f) => `<dt>${escapeHtml(f.label)}</dt><dd>${fmtLogistic(f, item.logistica[f.key])}</dd>`).join('')}</dl>`)
            .join('')}
          ${tech.length ? `<details class="fc-tech"><summary>Campos técnicos del esquema del Radar</summary><dl class="kv">${tech.map((k) => `<dt>${escapeHtml(k)}</dt><dd>${fmtValue(k, o[k])}</dd>`).join('')}</dl></details>` : ''}
        </section>
      </div>
    </form>`;
  dialog.showModal();
}
