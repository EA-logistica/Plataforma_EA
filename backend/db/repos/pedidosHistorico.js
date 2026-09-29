import { todos, uno, ejecutar, aCamel } from '../conexion.js';
import { tocar } from './ajustes.js';

/**
 * Pedidos de un área para ver más de sus últimos 5 servicios (uno más viejo,
 * o el histórico completo). Resolverlo a "Atendida" es solo una marca de
 * seguimiento -admin ya tiene el histórico completo en su propia pantalla y
 * se lo hace llegar al área por fuera de la aplicación-, no un mecanismo que
 * desbloquee algo solo: mismo espíritu que "Aprobar" en `autorizaciones`, que
 * tampoco hace nada por sí mismo más allá de dar de alta a la persona aparte.
 */

const error = (msg, status = 400) => Object.assign(new Error(msg), { status });

export async function listar() {
  return (await todos('SELECT * FROM pedidos_historico ORDER BY solicitado DESC')).map(aCamel);
}

export const pendientes = async () => (await listar()).filter(p => p.estado === 'Pendiente');

export async function pedir(area, dni) {
  const a = String(area || '').trim();
  if (!a) throw error('Falta el área.');

  const yaHay = await uno(
    "SELECT 1 FROM pedidos_historico WHERE area = ? AND estado = 'Pendiente'", [a]
  );
  if (yaHay) return { area: a, repetido: true };

  await ejecutar(
    "INSERT INTO pedidos_historico (area, dni, solicitado, estado) VALUES (?, ?, ?, 'Pendiente')",
    [a, String(dni || ''), new Date().toISOString()]
  );
  await tocar('app');
  return { area: a, repetido: false };
}

export async function resolver(id, estado) {
  if (!['Atendida', 'Rechazada'].includes(estado)) throw error('Estado inválido.');
  // `id` es INTEGER: un id que no es entero (NaN, '1.5', 'abc') en PostgreSQL
  // haría fallar la consulta con 500; en SQLite simplemente no coincidía con
  // nada. Se responde igual que antes: 404.
  const n = Number(id);
  const r = Number.isSafeInteger(n)
    ? await ejecutar("UPDATE pedidos_historico SET estado = ? WHERE id = ? AND estado = 'Pendiente'", [estado, n])
    : { changes: 0 };
  if (!r.changes) throw error('No hay un pedido pendiente con ese id.', 404);
  await tocar('app');
  return { id: n, estado };
}
