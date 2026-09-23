import { db, aCamel } from '../conexion.js';
import { normalizarDoc, DOC_VALIDO } from '#shared/documento.js';
import { tocar } from './ajustes.js';

/**
 * Pedidos de acceso de quien intentó entrar sin figurar en el padrón.
 *
 * Es la única vía por la que alguien de fuera deja rastro en el sistema. Con
 * solo el DNI, admin no tenía forma de saber a quién estaba habilitando ni de
 * contactarlo para confirmar; por eso apellidos, nombres y celular son
 * obligatorios para pedirla -email y área quedan a criterio de quien la pide,
 * porque no siempre se conocen o aplican-.
 */

const error = (msg, status = 400) => Object.assign(new Error(msg), { status });

const EMAIL_VALIDO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LARGO_MAX = { apellidos: 120, nombres: 120, email: 150, area: 120 };

function tope(campo, valor) {
  if (valor.length > LARGO_MAX[campo]) {
    throw error('El campo "' + campo + '" no puede superar los ' + LARGO_MAX[campo] + ' caracteres.');
  }
}

export function listar() {
  return db().prepare('SELECT * FROM autorizaciones ORDER BY solicitado DESC').all().map(aCamel);
}

export const pendientes = () =>
  listar().filter(a => a.estado === 'Pendiente');

export function pedir(doc, datos = {}) {
  const dni = normalizarDoc(doc);
  if (!DOC_VALIDO.test(dni)) throw error('Documento inválido.');

  const apellidos = String(datos.apellidos || '').trim();
  const nombres = String(datos.nombres || '').trim();
  const celular = String(datos.celular || '').replace(/\D/g, '');
  const email = String(datos.email || '').trim();
  const area = String(datos.area || '').trim();

  if (apellidos.length < 2) throw error('Escribe los apellidos de quien solicita el acceso.');
  if (nombres.length < 2) throw error('Escribe los nombres de quien solicita el acceso.');
  if (celular.length < 9 || celular.length > 11) throw error('Ingresa un celular válido de 9 dígitos.');
  if (email && !EMAIL_VALIDO.test(email)) throw error('El email no tiene un formato válido.');
  tope('apellidos', apellidos); tope('nombres', nombres); tope('email', email); tope('area', area);

  const yaHay = db().prepare(
    "SELECT 1 FROM autorizaciones WHERE dni = ? AND estado = 'Pendiente'"
  ).get(dni);
  if (yaHay) return { dni, repetido: true };

  db().prepare(
    "INSERT INTO autorizaciones (dni, apellidos, nombres, celular, email, area, solicitado, estado) "
    + "VALUES (?, ?, ?, ?, ?, ?, ?, 'Pendiente')"
  ).run(dni, apellidos, nombres, celular, email, area, new Date().toISOString());
  tocar();
  return { dni, repetido: false };
}

export function resolver(doc, estado) {
  if (!['Aprobada', 'Rechazada'].includes(estado)) throw error('Estado inválido.');
  const dni = normalizarDoc(doc);
  const r = db().prepare(
    "UPDATE autorizaciones SET estado = ? WHERE dni = ? AND estado = 'Pendiente'"
  ).run(estado, dni);
  if (!r.changes) throw error('No hay un pedido pendiente para el documento ' + dni + '.', 404);
  tocar();
  return { dni, estado };
}
