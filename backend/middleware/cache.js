import { createHash } from 'node:crypto';
import zlib from 'node:zlib';
import { leer } from '../db/repos/ajustes.js';

/**
 * Caché en memoria de respuestas GET en JSON.
 *
 * Por qué existe: consultas como el ranking de proveedores, la rotación ABC o
 * /estado (1600 servicios y ~1 MB de JSON) agregan decenas de miles de filas
 * en PostgreSQL y luego se serializan y comprimen en este proceso. Con 50
 * personas abriendo las mismas pantallas, casi todas piden exactamente lo
 * mismo; se calcula una vez y se reparte.
 *
 * Cuándo se invalida: TODA escritura de la app pasa por `ajustes.tocar()`
 * (el testigo de revisión que ya sondea el navegador), que llama a
 * `invalidar()` (ver los grupos más abajo). Las consultas ahora son
 * asíncronas, así que entre "empecé a calcular" y "respondí" pueden correr
 * otras peticiones, incluidas escrituras. Por eso cada petición anota la
 * generación de su grupo al empezar y solo guarda la respuesta si al terminar
 * sigue siendo la misma: si alguien escribió (y tocó) en el medio, se responde
 * igual pero no se guarda. Además se vacía al cambiar el día (UTC), porque la
 * clasificación ABC de productos depende de la fecha actual.
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
const ERP = /^\/api\/(ordenes-compra|oc|productos|requerimientos-compra-historico|materia-prima|stock-valorizado|proveedores|importaciones|buscar)(\/|\?|$)/;
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
  return async function (req, res, next) {
    if (DESACTIVADA || (req.method !== 'GET' && req.method !== 'HEAD')) return next();

    const hoy = hoyUtc();
    if (hoy !== dia) { dia = hoy; invalidar(); }
    await verificarRevision();

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

/**
 * Escrituras que no pasan por ESTE proceso -un script de carga, una
 * importación, la sincronización de Mongo corrida a mano- cambian el testigo
 * `revision` en la base pero no llaman a invalidar() acá: sin esto, el caché
 * seguía sirviendo la versión de antes (p. ej. una lista de muestras vacía
 * recién cargada por fuera). Se mira el testigo a lo sumo cada 2 s, para no
 * sumar una consulta a cada petición.
 */
let revisionVista = null;
let revisadoEn = 0;
async function verificarRevision() {
  const ahora = Date.now();
  if (ahora - revisadoEn < 2000) return;
  revisadoEn = ahora;
  try {
    const r = await leer('revision', '0');
    if (revisionVista !== null && r !== revisionVista) invalidar();
    revisionVista = r;
  } catch (_) { /* base no disponible: se sigue con lo que hay */ }
}

/** Para diagnóstico y pruebas. */
export const estadoCache = () => ({ entradas: entradas.size, bytes, generacion: { ...generacion } });
