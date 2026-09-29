import * as repo from '../db/repos/eventosSeguridad.js';

/**
 * Punto único para dejar un evento de auditoría. Envuelve `eventosSeguridad`
 * para no repetir en cada ruta cómo sacar el usuario y la IP de `req`.
 *
 * `detalle` es para contexto legible ("rol insuficiente: seguimiento pidió
 * /api/payback"), nunca para datos sensibles: nada de claves, hashes ni
 * tokens completos.
 *
 * Devuelve una promesa que NUNCA se rechaza: la escritura en la base ahora es
 * asíncrona, y un fallo al auditar no debe tumbar la petición que se está
 * auditando (ni quedar como unhandledRejection si nadie la espera). Quien
 * puede, la espera con await para que el evento quede escrito antes de
 * responder; quien no, puede dejarla correr sola.
 */
export function log(tipo, req, detalle = '') {
  // req.usuario es de una sesión de logística; req.area, de una de área (ver
  // requiereSesion/requiereSesionArea en usuarios/middleware.js). Solo una de
  // las dos existe en cualquier request, nunca ambas.
  return registrarSeguro(tipo, {
    usuario: req?.usuario?.usuario || req?.area?.usuario || '',
    ip: req?.ip || req?.socket?.remoteAddress || '',
    detalle
  });
}

/**
 * `eventosSeguridad.registrar` con la misma garantía que `log`: nunca se
 * rechaza, el error queda en la consola. Para los lugares que no tienen un
 * `req` a mano (el freno de intentos, el ingreso con usuario explícito).
 */
export function registrarSeguro(tipo, datos) {
  return Promise.resolve()
    .then(() => repo.registrar(tipo, datos))
    .catch(err => console.error('[seguridad] no se pudo registrar el evento "' + tipo + '":', err));
}

export const eventosRecientes = limite => repo.recientes(limite);
