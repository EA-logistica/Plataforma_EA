/**
 * Base PostgreSQL desechable para las pruebas.
 *
 * Con SQLite bastaba un archivo en una carpeta temporal; con PostgreSQL se
 * crea una base nueva (plansa_prueba_<azar>) en el mismo servidor que usa la
 * aplicación, se apunta PLANSA_PG_URL a ella y al terminar se borra. Así correr
 * las pruebas nunca toca la base real.
 *
 * El usuario de .env necesita permiso CREATEDB (la instalación se lo da).
 * Hay que llamar a crearBaseTemporal() ANTES de importar nada de backend/,
 * porque backend/config.js lee PLANSA_PG_URL al cargarse.
 */
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const RAIZ = path.resolve(import.meta.dirname, '..');

function urlBase() {
  if (process.env.PLANSA_PG_URL) return process.env.PLANSA_PG_URL;
  const env = path.join(RAIZ, '.env');
  if (fs.existsSync(env)) {
    const m = fs.readFileSync(env, 'utf8').match(/^\s*PLANSA_PG_URL\s*=\s*(.*?)\s*$/m);
    if (m) return m[1].replace(/^(['"])(.*)\1$/, '$2');
  }
  return 'postgresql://plansa@localhost:5432/plansa';
}

export async function crearBaseTemporal() {
  const base = new URL(urlBase());
  const nombre = 'plansa_prueba_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  const admin = new URL(base); admin.pathname = '/postgres';
  const cliente = new pg.Client({ connectionString: admin.href });
  await cliente.connect();
  await cliente.query(`CREATE DATABASE ${nombre} ENCODING 'UTF8' LOCALE_PROVIDER 'builtin' BUILTIN_LOCALE 'C' TEMPLATE template0`);
  await cliente.end();

  const prueba = new URL(base); prueba.pathname = '/' + nombre;
  process.env.PLANSA_PG_URL = prueba.href;

  return async function borrar() {
    const c = new pg.Client({ connectionString: admin.href });
    await c.connect();
    await c.query(`DROP DATABASE IF EXISTS ${nombre} WITH (FORCE)`);
    await c.end();
  };
}
