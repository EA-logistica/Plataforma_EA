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

export function setSesion(v) {
  sesion = v;
}
