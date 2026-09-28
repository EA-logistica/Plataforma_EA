import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { CONFIG } from '../config.js';

/**
 * Subida de guías de entrega con multer, a la carpeta uploads/.
 *
 * NOMBRE DEL ARCHIVO. El del usuario no se usa nunca como nombre en disco, por
 * dos razones distintas:
 *
 *   1. Duplicados. Todos fotografían la guía desde el celular y el archivo se
 *      llama "IMG_0001.jpg" o "WhatsApp Image.jpeg". Sin renombrar, el segundo
 *      pisa al primero.
 *   2. Seguridad. Un nombre como "../../backend/servidor.js" escribiría fuera
 *      de uploads/. Construyendo el nombre desde cero, el problema desaparece.
 *
 * El nombre queda así:
 *
 *      20260915-143012-a3f9c1-guia-de-entrega.jpg
 *      |        |      |      |                |
 *      fecha    hora   azar   nombre original  extensión
 *                             saneado y corto
 *
 * La marca de tiempo va primero para que la carpeta se ordene sola por fecha, y
 * lleva seis caracteres al azar porque dos subidas en el mismo segundo son
 * perfectamente posibles: el timestamp por sí solo no garantiza unicidad.
 * El resto del nombre original se conserva para que un humano reconozca el
 * archivo al mirar la carpeta.
 */

const MAX_BASE = 40;

/**
 * Arregla el nombre que entrega multer.
 *
 * multer 1.x decodifica el nombre del archivo de la cabecera multipart como
 * latin-1, así que "guía de entrega.pdf" llega como "guÃ­a de entrega.pdf".
 * Volviendo a leer esos bytes como UTF-8 se recupera el original.
 *
 * La conversión es segura para nombres en ASCII, donde no cambia nada, y se
 * descarta si produce basura: eso significaría que el nombre sí era latin-1 de
 * verdad y hay que dejarlo como estaba.
 */
export function nombreReal(nombre) {
  const utf8 = Buffer.from(String(nombre || ''), 'latin1').toString('utf8');
  return utf8.includes('�') ? String(nombre || '') : utf8;
}

/** Deja solo letras, números y guiones: nada que pueda salirse de la carpeta. */
function sanear(nombre) {
  return path.basename(String(nombre || ''), path.extname(String(nombre || '')))
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, MAX_BASE) || 'archivo';
}

/** Extensión admitida, derivada del tipo declarado y no del nombre. */
function extension(archivo) {
  const porTipo = { 'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png',
                    'image/webp': '.webp', 'image/heic': '.heic', 'image/gif': '.gif' };
  if (porTipo[archivo.mimetype]) return porTipo[archivo.mimetype];
  const ext = path.extname(archivo.originalname).toLowerCase();
  return /^\.[a-z0-9]{1,5}$/.test(ext) ? ext : '';
}

export function marcaDeTiempo(fecha = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return String(fecha.getFullYear()) + p(fecha.getMonth() + 1) + p(fecha.getDate())
    + '-' + p(fecha.getHours()) + p(fecha.getMinutes()) + p(fecha.getSeconds());
}

/** El nombre final. Separado del middleware para poder probarlo. */
export function nombreUnico(originalname, mimetype, fecha = new Date()) {
  const azar = crypto.randomBytes(3).toString('hex');
  return marcaDeTiempo(fecha) + '-' + azar + '-' + sanear(originalname)
    + extension({ originalname, mimetype });
}

const almacen = multer.diskStorage({
  destination(req, archivo, cb) {
    // Se crea al vuelo: si alguien borra uploads/ con el servidor corriendo,
    // la siguiente subida la vuelve a crear en vez de fallar.
    fs.mkdirSync(CONFIG.subidas, { recursive: true });
    cb(null, CONFIG.subidas);
  },
  filename(req, archivo, cb) {
    // Se corrige aquí y no solo al registrar, porque el nombre en disco se
    // construye a partir de este y saldría igual de mal.
    archivo.originalname = nombreReal(archivo.originalname);
    cb(null, nombreUnico(archivo.originalname, archivo.mimetype));
  }
});

function filtro(req, archivo, cb) {
  const admitido = CONFIG.archivos.tiposAceptados.includes(archivo.mimetype);
  if (admitido) return cb(null, true);
  cb(Object.assign(new Error('Solo se admiten imágenes (JPEG, PNG, WEBP, HEIC, GIF) o archivos PDF.'), { status: 415 }));
}

/**
 * El `Content-Type` de una parte multipart lo declara quien sube el archivo:
 * nada impide mandar contenido HTML o JavaScript diciendo "esto es una
 * imagen". `filtro()` solo mira esa declaración; esto mira los primeros
 * bytes de verdad y rechaza si no son los que ese tipo debería tener.
 *
 * No es la única defensa -`nosniff` y la extensión fija (ver `extension()`)
 * ya impiden que el navegador lo ejecute igual-, pero cierra el hueco desde
 * el origen: un archivo que miente sobre su tipo ni siquiera queda guardado.
 */
const FIRMAS = {
  'image/jpeg': buf => buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF,
  'image/png': buf => buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])),
  'image/gif': buf => buf.subarray(0, 6).toString('ascii') === 'GIF87a' || buf.subarray(0, 6).toString('ascii') === 'GIF89a',
  'image/webp': buf => buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP',
  'application/pdf': buf => buf.subarray(0, 4).toString('ascii') === '%PDF',
  // El contenedor de HEIC (ISO BMFF) es más variado: alcanza con confirmar la
  // caja "ftyp" que todo archivo de este formato tiene, sin exigir una marca
  // de compatibilidad puntual que cambia según el celular que lo generó.
  'image/heic': buf => buf.subarray(4, 8).toString('ascii') === 'ftyp'
};

export function coincideConFirma(archivo) {
  const verifica = FIRMAS[archivo.mimetype];
  if (!verifica) return true; // sin firma conocida para el tipo, no se bloquea de más
  const fd = fs.openSync(archivo.path, 'r');
  try {
    const buf = Buffer.alloc(16);
    fs.readSync(fd, buf, 0, 16, 0);
    return verifica(buf);
  } finally {
    fs.closeSync(fd);
  }
}

export const subirGuia = multer({
  storage: almacen,
  fileFilter: filtro,
  limits: {
    fileSize: CONFIG.archivos.tamanoMaximo,
    files: 1
  }
}).single('archivo');

/**
 * Envuelve a multer para que sus errores salgan con el mismo formato que el
 * resto de la API. Sin esto, pasarse del tamaño devuelve un volcado de multer
 * en vez de un mensaje que se pueda mostrar en pantalla.
 */
export function conSubida(req, res, next) {
  subirGuia(req, res, err => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        err.status = 413;
        err.message = 'El archivo supera el máximo de '
          + (CONFIG.archivos.tamanoMaximo / (1024 * 1024)).toFixed(0) + ' MB.';
      }
      if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
        err.status = 400;
        err.message = 'Envía un solo archivo, en el campo "archivo".';
      }
      return next(err);
    }

    if (req.file && !coincideConFirma(req.file)) {
      try { fs.unlinkSync(req.file.path); } catch (e) { /* ya no estaba */ }
      return next(Object.assign(
        new Error('El archivo no coincide con el tipo que declara. Sube el archivo original, no uno renombrado.'),
        { status: 415 }
      ));
    }

    next();
  });
}
