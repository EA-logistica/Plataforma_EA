import fs from 'node:fs';
import path from 'node:path';
import { db, aCamel } from '../conexion.js';
import { CONFIG } from '../../config.js';
import { tocar } from './ajustes.js';

/**
 * Guías de entrega: metadatos en SQLite, binarios en uploads/.
 *
 * La base guarda con qué nombre quedó el archivo en disco, no el archivo. Así
 * la base se mantiene pequeña y rápida, los archivos se respaldan por separado
 * y servirlos es un `sendFile` en vez de sacar un blob de una consulta.
 *
 * El precio de separarlos es que pueden desincronizarse, y eso se atiende:
 * al borrar un registro se borra el archivo, y `huerfanos()` encuentra lo que
 * haya quedado suelto.
 */

const error = (msg, status = 400) => Object.assign(new Error(msg), { status });

export const rutaDe = archivo => path.join(CONFIG.subidas, path.basename(archivo));

export function listar() {
  return db().prepare('SELECT * FROM adjuntos ORDER BY subido_en DESC').all().map(aCamel);
}

export function deTicket(ticketId) {
  return db().prepare(
    'SELECT * FROM adjuntos WHERE ticket_id = ? ORDER BY subido_en DESC'
  ).all(String(ticketId)).map(aCamel);
}

/** Los adjuntos de varios tickets a la vez: para el paquete que se manda al solicitante. */
export function deTickets(ticketIds) {
  if (!ticketIds.length) return [];
  const marcas = ticketIds.map(() => '?').join(',');
  return db().prepare(
    'SELECT * FROM adjuntos WHERE ticket_id IN (' + marcas + ') ORDER BY subido_en DESC'
  ).all(...ticketIds).map(aCamel);
}

export function porId(id) {
  return aCamel(db().prepare('SELECT * FROM adjuntos WHERE id = ?').get(String(id)));
}

/**
 * Registra un archivo que multer ya dejó en disco.
 * @param {object} datos { ticketId, archivo, nombreOriginal, tipo, tamano, subidoPor }
 */
export function registrar(datos) {
  const existe = db().prepare('SELECT 1 FROM solicitudes WHERE id = ?').get(String(datos.ticketId));
  if (!existe) throw error('No existe el ticket ' + datos.ticketId + '.', 404);

  const id = crypto.randomUUID();
  db().prepare(
    'INSERT INTO adjuntos (id, ticket_id, nombre_original, archivo, tipo, tamano, subido_por, subido_en) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(id, String(datos.ticketId), datos.nombreOriginal, datos.archivo,
        datos.tipo || '', datos.tamano || 0, datos.subidoPor || 'Logística',
        new Date().toISOString());
  tocar('app');
  return porId(id);
}

/** Borra el registro y, después, el archivo. Ese orden importa: ver abajo. */
export function eliminar(id) {
  const a = porId(id);
  if (!a) throw error('No existe ese adjunto.', 404);

  db().prepare('DELETE FROM adjuntos WHERE id = ?').run(String(id));
  // Si el borrado del archivo falla (permisos, archivo en uso), el registro ya
  // se fue y queda un huérfano en disco: molesto pero inofensivo. Al revés
  // sería peor: un registro apuntando a un archivo que ya no está.
  try { fs.unlinkSync(rutaDe(a.archivo)); } catch (e) { /* ya no estaba */ }
  tocar('app');
  return { id };
}

/** Archivos en uploads/ que ninguna fila reclama. Para limpiar de vez en cuando. */
export function huerfanos() {
  if (!fs.existsSync(CONFIG.subidas)) return [];
  const registrados = new Set(listar().map(a => a.archivo));
  return fs.readdirSync(CONFIG.subidas).filter(f => f !== '.gitkeep' && !registrados.has(f));
}
