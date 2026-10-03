import { $, esc } from '../../utils/dom.js';
import { usd, usdCorto, entero, fechaCorta } from '../../utils/format.js';

/**
 * Piezas comunes de las pestañas de Radar: formatos, los filtros compartidos
 * (barra superior) y los gráficos/tablas. Una sola serie por gráfico y un
 * solo eje: FOB por período; el precio por kg va en la tabla, no en un
 * segundo eje.
 */

// Montos y fechas con el formato único de la plataforma (utils/format.js).
export { usd, usdCorto, entero };
export const porKg = n => (n == null ? '—' : 'US$ ' + Number(n).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '/kg');
export const toneladas = n => (n == null ? '—' : Number(n).toLocaleString('es-PE', { maximumFractionDigits: 1 }) + ' t');
export const pct = n => (n == null ? '—' : Number(n).toLocaleString('es-PE', { maximumFractionDigits: 1 }) + '%');
export const delta = n => (n == null ? '<span class="muted">sin comparación</span>'
  : '<span class="' + (n >= 0 ? 'txt-ok' : 'txt-bad') + '">' + (n >= 0 ? '▲ ' : '▼ ') + pct(Math.abs(n)) + '</span>');
export const fecha = f => (f ? fechaCorta(f.slice(0, 10)) : '—');
export const vacio = (titulo, texto = '') => '<div class="empty"><strong>' + esc(titulo) + '</strong>' + esc(texto) + '</div>';
export const tarjeta = (clase, v, k, d) => '<div class="kpi ' + clase + '"><div class="v">' + v + '</div><div class="k">' + esc(k) + '</div><div class="d">' + d + '</div></div>';

/** Los filtros de la barra superior, como los entiende la API. */
export function filtrosComunes() {
  return {
    start: $('riDesde').value, end: $('riHasta').value,
    material: $('riMaterial').value, origin: $('riOrigen').value, scope: $('riAlcance').value
  };
}

/** Tabla simple: cols = [{ t, h(fila), num? }]. `clic(i)` hace la fila clicable. */
export function tabla(filas, cols, { clic = null, vacia = 'Sin datos' } = {}) {
  if (!filas.length) return vacio(vacia);
  return '<div class="table-wrap mp-tabla"><table><thead><tr>' + cols.map(c => '<th' + (c.num ? ' class="num"' : '') + '>' + esc(c.t) + '</th>').join('') + '</tr></thead><tbody>'
    + filas.map((f, i) => '<tr' + (clic ? ' class="mp-fila" onclick="' + clic(i) + '"' : '') + '>'
      + cols.map(c => '<td' + (c.num ? ' class="num"' : '') + '>' + c.h(f) + '</td>').join('') + '</tr>').join('')
    + '</tbody></table></div>';
}

/** Ranking con barra de participación (materiales, países, importadores). */
export function ranking(filas, { nombre = f => f.name || 'Sin dato', clic = null } = {}) {
  if (!filas.length) return vacio('Sin datos');
  const max = Math.max(...filas.map(f => f.fob_usd || 0)) || 1;
  return filas.map((f, i) => '<div class="ri-rank' + (clic ? ' mp-fila' : '') + '"' + (clic ? ' onclick="' + clic(i) + '"' : '') + '>'
    + '<span class="ri-rank-n">' + esc(nombre(f)) + '<small>' + toneladas(f.tonnes) + ' · ' + entero(f.series) + ' series</small></span>'
    + '<b class="mp-track"><i style="width:' + Math.max(1.5, (f.fob_usd || 0) / max * 100).toFixed(1) + '%"></i></b>'
    + '<span class="ri-rank-v">' + usdCorto(f.fob_usd) + '</span></div>').join('');
}

/**
 * Barras de una sola serie (FOB por período), con tooltip por barra. Las
 * barras "parciales" (períodos sin todas sus bases cargadas) van más claras
 * Y lo dicen en el tooltip y en la leyenda: nunca solo por color.
 */
export function barras(puntos, { etiqueta, valor, titulo, parcial = () => false, alto = 190 }) {
  if (!puntos.length) return vacio('Sin datos en el período');
  // Ancho lógico generoso: el SVG llena el panel en escritorio; en celular el
  // contenedor se desplaza en horizontal en vez de encoger el texto.
  const W = Math.max(720, puntos.length * 48), H = alto, pb = 34, pt = 22;
  const max = Math.max(...puntos.map(p => valor(p) || 0)) || 1;
  const ancho = W / puntos.length, barra = Math.min(ancho - 6, 28);
  const ultimo = puntos.length - 1;
  const iMax = puntos.findIndex(p => (valor(p) || 0) === max);
  let g = '<line x1="0" x2="' + W + '" y1="' + (H - pb) + '" y2="' + (H - pb) + '" stroke="var(--chart-grid)" stroke-width="1"/>';
  puntos.forEach((p, i) => {
    const v = valor(p) || 0;
    const h = Math.max(v ? 3 : 0, v / max * (H - pb - pt));
    const cx = i * ancho + ancho / 2, y = H - pb - h;
    g += '<g><rect x="' + (cx - ancho / 2) + '" y="0" width="' + ancho + '" height="' + H + '" fill="transparent"><title>' + esc(titulo(p)) + '</title></rect>'
      + '<rect x="' + (cx - barra / 2).toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + barra + '" height="' + h.toFixed(1) + '" rx="4" fill="var(--chart-1)" opacity="'
      + (parcial(p) ? .4 : .9) + '" pointer-events="none"/>'
      + ((i === iMax || i === ultimo) && v ? '<text x="' + cx.toFixed(1) + '" y="' + (y - 6).toFixed(1) + '" text-anchor="middle" font-size="10.5" font-weight="700" fill="var(--chart-value)">' + esc(usdCorto(v).replace('US$ ', '')) + '</text>' : '')
      + (puntos.length <= 16 || i % Math.ceil(puntos.length / 12) === 0
        ? '<text x="' + cx.toFixed(1) + '" y="' + (H - 14) + '" text-anchor="middle" font-size="10" fill="var(--chart-label)">' + esc(etiqueta(p)) + '</text>' : '')
      + '</g>';
  });
  return '<div class="ri-grafico"><svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="FOB por período" style="max-height:' + Math.round(H * 1.6) + 'px">' + g + '</svg></div>';
}
