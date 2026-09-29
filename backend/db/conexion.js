import fs from 'node:fs';
import path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import pg from 'pg';
import { CONFIG } from '../config.js';
import { migrar } from './migrar.js';

/**
 * Conexión a PostgreSQL. Único punto del proyecto que abre la base.
 *
 * Antes era SQLite síncrono (`node:sqlite`); ahora es un pool de `pg` y toda
 * consulta es asíncrona. Los repositorios no ven el pool: usan `todos()`,
 * `uno()` y `ejecutar()` de acá, que aceptan el SQL con los mismos
 * marcadores de siempre -`?` posicionales o `@nombre` con un objeto- y los
 * traducen a los `$1, $2…` de PostgreSQL. Así la migración de cada consulta
 * se limitó al SQL que de verdad cambia entre motores.
 *
 * Transacciones: `enTransaccion(fn)` toma un cliente del pool y lo deja en un
 * AsyncLocalStorage mientras corre `fn`. Cualquier `todos/uno/ejecutar` que se
 * llame dentro -aunque sea desde otro repositorio- usa ese mismo cliente, sin
 * tener que pasarlo a mano. Una transacción dentro de otra reutiliza la de
 * afuera.
 */

const { Pool, types } = pg;

// COUNT(*) y SUM de enteros vuelven como bigint (int8) y AVG/ROUND como
// numeric: pg los entrega como string para no perder precisión. Los montos y
// conteos de acá entran de sobra en un double, y el resto del código (igual
// que con SQLite) espera números.
types.setTypeParser(20, v => Number(v));    // int8
types.setTypeParser(1700, v => Number(v));  // numeric

let pool = null;
const contexto = new AsyncLocalStorage();

export async function abrir() {
  if (pool) return pool;
  pool = new Pool({
    connectionString: CONFIG.postgres,
    max: 10,
    // Las columnas de fecha son TEXT (heredadas de SQLite), pero por si alguna
    // función usa now(): todo en UTC, igual que datetime('now') de antes.
    options: '-c TimeZone=UTC'
  });
  pool.on('error', err => console.error('[postgres] conexión ociosa con error:', err.message));

  try {
    await pool.query('SELECT 1');
  } catch (e) {
    const p = pool; pool = null; await p.end().catch(() => {});
    throw Object.assign(new Error('No se pudo conectar a PostgreSQL (' + describir(CONFIG.postgres) + '): '
      + e.message + '\n¿Está corriendo el servicio de PostgreSQL y es correcta PLANSA_PG_URL en .env?'), { cause: e });
  }

  const esquema = fs.readFileSync(path.join(import.meta.dirname, 'esquema.sql'), 'utf8');
  // Varios procesos arrancando a la vez (pruebas, un reinicio) no deben pisarse
  // creando las mismas tablas: el candado consultivo los pone en fila.
  const cliente = await pool.connect();
  try {
    await cliente.query('SELECT pg_advisory_lock(727301)');
    await cliente.query(esquema);
  } finally {
    await cliente.query('SELECT pg_advisory_unlock(727301)').catch(() => {});
    cliente.release();
  }

  await migrar();
  return pool;
}

export async function cerrar() {
  if (!pool) return;
  const p = pool;
  pool = null;
  await p.end();
}

/** Dirección de la base sin la clave, para mensajes y el log de arranque. */
export function describir(url = CONFIG.postgres) {
  try {
    const u = new URL(url);
    return (u.username ? u.username + '@' : '') + u.host + u.pathname;
  } catch (_) { return '(PLANSA_PG_URL inválida)'; }
}

function ejecutor() {
  const tx = contexto.getStore();
  if (tx) return tx.cliente;
  if (!pool) throw new Error('La base no está abierta. Llama a abrir() durante el arranque.');
  return pool;
}

/**
 * Traduce `?` y `@nombre` a `$n`, saltando lo que está entre comillas simples
 * o dobles y los `::tipo` de PostgreSQL. `params` es un arreglo (para `?`) o
 * un objeto (para `@nombre`).
 */
const cacheSql = new Map();
export function traducir(sql, params) {
  const conObjeto = params != null && !Array.isArray(params) && typeof params === 'object';
  const clave = (conObjeto ? 'o|' : 'a|') + sql;
  let plan = cacheSql.get(clave);
  if (!plan) {
    let salida = '', n = 0;
    const nombres = [], indices = new Map();
    for (let i = 0; i < sql.length; i++) {
      const c = sql[i];
      if (c === "'" || c === '"') {
        const fin = sql.indexOf(c, i + 1);
        const hasta = fin === -1 ? sql.length : fin + 1;
        salida += sql.slice(i, hasta);
        i = hasta - 1;
      } else if (c === '?' && !conObjeto) {
        salida += '$' + (++n);
      } else if (c === '@' && conObjeto && /[A-Za-z_]/.test(sql[i + 1] || '')) {
        let j = i + 1;
        while (j < sql.length && /[A-Za-z0-9_]/.test(sql[j])) j++;
        const nombre = sql.slice(i + 1, j);
        if (!indices.has(nombre)) { indices.set(nombre, nombres.length + 1); nombres.push(nombre); }
        salida += '$' + indices.get(nombre);
        i = j - 1;
      } else {
        salida += c;
      }
    }
    plan = { texto: salida, nombres };
    if (cacheSql.size > 2000) cacheSql.clear();
    cacheSql.set(clave, plan);
  }
  const valores = conObjeto ? plan.nombres.map(k => normalizar(params[k])) : (params || []).map(normalizar);
  return { text: plan.texto, values: valores };
}

// SQLite aceptaba booleanos y undefined como 1/0 y NULL; pg no los adivina
// igual en columnas INTEGER, así que se normalizan acá una sola vez.
const normalizar = v => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v);

/** Todas las filas. */
export async function todos(sql, params) {
  const r = await ejecutor().query(traducir(sql, params));
  return r.rows;
}

/** La primera fila, o undefined. */
export async function uno(sql, params) {
  const r = await ejecutor().query(traducir(sql, params));
  return r.rows[0];
}

/**
 * Escritura. `changes` es el número de filas tocadas (lo que daba `.run()`
 * en SQLite) y `filas` lo que devuelva un RETURNING, si lo hay.
 */
export async function ejecutar(sql, params) {
  const r = await ejecutor().query(traducir(sql, params));
  return { changes: r.rowCount ?? 0, filas: r.rows };
}

/** Varias sentencias SQL sin parámetros, separadas por `;`. */
export async function ejecutarVarias(sql) {
  await ejecutor().query(sql);
}

/**
 * Inserta muchas filas en tandas de un solo INSERT … VALUES (…), (…): con
 * decenas de miles de filas del ERP, una consulta por fila eran decenas de
 * miles de viajes al servidor. `filas` son objetos con las claves de
 * `columnas`; `sufijo` va al final de cada INSERT (p. ej. un ON CONFLICT).
 * Devuelve cuántas filas entraron de verdad.
 */
export async function insertarLote(tabla, columnas, filas, sufijo = '') {
  if (!filas.length) return 0;
  // PostgreSQL admite hasta 65535 parámetros por consulta.
  const porTanda = Math.max(1, Math.floor(60000 / columnas.length));
  let total = 0;
  for (let i = 0; i < filas.length; i += porTanda) {
    const tanda = filas.slice(i, i + porTanda);
    const valores = [];
    const grupos = tanda.map((f, t) => '(' + columnas.map((c, k) => {
      valores.push(normalizar(f[c]));
      return '$' + (t * columnas.length + k + 1);
    }).join(', ') + ')');
    const r = await ejecutor().query({
      text: 'INSERT INTO ' + tabla + ' (' + columnas.join(', ') + ') VALUES ' + grupos.join(', ') + (sufijo ? ' ' + sufijo : ''),
      values: valores
    });
    total += r.rowCount ?? 0;
  }
  return total;
}

/**
 * Corre `fn` cuando lo escrito ya es visible para las demás conexiones: al
 * instante fuera de una transacción, o justo después del COMMIT dentro de una.
 * Lo usa ajustes.tocar() para vaciar la caché de respuestas: si la vaciara
 * solo antes del COMMIT, un GET que entrara en ese hueco leería lo viejo y lo
 * dejaría guardado como vigente.
 */
export function trasConfirmar(fn) {
  const tx = contexto.getStore();
  if (tx) tx.trasConfirmar.push(fn); else fn();
}

/**
 * Ejecuta varias escrituras como una sola operación: o entran todas o no entra
 * ninguna. Importante al sembrar y al mover un ticket de estado, donde un
 * corte a media escritura dejaría la base incoherente.
 */
export async function enTransaccion(fn) {
  if (contexto.getStore()) return fn();
  if (!pool) throw new Error('La base no está abierta. Llama a abrir() durante el arranque.');
  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    const tx = { cliente, trasConfirmar: [] };
    const r = await contexto.run(tx, fn);
    await cliente.query('COMMIT');
    for (const f of tx.trasConfirmar) f();
    return r;
  } catch (e) {
    await cliente.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    cliente.release();
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
