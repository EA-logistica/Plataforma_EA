import { db, aCamel } from '../conexion.js';

/**
 * Auditoría de seguridad: quién hizo qué, cuándo y desde dónde. Se guarda en
 * la misma base -no un archivo aparte- para no tener que rotarlo ni cuidar
 * permisos de un archivo nuevo; una tabla más no cuesta nada a este tamaño.
 *
 * Quien llama a `registrar()` es responsable de no pasar una clave, un token
 * ni el hash de una clave en `detalle`: esta función los guarda tal cual,
 * sin filtrar nada.
 */

export function registrar(tipo, { usuario = '', ip = '', detalle = '' } = {}) {
  db().prepare(
    'INSERT INTO eventos_seguridad (tipo, usuario, ip, detalle) VALUES (?, ?, ?, ?)'
  ).run(String(tipo), String(usuario || ''), String(ip || ''), String(detalle || '').slice(0, 500));
}

export function recientes(limite = 200) {
  // Math.max(1, …): con ?limite=-1 llegaba LIMIT -1 a SQLite, que significa
  // sin límite, y se volcaba la tabla entera.
  const n = Math.max(1, Math.min(Math.trunc(Number(limite)) || 200, 500));
  return db().prepare('SELECT * FROM eventos_seguridad ORDER BY id DESC LIMIT ?').all(n).map(aCamel);
}
