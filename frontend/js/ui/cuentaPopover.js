import { $ } from '../utils/dom.js';

/**
 * Menú de la cuenta en la topbar (nombre + rol de quien entró como
 * logística o como área). Antes "Mi clave" era un botón suelto siempre a la
 * vista; ahora vive acá, junto con "Padrón y accesos" y "Usuarios" -estos
 * dos, solo para admin, ver aplicarPermisosAdmin() en views/tabs.js-, en vez
 * de ocupar su propio lugar en la barra lateral.
 */
function estaAbierto() {
  return $('cuentaPopover').classList.contains('on');
}

function abrirMenuCuenta() {
  $('cuentaPopover').classList.add('on');
  $('btnCuenta').setAttribute('aria-expanded', 'true');
}

export function cerrarMenuCuenta() {
  $('cuentaPopover').classList.remove('on');
  $('btnCuenta').setAttribute('aria-expanded', 'false');
}

export function alternarMenuCuenta() {
  if (estaAbierto()) cerrarMenuCuenta(); else abrirMenuCuenta();
}
