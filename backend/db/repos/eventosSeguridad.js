import { todos, ejecutar, aCamel } from '../conexion.js';

/**
 * Auditoría de seguridad: quién hizo qué, cuándo y desde dónde. Se guarda en
 * la misma base -no un archivo aparte- para no tener que rotarlo ni cuidar
 * permisos de un archivo nuevo; una tabla más no cuesta nada a este tamaño.
 *
 * Quien llama a `registrar()` es responsable de no pasar una clave, un token
 * ni el hash de una clave en `detalle`: esta función los guarda tal cual,
 * sin filtrar nada.
 */

export async function registrar(tipo, { usuario = '', ip = '', detalle = '' } = {}) {
  await ejecutar(
    'INSERT INTO eventos_seguridad (tipo, usuario, ip, detalle) VALUES (?, ?, ?, ?)',
    [String(tipo), String(usuario || ''), String(ip || ''), String(detalle || '').slice(0, 500)]
  );
}

export async function recientes(limite = 200) {
  // Math.max(1, …): con ?limite=-1 llegaba LIMIT -1 a SQLite, que significaba
  // sin límite, y se volcaba la tabla entera (en PostgreSQL sería un error).
  const n = Math.max(1, Math.min(Math.trunc(Number(limite)) || 200, 500));
  return (await todos('SELECT * FROM eventos_seguridad ORDER BY id DESC LIMIT ?', [n])).map(aCamel);
}
