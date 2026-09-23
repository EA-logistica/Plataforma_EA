import { db } from './conexion.js';
import { leer, escribir } from './repos/ajustes.js';

/**
 * Migraciones de esquema para una base que YA existe en disco.
 *
 * `esquema.sql` usa `CREATE TABLE IF NOT EXISTS`: le sirve a una base nueva,
 * pero un cambio ahí no le hace nada a una tabla que ya existe. SQLite tampoco
 * deja alterar un CHECK constraint con `ALTER TABLE`, así que la única forma
 * de cambiar uno es recrear la tabla entera y copiar los datos.
 *
 * `migrar()` se corre siempre al arrancar (ver conexion.js). Cada paso se
 * salta solo si ya se aplicó, comprobando `esquema_version` en `ajustes` —
 * misma tabla que ya guarda la revisión y `version_datos`.
 */
const VERSION_ACTUAL = 3;

export function migrar() {
  const desde = Number(leer('esquema_version', '1'));
  if (desde < 2) migrarA2();
  if (desde < 3) migrarA3();
  if (desde < VERSION_ACTUAL) escribir('esquema_version', String(VERSION_ACTUAL));
}

/**
 * v2: agrega el estado 'Cancelado' y las columnas de motivo a `solicitudes`.
 *
 * `adjuntos.ticket_id` tiene una FOREIGN KEY hacia `solicitudes(id)`. La forma
 * segura de recrear una tabla que otra referencia -la que documenta el propio
 * SQLite- es armar la tabla nueva con OTRO nombre, copiar los datos, borrar la
 * vieja y recién ahí renombrar la nueva al nombre original. Si en cambio se
 * renombrara primero la vieja fuera del camino, SQLite reescribe la FK de
 * `adjuntos` para que apunte a ese nombre temporal, y se queda rota cuando ese
 * nombre desaparece.
 */
function migrarA2() {
  const base = db();
  base.exec('PRAGMA foreign_keys = OFF');
  base.exec('BEGIN');
  try {
    base.exec(`
      CREATE TABLE solicitudes_v2 (
        id              TEXT PRIMARY KEY,
        correlativo     INTEGER NOT NULL,
        creado          TEXT NOT NULL,

        dni             TEXT NOT NULL DEFAULT '',
        nombre          TEXT NOT NULL DEFAULT '',
        cargo           TEXT NOT NULL DEFAULT '',
        area            TEXT NOT NULL DEFAULT '',

        tipo            TEXT NOT NULL CHECK (tipo IN ('Recoger', 'Entregar')),
        servicio        TEXT NOT NULL DEFAULT '',
        motivo          TEXT NOT NULL DEFAULT '',
        origen          TEXT NOT NULL DEFAULT '',
        origen_detalle  TEXT NOT NULL DEFAULT '',
        destino         TEXT NOT NULL DEFAULT '',
        contacto        TEXT NOT NULL DEFAULT '',
        telefono        TEXT NOT NULL DEFAULT '',

        fecha_prog      TEXT NOT NULL DEFAULT '',
        hora_prog       TEXT NOT NULL DEFAULT '',

        vehiculo        TEXT CHECK (vehiculo IS NULL OR vehiculo IN ('Motorizado', 'Carro')),
        costo           REAL CHECK (costo IS NULL OR costo >= 0),

        estado          TEXT NOT NULL CHECK (estado IN ('En espera', 'En tránsito', 'Concluido', 'Cancelado')),
        ts_espera       TEXT,
        ts_transito     TEXT,
        ts_concluido    TEXT,

        motivo_cancelacion         TEXT NOT NULL DEFAULT ''
                                   CHECK (motivo_cancelacion IN ('', 'Usuario solicitó baja', 'No autorizado', 'Otros')),
        motivo_cancelacion_detalle TEXT NOT NULL DEFAULT '',
        cancelado_por              TEXT NOT NULL DEFAULT '',
        ts_cancelado               TEXT,

        fuente          TEXT NOT NULL DEFAULT 'app' CHECK (fuente IN ('app', 'historico'))
      )
    `);

    base.exec(`
      INSERT INTO solicitudes_v2 (
        id, correlativo, creado, dni, nombre, cargo, area, tipo, servicio, motivo,
        origen, origen_detalle, destino, contacto, telefono, fecha_prog, hora_prog,
        vehiculo, costo, estado, ts_espera, ts_transito, ts_concluido, fuente
      )
      SELECT
        id, correlativo, creado, dni, nombre, cargo, area, tipo, servicio, motivo,
        origen, origen_detalle, destino, contacto, telefono, fecha_prog, hora_prog,
        vehiculo, costo, estado, ts_espera, ts_transito, ts_concluido, fuente
      FROM solicitudes
    `);

    base.exec('DROP TABLE solicitudes');
    base.exec('ALTER TABLE solicitudes_v2 RENAME TO solicitudes');

    base.exec('CREATE INDEX IF NOT EXISTS idx_solicitudes_estado ON solicitudes (estado)');
    base.exec('CREATE INDEX IF NOT EXISTS idx_solicitudes_fecha  ON solicitudes (fecha_prog)');
    base.exec('CREATE INDEX IF NOT EXISTS idx_solicitudes_dni    ON solicitudes (dni)');

    const huerfanos = base.prepare('PRAGMA foreign_key_check(adjuntos)').all();
    if (huerfanos.length) throw new Error('La migración dejó adjuntos sin su ticket: revisa antes de continuar.');

    base.exec('COMMIT');
  } catch (e) {
    base.exec('ROLLBACK');
    throw e;
  } finally {
    base.exec('PRAGMA foreign_keys = ON');
  }
}

/**
 * v3: agrega a `autorizaciones` quién es la persona que pide el alta -antes
 * solo quedaba el DNI, y admin tenía que aprobarla a ciegas-.
 *
 * Son columnas nuevas con un valor por defecto constante ('') y sin CHECK: a
 * diferencia de v2, esto SÍ lo permite `ALTER TABLE ADD COLUMN` directo, sin
 * recrear la tabla ni copiar filas.
 *
 * Cada columna se agrega solo si todavía no existe: una base NUEVA ya la creó
 * con esta forma desde `esquema.sql` -que siempre refleja la versión más
 * reciente-, así que para ella esto no debe hacer nada. Solo una base vieja,
 * creada antes de este cambio, de verdad necesita el `ALTER TABLE`.
 */
function migrarA3() {
  const base = db();
  const columnas = new Set(base.prepare('PRAGMA table_info(autorizaciones)').all().map(c => c.name));
  const agregar = (nombre, tipo) => {
    if (!columnas.has(nombre)) base.exec('ALTER TABLE autorizaciones ADD COLUMN ' + nombre + ' ' + tipo);
  };
  base.exec('BEGIN');
  try {
    agregar('apellidos', "TEXT NOT NULL DEFAULT ''");
    agregar('nombres', "TEXT NOT NULL DEFAULT ''");
    agregar('celular', "TEXT NOT NULL DEFAULT ''");
    agregar('email', "TEXT NOT NULL DEFAULT ''");
    agregar('area', "TEXT NOT NULL DEFAULT ''");
    base.exec('COMMIT');
  } catch (e) {
    base.exec('ROLLBACK');
    throw e;
  }
}
