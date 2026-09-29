import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { CONFIG, RAIZ } from '../config.js';

/**
 * Respaldo de la base PostgreSQL y de las guías subidas.
 *
 *     npm run db:respaldo
 *
 * Deja en PLANSA_RESPALDOS (por defecto respaldos/ en la raíz) una carpeta por
 * respaldo con:
 *   - plansa.dump  pg_dump en formato "custom": se restaura con pg_restore
 *   - uploads/     copia de las guías de entrega
 * y conserva los últimos PLANSA_RESPALDOS_MAX (14 por defecto).
 *
 * pg_dump saca una foto coherente aunque el servidor esté en uso: no hace
 * falta apagarlo. Lo programa una tarea de Windows (ver README).
 *
 * Restaurar (con el servidor apagado):
 *   pg_restore --clean --if-exists -d "<PLANSA_PG_URL>" respaldos/<fecha>/plansa.dump
 */

const destinoBase = process.env.PLANSA_RESPALDOS ? path.resolve(process.env.PLANSA_RESPALDOS) : path.join(RAIZ, 'respaldos');
const conservar = Number(process.env.PLANSA_RESPALDOS_MAX) || 14;

function binario(nombre) {
  const candidatos = [];
  for (const base of ['C:/Program Files/PostgreSQL', 'C:/Program Files (x86)/PostgreSQL']) {
    if (!fs.existsSync(base)) continue;
    for (const v of fs.readdirSync(base).sort((a, b) => Number(b) - Number(a))) {
      candidatos.push(path.join(base, v, 'bin', nombre + '.exe'));
    }
  }
  return candidatos.find(p => fs.existsSync(p)) || nombre;
}

const sello = new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', '');
const carpeta = path.join(destinoBase, sello);
fs.mkdirSync(carpeta, { recursive: true });

const dump = path.join(carpeta, 'plansa.dump');
const r = spawnSync(binario('pg_dump'), ['--format=custom', '--no-owner', '--file', dump, '--dbname', CONFIG.postgres], {
  stdio: ['ignore', 'inherit', 'inherit']
});
if (r.error || r.status !== 0) {
  console.error('Falló pg_dump' + (r.error ? ': ' + r.error.message : ' (código ' + r.status + ')'));
  fs.rmSync(carpeta, { recursive: true, force: true });
  process.exit(1);
}

if (fs.existsSync(CONFIG.subidas)) {
  fs.cpSync(CONFIG.subidas, path.join(carpeta, 'uploads'), { recursive: true });
}

// Rotación: las carpetas se llaman por fecha, así que ordenarlas por nombre es
// ordenarlas por antigüedad.
const todas = fs.readdirSync(destinoBase, { withFileTypes: true })
  .filter(d => d.isDirectory() && /^\d{4}-\d{2}-\d{2}_\d{4}$/.test(d.name))
  .map(d => d.name).sort();
for (const vieja of todas.slice(0, Math.max(0, todas.length - conservar))) {
  fs.rmSync(path.join(destinoBase, vieja), { recursive: true, force: true });
}

const mb = (fs.statSync(dump).size / 1024 / 1024).toFixed(1);
console.log('Respaldo listo: ' + carpeta + ' (' + mb + ' MB). Se conservan los últimos ' + conservar + '.');
