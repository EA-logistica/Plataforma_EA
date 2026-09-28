import { db, aCamel } from '../conexion.js';
import { tocar } from './ajustes.js';

/**
 * Credencial compartida de un área: el segundo factor del ingreso del
 * solicitante (DNI + esta clave). No es una cuenta de `usuarios` -esas son
 * personales, de quien despacha, con su propio ciclo de vida-; esta es una
 * sola por área, la reparte admin y la conoce cualquiera que trabaje ahí. El
 * control real de quién puede intentar entrar sigue siendo el DNI contra el
 * padrón: esto solo evita que alguien con un DNI ajeno vea los servicios de
 * un área que no es la suya.
 */

const error = (msg, status = 400) => Object.assign(new Error(msg), { status });

/** Nunca debe salir del servidor: se quita antes de responder al navegador. */
const sinClave = c => {
  if (!c) return c;
  const { claveHash, ...resto } = c;
  return resto;
};

export function listar() {
  return db().prepare('SELECT * FROM credenciales_area ORDER BY area').all().map(aCamel).map(sinClave);
}

/** Con el hash incluido: solo para uso interno (autenticar, cambiar clave). */
export function porArea(area) {
  const a = String(area || '').trim();
  if (!a) return null;
  return aCamel(db().prepare('SELECT * FROM credenciales_area WHERE area = ?').get(a));
}

export function porUsuario(usuario) {
  const nombre = String(usuario || '').trim().toLowerCase();
  if (!nombre) return null;
  return aCamel(db().prepare('SELECT * FROM credenciales_area WHERE usuario = ?').get(nombre));
}

export function crear({ area, usuario, claveHash, creadoPor }) {
  const a = String(area || '').trim();
  const nombre = String(usuario || '').trim().toLowerCase();
  if (!a) throw error('Falta el área.');
  if (!/^[a-z0-9._-]{3,32}$/.test(nombre)) {
    throw error('El usuario debe tener de 3 a 32 caracteres: minúsculas, números, punto, guion o guion bajo.');
  }
  if (porArea(a)) throw error('El área "' + a + '" ya tiene una credencial.', 409);
  if (porUsuario(nombre)) throw error('Ya existe el usuario "' + nombre + '".', 409);

  db().prepare(
    'INSERT INTO credenciales_area (area, usuario, clave_hash, creado_por, creado_en) VALUES (?, ?, ?, ?, ?)'
  ).run(a, nombre, claveHash, String(creadoPor || ''), new Date().toISOString());
  tocar('app');
  return sinClave(porArea(a));
}

export function cambiarClave(area, claveHash, { debeCambiar }) {
  const r = db().prepare(
    'UPDATE credenciales_area SET clave_hash = ?, debe_cambiar_clave = ? WHERE area = ?'
  ).run(claveHash, debeCambiar ? 1 : 0, String(area));
  if (!r.changes) throw error('No existe credencial para el área "' + area + '".', 404);
  tocar('app');
}

export function cambiarEstado(area, activo) {
  const r = db().prepare('UPDATE credenciales_area SET activo = ? WHERE area = ?').run(activo ? 1 : 0, String(area));
  if (!r.changes) throw error('No existe credencial para el área "' + area + '".', 404);
  tocar('app');
  return sinClave(porArea(area));
}
