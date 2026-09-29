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
