import { $, esc } from '../utils/dom.js';
import { fechaHora } from '../utils/format.js';
import { toast } from '../utils/toast.js';
import * as api from '../api/estado.js';
import { DB } from '../api/estado.js';
import { normalizarDoc, DOC_VALIDO } from '#shared/documento.js';

/**
 * Padrón de personal habilitado y autorizaciones pendientes de acceso.
 *
 * Toda esta pestaña ("Padrón y accesos") es exclusiva de admin: seguimiento
 * ni la ve (ver TABS_SOLO_ADMIN en tabs.js) ni el servidor se lo permite
 * (GET /personal y GET /autorizaciones piden requiereRol('admin')), así que
 * no hace falta ninguna rama por rol acá dentro.
 *
 * La búsqueda la resuelve el servidor, no esta pantalla. Antes el navegador
 * tenía una copia del padrón completo y filtraba sobre ella, lo que dejaba los
 * 212 nombres con su DNI a la vista de cualquiera que abriera la consola: la
 * tabla no los listaba, pero los datos igual habían viajado. Ahora solo llega
 * lo que se busca, y el conteo total viene como número.
 */

/** Marca de la búsqueda en curso, para que una respuesta lenta no pise a otra. */
let ultimaBusqueda = 0;

/**
 * Apellidos, nombres y área son texto libre que escribe quien pide el
 * acceso (a diferencia del DNI, que ya viene normalizado a solo dígitos), así
 * que pueden traer una comilla. Se escapa primero para la cadena de JS del
 * onclick y recién después para el atributo HTML, o una comilla suelta
 * rompería el uno o el otro.
 */
const jsStr = s => esc(String(s || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'"));

/** Repinta solo si la pestaña está a la vista: si no, es una consulta de más. */
export function renderPadronSiVisible() {
  if ($('aPadron').classList.contains('on')) return renderPadron();
}

export async function renderPadron() {
  const pend = DB.autorizaciones.filter(a => a.estado === 'Pendiente');
  $('cntAut').textContent = pend.length;
  $('cntPadron').textContent = DB.totalPersonal;

  $('listaAut').innerHTML = pend.length ? pend.map(a => {
    const nombreCompleto = [a.nombres, a.apellidos].filter(Boolean).join(' ');
    const detalle = [
      nombreCompleto,
      a.celular ? 'cel. ' + a.celular : '',
      a.email || '',
      a.area ? 'área: ' + a.area : ''
    ].filter(Boolean).join(' · ');
    return '<div class="aut"><div><div class="aut-dni">' + esc(a.dni) + '</div>'
      + (detalle ? '<div class="small">' + esc(detalle) + '</div>' : '')
      + '<div class="small muted">Solicitado el ' + fechaHora(a.solicitado) + '</div></div>'
      + '<div class="tools"><button class="btn btn-sm" onclick="formAlta(\'' + jsStr(a.dni) + '\',\'' + jsStr(nombreCompleto) + '\',\'' + jsStr(a.area) + '\')">Habilitar</button>'
      + '<button class="btn btn-sm btn-ghost" onclick="rechazarAut(\'' + jsStr(a.dni) + '\')">Rechazar</button></div></div>';
  }).join('') : '<div class="muted small">Sin pedidos pendientes.</div>';

  // No viene con /estado -no es un dato de uso constante como autorizaciones-,
  // así que se pide aparte, cada vez que se abre o se repinta esta pestaña.
  renderPedidosHistorico();

  const vacio = m => '<tr><td colspan="5" class="muted small" style="padding:18px 12px">' + m + '</td></tr>';
  const q = String($('qPadron').value || '').trim();
  const turno = ++ultimaBusqueda;

  // Sin búsqueda no se pide nada: el padrón completo no se muestra ni se trae.
  if (q.length < 2) {
    $('cntPadronVista').textContent = '—';
    $('tbPadron').innerHTML = vacio('Escribe un documento, un nombre o un apellido para ver su ficha.');
    return;
  }

  let filas;
  try {
    filas = await api.buscarPersonal(q);
  } catch (e) {
    if (turno !== ultimaBusqueda) return;
    $('cntPadronVista').textContent = '—';
    $('tbPadron').innerHTML = vacio('No se pudo buscar: ' + esc(e.message));
    return;
  }
  // Mientras llegaba la respuesta el usuario siguió escribiendo: la descartamos.
  if (turno !== ultimaBusqueda) return;

  $('cntPadronVista').textContent = filas.length;
  $('tbPadron').innerHTML = filas.length ? filas.map(p =>
    '<tr><td class="tk" style="color:var(--text)">' + esc(p.dni) + '</td><td>' + esc(p.nombre) + '</td>'
    + '<td class="muted small">' + esc(p.cargo || '—') + '</td>'
    + '<td class="muted">' + esc(p.area) + '</td>'
    + '<td><button class="btn btn-sm btn-ghost" onclick="quitarPersona(\'' + p.dni + '\')">Quitar</button></td></tr>'
  ).join('') : vacio('Sin coincidencias para esa búsqueda.');
}

export async function agregarPersona() {
  const dni = normalizarDoc($('pDni').value);
  const nom = $('pNom').value.trim();
  if (!DOC_VALIDO.test(dni) || nom.length < 3) { $('ePadron').classList.add('on'); return; }
  $('ePadron').classList.remove('on');

  try {
    await api.agregarPersona({
      dni,
      nombre: nom,
      cargo: $('pCargo').value.trim(),
      area: $('pArea').value.trim()
    });
  } catch (e) {
    toast('No se pudo habilitar', e.message, e.status === 409 ? 'warn' : 'bad');
    return;
  }
  ['pDni', 'pNom', 'pCargo', 'pArea'].forEach(id => $(id).value = '');
  $('qPadron').value = dni;      // deja a la vista la ficha recién creada
  renderPadron();
  toast('Persona habilitada', nom + ' ya puede registrar servicios.');
}

export async function quitarPersona(dni) {
  try {
    await api.quitarPersona(normalizarDoc(dni));
  } catch (e) {
    toast('No se pudo retirar', e.message, 'bad');
    return;
  }
  renderPadron();
  toast('Retirado del padrón', 'El DNI ' + dni + ' ya no puede solicitar servicios.', 'warn');
}

export function formAlta(dni, nombre, area) {
  $('pDni').value = dni;
  // Vienen del propio pedido de autorización: se prellenan, pero admin los
  // revisa igual antes de guardar -son datos que escribió el solicitante,
  // no el padrón oficial de RR.HH.-.
  if (nombre) $('pNom').value = nombre;
  if (area) $('pArea').value = area;
  $('pNom').focus();
  toast('Completa los datos', 'Revisa nombre, cargo y área antes de habilitar el documento ' + dni + '.');
}

export async function rechazarAut(dni) {
  try {
    await api.resolverAutorizacion(normalizarDoc(dni), 'Rechazada');
  } catch (e) {
    toast('No se pudo rechazar', e.message, 'bad');
    return;
  }
  renderPadron();
  toast('Pedido rechazado', 'El DNI ' + dni + ' sigue bloqueado.', 'warn');
}

/**
 * Pedidos de un área para ver más de sus últimos 5 servicios. Resolverlo no
 * desbloquea nada solo -admin ya tiene el histórico completo en su propia
 * pestaña "Histórico" y se lo hace llegar al área por fuera de la
 * aplicación-, es solo la marca de que ya se atendió.
 */
export async function renderPedidosHistorico() {
  let filas;
  try {
    filas = await api.listarPedidosHistorico();
  } catch (e) {
    $('listaPedidosHistorico').innerHTML = '<div class="muted small">No se pudo cargar: ' + esc(e.message) + '</div>';
    return;
  }
  const pend = filas.filter(p => p.estado === 'Pendiente');
  $('listaPedidosHistorico').innerHTML = pend.length ? pend.map(p =>
    '<div class="aut"><div><div class="aut-dni">' + esc(p.area) + '</div>'
    + '<div class="small muted">Pedido por DNI ' + esc(p.dni) + ' · ' + fechaHora(p.solicitado) + '</div></div>'
    + '<div class="tools"><button class="btn btn-sm" onclick="atenderPedidoHistorico(' + p.id + ')">Marcar atendido</button>'
    + '<button class="btn btn-sm btn-ghost" onclick="rechazarPedidoHistorico(' + p.id + ')">Rechazar</button></div></div>'
  ).join('') : '<div class="muted small">Sin pedidos pendientes.</div>';
}

export async function atenderPedidoHistorico(id) {
  try {
    await api.resolverPedidoHistorico(id, 'Atendida');
  } catch (e) {
    toast('No se pudo actualizar', e.message, 'bad');
    return;
  }
  renderPedidosHistorico();
  toast('Pedido marcado como atendido', 'Recuerda hacerle llegar el histórico al área.');
}

export async function rechazarPedidoHistorico(id) {
  try {
    await api.resolverPedidoHistorico(id, 'Rechazada');
  } catch (e) {
    toast('No se pudo actualizar', e.message, 'bad');
    return;
  }
  renderPedidosHistorico();
  toast('Pedido rechazado', '', 'warn');
}
