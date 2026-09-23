-- Esquema de la base de PLANSA Delivery (SQLite).
--
-- Es la fuente de verdad de la estructura: backend/db/conexion.js lo ejecuta al
-- arrancar y SQLite ignora lo que ya existe gracias a IF NOT EXISTS. Para
-- cambiar la forma de una tabla hay que agregar una migración en migrar.js, no
-- editar esto y esperar que se aplique solo.
--
-- Convención de nombres: tablas y columnas en minúscula con guion bajo. El
-- JavaScript usa camelCase, y la traducción entre ambos vive en los
-- repositorios (db/repos/), que es el único sitio que conoce las dos formas.

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------- personal
-- El padrón de RR.HH. `origen` distingue lo que vino del listado oficial de lo
-- que logística dio de alta a mano: al recargar el padrón, lo manual sobrevive.
CREATE TABLE IF NOT EXISTS personal (
  dni         TEXT PRIMARY KEY,
  nombre      TEXT NOT NULL,
  cargo       TEXT NOT NULL DEFAULT '',
  area        TEXT NOT NULL DEFAULT '',
  origen      TEXT NOT NULL DEFAULT 'padron' CHECK (origen IN ('padron', 'manual')),
  creado_en   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_personal_nombre ON personal (nombre);

-- ------------------------------------------------------------- solicitudes
-- Un servicio de mensajería. `fuente` distingue lo registrado en la aplicación
-- de lo que se cargó del histórico 2026, que no tiene hora ni vehículo.
CREATE TABLE IF NOT EXISTS solicitudes (
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

  -- Solo se llenan si `estado` es 'Cancelado'. `motivo_cancelacion` es de las
  -- tres opciones fijas de la pantalla; `_detalle` es el texto libre que solo
  -- pide "Otros". `cancelado_por` guarda quién fue: el usuario de logística
  -- que lo hizo, o "Solicitante" si lo canceló el propio dueño del ticket.
  motivo_cancelacion         TEXT NOT NULL DEFAULT ''
                             CHECK (motivo_cancelacion IN ('', 'Usuario solicitó baja', 'No autorizado', 'Otros')),
  motivo_cancelacion_detalle TEXT NOT NULL DEFAULT '',
  cancelado_por              TEXT NOT NULL DEFAULT '',
  ts_cancelado               TEXT,

  fuente          TEXT NOT NULL DEFAULT 'app' CHECK (fuente IN ('app', 'historico'))
);

-- Los accesos que de verdad se usan: la bandeja filtra por estado, los
-- indicadores agrupan por fecha, el solicitante busca lo suyo por DNI y,
-- desde el ingreso por área, su área pide los últimos 5 servicios por `area`.
CREATE INDEX IF NOT EXISTS idx_solicitudes_estado ON solicitudes (estado);
CREATE INDEX IF NOT EXISTS idx_solicitudes_fecha  ON solicitudes (fecha_prog);
CREATE INDEX IF NOT EXISTS idx_solicitudes_dni    ON solicitudes (dni);
CREATE INDEX IF NOT EXISTS idx_solicitudes_area   ON solicitudes (area);

-- ----------------------------------------------------------------- paradas
-- Destinos adicionales de una solicitud con dos o más rutas en la misma
-- programación. El primer destino sigue viviendo en `solicitudes.destino`
-- -así no cambia nada de lo que ya lee el resto del sistema-; esta tabla solo
-- guarda las paradas de MÁS, en el orden en que se visitan.
CREATE TABLE IF NOT EXISTS paradas (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id  TEXT NOT NULL,
  orden      INTEGER NOT NULL,
  destino    TEXT NOT NULL,
  contacto   TEXT NOT NULL DEFAULT '',
  telefono   TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (ticket_id) REFERENCES solicitudes (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_paradas_ticket ON paradas (ticket_id);

-- ---------------------------------------------------------- autorizaciones
-- Pedidos de alta en el padrón de quien intentó entrar sin figurar en él.
-- Antes solo se guardaba el DNI: no alcanzaba para que admin supiera a quién
-- estaba habilitando. Apellidos, nombres y celular son obligatorios para
-- pedirla; email y área quedan a criterio de quien la pide.
CREATE TABLE IF NOT EXISTS autorizaciones (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  dni         TEXT NOT NULL,
  apellidos   TEXT NOT NULL DEFAULT '',
  nombres     TEXT NOT NULL DEFAULT '',
  celular     TEXT NOT NULL DEFAULT '',
  email       TEXT NOT NULL DEFAULT '',
  area        TEXT NOT NULL DEFAULT '',
  solicitado  TEXT NOT NULL,
  estado      TEXT NOT NULL DEFAULT 'Pendiente'
              CHECK (estado IN ('Pendiente', 'Aprobada', 'Rechazada'))
);

CREATE INDEX IF NOT EXISTS idx_autorizaciones_estado ON autorizaciones (estado);

-- --------------------------------------------------------- credenciales_area
-- Segundo factor del ingreso del solicitante: el DNI detecta el área (contra
-- `personal`) y esta es la clave de esa área, una sola para todo el mundo que
-- trabaja ahí. No es una tabla de `usuarios` -esas son cuentas personales de
-- logística, con otro ciclo de vida (las crea/desactiva admin una por una) y
-- otro propósito (despachar, no pedir un servicio)-, así que se separan aunque
-- el hash y el patrón de alta sean iguales.
CREATE TABLE IF NOT EXISTS credenciales_area (
  area                TEXT PRIMARY KEY,
  usuario             TEXT NOT NULL UNIQUE,
  clave_hash          TEXT NOT NULL,
  activo              INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0, 1)),
  debe_cambiar_clave  INTEGER NOT NULL DEFAULT 1 CHECK (debe_cambiar_clave IN (0, 1)),
  creado_por          TEXT NOT NULL DEFAULT '',
  creado_en           TEXT NOT NULL DEFAULT (datetime('now'))
);

-- -------------------------------------------------------- pedidos_historico
-- Un área solo ve sus últimos 5 servicios; si necesita uno más viejo o el
-- histórico completo, se lo pide a admin en vez de poder traérselo ella misma.
-- Mismo espíritu que `autorizaciones` (un pedido que admin resuelve a mano),
-- pero es un pedido distinto -ver más, no entrar- y de otra área (no de un
-- DNI), así que es otra tabla en vez de forzar `autorizaciones` a servir para
-- dos cosas.
CREATE TABLE IF NOT EXISTS pedidos_historico (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  area        TEXT NOT NULL,
  dni         TEXT NOT NULL DEFAULT '',
  solicitado  TEXT NOT NULL,
  estado      TEXT NOT NULL DEFAULT 'Pendiente'
              CHECK (estado IN ('Pendiente', 'Atendida', 'Rechazada'))
);

CREATE INDEX IF NOT EXISTS idx_pedidos_historico_estado ON pedidos_historico (estado);

-- --------------------------------------------------------------- usuarios
-- Cuentas de logística: quién puede ENTRAR a despachar, ver indicadores o
-- administrar el padrón. No confundir con `personal`, que es quién puede
-- PEDIR un servicio: son universos distintos y del segundo hay cientos.
--
-- rol 'admin'        controles generales, indicadores, payback y padrón.
-- rol 'seguimiento'  bandeja de despacho; para dar de alta a alguien que no
--                    figura en el padrón, pide autorización en vez de poder
--                    agregarlo directo.
CREATE TABLE IF NOT EXISTS usuarios (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario             TEXT NOT NULL UNIQUE,
  clave_hash          TEXT NOT NULL,
  rol                 TEXT NOT NULL CHECK (rol IN ('admin', 'seguimiento')),
  activo              INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0, 1)),
  debe_cambiar_clave  INTEGER NOT NULL DEFAULT 1 CHECK (debe_cambiar_clave IN (0, 1)),
  creado_por          TEXT NOT NULL DEFAULT '',
  creado_en           TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_usuarios_rol ON usuarios (rol);

-- ----------------------------------------------------------------- adjuntos
-- Metadatos de las guías de entrega. El binario NO vive aquí: multer lo deja en
-- uploads/ y esta tabla guarda con qué nombre quedó. Separarlos mantiene la
-- base pequeña y permite respaldar los archivos por separado.
CREATE TABLE IF NOT EXISTS adjuntos (
  id               TEXT PRIMARY KEY,
  ticket_id        TEXT NOT NULL,
  nombre_original  TEXT NOT NULL,
  archivo          TEXT NOT NULL UNIQUE,
  tipo             TEXT NOT NULL DEFAULT '',
  tamano           INTEGER NOT NULL DEFAULT 0,
  subido_por       TEXT NOT NULL DEFAULT '',
  subido_en        TEXT NOT NULL,
  FOREIGN KEY (ticket_id) REFERENCES solicitudes (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_adjuntos_ticket ON adjuntos (ticket_id);

-- --------------------------------------------------------- eventos_seguridad
-- Auditoría: ingresos, cambios de clave, altas/bajas de usuarios, acciones
-- administrativas y accesos denegados. Nunca se guarda una clave ni un token
-- acá -eso lo garantiza quien llama a `registrar()`, no esta tabla-.
CREATE TABLE IF NOT EXISTS eventos_seguridad (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  cuando   TEXT NOT NULL DEFAULT (datetime('now')),
  tipo     TEXT NOT NULL,
  usuario  TEXT NOT NULL DEFAULT '',
  ip       TEXT NOT NULL DEFAULT '',
  detalle  TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_eventos_seguridad_cuando ON eventos_seguridad (cuando);
CREATE INDEX IF NOT EXISTS idx_eventos_seguridad_tipo ON eventos_seguridad (tipo);

-- ------------------------------------------------------------------ ajustes
-- Pares clave/valor para lo que no merece una tabla: la clave de logística, la
-- versión del esquema y el testigo de revisión que usa el sondeo del navegador.
CREATE TABLE IF NOT EXISTS ajustes (
  clave  TEXT PRIMARY KEY,
  valor  TEXT NOT NULL
);
