/**
 * Sesión activa, o null.
 *
 *   solicitante: {tipo:'user', dni, nombre, cargo, area, token, debeCambiarClave}
 *   logística:   {tipo:'admin', usuario, rol:'admin'|'seguimiento', token, nombre, area}
 *
 * El solicitante también lleva `token` desde que entra con DNI + credencial
 * de área (backend/areas/), no solo con el DNI: `area` es de dónde es la
 * persona, `token` es de la sesión de ESA área (compartida con quien más
 * trabaje ahí), y ambos viajan en cada llamada vía cliente.js.
 *
 * `rol`/el tipo de sesión son el permiso real, verificado en el servidor en
 * cada llamada; ocultar botones aquí es solo para no confundir a quien no
 * puede usarlos, no la medida de seguridad (esa vive en
 * backend/usuarios/middleware.js).
 *
 * Único módulo autorizado a reasignar `sesion`; el resto la importa solo lectura.
 */
export let sesion = null;

// Se guarda en sessionStorage (no localStorage) a propósito: sobrevive a un
// F5 -que antes mandaba de vuelta al login, aun con el token todavía
// vigente en el servidor-, pero se borra sola al cerrar la pestaña o el
// navegador, que es lo esperable en una PC que comparten varias personas
// (admin, seguimiento, o quien entra con DNI + credencial de área).
const CLAVE = 'pn_mensajeria_sesion';

export function setSesion(v) {
  sesion = v;
  try {
    if (v) sessionStorage.setItem(CLAVE, JSON.stringify(v));
    else sessionStorage.removeItem(CLAVE);
  } catch (e) { /* almacenamiento bloqueado (modo privado, etc.): sigue funcionando, solo no sobrevive un F5 */ }
}

/** Se lee una sola vez, al arrancar la página -ver restaurarSesion() en auth.js-. */
export function leerSesionGuardada() {
  try {
    const v = sessionStorage.getItem(CLAVE);
    return v ? JSON.parse(v) : null;
  } catch (e) {
    return null;
  }
}
