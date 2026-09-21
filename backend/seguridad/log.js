import * as repo from '../db/repos/eventosSeguridad.js';

/**
 * Punto único para dejar un evento de auditoría. Envuelve `eventosSeguridad`
 * para no repetir en cada ruta cómo sacar el usuario y la IP de `req`.
 *
 * `detalle` es para contexto legible ("rol insuficiente: seguimiento pidió
 * /api/payback"), nunca para datos sensibles: nada de claves, hashes ni
 * tokens completos.
 */
export function log(tipo, req, detalle = '') {
  // req.usuario es de una sesión de logística; req.area, de una de área (ver
  // requiereSesion/requiereSesionArea en usuarios/middleware.js). Solo una de
  // las dos existe en cualquier request, nunca ambas.
  repo.registrar(tipo, {
    usuario: req?.usuario?.usuario || req?.area?.usuario || '',
    ip: req?.ip || req?.socket?.remoteAddress || '',
    detalle
  });
}

export const eventosRecientes = repo.recientes;
