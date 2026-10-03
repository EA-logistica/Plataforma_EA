import { $, esc } from '../utils/dom.js';
import { sesion } from '../state/sessionState.js';
import { fechaHora } from '../utils/format.js';
import { toast } from '../utils/toast.js';

/**
 * Tablas de nivel empresarial en TODA la vista de logística, sin tocar cada
 * vista: un observador mira #viewAdmin y a cada `.table-wrap` que aparece le
 * agrega una barra con
 *   - Columnas: mostrar u ocultar columnas (se recuerda por tabla, en este
 *     navegador);
 *   - Excel: un .xlsx de verdad (lo arma el servidor, con encabezados,
 *     filtros y números como números);
 *   - PDF: una versión imprimible para "Guardar como PDF".
 * El encabezado fijo y las cifras alineadas son CSS (styles.css, .table-wrap).
 *
 * Por defecto se exporta lo que se ve. Una vista con paginación puede
 * declarar `data-exportar="nombreFuncion"` en su .table-wrap: esa función
 * global devuelve { titulo, columnas: [{ t, num }], filas: [[...]] } con
 * TODO lo filtrado, no solo la página visible.
 */

const CLAVE = 'plansa_cols_';
const numero = t => {
  const limpio = String(t).replace(/US\$|S\/|%|\s|d$|kg$|m$/gi, '').replace(/,/g, '');
  return /^-?\d+(\.\d+)?$/.test(limpio) ? Number(limpio) : null;
};

function leerOcultas(clave) {
  try { return new Set(JSON.parse(localStorage.getItem(CLAVE + clave) || '[]')); } catch (_) { return new Set(); }
}
function guardarOcultas(clave, set) {
  try { localStorage.setItem(CLAVE + clave, JSON.stringify([...set])); } catch (_) { /* sin almacenamiento: dura hasta recargar */ }
}

const encabezados = tabla => [...tabla.querySelectorAll('thead tr:last-child th')].map(th => th.textContent.trim());
/** La tabla se reconoce por sus columnas y la sección donde vive: así cada una recuerda lo suyo. */
function claveDe(wrap, tabla) {
  const seccion = wrap.closest('section.view');
  return (seccion ? seccion.id : '') + '|' + encabezados(tabla).join('|').slice(0, 300);
}

function aplicarOcultas(wrap) {
  const tabla = wrap.querySelector('table');
  if (!tabla) return;
  const ocultas = leerOcultas(claveDe(wrap, tabla));
  tabla.querySelectorAll('tr').forEach(tr => {
    // Solo filas "normales": una fila con colspan (vacía, de grupo) se deja igual.
    if ([...tr.children].some(c => c.colSpan > 1)) return;
    [...tr.children].forEach((c, i) => { c.classList.toggle('col-oculta', ocultas.has(i)); });
  });
  const boton = wrap.previousElementSibling && wrap.previousElementSibling.querySelector('.tb-cols');
  if (boton) boton.textContent = ocultas.size ? 'Columnas (' + ocultas.size + ' ocultas)' : 'Columnas';
}

function titulo(wrap) {
  const seccion = wrap.closest('section.view');
  const h2 = seccion && seccion.querySelector('h2');
  const panel = wrap.closest('.panel');
  const h3 = panel && panel.querySelector('h3');
  return [h2 && h2.textContent.trim(), h3 && h3.textContent.trim()].filter(Boolean).join(' · ') || 'Tabla';
}

/** Lo visible de la tabla como { columnas, filas }: sin columnas ocultas ni la de acciones. */
function datosVisibles(wrap) {
  const tabla = wrap.querySelector('table');
  const ths = [...tabla.querySelectorAll('thead tr:last-child th')];
  const usar = ths.map((th, i) => !th.classList.contains('col-oculta') && th.textContent.trim() !== '' && !/^acciones?$/i.test(th.textContent.trim()) ? i : -1).filter(i => i >= 0);
  const filas = [...tabla.querySelectorAll('tbody tr')].filter(tr => ![...tr.children].some(c => c.colSpan > 1))
    .map(tr => usar.map(i => (tr.children[i] ? tr.children[i].innerText || tr.children[i].textContent : '').replace(/\s+/g, ' ').trim()));
  const columnas = usar.map(i => {
    const num = ths[i].classList.contains('num') || (filas.length > 0 && filas.every(f => f[usar.indexOf(i)] === '' || f[usar.indexOf(i)] === '—' || numero(f[usar.indexOf(i)]) !== null));
    return { t: ths[i].textContent.trim(), num };
  });
  return {
    titulo: titulo(wrap), columnas,
    filas: filas.map(f => f.map((v, k) => (columnas[k].num ? (numero(v) ?? '') : v)))
  };
}

function datosDe(wrap) {
  const fn = wrap.dataset.exportar && window[wrap.dataset.exportar];
  return typeof fn === 'function' ? fn() : datosVisibles(wrap);
}

/** POST que devuelve un archivo: el cliente JSON no sirve, se pide crudo. */
async function descargarExcel(datos) {
  const init = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(datos) };
  if (sesion && sesion.token) init.headers.Authorization = 'Bearer ' + sesion.token;
  const res = await fetch('/api/exportar/xlsx', init);
  if (!res.ok) {
    let msg = 'Error ' + res.status + ' al exportar.';
    try { const d = await res.json(); if (d.error) msg = d.error; } catch (_) { /* sin JSON */ }
    throw new Error(msg);
  }
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url; a.download = datos.titulo.replace(/[\\/:*?"<>|]/g, '-') + '.xlsx';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export async function exportarExcel(boton) {
  const wrap = boton.closest('.tabla-barra').nextElementSibling;
  boton.classList.add('is-loading');
  try {
    const datos = await datosDe(wrap);
    if (!datos.filas.length) return toast('No hay filas para exportar', 'Cambia los filtros e inténtalo de nuevo.', 'warn');
    await descargarExcel(datos);
  } catch (e) {
    toast('No se pudo exportar', e.message, 'bad');
  } finally {
    boton.classList.remove('is-loading');
  }
}

/** HTML imprimible con estilos propios: se ve igual en tema claro u oscuro. */
export function imprimir({ titulo: t, columnas, filas, subtitulo = '' }) {
  const v = window.open('', '_blank');
  if (!v) return toast('El navegador bloqueó la ventana', 'Permite las ventanas emergentes de esta página para exportar a PDF.', 'warn');
  const fmt = (c, x) => (c.num && typeof x === 'number' ? x.toLocaleString('es-PE', { maximumFractionDigits: 2 }) : esc(x));
  v.document.write('<!doctype html><html lang="es"><head><meta charset="utf-8"><title>' + esc(t) + '</title><style>'
    + 'body{font:12px/1.4 "Segoe UI",Arial,sans-serif;color:#1D1D1F;margin:24px}'
    + 'h1{font-size:18px;margin:0 0 2px}p{color:#565E6C;margin:0 0 14px}'
    + 'table{width:100%;border-collapse:collapse}th{background:#1B4E8E;color:#fff;text-align:left;padding:6px 8px;font-size:11px}'
    + 'td{padding:5px 8px;border-bottom:1px solid #DFE4EC;vertical-align:top}tr:nth-child(even) td{background:#F7F9FC}'
    + '.n{text-align:right;font-family:Consolas,monospace;white-space:nowrap}thead{display:table-header-group}'
    + '@page{size:landscape;margin:12mm}</style></head><body>'
    + '<h1>' + esc(t) + '</h1><p>Plásticos Nacionales · Logística · ' + esc(fechaHora(new Date().toISOString())) + (subtitulo ? ' · ' + esc(subtitulo) : '') + ' · ' + filas.length + ' filas</p>'
    + '<table><thead><tr>' + columnas.map(c => '<th' + (c.num ? ' class="n"' : '') + '>' + esc(c.t) + '</th>').join('') + '</tr></thead><tbody>'
    + filas.map(f => '<tr>' + columnas.map((c, i) => '<td' + (c.num ? ' class="n"' : '') + '>' + fmt(c, f[i]) + '</td>').join('') + '</tr>').join('')
    + '</tbody></table><script>window.onload=()=>setTimeout(()=>window.print(),150)<\/script></body></html>');
  v.document.close();
}

export async function exportarPdf(boton) {
  const wrap = boton.closest('.tabla-barra').nextElementSibling;
  try {
    const datos = await datosDe(wrap);
    if (!datos.filas.length) return toast('No hay filas para exportar', 'Cambia los filtros e inténtalo de nuevo.', 'warn');
    imprimir(datos);
  } catch (e) { toast('No se pudo exportar', e.message, 'bad'); }
}

/** Menú de columnas: una casilla por columna; desmarcar la oculta. */
export function menuColumnas(boton) {
  const barra = boton.closest('.tabla-barra');
  const wrap = barra.nextElementSibling;
  const tabla = wrap.querySelector('table');
  let menu = barra.querySelector('.tb-menu');
  if (menu) { menu.remove(); return; }
  const clave = claveDe(wrap, tabla);
  const ocultas = leerOcultas(clave);
  menu = document.createElement('div');
  menu.className = 'tb-menu';
  menu.innerHTML = '<div class="tb-menu-t">Columnas visibles</div>' + encabezados(tabla).map((t, i) => t
    ? '<label><input type="checkbox" data-i="' + i + '"' + (ocultas.has(i) ? '' : ' checked') + '> ' + esc(t) + '</label>' : '').join('')
    + '<button class="btn btn-sm btn-ghost" data-todas="1">Mostrar todas</button>';
  menu.addEventListener('change', e => {
    const i = Number(e.target.dataset.i);
    const set = leerOcultas(clave);
    if (e.target.checked) set.delete(i); else set.add(i);
    guardarOcultas(clave, set);
    aplicarOcultas(wrap);
  });
  menu.addEventListener('click', e => {
    if (!e.target.dataset.todas) return;
    guardarOcultas(clave, new Set());
    menu.querySelectorAll('input').forEach(x => { x.checked = true; });
    aplicarOcultas(wrap);
  });
  barra.appendChild(menu);
}

function barraPara(wrap) {
  const previa = wrap.previousElementSibling;
  if (previa && previa.classList.contains('tabla-barra')) return previa;
  const barra = document.createElement('div');
  barra.className = 'tabla-barra';
  barra.innerHTML = '<button class="btn btn-sm btn-ghost tb-cols" onclick="menuColumnasTabla(this)" title="Mostrar u ocultar columnas">Columnas</button>'
    + '<button class="btn btn-sm btn-ghost" onclick="exportarExcelTabla(this)" title="Descargar en Excel (.xlsx)">Excel</button>'
    + '<button class="btn btn-sm btn-ghost" onclick="exportarPdfTabla(this)" title="Versión para imprimir o guardar como PDF">PDF</button>';
  wrap.parentNode.insertBefore(barra, wrap);
  return barra;
}

function revisar() {
  document.querySelectorAll('#viewAdmin .table-wrap').forEach(wrap => {
    const tabla = wrap.querySelector('table');
    const previa = wrap.previousElementSibling;
    const tieneBarra = previa && previa.classList.contains('tabla-barra');
    if (!tabla || wrap.dataset.sinBarra !== undefined) { if (tieneBarra) previa.hidden = true; return; }
    barraPara(wrap).hidden = false;
    aplicarOcultas(wrap);
  });
}

export function iniciarTablas() {
  if (typeof MutationObserver === 'undefined' || !$('viewAdmin')) return;
  let pendiente = false;
  const obs = new MutationObserver(muts => {
    // Los cambios que hace la propia barra (menú, clases col-oculta) no cuentan.
    if (muts.every(m => m.target.closest && (m.target.closest('.tabla-barra') || m.type === 'attributes'))) return;
    if (pendiente) return;
    pendiente = true;
    requestAnimationFrame(() => { pendiente = false; revisar(); });
  });
  obs.observe($('viewAdmin'), { childList: true, subtree: true });
  document.addEventListener('click', e => {
    document.querySelectorAll('.tb-menu').forEach(m => { if (!m.parentNode.contains(e.target)) m.remove(); });
  });
  revisar();
}

// Las vistas que exportan todo lo filtrado (no solo la página) usan esto.
export { descargarExcel };
