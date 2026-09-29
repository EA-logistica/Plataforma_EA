import { todos, uno, ejecutar, aCamel } from '../db/conexion.js';
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

// `id` es INTEGER. Las rutas pasan Number(req.params.id), que puede ser NaN:
// en SQLite eso no coincidía con nada; en PostgreSQL haría fallar la consulta
// con un 500. Un id que no es entero se trata como "no existe", igual que antes.
const idValido = id => Number.isSafeInteger(Number(id));

export async function listar() {
  return (await todos('SELECT * FROM usuarios ORDER BY creado_en')).map(aCamel).map(sinClave);
}

/** Con el hash incluido: solo para uso interno (autenticar, cambiar clave). */
export async function porUsuario(usuario) {
  const nombre = String(usuario || '').trim().toLowerCase();
  if (!nombre) return null;
  return aCamel(await uno('SELECT * FROM usuarios WHERE usuario = ?', [nombre]));
}

export async function porId(id) {
  if (!idValido(id)) return null;
  return aCamel(await uno('SELECT * FROM usuarios WHERE id = ?', [Number(id)]));
}

export async function total() {
  return (await uno('SELECT COUNT(*) AS n FROM usuarios')).n;
}

export async function crear({ usuario, claveHash, rol, creadoPor }) {
  const nombre = String(usuario || '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,32}$/.test(nombre)) {
    throw error('El usuario debe tener de 3 a 32 caracteres: minúsculas, números, punto, guion o guion bajo.');
  }
  if (!['admin', 'seguimiento'].includes(rol)) throw error('El rol debe ser "admin" o "seguimiento".');
  if (await porUsuario(nombre)) throw error('Ya existe el usuario ' + nombre + '.', 409);

  await ejecutar(
    'INSERT INTO usuarios (usuario, clave_hash, rol, creado_por, creado_en) VALUES (?, ?, ?, ?, ?)',
    [nombre, claveHash, rol, String(creadoPor || ''), new Date().toISOString()]
  );
  await tocar('app');
  return sinClave(await porUsuario(nombre));
}

export async function cambiarClave(id, claveHash, { debeCambiar }) {
  const r = idValido(id)
    ? await ejecutar(
      'UPDATE usuarios SET clave_hash = ?, debe_cambiar_clave = ? WHERE id = ?',
      [claveHash, debeCambiar ? 1 : 0, Number(id)]
    )
    : { changes: 0 };
  if (!r.changes) throw error('No existe ese usuario.', 404);
  await tocar('app');
}

export async function cambiarEstado(id, activo) {
  const r = idValido(id)
    ? await ejecutar('UPDATE usuarios SET activo = ? WHERE id = ?', [activo ? 1 : 0, Number(id)])
    : { changes: 0 };
  if (!r.changes) throw error('No existe ese usuario.', 404);
  await tocar('app');
  return sinClave(await porId(id));
}

export const hayAdmin = async () => !!(await uno("SELECT 1 FROM usuarios WHERE rol = 'admin'"));
