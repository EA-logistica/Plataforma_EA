import { esc } from '../utils/dom.js';

/**
 * Gráficos de la plataforma en SVG/HTML plano, sin librerías. Reglas que
 * siguen todos (las mismas de Radar):
 *   - una serie y un solo eje por gráfico; dos medidas distintas van en dos
 *     gráficos, nunca en un eje doble;
 *   - marcas finas, extremos redondeados de 4px anclados a la base, grilla
 *     discreta; el texto va en tinta (nunca del color de la serie);
 *   - etiquetas directas solo en lo que importa (el máximo y el último), el
 *     resto en el tooltip;
 *   - cada marca tiene tooltip (data-tip) y, si se pasa `clic`, lleva al
 *     detalle: el gráfico filtra la tabla de abajo.
 *
 * El tooltip es uno solo para toda la página (iniciarTooltips): cualquier
 * elemento con data-tip lo muestra al pasar el mouse o al enfocarlo con el
 * teclado. El texto de data-tip admite saltos de línea; la primera línea va
 * en negrita.
 */

const attrTip = t => ' data-tip="' + esc(t) + '"';
const vacio = (texto = 'Sin datos') => '<div class="empty" style="padding:22px 0"><strong>' + esc(texto) + '</strong></div>';

/**
 * Columnas verticales (una serie). `tenue(p)` aclara una columna Y lo dice
 * en su tooltip (p. ej. meses futuros = "programado"); `clic(p, i)` devuelve
 * el código del onclick.
 */
export function columnas(puntos, { etiqueta, valor, tip, clic = null, tenue = () => false, corto = v => String(v), alto = 200, aria = 'Gráfico de columnas' }) {
  if (!puntos.length || !puntos.some(p => valor(p))) return vacio('Sin datos en el período');
  const W = Math.max(640, puntos.length * 52), H = alto, pb = 30, pt = 22;
  const max = Math.max(...puntos.map(p => valor(p) || 0)) || 1;
  const ancho = W / puntos.length, barra = Math.min(ancho - 10, 30);
  const iMax = puntos.findIndex(p => (valor(p) || 0) === max);
  let iUlt = -1;
  puntos.forEach((p, i) => { if (valor(p) && !tenue(p)) iUlt = i; });
  let g = '';
  for (let k = 1; k <= 3; k++) {
    const y = (H - pb - (H - pb - pt) * k / 3).toFixed(1);
    g += '<line x1="0" x2="' + W + '" y1="' + y + '" y2="' + y + '" stroke="var(--chart-grid)" stroke-width="1" stroke-dasharray="2 4" opacity=".7"/>';
  }
  g += '<line x1="0" x2="' + W + '" y1="' + (H - pb) + '" y2="' + (H - pb) + '" stroke="var(--chart-grid)" stroke-width="1"/>';
  puntos.forEach((p, i) => {
    const v = valor(p) || 0;
    const h = Math.max(v ? 3 : 0, v / max * (H - pb - pt));
    const cx = i * ancho + ancho / 2, y = H - pb - h, r = Math.min(4, barra / 2, h / 2);
    const x0 = cx - barra / 2;
    // Barra con las esquinas de arriba redondeadas y la base recta (anclada al eje).
    const d = h ? 'M' + x0.toFixed(1) + ',' + (H - pb) + 'V' + (y + r).toFixed(1) + 'Q' + x0.toFixed(1) + ',' + y.toFixed(1) + ' ' + (x0 + r).toFixed(1) + ',' + y.toFixed(1)
      + 'H' + (x0 + barra - r).toFixed(1) + 'Q' + (x0 + barra).toFixed(1) + ',' + y.toFixed(1) + ' ' + (x0 + barra).toFixed(1) + ',' + (y + r).toFixed(1) + 'V' + (H - pb) + 'Z' : '';
    g += '<g class="g-marca' + (clic ? ' g-clic' : '') + '"' + attrTip(tip(p)) + (clic ? ' onclick="' + clic(p, i) + '" tabindex="0" role="button"' : ' tabindex="0"') + '>'
      + '<rect x="' + (cx - ancho / 2).toFixed(1) + '" y="0" width="' + ancho.toFixed(1) + '" height="' + H + '" fill="transparent"/>'
      + (d ? '<path d="' + d + '" fill="var(--chart-1)" opacity="' + (tenue(p) ? .38 : .92) + '"' + (tenue(p) ? ' stroke="var(--chart-1)" stroke-dasharray="3 3" stroke-width="1"' : '') + '/>' : '')
      + ((i === iMax || i === iUlt) && v ? '<text x="' + cx.toFixed(1) + '" y="' + (y - 7).toFixed(1) + '" text-anchor="middle" class="g-valor">' + esc(corto(v)) + '</text>' : '')
      + '<text x="' + cx.toFixed(1) + '" y="' + (H - 10) + '" text-anchor="middle" class="g-eje">' + esc(etiqueta(p)) + '</text>'
      + '</g>';
  });
  return '<div class="g-cont"><svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="' + esc(aria) + '" style="max-height:' + Math.round(H * 1.5) + 'px">' + g + '</svg></div>';
}

/**
 * Ranking horizontal: nombre, barra de participación y valor. `clic(item,i)`
 * hace la fila clicable (filtra la tabla). `tono(item)` = 'bad' | 'warn' |
 * 'ok' para pintar con un color de estado (siempre acompañado del texto).
 */
export function ranking(items, { nombre = x => x.k, valor = x => x.valor, texto = x => String(valor(x)), detalle = () => '', tip = null, clic = null, tono = () => '' } = {}) {
  if (!items.length) return vacio();
  const max = Math.max(...items.map(valor)) || 1;
  return '<div class="g-ranking">' + items.map((x, i) =>
    '<div class="g-rank' + (clic ? ' g-clic' : '') + '"' + (tip ? attrTip(tip(x)) : '') + (clic ? ' onclick="' + clic(x, i) + '" tabindex="0" role="button"' : '') + '>'
    + '<span class="g-rank-n">' + esc(nombre(x)) + (detalle(x) ? '<small>' + esc(detalle(x)) + '</small>' : '') + '</span>'
    + '<b class="g-rank-barra"><i class="' + tono(x) + '" style="width:' + Math.max(1.5, valor(x) / max * 100).toFixed(1) + '%"></i></b>'
    + '<span class="g-rank-v">' + esc(texto(x)) + '</span></div>').join('') + '</div>';
}

/**
 * Barra 100% apilada (participación de un total), con 2px de separación
 * entre segmentos y la leyenda debajo con el nombre y el valor de cada uno:
 * la identidad nunca depende solo del color. `segmentos`: [{ t, v, clase,
 * texto, tip?, clic? }]; `clase` es el color (s1, s2, s3… o ok/warn/bad).
 */
export function apilada(segmentos, { alto = 14 } = {}) {
  const total = segmentos.reduce((a, s) => a + (s.v || 0), 0);
  if (!total) return vacio();
  return '<div class="g-apilada" style="height:' + alto + 'px">' + segmentos.filter(s => s.v > 0).map(s =>
    '<i class="' + (s.clase || 's1') + (s.clic ? ' g-clic' : '') + '" style="flex:' + s.v + '"' + attrTip(s.tip || (s.t + '\n' + s.texto))
    + (s.clic ? ' onclick="' + s.clic + '" role="button" tabindex="0"' : '') + '></i>').join('') + '</div>'
    + '<div class="g-leyenda">' + segmentos.map(s => '<span' + (s.clic ? ' class="g-clic" onclick="' + s.clic + '"' : '') + '><i class="' + (s.clase || 's1') + '"></i>' + esc(s.t)
      + ' <b>' + esc(s.texto) + '</b></span>').join('') + '</div>';
}

/** Mini tendencia para las tarjetas: línea de 2px y el último punto marcado. */
export function sparkline(valores, { ancho = 112, alto = 30, aria = 'Tendencia' } = {}) {
  const v = valores.map(x => Number(x) || 0);
  if (v.length < 2 || !v.some(Boolean)) return '';
  const min = Math.min(...v), max = Math.max(...v), rango = max - min || 1;
  const px = i => (2 + i * (ancho - 6) / (v.length - 1)).toFixed(1);
  const py = x => (alto - 3 - (x - min) / rango * (alto - 6)).toFixed(1);
  const pts = v.map((x, i) => px(i) + ',' + py(x)).join(' ');
  return '<svg class="g-spark" viewBox="0 0 ' + ancho + ' ' + alto + '" width="' + ancho + '" height="' + alto + '" role="img" aria-label="' + esc(aria) + '">'
    + '<polyline points="' + pts + '" fill="none" stroke="var(--chart-1)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>'
    + '<circle cx="' + px(v.length - 1) + '" cy="' + py(v[v.length - 1]) + '" r="3" fill="var(--chart-1)" stroke="var(--surface)" stroke-width="2"/></svg>';
}

/**
 * Curva acumulada (Pareto): x = % de códigos, y = % del valor. Las bandas de
 * fondo marcan las clases y se rotulan; cada punto tiene tooltip.
 */
export function pareto(puntos, { bandas = [], tip, alto = 220, aria = 'Curva de Pareto' }) {
  if (!puntos.length) return vacio();
  const W = 640, H = alto, pl = 38, pb = 26, pt = 12, pr = 10;
  const x = f => pl + f * (W - pl - pr), y = f => H - pb - f * (H - pb - pt);
  let g = '';
  let desde = 0;
  bandas.forEach(b => {
    g += '<rect x="' + x(desde).toFixed(1) + '" y="' + pt + '" width="' + Math.max(0, x(b.hasta) - x(desde)).toFixed(1) + '" height="' + (H - pb - pt) + '" class="' + b.clase + '" opacity=".14"/>'
      + '<text x="' + ((x(desde) + x(b.hasta)) / 2).toFixed(1) + '" y="' + (pt + 14) + '" text-anchor="middle" class="g-valor">' + esc(b.t) + '</text>';
    desde = b.hasta;
  });
  // Líneas en 50/80/95/100%; el rótulo de 95% se omite: queda pegado al de 100%.
  [0, .5, .8, .95, 1].forEach(f => {
    g += '<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + y(f).toFixed(1) + '" y2="' + y(f).toFixed(1) + '" stroke="var(--chart-grid)" stroke-width="1"' + (f ? ' stroke-dasharray="2 4"' : '') + '/>'
      + (f === .95 ? '' : '<text x="' + (pl - 6) + '" y="' + (y(f) + 3.5).toFixed(1) + '" text-anchor="end" class="g-eje">' + Math.round(f * 100) + '%</text>');
  });
  [0, .25, .5, .75, 1].forEach(f => {
    g += '<text x="' + x(f).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle" class="g-eje">' + Math.round(f * 100) + '%</text>';
  });
  const pts = [[0, 0], ...puntos.map(p => [p.pctCodigos, p.acumulado])];
  g += '<polyline points="' + pts.map(([a, b]) => x(a).toFixed(1) + ',' + y(b).toFixed(1)).join(' ') + '" fill="none" stroke="var(--chart-1)" stroke-width="2" stroke-linejoin="round"/>';
  const anchoHit = (W - pl - pr) / Math.max(1, puntos.length);
  puntos.forEach(p => {
    g += '<g class="g-marca"' + attrTip(tip(p)) + ' tabindex="0"><rect x="' + (x(p.pctCodigos) - anchoHit / 2).toFixed(1) + '" y="' + pt + '" width="' + anchoHit.toFixed(1) + '" height="' + (H - pb - pt) + '" fill="transparent"/>'
      + '<circle cx="' + x(p.pctCodigos).toFixed(1) + '" cy="' + y(p.acumulado).toFixed(1) + '" r="4" class="g-punto"/></g>';
  });
  return '<div class="g-cont"><svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="' + esc(aria) + '" style="max-height:' + Math.round(H * 1.4) + 'px">' + g + '</svg></div>';
}

// ------------------------------------------------------------------ tooltip
let globo = null;
function mostrar(el, x, y) {
  if (!globo) {
    globo = document.createElement('div');
    globo.className = 'g-tooltip';
    globo.setAttribute('role', 'tooltip');
    document.body.appendChild(globo);
  }
  const lineas = String(el.getAttribute('data-tip') || '').split('\n');
  globo.innerHTML = '<b>' + esc(lineas[0]) + '</b>' + lineas.slice(1).map(l => '<span>' + esc(l) + '</span>').join('');
  globo.classList.add('on');
  const r = globo.getBoundingClientRect();
  const left = Math.min(window.innerWidth - r.width - 8, Math.max(8, x + 14));
  const top = y + 16 + r.height > window.innerHeight ? y - r.height - 12 : y + 16;
  globo.style.left = left + 'px';
  globo.style.top = Math.max(8, top) + 'px';
}
const ocultar = () => globo && globo.classList.remove('on');

/** Un solo listener para toda la página: vale también para lo que se pinte después. */
export function iniciarTooltips() {
  if (typeof document === 'undefined' || !document.addEventListener) return;
  document.addEventListener('mousemove', e => {
    const el = e.target && e.target.closest ? e.target.closest('[data-tip]') : null;
    if (el) mostrar(el, e.clientX, e.clientY); else ocultar();
  });
  document.addEventListener('focusin', e => {
    const el = e.target && e.target.closest ? e.target.closest('[data-tip]') : null;
    if (!el) return ocultar();
    const r = el.getBoundingClientRect();
    mostrar(el, r.left + r.width / 2, r.top + r.height / 2);
  });
  document.addEventListener('focusout', ocultar);
  document.addEventListener('scroll', ocultar, true);
  // Enter/Espacio sobre una marca clicable = clic, como un botón.
  document.addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target && e.target.classList && e.target.classList.contains('g-clic')) {
      e.preventDefault();
      e.target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }
  });
}
