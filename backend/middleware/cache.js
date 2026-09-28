import { createHash } from 'node:crypto';
import zlib from 'node:zlib';

/**
 * Caché en memoria de respuestas GET en JSON.
 *
 * Por qué existe: la base es `node:sqlite` síncrona, así que mientras una
 * consulta agrega 30 mil filas (ranking de proveedores, rotación ABC,
 * /estado con 1600 servicios y ~1 MB de JSON) el proceso entero queda
 * detenido y todos los demás usuarios esperan. Con 50 personas abriendo las
 * mismas pantallas, casi todas piden exactamente lo mismo; se calcula una vez
 * y se reparte.
 *
 * Cuándo se invalida: TODA escritura de la app pasa por `ajustes.tocar()`
 * (el testigo de revisión que ya sondea el navegador), que llama a
 * `invalidar()` (ver los grupos más abajo). Como el proceso es uno solo y las consultas son
 * síncronas, no hay carrera posible entre "calculé" y "alguien escribió":
 * mientras se calcula una respuesta no corre ninguna otra petición. Además se
 * vacía al cambiar el día (UTC), porque la clasificación ABC de productos usa
 * date('now') de SQLite.
 *
 * Lo que se guarda es el cuerpo ya serializado y ya comprimido: repetir
 * JSON.stringify + gzip de un megabyte por cada pestaña era la otra mitad del
 * costo. Cada entrada lleva un ETag por contenido, así que un navegador que
 * ya tiene la versión vigente recibe un 304 sin cuerpo.
 *
 * Límites: 400 entradas o 96 MB, lo que llegue primero; se descarta la menos
 * usada. Las búsquedas por texto libre (?q=) entran igual, el tope las acota.
 */

const MAX_ENTRADAS = 400;
const MAX_BYTES = 96 * 1024 * 1024;
const MIN_GZIP = 1024;
// Interruptor de emergencia: PLANSA_SIN_CACHE=1 npm start la apaga entera.
const DESACTIVADA = process.env.PLANSA_SIN_CACHE === '1';

const entradas = new Map(); // clave -> { grupo, etag, cuerpo, gzip, bytes }
let bytes = 0;
let dia = '';

/**
 * Dos grupos, para que el despacho de mensajería (varias escrituras por
 * minuto) no tire a la basura los agregados de Compras, que se calculan sobre
 * los reportes del ERP y solo cambian al recargarlos en el arranque:
 *
 *   - 'erp': las rutas de solo lectura sobre esos reportes (ver ERP abajo).
 *   - 'app': todo lo demás (/estado, solicitudes, exportaciones...).
 *
 * invalidar('app') -lo que hace tocar('app') en los repositorios de la app-
 * vacía solo el segundo. invalidar() sin grupo -cualquier tocar() sin
 * ámbito, incluidas las cargas del ERP y cualquier escritura nueva que nadie
 * marque- vacía los dos: ante la duda, se recalcula.
 */
const ERP = /^\/api\/(ordenes-compra|oc|productos|requerimientos-compra-historico|materia-prima|stock-valorizado|proveedores)(\/|\?|$)/;
const generacion = { app: 0, erp: 0 };

export function invalidar(grupo) {
  for (const g of Object.keys(generacion)) {
    if (grupo && g !== grupo) continue;
    generacion[g]++;
    for (const [k, e] of entradas) if (e.grupo === g) { entradas.delete(k); bytes -= e.bytes; }
  }
}

function hoyUtc() {
  return new Date().toISOString().slice(0, 10);
}

function guardar(clave, grupo, texto) {
  const cuerpo = Buffer.from(texto, 'utf8');
  const etag = '"' + createHash('sha1').update(cuerpo).digest('base64url').slice(0, 27) + '"';
  const gzip = cuerpo.length >= MIN_GZIP ? zlib.gzipSync(cuerpo, { level: 6 }) : null;
  const entrada = { grupo, etag, cuerpo, gzip, bytes: cuerpo.length + (gzip ? gzip.length : 0) };

  const previa = entradas.get(clave);
  if (previa) { bytes -= previa.bytes; entradas.delete(clave); }
  entradas.set(clave, entrada);
  bytes += entrada.bytes;
  // Map conserva el orden de inserción: el primero es el menos usado.
  for (const [k, e] of entradas) {
    if (entradas.size <= MAX_ENTRADAS && bytes <= MAX_BYTES) break;
    if (k === clave) continue;
    entradas.delete(k);
    bytes -= e.bytes;
  }
  return entrada;
}

const aceptaGzip = req => /\bgzip\b(?!\s*;\s*q=0(\.0*)?\b)/i.test(req.headers['accept-encoding'] || '');

function enviar(req, res, entrada, origen) {
  res.setHeader('ETag', entrada.etag);
  // private: nada de proxies compartidos (son datos con sesión). no-cache:
  // el navegador puede guardarla, pero pregunta siempre antes de usarla.
  res.setHeader('Cache-Control', 'private, no-cache');
  res.setHeader('Vary', 'Accept-Encoding, Authorization');
  res.setHeader('X-Cache', origen);

  const inm = req.headers['if-none-match'];
  if (inm && inm.split(',').some(t => t.trim().replace(/^W\//, '') === entrada.etag)) {
    res.statusCode = 304;
    return res.end();
  }

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (entrada.gzip && aceptaGzip(req)) {
    // Con Content-Encoding ya puesto, el middleware compression no la toca.
    res.setHeader('Content-Encoding', 'gzip');
    res.setHeader('Content-Length', String(entrada.gzip.length));
    return res.end(entrada.gzip);
  }
  res.setHeader('Content-Length', String(entrada.cuerpo.length));
  return res.end(entrada.cuerpo);
}

/**
 * Middleware para rutas GET de solo lectura. Va DESPUÉS de requiereSesion /
 * requiereRol (nunca antes: serviría datos sin mirar la sesión). La clave
 * incluye el rol, por si una ruta responde distinto según quién pregunta, y
 * `variar(req)` agrega lo que haga falta (p. ej. si hay sesión o no).
 *
 * Solo se guarda una respuesta 200 mandada con res.json(); cualquier otra
 * (error, archivo, stream) pasa de largo sin tocarse.
 */
export function cachearGet({ variar } = {}) {
  return function (req, res, next) {
    if (DESACTIVADA || (req.method !== 'GET' && req.method !== 'HEAD')) return next();

    const hoy = hoyUtc();
    if (hoy !== dia) { dia = hoy; invalidar(); }

    const clave = (req.usuario ? req.usuario.rol : '-') + '|' + (variar ? variar(req) : '')
      + '|' + req.originalUrl;
    const hit = entradas.get(clave);
    if (hit) {
      entradas.delete(clave); entradas.set(clave, hit); // renovar en el LRU
      return enviar(req, res, hit, 'HIT');
    }

    const grupo = ERP.test(req.originalUrl) ? 'erp' : 'app';
    const gen = generacion[grupo];
    const json = res.json;
    res.json = function (obj) {
      res.json = json;
      if (res.statusCode !== 200 || gen !== generacion[grupo] || obj === undefined) return json.call(res, obj);
      return enviar(req, res, guardar(clave, grupo, JSON.stringify(obj)), 'MISS');
    };
    next();
  };
}

/** Para diagnóstico y pruebas. */
export const estadoCache = () => ({ entradas: entradas.size, bytes, generacion: { ...generacion } });
