import * as sesiones from './sesiones.js';
import { log } from '../seguridad/log.js';

/**
 * Guardia de las rutas de logística. Antes de esto, la API no tenía ningún
 * control del lado del servidor: la clave del área solo abría una pantalla en
 * el navegador, pero cualquiera en la red podía golpear /api/personal o
 * /api/autorizaciones directamente sin conocerla. Ahora sí hace falta una
 * sesión de verdad para escribir.
 */

const error = (msg, status) => Object.assign(new Error(msg), { status });

function tokenDe(req) {
  const cab = req.headers.authorization || '';
  return cab.startsWith('Bearer ') ? cab.slice(7) : null;
}

/**
 * Exige una sesión vigente de logística (admin o seguimiento) y la cuelga de
 * req.usuario. Comprueba `tipo === 'logistica'` explícitamente y no solo que
 * el token exista: desde que el solicitante también tiene un token (la
 * credencial de área, ver backend/areas/), un token válido pero de área NO
 * debe alcanzar para entrar a una ruta de despacho.
 */
export function requiereSesion(req, res, next) {
  const token = tokenDe(req);
  const s = sesiones.verificar(token);
  if (!s || s.tipo !== 'logistica') {
    log('acceso_denegado', req, 'sin sesión válida en ' + req.method + ' ' + req.originalUrl);
    throw error('Sesión inválida o vencida. Vuelve a ingresar.', 401);
  }
  req.usuario = s;
  req.token = token;
  next();
}

/** Exige una sesión vigente de área (el solicitante que entró con DNI + credencial de área) y la cuelga de req.area. */
export function requiereSesionArea(req, res, next) {
  const token = tokenDe(req);
  const s = sesiones.verificar(token);
  if (!s || s.tipo !== 'area') {
    log('acceso_denegado', req, 'sin sesión de área válida en ' + req.method + ' ' + req.originalUrl);
    throw error('Sesión inválida o vencida. Vuelve a ingresar con tu DNI.', 401);
  }
  req.area = s;
  req.token = token;
  next();
}

/** Además del inicio de sesión, exige uno de los roles dados. Va después de requiereSesion. */
export function requiereRol(...roles) {
  return function (req, res, next) {
    if (!req.usuario) throw error('Sesión inválida o vencida. Vuelve a ingresar.', 401);
    if (!roles.includes(req.usuario.rol)) {
      // No es solo un 401 rutinario (token vencido): alguien autenticado
      // pidió algo que su rol no cubre. Vale la pena distinguirlo en la
      // auditoría de un simple "se le venció la sesión".
      log('acceso_denegado', req, 'rol "' + req.usuario.rol + '" sin permiso para ' + req.method + ' ' + req.originalUrl);
      throw error('Tu usuario no tiene permiso para esto.', 403);
    }
    next();
  };
}

/**
 * Cuelga `req.usuario` si viene un token válido, pero nunca rechaza la
 * petición: para las pocas rutas que hacen algo distinto según quién llama
 * (autoservicio del solicitante vs. logística), como cancelar un ticket.
 */
export function sesionOpcional(req, res, next) {
  const s = sesiones.verificar(tokenDe(req));
  if (s && s.tipo === 'logistica') req.usuario = s;
  next();
}
