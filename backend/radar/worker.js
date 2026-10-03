import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from '../config.js';
import { uno } from '../db/conexion.js';
import { encolar } from './consultas.js';

/**
 * El ETL de Radar (Python: descarga de bases SUNAT, normalización, grados)
 * corre como un proceso hijo de ESTE servidor -no como un servicio aparte que
 * alguien tenga que acordarse de levantar-:
 *   - lo lanza con la base de la plataforma (esquema "radar") y la carpeta de
 *     originales de la plataforma: no hay otra base ni otro .env a los que
 *     pueda escribir, así que no puede quedar desincronizado;
 *   - si se cae, lo vuelve a levantar (espera creciente, hasta 5 minutos);
 *   - cada CONFIG.radar.cadaHoras encola una actualización de las últimas
 *     CONFIG.radar.semanas semanas publicadas, si no hay otra en curso.
 * El worker de Python toma un advisory lock: aunque se lanzaran dos, solo uno
 * procesa la cola.
 */

const estado = { activo: false, motivo: 'Sin iniciar', reinicios: 0, desde: null, ultimoMensaje: '', ultimoError: '' };
let proceso = null;
let detenido = false;
let timerReinicio = null;
let timerProgramacion = null;

export const estadoWorker = () => ({ ...estado, python: CONFIG.radar.python, raw: CONFIG.radar.raw });

/** postgresql://… de la plataforma → URL de SQLAlchemy/psycopg con search_path=radar. */
export function urlPython(url = CONFIG.postgres) {
  const u = new URL(url);
  u.protocol = 'postgresql+psycopg:';
  u.searchParams.set('options', '-csearch_path=radar');
  return u.toString();
}

function registro() {
  const dir = path.join(path.dirname(CONFIG.radar.raw), 'logs');
  fs.mkdirSync(dir, { recursive: true });
  return fs.createWriteStream(path.join(dir, 'worker.log'), { flags: 'a' });
}

function lanzar({ silencioso }) {
  if (detenido) return;
  const log = registro();
  const hijo = spawn(CONFIG.radar.python, ['-m', 'radar.worker'], {
    cwd: CONFIG.radar.etl,
    env: { ...process.env, DATABASE_URL: urlPython(), RAW_DIR: CONFIG.radar.raw, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
  proceso = hijo;
  Object.assign(estado, { activo: true, motivo: 'En ejecución', desde: new Date().toISOString() });
  const leer = buf => {
    log.write(buf);
    const lineas = String(buf).trim().split(/\r?\n/);
    const ultima = lineas[lineas.length - 1];
    if (ultima) estado.ultimoMensaje = ultima.slice(0, 300);
    const err = lineas.filter(l => /ERROR|Traceback|Error:/.test(l)).pop();
    if (err) estado.ultimoError = err.slice(0, 300);
  };
  hijo.stdout.on('data', leer);
  hijo.stderr.on('data', leer);
  hijo.on('error', e => { estado.ultimoError = e.message; });
  hijo.on('exit', codigo => {
    log.end();
    proceso = null;
    estado.activo = false;
    if (detenido) { estado.motivo = 'Detenido'; return; }
    estado.reinicios++;
    const espera = Math.min(5 * 60000, 5000 * 2 ** Math.min(estado.reinicios, 6));
    estado.motivo = 'Se detuvo (código ' + codigo + '); reintenta en ' + Math.round(espera / 1000) + ' s';
    if (!silencioso) console.error('[radar] el worker se detuvo (código ' + codigo + '): ' + (estado.ultimoError || estado.ultimoMensaje));
    timerReinicio = setTimeout(() => lanzar({ silencioso }), espera);
    timerReinicio.unref();
  });
}

/** Encola la actualización periódica si toca y no hay otra pendiente. */
export async function encolarSiToca(ahora = Date.now()) {
  const r = await uno(
    "SELECT count(*) FILTER (WHERE status IN ('queued', 'running')) AS pendientes, "
    + "max(started_at) FILTER (WHERE kind = 'bulk' AND status <> 'failed') AS ultima FROM radar.runs");
  if (r.pendientes > 0) return null;
  if (r.ultima && ahora - new Date(r.ultima).getTime() < CONFIG.radar.cadaHoras * 3600000) return null;
  return encolar({ kind: 'bulk', weeks: CONFIG.radar.semanas, scope: 'plastics' });
}

export function iniciarRadar({ silencioso = false } = {}) {
  detenido = false;
  if (!CONFIG.radar.worker) { estado.motivo = 'Desactivado (RADAR_WORKER=0)'; return; }
  if (!fs.existsSync(CONFIG.radar.python)) {
    estado.motivo = 'Falta el entorno Python del ETL (' + CONFIG.radar.python + '). Ver docs/radar/INTEGRACION.md.';
    if (!silencioso) console.log('  radar        sin ETL: ' + estado.motivo);
    return;
  }
  fs.mkdirSync(CONFIG.radar.raw, { recursive: true });
  lanzar({ silencioso });
  const revisar = () => encolarSiToca()
    .then(r => { if (r && !silencioso) console.log('  radar        actualización encolada (' + CONFIG.radar.semanas + ' semanas)'); })
    .catch(e => console.error('[radar] no se pudo programar la actualización:', e.message));
  // La primera revisión, un minuto después de arrancar (no compite con el arranque).
  setTimeout(revisar, 60000).unref();
  timerProgramacion = setInterval(revisar, 30 * 60000);
  timerProgramacion.unref();
  if (!silencioso) console.log('  radar        ETL activo · actualiza cada ' + CONFIG.radar.cadaHoras + ' h');
}

export function detenerRadar() {
  detenido = true;
  clearTimeout(timerReinicio);
  clearInterval(timerProgramacion);
  if (!proceso) return;
  // En Windows el python.exe del .venv es un lanzador que abre al intérprete
  // real como hijo: matar solo al lanzador dejaba al hijo huérfano, con el
  // lock de la cola tomado. Se termina el árbol completo, y de forma síncrona
  // porque el servidor sale enseguida.
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(proceso.pid), '/T', '/F'], { windowsHide: true });
  else proceso.kill();
}
