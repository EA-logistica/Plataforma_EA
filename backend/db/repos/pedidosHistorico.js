import { db, aCamel } from '../conexion.js';
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

export function listar() {
  return db().prepare('SELECT * FROM pedidos_historico ORDER BY solicitado DESC').all().map(aCamel);
}

export const pendientes = () => listar().filter(p => p.estado === 'Pendiente');

export function pedir(area, dni) {
  const a = String(area || '').trim();
  if (!a) throw error('Falta el área.');

  const yaHay = db().prepare(
    "SELECT 1 FROM pedidos_historico WHERE area = ? AND estado = 'Pendiente'"
  ).get(a);
  if (yaHay) return { area: a, repetido: true };

  db().prepare(
    "INSERT INTO pedidos_historico (area, dni, solicitado, estado) VALUES (?, ?, ?, 'Pendiente')"
  ).run(a, String(dni || ''), new Date().toISOString());
  tocar('app');
  return { area: a, repetido: false };
}

export function resolver(id, estado) {
  if (!['Atendida', 'Rechazada'].includes(estado)) throw error('Estado inválido.');
  const r = db().prepare(
    "UPDATE pedidos_historico SET estado = ? WHERE id = ? AND estado = 'Pendiente'"
  ).run(estado, Number(id));
  if (!r.changes) throw error('No hay un pedido pendiente con ese id.', 404);
  tocar('app');
  return { id: Number(id), estado };
}
