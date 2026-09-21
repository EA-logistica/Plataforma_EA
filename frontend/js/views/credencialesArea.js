import { $, esc } from '../utils/dom.js';
import { toast } from '../utils/toast.js';
import * as api from '../api/estado.js';
import { abrirModal } from './dispatch.js';

/**
 * Administración de las credenciales de área (segundo factor del ingreso del
 * solicitante). Vive junto a "Usuarios" -misma pestaña, solo admin- pero es
 * otra cosa: una clave compartida por área, no una cuenta personal.
 */

/**
 * El área es texto libre que escribe admin (a diferencia de un id numérico
 * como en usuarios.js), así que puede traer una comilla. Para meterla como
 * argumento de un onclick sin que rompa el JavaScript ni el atributo HTML,
 * se escapa primero para la cadena de JS y recién después para el atributo.
 */
const jsStr = s => esc(String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'"));

/** Repinta solo si la pestaña está a la vista: si no, es una consulta de más. */
export function renderCredencialesAreaSiVisible() {
  if ($('aUsuarios').classList.contains('on')) renderCredencialesArea();
}

export async function renderCredencialesArea() {
  let filas;
  try {
    filas = await api.listarCredencialesArea();
  } catch (e) {
    $('tbCredArea').innerHTML = '<tr><td colspan="4" class="muted small" style="padding:18px 12px">'
      + 'No se pudo cargar: ' + esc(e.message) + '</td></tr>';
    return;
  }

  $('tbCredArea').innerHTML = filas.map(c =>
    '<tr><td class="tk" style="color:var(--text)">' + esc(c.area) + '</td>'
    + '<td>' + esc(c.usuario) + '</td>'
    + '<td>' + (c.activo ? '<span class="chip st-concluido"><i class="dot"></i>Activo</span>'
      : '<span class="chip st-espera"><i class="dot"></i>Desactivado</span>')
    + (c.debeCambiarClave ? ' <span class="small muted">clave temporal</span>' : '') + '</td>'
    + '<td class="nowrap">'
    + '<button class="btn btn-sm btn-ghost" onclick="restablecerClaveAreaVista(\'' + jsStr(c.area) + '\')">Nueva clave temporal</button> '
    + '<button class="btn btn-sm btn-ghost" onclick="cambiarEstadoAreaVista(\'' + jsStr(c.area) + '\',' + !c.activo + ')">'
    + (c.activo ? 'Desactivar' : 'Reactivar') + '</button>'
    + '</td></tr>'
  ).join('') || '<tr><td colspan="4" class="muted small" style="padding:18px 12px">Todavía no hay credenciales de área.</td></tr>';
}

export async function crearCredencialAreaVista() {
  const area = $('caArea').value.trim();
  const usuario = $('caUsuario').value.trim();
  if (!area || !/^[a-zA-Z0-9._-]{3,32}$/.test(usuario)) { $('eCredArea').classList.add('on'); return; }
  $('eCredArea').classList.remove('on');

  let r;
  try {
    r = await api.crearCredencialArea(area, usuario);
  } catch (e) {
    toast('No se pudo crear la credencial', e.message, e.status === 409 || e.status === 400 ? 'warn' : 'bad');
    return;
  }
  $('caArea').value = ''; $('caUsuario').value = '';
  renderCredencialesArea();
  mostrarClaveTemporalArea(r.area, r.usuario, r.claveTemporal, 'Credencial creada');
}

export async function restablecerClaveAreaVista(area) {
  let r;
  try {
    r = await api.restablecerClaveCredencialArea(area);
  } catch (e) {
    toast('No se pudo generar la clave', e.message, 'bad');
    return;
  }
  renderCredencialesArea();
  mostrarClaveTemporalArea(r.area, r.usuario, r.claveTemporal, 'Clave temporal generada');
}

export async function cambiarEstadoAreaVista(area, activo) {
  try {
    await api.cambiarEstadoCredencialArea(area, activo);
  } catch (e) {
    toast('No se pudo actualizar', e.message, 'bad');
    return;
  }
  renderCredencialesArea();
  toast(activo ? 'Credencial reactivada' : 'Credencial desactivada', '', activo ? undefined : 'warn');
}

/**
 * La clave temporal solo se muestra esta vez: el servidor no la vuelve a dar,
 * guarda el hash y nada más.
 */
function mostrarClaveTemporalArea(area, usuario, clave, titulo) {
  const html = '<p>Área <b>' + esc(area) + '</b>, usuario <b>' + esc(usuario) + '</b>, clave temporal:</p>'
    + '<p class="tk" style="font-size:22px;letter-spacing:2px;margin:10px 0">' + esc(clave) + '</p>'
    + '<div class="banner"><div>Se muestra una sola vez. Compártela con el área por un canal seguro; '
    + 'al ingresar, la aplicación le va a pedir que la cambien por una propia.</div></div>';
  abrirModal(titulo, html);
}
