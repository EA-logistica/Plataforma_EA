import { $, esc } from '../utils/dom.js';
import { fechaCorta, hoyISO } from '../utils/format.js';

/**
 * Período global de la vista de logística (barra superior): este mes,
 * trimestre, año, últimos 12 meses o un rango a mano, con la opción de
 * comparar contra el mismo período del año anterior.
 *
 * Lo usan las vistas que hablan de "cuánto pasó en un lapso" (Dashboard,
 * Importaciones); las que muestran una foto (stock, ABC) no dependen de él.
 * Quien quiera enterarse de un cambio se suscribe con alCambiarPeriodo().
 * Se recuerda en este navegador.
 */

const CLAVE = 'plansa_periodo';
export const OPCIONES = [
  { k: 'mes', t: 'Este mes', corto: 'Mes' },
  { k: 'trimestre', t: 'Últimos 3 meses', corto: '3 meses' },
  { k: 'anio', t: 'Este año', corto: 'Año' },
  { k: '12m', t: 'Últimos 12 meses', corto: '12 meses' },
  { k: 'rango', t: 'Personalizado' }
];

let estado = { k: 'mes', desde: '', hasta: '', comparar: false };
try { estado = { ...estado, ...JSON.parse(localStorage.getItem(CLAVE) || '{}') }; } catch (_) { /* sin almacenamiento */ }

const suscriptores = [];
export const alCambiarPeriodo = fn => suscriptores.push(fn);

const iso = d => d.toISOString().slice(0, 10);
const menosMeses = (f, n) => { const d = new Date(f + 'T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() - n); return iso(d); };
const menosDias = (f, n) => iso(new Date(Date.parse(f + 'T00:00:00Z') - n * 86400000));

/**
 * { desde, hasta, etiqueta, previo: { desde, hasta, etiqueta } } en
 * 'YYYY-MM-DD', ambos inclusive. `previo` es el mismo lapso del año anterior
 * si se pidió comparar así; si no, el lapso inmediatamente anterior de igual
 * largo (para las flechas de variación).
 */
export function rango(hoy = hoyISO()) {
  let desde, hasta = hoy;
  if (estado.k === 'mes') desde = hoy.slice(0, 8) + '01';
  else if (estado.k === 'trimestre') desde = menosDias(menosMeses(hoy, 3), -1);
  else if (estado.k === 'anio') desde = hoy.slice(0, 4) + '-01-01';
  else if (estado.k === '12m') desde = menosDias(menosMeses(hoy, 12), -1);
  else { desde = estado.desde || hoy.slice(0, 8) + '01'; hasta = estado.hasta || hoy; }
  if (desde > hasta) [desde, hasta] = [hasta, desde];
  const largo = Math.round((Date.parse(hasta) - Date.parse(desde)) / 86400000);
  const previo = estado.comparar
    ? { desde: menosMeses(desde, 12), hasta: menosMeses(hasta, 12), etiqueta: 'mismo período del año anterior' }
    : { desde: menosDias(desde, largo + 1), hasta: menosDias(desde, 1), etiqueta: 'período anterior' };
  const op = OPCIONES.find(o => o.k === estado.k);
  return { desde, hasta, etiqueta: estado.k === 'rango' ? fechaCorta(desde) + ' a ' + fechaCorta(hasta) : op.t, previo, comparar: estado.comparar };
}

export const enRango = (f, r) => Boolean(f) && f.slice(0, 10) >= r.desde && f.slice(0, 10) <= r.hasta;

function guardar() {
  try { localStorage.setItem(CLAVE, JSON.stringify(estado)); } catch (_) { /* dura hasta recargar */ }
  pintar();
  suscriptores.forEach(fn => { try { fn(rango()); } catch (e) { console.error(e); } });
}

export function setPeriodo(k) {
  estado.k = k;
  seleccion = null;
  if (k !== 'rango') { cerrarPeriodo(); mesVisto = null; }
  guardar();
}
export function setCompararPeriodo(v) { estado.comparar = Boolean(v); guardar(); }

// ------------------------------------------------------------ calendario
// Como el de iOS: un mes a la vez, flechas para moverse, primer toque = desde,
// segundo toque = hasta (y se aplica). Entre los dos, el día "desde" queda
// marcado y el resto espera el segundo toque.
const DIAS_SEMANA = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
const NOMBRE_MES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
let mesVisto = null;    // 'YYYY-MM' del mes que se muestra
let seleccion = null;   // 'YYYY-MM-DD' del primer toque, mientras falta el segundo

export function perMes(delta) {
  const [a, m] = (mesVisto || rango().hasta.slice(0, 7)).split('-').map(Number);
  const d = new Date(Date.UTC(a, m - 1 + delta, 1));
  mesVisto = d.toISOString().slice(0, 7);
  pintarCalendario();
}

export function perDia(f) {
  if (!seleccion) { seleccion = f; pintarCalendario(); return; }
  const [desde, hasta] = seleccion <= f ? [seleccion, f] : [f, seleccion];
  seleccion = null;
  Object.assign(estado, { k: 'rango', desde, hasta });
  guardar();
}

function pintarCalendario() {
  const r = rango(), hoy = hoyISO();
  const ym = mesVisto || r.hasta.slice(0, 7);
  const [a, m] = ym.split('-').map(Number);
  const primero = new Date(Date.UTC(a, m - 1, 1));
  const diasMes = new Date(Date.UTC(a, m, 0)).getUTCDate();
  const hueco = (primero.getUTCDay() + 6) % 7; // lunes primero
  const desde = seleccion || r.desde, hasta = seleccion ? '' : r.hasta;
  let celdas = '';
  for (let i = 0; i < hueco; i++) celdas += '<span></span>';
  for (let d = 1; d <= diasMes; d++) {
    const f = ym + '-' + String(d).padStart(2, '0');
    const enRangoSel = hasta && f > desde && f < hasta;
    const cls = [
      f === desde ? 'ini' : '', f === hasta ? 'fin' : '', enRangoSel ? 'dentro' : '',
      f === hoy ? 'hoy' : '', f > hoy ? 'futuro' : '',
      hasta && desde !== hasta && f === desde ? 'con-fin' : '', hasta && desde !== hasta && f === hasta ? 'con-ini' : ''
    ].filter(Boolean).join(' ');
    celdas += '<button class="' + cls + '" onclick="perDia(\'' + f + '\')" aria-label="' + esc(fechaCorta(f)) + '"' + (f === desde || f === hasta ? ' aria-pressed="true"' : '') + '>' + d + '</button>';
  }
  $('periodoCal').innerHTML = '<div class="cal-cab"><b>' + NOMBRE_MES[m - 1] + ' ' + a + '</b>'
    + '<span><button onclick="perMes(-1)" aria-label="Mes anterior">‹</button><button onclick="perMes(1)" aria-label="Mes siguiente">›</button></span></div>'
    + '<div class="cal-sem">' + DIAS_SEMANA.map(x => '<span>' + x + '</span>').join('') + '</div>'
    + '<div class="cal-dias">' + celdas + '</div>'
    + '<div class="cal-pie">' + (seleccion ? 'Elige el día final' : '<span>' + esc(fechaCorta(r.desde)) + '</span> → <span>' + esc(fechaCorta(r.hasta)) + '</span>') + '</div>';
}

/** Queda dentro de la ventana aunque el botón esté cerca de un borde. */
function ubicar() {
  const p = $('periodoPopover'), b = $('btnPeriodo');
  if (!p.getBoundingClientRect || !b.getBoundingClientRect) return;
  const rb = b.getBoundingClientRect(), ancho = p.offsetWidth || 300;
  const izquierda = Math.max(12, Math.min(rb.right - ancho, window.innerWidth - ancho - 12));
  p.style.left = izquierda + 'px';
  p.style.top = (rb.bottom + 8) + 'px';
}

export function alternarPeriodo() {
  const p = $('periodoPopover');
  const abrir = !p.classList.contains('on');
  p.classList.toggle('on', abrir);
  $('btnPeriodo').setAttribute('aria-expanded', String(abrir));
  if (abrir) { seleccion = null; mesVisto = null; pintar(); ubicar(); }
}
export function cerrarPeriodo() {
  seleccion = null;
  $('periodoPopover').classList.remove('on');
  $('btnPeriodo').setAttribute('aria-expanded', 'false');
}

export function pintar() {
  const r = rango();
  $('periodoTexto').textContent = r.etiqueta;
  $('periodoDetalle').textContent = fechaCorta(r.desde) + ' → ' + fechaCorta(r.hasta) + (r.comparar ? ' · vs. año anterior' : '');
  $('periodoOpciones').innerHTML = OPCIONES.filter(o => o.k !== 'rango').map(o => '<button class="' + (o.k === estado.k ? 'on' : '') + '" onclick="setPeriodo(\'' + o.k + '\')">' + esc(o.corto || o.t) + '</button>').join('');
  $('perComparar').checked = estado.comparar;
  pintarCalendario();
}
