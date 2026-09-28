import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from '../config.js';
import { migrar } from './migrar.js';

/**
 * Conexión a SQLite. Único punto del proyecto que abre la base.
 *
 * Se usa `node:sqlite`, que viene incorporado en Node 22.5 en adelante, en vez
 * de better-sqlite3 o sqlite3: ninguna dependencia nativa que compilar, que en
 * Windows sin herramientas de build es la diferencia entre funcionar y no.
 *
 * La API es síncrona a propósito. Con SQLite en disco local una consulta tarda
 * microsegundos, y el código queda mucho más simple que envolviendo todo en
 * promesas para nada. Las rutas de Express sí son asíncronas donde toca (la
 * subida de archivos), pero las consultas no lo necesitan.
 */

let bd = null;

export function abrir() {
  if (bd) return bd;

  fs.mkdirSync(path.dirname(CONFIG.baseDatos), { recursive: true });
  bd = new DatabaseSync(CONFIG.baseDatos);

  // WAL: permite leer mientras se escribe. Con varias pestañas abiertas
  // consultando la bandeja, evita bloqueos.
  bd.exec('PRAGMA journal_mode = WAL');
  bd.exec('PRAGMA foreign_keys = ON');
  // Espera en vez de fallar si otra escritura tiene la base tomada.
  bd.exec('PRAGMA busy_timeout = 5000');
  // Con WAL, NORMAL es seguro contra corrupción (solo un corte de luz puede
  // perder la última transacción confirmada) y ahorra un fsync por cada
  // escritura: con 50 personas registrando, ese fsync es lo que más tarda.
  bd.exec('PRAGMA synchronous = NORMAL');
  // 64 MB de caché de páginas (el default son 2 MB): la base entera ronda los
  // 30 MB, así que queda en memoria y los agregados no vuelven al disco.
  bd.exec('PRAGMA cache_size = -65536');
  // GROUP BY / DISTINCT / ORDER BY sin índice arman b-trees temporales;
  // en memoria en vez de en un archivo temporal.
  bd.exec('PRAGMA temp_store = MEMORY');
  // mmap_size queda en 0 a propósito: con la caché de arriba la base ya vive
  // en memoria, y en Windows (y en una carpeta de OneDrive) un archivo
  // mapeado complica que otro proceso lo copie o lo sincronice.

  const esquema = fs.readFileSync(path.join(import.meta.dirname, 'esquema.sql'), 'utf8');
  bd.exec(esquema);

  // esquema.sql es CREATE TABLE IF NOT EXISTS: le sirve a una base nueva, pero
  // no le cambia nada a una que ya existía con una forma anterior. Eso lo hace
  // migrar(), que recorre las migraciones pendientes contra `ajustes` (ver
  // db/migrar.js). Import circular seguro: db() y migrar() son funciones
  // declaradas (hoisted), no se llaman hasta aquí, mucho después de que ambos
  // módulos ya terminaron de evaluarse.
  migrar();

  return bd;
}

export function cerrar() {
  if (!bd) return;
  // Estadísticas para el planificador y el WAL volcado a la base principal
  // antes de cerrar: el archivo -wal no queda creciendo entre arranques.
  try { bd.exec('PRAGMA optimize'); bd.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch (_) { /* best effort */ }
  bd.close();
  bd = null;
}

/** La conexión ya abierta. Falla claro si alguien la pide antes de tiempo. */
export function db() {
  if (!bd) throw new Error('La base no está abierta. Llama a abrir() durante el arranque.');
  return bd;
}

/**
 * Ejecuta varias escrituras como una sola operación: o entran todas o no entra
 * ninguna. Importante al sembrar y al mover un ticket de estado, donde un
 * corte a media escritura dejaría la base incoherente.
 */
export function enTransaccion(fn) {
  const base = db();
  base.exec('BEGIN');
  try {
    const r = fn(base);
    base.exec('COMMIT');
    return r;
  } catch (e) {
    base.exec('ROLLBACK');
    throw e;
  }
}

// ------------------------------------------------- traducción de nombres
// La base usa snake_case y el JavaScript camelCase. La conversión vive aquí
// para que ningún repositorio tenga que repetirla a mano.

export const aCamel = fila => {
  if (!fila) return null;
  const salida = {};
  for (const [k, v] of Object.entries(fila)) {
    salida[k.replace(/_([a-z])/g, (_, c) => c.toUpperCase())] = v;
  }
  return salida;
};

export const aSnake = obj => {
  const salida = {};
  for (const [k, v] of Object.entries(obj)) {
    salida[k.replace(/[A-Z]/g, c => '_' + c.toLowerCase())] = v;
  }
  return salida;
};
