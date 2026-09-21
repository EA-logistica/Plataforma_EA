import { $ } from '../utils/dom.js';
import { sesion } from '../state/sessionState.js';
import { renderMis, consultarTicket } from './tickets.js';
import { renderKpi } from './kpi.js';
import { renderHistorico } from './history.js';
import { renderPadron } from './roster.js';
import { renderPayback } from './payback/vista.js';
import { renderUsuarios } from './usuarios.js';
import { renderCredencialesArea } from './credencialesArea.js';

/** Pestañas de la vista de solicitante: nueva solicitud / seguimiento / mis servicios. */
export function tabUser(k) {
  document.querySelectorAll('[data-utab]').forEach(b => b.classList.toggle('on', b.dataset.utab === k));
  $('uNueva').classList.toggle('on', k === 'nueva');
  $('uSeguimiento').classList.toggle('on', k === 'seguimiento');
  $('uMis').classList.toggle('on', k === 'mis');
  if (k === 'mis') renderMis();
  if (k === 'seguimiento' && $('qTicket').value) consultarTicket();
}

/** Pestañas reservadas a rol admin: indicadores, payback, padrón y usuarios. */
const TABS_SOLO_ADMIN = ['kpi', 'payback', 'padron', 'usuarios'];

/**
 * Oculta del todo, no solo deshabilita, las pestañas que el rol de la sesión
 * no puede usar. El permiso real se comprueba en el servidor en cada llamada
 * (ver backend/usuarios/middleware.js); esto es solo para no ofrecerle a
 * seguimiento un botón que de todos modos le va a responder 403.
 */
export function aplicarPermisosAdmin() {
  const esAdmin = !sesion || sesion.rol === 'admin';
  $('tabUsuarios').style.display = esAdmin ? '' : 'none';
  document.querySelectorAll('[data-atab="kpi"], [data-atab="payback"], [data-atab="padron"]')
    .forEach(b => { b.style.display = esAdmin ? '' : 'none'; });
}

/** Vistas de logística: bandeja / histórico / indicadores / padrón / payback / usuarios. */
export function tabAdmin(k) {
  // Seguimiento no tiene estas pestañas ni en pantalla; si igual se invoca
  // (por ejemplo, un enlace viejo), se cae a la bandeja en vez de abrir algo
  // que el servidor le va a rechazar de todos modos.
  if (TABS_SOLO_ADMIN.includes(k) && sesion && sesion.rol !== 'admin') k = 'bandeja';

  document.querySelectorAll('[data-atab]').forEach(b => b.classList.toggle('on', b.dataset.atab === k));
  $('aBandeja').classList.toggle('on', k === 'bandeja');
  $('aHistorico').classList.toggle('on', k === 'historico');
  $('aKpi').classList.toggle('on', k === 'kpi');
  $('aPadron').classList.toggle('on', k === 'padron');
  $('aUsuarios').classList.toggle('on', k === 'usuarios');
  $('aPayback').classList.toggle('on', k === 'payback');
  // El botón de payback vive fuera de la fila de pestañas, así que se marca aparte.
  $('btnPayback').classList.toggle('on', k === 'payback');
  if (k === 'kpi') renderKpi();
  if (k === 'historico') renderHistorico();
  if (k === 'padron') renderPadron();
  if (k === 'usuarios') { renderUsuarios(); renderCredencialesArea(); }
  if (k === 'payback') renderPayback();
}
