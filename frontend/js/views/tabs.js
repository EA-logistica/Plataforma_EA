import { $ } from '../utils/dom.js';
import { sesion } from '../state/sessionState.js';
import { renderMis, consultarTicket } from './tickets.js';
import { renderKpi } from './kpi.js';
import { renderHistorico } from './history.js';
import { renderPadron } from './roster.js';
import { renderPayback } from './payback/vista.js';
import { renderUsuarios } from './usuarios.js';
import { renderCredencialesArea } from './credencialesArea.js';
import { renderExportaciones } from './exportaciones.js';
import { renderRequerimientos } from './requerimientosCompra.js';
import { renderServiciosLogistica } from './serviciosLogistica.js';
import { abrirAlmacen } from './almacen.js';
import { cerrarMenu } from '../ui/sidebar.js';
import { cerrarMenuCuenta } from '../ui/cuentaPopover.js';

/** Pestañas de la vista de solicitante: nueva solicitud / seguimiento / mis servicios. */
export function tabUser(k) {
  document.querySelectorAll('[data-utab]').forEach(b => b.classList.toggle('on', b.dataset.utab === k));
  $('uNueva').classList.toggle('on', k === 'nueva');
  $('uSeguimiento').classList.toggle('on', k === 'seguimiento');
  $('uMis').classList.toggle('on', k === 'mis');
  if (k === 'mis') renderMis();
  if (k === 'seguimiento' && $('qTicket').value) consultarTicket();
}

/** Pestañas reservadas a rol admin: indicadores, payback, padrón, usuarios y el grupo de compras/logística. */
const TABS_SOLO_ADMIN = [
  'kpi', 'payback', 'padron', 'usuarios',
  'almacen', 'exportaciones', 'requerimientos', 'servicios'
];

/**
 * Oculta del todo, no solo deshabilita, las pestañas que el rol de la sesión
 * no puede usar. El permiso real se comprueba en el servidor en cada llamada
 * (ver backend/usuarios/middleware.js); esto es solo para no ofrecerle a
 * seguimiento un botón que de todos modos le va a responder 403.
 */
export function aplicarPermisosAdmin() {
  const esAdmin = !sesion || sesion.rol === 'admin';
  // Padrón y accesos / Usuarios ya no viven en la barra lateral: son ítems
  // del menú de la cuenta (ver ui/cuentaPopover.js), así que el permiso se
  // aplica ahí.
  $('btnMenuPadron').style.display = esAdmin ? '' : 'none';
  $('btnMenuUsuarios').style.display = esAdmin ? '' : 'none';
  $('navCompras').style.display = esAdmin ? '' : 'none';
  document.querySelectorAll('[data-atab="kpi"], [data-atab="payback"]')
    .forEach(b => { b.style.display = esAdmin ? '' : 'none'; });
}

/**
 * Vistas de logística: bandeja / histórico / indicadores / padrón / payback /
 * usuarios, más el grupo "Compras y Logística" (almacén, exportaciones,
 * requerimientos de compra, servicios) que solo ve admin.
 */
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
  $('aAlmacen').classList.toggle('on', k === 'almacen');
  $('aExportaciones').classList.toggle('on', k === 'exportaciones');
  $('aRequerimientos').classList.toggle('on', k === 'requerimientos');
  $('aServiciosLogistica').classList.toggle('on', k === 'servicios');
  // El botón de payback vive fuera de la fila de pestañas, así que se marca aparte.
  $('btnPayback').classList.toggle('on', k === 'payback');
  if (k === 'kpi') renderKpi();
  if (k === 'historico') renderHistorico();
  if (k === 'padron') renderPadron();
  if (k === 'usuarios') { renderUsuarios(); renderCredencialesArea(); }
  if (k === 'payback') renderPayback();
  if (k === 'almacen') abrirAlmacen();
  if (k === 'exportaciones') renderExportaciones();
  if (k === 'requerimientos') renderRequerimientos();
  if (k === 'servicios') renderServiciosLogistica();
  cerrarMenu();
  cerrarMenuCuenta();
}
