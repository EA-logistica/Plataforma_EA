import * as repo from './repositorio.js';
import { hashClave, verificarHash, generarClaveTemporal } from './claves.js';
import * as sesiones from './sesiones.js';
import { log } from '../seguridad/log.js';
import { registrar as registrarEvento } from '../db/repos/eventosSeguridad.js';

/**
 * Reglas de negocio de las cuentas de logística. `rutas.js` solo traduce
 * HTTP <-> estas funciones; aquí vive lo que hay que cuidar (nadie entra con
 * un usuario desactivado, la clave nunca se guarda en claro, etc.).
 */

const error = (msg, status = 400) => Object.assign(new Error(msg), { status });

// Hash de relleno con el mismo costo (N=32768) que uno real: sin esto,
// `verificarHash` solo corre cuando el usuario SÍ existe (el `||` de abajo
// corta antes), y esa diferencia de tiempo -scrypt real tarda decenas de ms;
// saltárselo, prácticamente nada- deja adivinar qué usuarios existen con
// solo cronometrar la respuesta, aunque el mensaje de error sea igual.
const HASH_FICTICIO = '32768:8:1:' + '0'.repeat(32) + ':' + '0'.repeat(128);

/** `req` es opcional (solo para la auditoría); nunca hace falta para la lógica en sí. */
export function ingresar(usuario, clave, req) {
  const u = repo.porUsuario(usuario);
  const claveOk = verificarHash(clave, u && u.activo ? u.claveHash : HASH_FICTICIO);
  if (!u || !u.activo || !claveOk) {
    // El mismo mensaje de siempre no dice si el problema fue el usuario o la
    // clave; en el log sí conviene distinguir "no existe/inactivo" de "clave
    // mala", porque son dos formas distintas de sospechoso.
    log('login_fallido', req, 'usuario "' + String(usuario || '') + '": '
      + (u && u.activo ? 'clave incorrecta' : 'usuario inexistente o inactivo'));
    throw error('Usuario o clave incorrectos.', 401);
  }

  // La clave verificó bien: si el hash guardado es del formato viejo (sin
  // costo explícito), se aprovecha el ingreso para pasarlo al nuevo formato.
  // No cuesta un viaje extra a la base -ya se leyó la fila- y así las cuentas
  // existentes se ponen al día solas, sin forzar un cambio de clave.
  if (u.claveHash.split(':').length !== 5) repo.cambiarClave(u.id, hashClave(clave), { debeCambiar: !!u.debeCambiarClave });

  registrarEvento('login_exitoso', { usuario: u.usuario, ip: req?.ip || '' });
  return {
    token: sesiones.crear(u),
    usuario: u.usuario,
    rol: u.rol,
    debeCambiarClave: !!u.debeCambiarClave
  };
}

export function crearUsuario({ usuario, rol, creadoPor }, req) {
  const claveTemporal = generarClaveTemporal();
  const creado = repo.crear({ usuario, claveHash: hashClave(claveTemporal), rol, creadoPor });
  log('usuario_creado', req, 'usuario "' + creado.usuario + '", rol ' + creado.rol);
  // La clave temporal sale UNA sola vez, en la respuesta de creación: no se
  // guarda en ningún lado en claro y no se puede volver a consultar después,
  // solo generar una nueva con restablecerClave.
  return { ...creado, claveTemporal };
}

export function restablecerClave(id, req) {
  const u = repo.porId(id);
  if (!u) throw error('No existe ese usuario.', 404);
  const claveTemporal = generarClaveTemporal();
  repo.cambiarClave(id, hashClave(claveTemporal), { debeCambiar: true });
  sesiones.revocarDeUsuario(id);
  log('clave_restablecida', req, 'admin restableció la clave de "' + u.usuario + '"');
  return { id, usuario: u.usuario, claveTemporal };
}

export function cambiarClavePropia(sesion, actual, nueva, req) {
  const u = repo.porUsuario(sesion.usuario);
  if (!u || !verificarHash(actual, u.claveHash)) throw error('La clave actual no es correcta.', 401);
  if (String(nueva || '').length < 6) throw error('La clave nueva debe tener al menos 6 caracteres.');
  if (verificarHash(nueva, u.claveHash)) throw error('La clave nueva debe ser distinta de la actual.');
  repo.cambiarClave(u.id, hashClave(nueva), { debeCambiar: false });
  // Si alguien más tenía un token de esta cuenta -robado o de una PC
  // compartida donde nunca se cerró sesión-, cambiar la clave lo debe dejar
  // afuera. La sesión que pidió el cambio se re-emite para no cortarse a sí
  // misma en el proceso.
  sesiones.revocarDeUsuario(u.id);
  log('cambio_clave', req, 'cambió su propia clave');
  return sesiones.crear(u);
}

/**
 * Solo admin llama a esto (requiereRol('admin') en rutas.js), y quien llama
 * siempre queda activo: por eso basta con impedir que alguien se desactive a
 * sí mismo para que nunca se pueda dejar el sistema sin ningún admin activo.
 */
export function cambiarEstado(id, activo, sesion, req) {
  const u = repo.porId(id);
  if (!u) throw error('No existe ese usuario.', 404);
  if (!activo && u.usuario === sesion.usuario) throw error('No puedes desactivar tu propio usuario.');
  const actualizado = repo.cambiarEstado(id, activo);
  if (!activo) sesiones.revocarDeUsuario(id);
  log(activo ? 'usuario_reactivado' : 'usuario_desactivado', req, 'cuenta "' + u.usuario + '"');
  return actualizado;
}
