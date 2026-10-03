import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Configuración del servidor. Un solo lugar donde mirar cuando algo "no
 * encuentra" un archivo o un puerto está ocupado.
 *
 * Todo se puede sobrescribir por variable de entorno, que es lo que permite
 * mover la base o la carpeta de subidas a un disco de red sin tocar código:
 *
 *   PLANSA_PUERTO=8080 PLANSA_DB=D:/datos/plansa.sqlite npm start
 */

export const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// .env de la raíz (nunca va al repo): ahí vive PLANSA_PG_URL con la clave de
// PostgreSQL. Lo ya definido en el entorno manda sobre el archivo.
const archivoEnv = path.join(RAIZ, '.env');
if (fs.existsSync(archivoEnv)) {
  for (const linea of fs.readFileSync(archivoEnv, 'utf8').split(/\r?\n/)) {
    const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m || linea.trim().startsWith('#')) continue;
    if (process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

const ruta = (env, porDefecto) =>
  process.env[env] ? path.resolve(process.env[env]) : path.join(RAIZ, porDefecto);

export const CONFIG = {
  puerto: Number(process.env.PLANSA_PUERTO) || 3000,

  /**
   * Interfaz en la que escucha. Por defecto todas, que es lo que hace falta
   * para que el resto de la red —o Tailscale— llegue al servidor. Con
   * PLANSA_HOST=127.0.0.1 solo responde a esta PC, útil para probar a solas.
   */
  host: process.env.PLANSA_HOST || '0.0.0.0',

  /**
   * Base PostgreSQL. Las tablas se crean solas la primera vez; la base y el
   * usuario los crea la instalación (ver README, "La base de datos").
   */
  postgres: process.env.PLANSA_PG_URL || 'postgresql://plansa@localhost:5432/plansa',

  /**
   * Base SQLite de antes de pasar a PostgreSQL. Ya no se usa al correr: solo
   * la lee `npm run db:importar-sqlite` para traer sus datos.
   */
  baseDatos: ruta('PLANSA_DB', 'plansa.sqlite'),

  /** Carpeta donde multer deja las guías de entrega. */
  subidas: ruta('PLANSA_UPLOADS', 'uploads'),

  /**
   * Excel de materias primas homologadas (pestaña Materia Prima →
   * Homologados). Se lee tal cual: para actualizarlo basta reemplazar el
   * archivo, sin reiniciar.
   */
  homologados: ruta('PLANSA_HOMOLOGADOS', 'Data_export/HOMOLOGADOS_MATERIA PRIMA.xlsx'),

  /**
   * Radar de Importaciones (SUNAT). Sus datos viven en el esquema "radar" de
   * la misma PostgreSQL; el ETL es Python (backend/radar/etl) y lo lanza y
   * vigila el propio servidor (backend/radar/worker.js).
   *   - etl: carpeta del proyecto Python.
   *   - python: intérprete con sus dependencias (el .venv de etl por defecto).
   *   - raw: originales descargados de SUNAT (ZIP/DBF), auditables por hash.
   *   - worker: RADAR_WORKER=0 lo apaga (pruebas, o una PC que solo consulta).
   *   - cadaHoras / semanas: cada cuánto se encola una actualización y cuántas
   *     semanas publicadas se revisan en cada una.
   */
  radar: {
    etl: path.join(RAIZ, 'backend', 'radar', 'etl'),
    python: process.env.RADAR_PYTHON
      || path.join(RAIZ, 'backend', 'radar', 'etl', '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'),
    raw: ruta('RADAR_RAW_DIR', 'radar-datos/raw'),
    worker: process.env.RADAR_WORKER !== '0',
    cadaHoras: Number(process.env.RADAR_CADA_HORAS) || 24,
    semanas: Number(process.env.RADAR_SEMANAS) || 2
  },

  /**
   * Reporte semanal (backend/reportes/semanal.js). Siempre se puede abrir y
   * guardar como PDF desde el Dashboard; el envío por correo se activa solo
   * si hay servidor SMTP y destinatarios en .env:
   *   SMTP_HOST, SMTP_PORT (587), SMTP_USUARIO, SMTP_CLAVE, SMTP_DE,
   *   REPORTE_PARA=a@empresa.com,b@empresa.com
   *   REPORTE_DIA=1 (0 domingo … 6 sábado; 1 = lunes) y REPORTE_HORA=8 (hora de Lima)
   */
  reporte: {
    smtp: {
      host: process.env.SMTP_HOST || '',
      port: Number(process.env.SMTP_PORT) || 587,
      usuario: process.env.SMTP_USUARIO || '',
      clave: process.env.SMTP_CLAVE || '',
      de: process.env.SMTP_DE || process.env.SMTP_USUARIO || ''
    },
    para: (process.env.REPORTE_PARA || '').split(/[,;]/).map(s => s.trim()).filter(Boolean),
    dia: process.env.REPORTE_DIA === undefined ? 1 : Number(process.env.REPORTE_DIA),
    hora: process.env.REPORTE_HORA === undefined ? 8 : Number(process.env.REPORTE_HORA)
  },

  /** Lo que se sirve al navegador. */
  estaticos: {
    frontend: path.join(RAIZ, 'frontend'),
    // El cálculo puro y los datos de referencia los usan el servidor Y el
    // navegador. Se publican para que el import map del HTML los resuelva.
    shared: path.join(RAIZ, 'shared'),
    data: path.join(RAIZ, 'data')
  },

  /**
   * Lo único de `data/` que se publica al navegador.
   *
   * El resto de la carpeta —el padrón y el histórico— son datos personales y
   * de costos: se quedan en el servidor y salen, filtrados, por la API. Una
   * entrada que termina en "/" habilita toda la subcarpeta.
   */
  datosPublicos: ['destinos.js', 'payback/'],

  archivos: {
    /** 15 MB por archivo. */
    tamanoMaximo: 15 * 1024 * 1024,
    /**
     * Lista cerrada, no un patrón "cualquier image/*": ese patrón dejaba
     * pasar "image/svg+xml", que ni `extension()` ni `coincideConFirma()`
     * (backend/middleware/subida.js) saben tratar -su "sin firma conocida,
     * no se bloquea de más" es justo el hueco- y que un navegador ejecuta
     * como HTML/JS al abrirlo, aunque el servidor lo sirva como "guía de
     * entrega". Cada tipo de esta lista tiene su verificación de firma y su
     * extensión fija en subida.js; un tipo nuevo debe agregarse en los tres
     * lugares a la vez, no solo aquí.
     */
    tiposAceptados: ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/gif', 'application/pdf']
  },

  limites: {
    /** Intentos fallidos de ingreso por IP antes de hacer esperar. */
    intentos: 10,
    /** Cuánto dura el castigo, y la ventana en que se cuentan los fallos. */
    ventanaMs: 5 * 60 * 1000
  }
};
