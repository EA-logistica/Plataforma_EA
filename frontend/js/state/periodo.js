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
  { k: 'mes', t: 'Este mes' },
  { k: 'trimestre', t: 'Últimos 3 meses' },
  { k: 'anio', t: 'Este año' },
  { k: '12m', t: 'Últimos 12 meses' },
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

export function setPeriodo(k) { estado.k = k; if (k !== 'rango') cerrarPeriodo(); guardar(); }
export function setRangoPeriodo() { estado.k = 'rango'; estado.desde = $('perDesde').value; estado.hasta = $('perHasta').value; guardar(); }
export function setCompararPeriodo(v) { estado.comparar = Boolean(v); guardar(); }

export function alternarPeriodo() {
  const p = $('periodoPopover');
  const abrir = !p.classList.contains('on');
  p.classList.toggle('on', abrir);
  $('btnPeriodo').setAttribute('aria-expanded', String(abrir));
  if (abrir) pintar();
}
export function cerrarPeriodo() {
  $('periodoPopover').classList.remove('on');
  $('btnPeriodo').setAttribute('aria-expanded', 'false');
}

export function pintar() {
  const r = rango();
  $('periodoTexto').textContent = r.etiqueta;
  $('periodoDetalle').textContent = fechaCorta(r.desde) + ' → ' + fechaCorta(r.hasta) + (r.comparar ? ' · vs. año anterior' : '');
  $('periodoOpciones').innerHTML = OPCIONES.map(o => '<button class="fchip' + (o.k === estado.k ? ' on' : '') + '" onclick="setPeriodo(\'' + o.k + '\')">' + esc(o.t) + '</button>').join('');
  $('perDesde').value = r.desde;
  $('perHasta').value = r.hasta;
  $('perComparar').checked = estado.comparar;
}
