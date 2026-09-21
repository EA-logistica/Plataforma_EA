import * as personal from '../db/repos/personal.js';
import * as credRepo from '../db/repos/credencialesArea.js';
import { hashClave, verificarHash, generarClaveTemporal } from '../usuarios/claves.js';
import * as sesiones from '../usuarios/sesiones.js';
import { log } from '../seguridad/log.js';
import { registrar as registrarEvento } from '../db/repos/eventosSeguridad.js';

/**
 * Reglas de negocio del ingreso por área: el DNI detecta el área en el
 * padrón y la clave que se pide después es la de esa área, no la de la
 * persona. Calcado de backend/usuarios/servicio.js, pero separado porque la
 * credencial de área no es una cuenta de logística (ver credencialesArea.js).
 */

const error = (msg, status = 400) => Object.assign(new Error(msg), { status });

/** `req` es opcional (solo para la auditoría); nunca hace falta para la lógica en sí. */
export function ingresarPorArea(dni, usuarioArea, claveArea, req) {
  const p = personal.porDocumento(dni);
  if (!p) throw error('El documento no figura en el padrón de personal.', 404);

  const cred = credRepo.porArea(p.area);
  const usuarioEscrito = String(usuarioArea || '').trim().toLowerCase();
  // Un solo mensaje para las tres formas de fallar (sin credencial todavía,
  // desactivada, usuario o clave que no calzan): no hay que decirle a quien
  // prueba a ciegas cuál de las tres fue.
  const valido = !!cred && !!cred.activo && usuarioEscrito === cred.usuario && verificarHash(claveArea, cred.claveHash);

  if (!valido) {
    registrarEvento('login_area_fallido', {
      usuario: usuarioEscrito, ip: req?.ip || '',
      detalle: 'DNI ' + p.dni + ', área "' + p.area + '": '
        + (!cred ? 'el área no tiene credencial configurada' : !cred.activo ? 'credencial desactivada' : 'usuario o clave incorrectos')
    });
    throw error('Usuario o clave incorrectos.', 401);
  }

  // Mismo aprovechamiento del ingreso que usuarios/servicio.js#ingresar: si el
  // hash guardado es del formato viejo, se actualiza solo, sin forzar un
  // cambio de clave.
  if (cred.claveHash.split(':').length !== 5) {
    credRepo.cambiarClave(p.area, hashClave(claveArea), { debeCambiar: !!cred.debeCambiarClave });
  }

  registrarEvento('login_area_exitoso', {
    usuario: cred.usuario, ip: req?.ip || '', detalle: 'DNI ' + p.dni + ', área "' + p.area + '"'
  });

  return {
    token: sesiones.crearArea(cred, p),
    dni: p.dni, nombre: p.nombre, cargo: p.cargo, area: p.area,
    debeCambiarClave: !!cred.debeCambiarClave
  };
}

/** Análogo a usuarios/servicio.js#cambiarClavePropia, para la credencial compartida de un área. */
export function cambiarClavePropiaArea(sesionArea, actual, nueva, req) {
  const cred = credRepo.porArea(sesionArea.area);
  if (!cred || !verificarHash(actual, cred.claveHash)) throw error('La clave actual no es correcta.', 401);
  if (String(nueva || '').length < 6) throw error('La clave nueva debe tener al menos 6 caracteres.');
  if (verificarHash(nueva, cred.claveHash)) throw error('La clave nueva debe ser distinta de la actual.');
  credRepo.cambiarClave(sesionArea.area, hashClave(nueva), { debeCambiar: false });
  // Cambiar la clave compartida cierra las sesiones de TODOS los que la
  // tenían abierta con la credencial vieja -no solo la de quien la cambió-,
  // porque cualquiera de esa área la conocía igual. Se re-emite una para
  // quien pidió el cambio, para no dejarlo afuera en el proceso.
  sesiones.revocarDeArea(sesionArea.area);
  log('cambio_clave_area', req, 'área "' + sesionArea.area + '" cambió su credencial compartida');
  return sesiones.crearArea(credRepo.porArea(sesionArea.area), sesionArea);
}

export function crearCredencialArea({ area, usuario, creadoPor }, req) {
  if (!personal.existeArea(area)) throw error('El área "' + area + '" no figura en el padrón de personal.');
  const claveTemporal = generarClaveTemporal();
  const creada = credRepo.crear({ area, usuario, claveHash: hashClave(claveTemporal), creadoPor });
  log('credencial_area_creada', req, 'área "' + creada.area + '", usuario "' + creada.usuario + '"');
  // La clave temporal sale UNA sola vez, en la respuesta de creación: igual
  // que con usuarios, no se guarda en claro y no se puede volver a consultar.
  return { ...creada, claveTemporal };
}

export function restablecerClaveArea(area, req) {
  const cred = credRepo.porArea(area);
  if (!cred) throw error('No existe credencial para el área "' + area + '".', 404);
  const claveTemporal = generarClaveTemporal();
  credRepo.cambiarClave(area, hashClave(claveTemporal), { debeCambiar: true });
  sesiones.revocarDeArea(area);
  log('credencial_area_restablecida', req, 'admin restableció la clave del área "' + cred.area + '"');
  return { area: cred.area, usuario: cred.usuario, claveTemporal };
}

export function cambiarEstadoArea(area, activo, req) {
  const cred = credRepo.porArea(area);
  if (!cred) throw error('No existe credencial para el área "' + area + '".', 404);
  const actualizado = credRepo.cambiarEstado(area, activo);
  if (!activo) sesiones.revocarDeArea(area);
  log(activo ? 'credencial_area_reactivada' : 'credencial_area_desactivada', req, 'área "' + cred.area + '"');
  return actualizado;
}
