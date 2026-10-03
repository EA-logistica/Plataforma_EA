import { $, esc } from '../utils/dom.js';
import { fechaCorta, entero } from '../utils/format.js';
import * as api from '../api/estado.js';
import { DB } from '../api/estado.js';
import { sesion } from '../state/sessionState.js';
import { impPreparar } from '../views/importaciones.js';
import { ETIQUETA_ESTADO } from '#shared/importaciones.js';

/**
 * Buscador global: Ctrl+K (o ⌘K) desde cualquier pantalla de logística. Una
 * sola caja para encontrar una importación, una OC del ERP, un producto, un
 * proveedor o un ticket de mensajería, y para saltar a cualquier sección.
 * Flechas para moverse, Enter para abrir, Esc para cerrar.
 *
 * Los tickets se buscan aquí mismo (ya están en DB); lo demás lo busca el
 * servidor (GET /api/buscar).
 */

const SECCIONES = [
  ['dashboard', 'Dashboard'], ['importaciones', 'Importaciones'], ['radar', 'Radar de Importaciones'],
  ['almacen', 'Control de Almacenes'], ['exportaciones', 'Exportaciones'], ['productos', 'Productos'],
  ['materiaPrima', 'Materia Prima'], ['servicios', 'Servicios'], ['bandeja', 'Bandeja de despacho'],
  ['historico', 'Histórico'], ['payback', 'Payback']
];
const ICONO = { nav: '→', ticket: '✉', importacion: '⛴', oc: '#', producto: '▦', proveedor: '◎' };

let resultados = [];
let activo = 0;
let pedido = 0;
let espera = null;

const normal = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function abrirBuscador() {
  if (!sesion || sesion.tipo !== 'admin') return;
  $('buscador').classList.add('on');
  $('buscadorQ').value = '';
  pintar('');
  setTimeout(() => $('buscadorQ').focus(), 20);
}
export function cerrarBuscador() { $('buscador').classList.remove('on'); }

export function escribirBuscador() {
  clearTimeout(espera);
  const q = $('buscadorQ').value.trim();
  pintar(q);
  if (q.length >= 2) espera = setTimeout(() => buscarServidor(q), 180);
}

function locales(q) {
  const n = normal(q);
  const nav = SECCIONES.filter(([, t]) => !n || normal(t).includes(n)).slice(0, n ? 4 : 11)
    .map(([k, t]) => ({ tipo: 'nav', titulo: t, detalle: 'Ir a la sección', accion: () => window.tabAdmin(k) }));
  // Palabras en cualquier orden, igual que el servidor.
  const ps = n.split(/[\s,;]+/).filter(Boolean);
  const tickets = n.length < 2 ? [] : (DB.solicitudes || [])
    .filter(s => { const t = normal([s.id, s.destino, s.nombre, s.area, s.servicio, s.motivo].join(' ')); return ps.every(p => t.includes(p)); }).slice(-6).reverse()
    .map(s => ({ tipo: 'ticket', titulo: s.id + ' · ' + (s.destino || ''), detalle: [s.estado, s.nombre, fechaCorta(s.creado)].filter(Boolean).join(' · '),
      accion: () => { window.tabAdmin('historico'); window.verDetalle(s.id); } }));
  return [{ titulo: 'Secciones', items: nav }, { titulo: 'Tickets de mensajería', items: tickets }].filter(g => g.items.length);
}

let remotos = [];
async function buscarServidor(q) {
  const mio = ++pedido;
  try {
    const r = await api.buscarGlobal(q);
    if (mio !== pedido || $('buscadorQ').value.trim() !== q) return;
    remotos = r.grupos.map(g => ({ titulo: g.titulo, items: g.items.map(x => aItem(g.tipo, x)) }));
  } catch (_) { remotos = []; }
  pintar(q, true);
}

function aItem(tipo, x) {
  if (tipo === 'importacion') return { tipo, titulo: (x.oc ? 'OC ' + x.oc : 'Solicitud') + ' · ' + x.descripcion, detalle: [ETIQUETA_ESTADO[x.estado] || x.estado, x.proveedor, x.bl && 'BL ' + x.bl].filter(Boolean).join(' · '),
    accion: () => { window.tabAdmin('importaciones'); window.impDetalle(x.id); } };
  if (tipo === 'oc') return { tipo, titulo: 'OC ' + x.oc + ' · ' + x.proveedor, detalle: entero(x.items) + ' ítems · ' + fechaCorta(x.fecha) + ' · ' + (x.descripcion || ''),
    accion: () => window.verItemsOC(x.oc) };
  if (tipo === 'producto') return { tipo, titulo: x.codigo + ' · ' + x.descripcion, detalle: [x.familia, x.linea, 'stock ' + entero(x.stock) + ' ' + (x.unidad_medida || '')].filter(Boolean).join(' · '),
    accion: () => { window.tabAdmin('productos'); $('prodQ').value = x.codigo; window.setFiltroProductos(); } };
  return { tipo, titulo: x.proveedor, detalle: [x.ruc && 'RUC ' + x.ruc, entero(x.ordenes) + ' OC', 'última ' + fechaCorta(x.ultima)].filter(Boolean).join(' · '),
    accion: () => { impPreparar({ estado: '', q: x.proveedor }); window.tabAdmin('importaciones'); } };
}

function pintar(q, conRemotos = false) {
  if (!conRemotos) remotos = q.length >= 2 ? remotos : [];
  const grupos = [...locales(q), ...(q.length >= 2 ? remotos : [])];
  resultados = grupos.flatMap(g => g.items);
  activo = Math.min(activo, Math.max(0, resultados.length - 1));
  if (!conRemotos) activo = 0;
  let i = 0;
  $('buscadorResultados').innerHTML = !resultados.length
    ? '<div class="empty" style="padding:26px 0"><strong>' + (q.length >= 2 ? 'Sin resultados para "' + esc(q) + '"' : 'Escribe para buscar') + '</strong>OC, BL, código o descripción de producto, proveedor, RUC o ticket.</div>'
    : grupos.map(g => '<div class="bus-grupo">' + esc(g.titulo) + '</div>' + g.items.map(x => {
      const n = i++;
      return '<button class="bus-item' + (n === activo ? ' on' : '') + '" data-i="' + n + '" onmousemove="marcarBuscador(' + n + ')" onclick="elegirBuscador(' + n + ')">'
        + '<span class="bus-ic" aria-hidden="true">' + ICONO[x.tipo] + '</span><span class="bus-t"><b>' + esc(x.titulo) + '</b><small>' + esc(x.detalle) + '</small></span></button>';
    }).join('')).join('');
}

export function marcarBuscador(n) {
  if (n === activo) return;
  activo = n;
  document.querySelectorAll('.bus-item').forEach(b => b.classList.toggle('on', Number(b.dataset.i) === n));
}
export function elegirBuscador(n) {
  const x = resultados[n];
  if (!x) return;
  cerrarBuscador();
  x.accion();
}

export function iniciarBuscador() {
  if (!document.addEventListener) return;
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); abrirBuscador(); return; }
    if (!$('buscador').classList.contains('on')) return;
    if (e.key === 'Escape') { cerrarBuscador(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!resultados.length) return;
      marcarBuscador((activo + (e.key === 'ArrowDown' ? 1 : -1) + resultados.length) % resultados.length);
      const el = document.querySelector('.bus-item.on');
      if (el) el.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      elegirBuscador(activo);
    }
  });
}
