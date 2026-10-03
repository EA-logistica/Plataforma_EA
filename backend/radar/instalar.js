import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from '../config.js';
import { urlPython } from './worker.js';

/**
 * Prepara el ETL de Radar en esta PC (una vez, o al cambiar requirements.lock):
 *
 *   npm run radar:instalar            crea backend/radar/etl/.venv, instala las
 *                                     dependencias fijadas y el Chromium de Playwright
 *   npm run radar:test                corre las pruebas del ETL contra esta PostgreSQL
 *                                     (cada prueba usa un esquema temporal y lo borra)
 *
 * Requiere Python 3.12 o superior. Se busca en RADAR_PYTHON_BASE, luego "py -3"
 * y "python" del PATH.
 */

const etl = CONFIG.radar.etl;
const venvPython = CONFIG.radar.python;

function correr(cmd, args, opciones = {}) {
  console.log('> ' + [cmd, ...args].join(' '));
  const r = spawnSync(cmd, args, { stdio: 'inherit', cwd: etl, ...opciones });
  if (r.status !== 0) throw new Error(cmd + ' terminó con código ' + r.status);
}

function pythonBase() {
  const candidatos = [
    process.env.RADAR_PYTHON_BASE && [process.env.RADAR_PYTHON_BASE, []],
    ['py', ['-3']],
    ['python', []]
  ].filter(Boolean);
  for (const [cmd, pre] of candidatos) {
    const r = spawnSync(cmd, [...pre, '-c', 'import sys; print(sys.version_info >= (3, 12))'], { encoding: 'utf8' });
    if (r.status === 0 && r.stdout.trim() === 'True') return [cmd, pre];
  }
  throw new Error('No se encontró Python 3.12+. Instálalo o indica su ruta en RADAR_PYTHON_BASE.');
}

if (process.argv.includes('--probar')) {
  correr(venvPython, ['-m', 'pytest', '-q'], { env: { ...process.env, TEST_DATABASE_URL: urlPython().replace(/[?&]options=[^&]*/, '') } });
} else {
  if (!fs.existsSync(venvPython)) {
    const [cmd, pre] = pythonBase();
    correr(cmd, [...pre, '-m', 'venv', path.join(etl, '.venv')]);
  }
  correr(venvPython, ['-m', 'pip', 'install', '-q', '-r', 'requirements.lock']);
  correr(venvPython, ['-m', 'playwright', 'install', 'chromium']);
  fs.mkdirSync(CONFIG.radar.raw, { recursive: true });
  console.log('\nListo. El servidor de la plataforma lanzará el worker de Radar al arrancar.');
}
