import { db, aCamel } from '../db/conexion.js';
import { tocar } from '../db/repos/ajustes.js';

/**
 * Cuentas de logística (admin / seguimiento). El padrón de personal (quién
 * puede PEDIR un servicio) es otra tabla y otro repositorio: aquí solo vive
 * quién puede ENTRAR a despachar, ver indicadores o administrar el padrón.
 */

const error = (msg, status = 400) => Object.assign(new Error(msg), { status });

/** Nunca debe salir del servidor: se quita antes de responder al navegador. */
const sinClave = u => {
  if (!u) return u;
  const { claveHash, ...resto } = u;
  return resto;
};

export function listar() {
  return db().prepare('SELECT * FROM usuarios ORDER BY creado_en').all().map(aCamel).map(sinClave);
}

/** Con el hash incluido: solo para uso interno (autenticar, cambiar clave). */
export function porUsuario(usuario) {
  const nombre = String(usuario || '').trim().toLowerCase();
  if (!nombre) return null;
  return aCamel(db().prepare('SELECT * FROM usuarios WHERE usuario = ?').get(nombre));
}

export function porId(id) {
  return aCamel(db().prepare('SELECT * FROM usuarios WHERE id = ?').get(id));
}

export function total() {
  return db().prepare('SELECT COUNT(*) AS n FROM usuarios').get().n;
}

export function crear({ usuario, claveHash, rol, creadoPor }) {
  const nombre = String(usuario || '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,32}$/.test(nombre)) {
    throw error('El usuario debe tener de 3 a 32 caracteres: minúsculas, números, punto, guion o guion bajo.');
  }
  if (!['admin', 'seguimiento'].includes(rol)) throw error('El rol debe ser "admin" o "seguimiento".');
  if (porUsuario(nombre)) throw error('Ya existe el usuario ' + nombre + '.', 409);

  db().prepare(
    'INSERT INTO usuarios (usuario, clave_hash, rol, creado_por, creado_en) VALUES (?, ?, ?, ?, ?)'
  ).run(nombre, claveHash, rol, String(creadoPor || ''), new Date().toISOString());
  tocar('app');
  return sinClave(porUsuario(nombre));
}

export function cambiarClave(id, claveHash, { debeCambiar }) {
  const r = db().prepare(
    'UPDATE usuarios SET clave_hash = ?, debe_cambiar_clave = ? WHERE id = ?'
  ).run(claveHash, debeCambiar ? 1 : 0, id);
  if (!r.changes) throw error('No existe ese usuario.', 404);
  tocar('app');
}

export function cambiarEstado(id, activo) {
  const r = db().prepare('UPDATE usuarios SET activo = ? WHERE id = ?').run(activo ? 1 : 0, id);
  if (!r.changes) throw error('No existe ese usuario.', 404);
  tocar('app');
  return sinClave(porId(id));
}

export const hayAdmin = () => !!db().prepare("SELECT 1 FROM usuarios WHERE rol = 'admin'").get();
