import { $ } from '../utils/dom.js';
import { sesion } from '../state/sessionState.js';
import { setSubtabHistoricoActual } from '../state/historicoSubtab.js';
import { renderMis } from './tickets.js';
import { renderDashboard } from './dashboard.js';
import { renderKpi } from './kpi.js';
import { renderHistorico } from './history.js';
import { renderPadron } from './roster.js';
import { renderPayback } from './payback/vista.js';
import { renderUsuarios } from './usuarios.js';
import { renderCredencialesArea } from './credencialesArea.js';
import { renderExportaciones } from './exportaciones.js';
import { renderRequerimientos, renderRequerimientosHistorico } from './requerimientosCompra.js';
import { subtabCompras } from './ordenesCompra.js';
import { renderProductos } from './productos.js';
import { subtabMateriaPrima } from './muestras.js';
import { renderProveedores } from './proveedores.js';
import { renderServiciosLogistica } from './serviciosLogistica.js';
import { abrirAlmacen } from './almacen.js';
import { cerrarMenu } from '../ui/sidebar.js';
import { cerrarMenuCuenta } from '../ui/cuentaPopover.js';

/** Pestañas de la vista de solicitante: nueva solicitud / mis servicios (con buscador). */
export function tabUser(k) {
  document.querySelectorAll('[data-utab]').forEach(b => b.classList.toggle('on', b.dataset.utab === k));
  $('uNueva').classList.toggle('on', k === 'nueva');
  $('uMis').classList.toggle('on', k === 'mis');
  if (k === 'mis') renderMis();
}

/** Pestañas reservadas a rol admin: dashboard, payback, padrón, usuarios y el grupo de compras/logística. */
const TABS_SOLO_ADMIN = [
  'dashboard', 'payback', 'padron', 'usuarios',
  'almacen', 'exportaciones', 'productos', 'materiaPrima', 'requerimientos', 'ordenesCompra', 'proveedores', 'servicios'
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
  document.querySelectorAll('[data-atab="dashboard"], [data-atab="payback"]')
    .forEach(b => { b.style.display = esAdmin ? '' : 'none'; });
  // "Indicadores" ya no es una pestaña aparte -es una sub-pestaña dentro de
  // Histórico, que sí ve seguimiento- así que el permiso se aplica al botón
  // del sub-tab, no a toda la sección.
  $('histSubIndicadores').style.display = esAdmin ? '' : 'none';
}

/** Sub-pestañas dentro de "Histórico": Listado (la tabla) e Indicadores (los gráficos). */
export function subtabHistorico(k) {
  setSubtabHistoricoActual(k);
  $('histSubListado').classList.toggle('on', k === 'listado');
  $('histSubIndicadores').classList.toggle('on', k === 'indicadores');
  $('histPanelListado').style.display = k === 'listado' ? '' : 'none';
  $('histPanelIndicadores').style.display = k === 'indicadores' ? '' : 'none';
  $('histBtnExportar').style.display = k === 'listado' ? '' : 'none';
  if (k === 'listado') renderHistorico(); else renderKpi();
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
  $('aDashboard').classList.toggle('on', k === 'dashboard');
  $('aBandeja').classList.toggle('on', k === 'bandeja');
  $('aHistorico').classList.toggle('on', k === 'historico');
  $('aPadron').classList.toggle('on', k === 'padron');
  $('aUsuarios').classList.toggle('on', k === 'usuarios');
  $('aPayback').classList.toggle('on', k === 'payback');
  $('aAlmacen').classList.toggle('on', k === 'almacen');
  $('aExportaciones').classList.toggle('on', k === 'exportaciones');
  $('aProductos').classList.toggle('on', k === 'productos');
  $('aMateriaPrima').classList.toggle('on', k === 'materiaPrima');
  $('aRequerimientos').classList.toggle('on', k === 'requerimientos');
  $('aOrdenesCompra').classList.toggle('on', k === 'ordenesCompra');
  $('aProveedores').classList.toggle('on', k === 'proveedores');
  $('aServiciosLogistica').classList.toggle('on', k === 'servicios');
  // El botón de payback vive fuera de la fila de pestañas, así que se marca aparte.
  $('btnPayback').classList.toggle('on', k === 'payback');
  if (k === 'dashboard') renderDashboard();
  // Al entrar a Histórico siempre se ve el Listado primero -Indicadores es un
  // clic aparte-, sin importar en cuál sub-pestaña se había quedado antes.
  if (k === 'historico') subtabHistorico('listado');
  if (k === 'padron') renderPadron();
  if (k === 'usuarios') { renderUsuarios(); renderCredencialesArea(); }
  if (k === 'payback') renderPayback();
  if (k === 'almacen') abrirAlmacen();
  if (k === 'exportaciones') renderExportaciones();
  if (k === 'productos') renderProductos();
  if (k === 'materiaPrima') subtabMateriaPrima();
  if (k === 'requerimientos') { renderRequerimientos(); renderRequerimientosHistorico(); }
  if (k === 'ordenesCompra') subtabCompras();
  if (k === 'proveedores') renderProveedores();
  if (k === 'servicios') renderServiciosLogistica();
  cerrarMenu();
  cerrarMenuCuenta();
}
