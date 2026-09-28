import { obtener, crear, borrar, urlAdjunto } from './cliente.js';
import { DB } from './estado.js';

/**
 * Guías de entrega. Sustituye a la antigua capa de IndexedDB: los archivos ya
 * no viven en el navegador sino en uploads/, en el servidor, subidos con
 * multer y referenciados desde SQLite.
 *
 * La diferencia práctica para el usuario es grande: antes cada uno veía solo
 * los archivos que él mismo había subido en ese navegador, y se perdían al
 * limpiar los datos del sitio. Ahora los sube uno y los ve cualquiera.
 *
 * La API de este módulo se mantuvo igual que la anterior a propósito, para que
 * las vistas que ya funcionaban no tuvieran que reescribirse.
 */

export const TIPOS_ACEPTADOS = 'image/*,application/pdf';
export const TAMANO_MAXIMO = 15 * 1024 * 1024;

/** Adjuntos de un ticket, desde la copia local (síncrono, como antes). */
export function adjuntosDe(ticketId) {
  return DB.adjuntos
    .filter(a => a.ticketId === ticketId)
    .map(normalizar)
    .sort((a, b) => String(b.subidoEn).localeCompare(String(a.subidoEn)));
}

/**
 * Con el servidor de por medio los archivos siempre son persistentes. La
 * función se mantiene porque la pantalla la consulta para avisar cuando no lo
 * eran; ahora simplemente nunca hay nada que avisar.
 */
export const esPersistente = () => true;

/** Sube un archivo. Devuelve el adjunto ya registrado. */
export async function subir(ticketId, archivo, subidoPor) {
  if (!archivo) throw new Error('No se seleccionó ningún archivo.');
  // Se valida aquí además de en el servidor: así el usuario se entera antes de
  // esperar la subida de 15 MB para que se la rechacen.
  if (archivo.size > TAMANO_MAXIMO) {
    throw new Error('El archivo pesa ' + tamanoLegible(archivo.size)
      + '. El máximo permitido es ' + tamanoLegible(TAMANO_MAXIMO) + '.');
  }
  const esImagen = String(archivo.type).startsWith('image/');
  if (!esImagen && archivo.type !== 'application/pdf') {
    throw new Error('Solo se admiten imágenes o archivos PDF.');
  }

  const cuerpo = new FormData();
  cuerpo.append('ticketId', ticketId);
  cuerpo.append('subidoPor', subidoPor || 'Logística');
  cuerpo.append('archivo', archivo);

  const adjunto = await crear('/adjuntos', cuerpo);
  DB.adjuntos.push(adjunto);
  return adjunto.id;
}

export async function eliminar(id, motivo) {
  await borrar('/adjuntos/' + encodeURIComponent(id), { motivo });
  DB.adjuntos = DB.adjuntos.filter(a => a.id !== id);
}

/**
 * URL para ver o descargar. Ya no hace falta crear un object URL a partir de
 * un blob: el servidor sirve el archivo con su nombre y su tipo.
 */
export async function urlDe(id) {
  const a = DB.adjuntos.find(x => x.id === id);
  if (!a) return null;
  return { url: urlAdjunto(id), temporal: false, registro: normalizar(a) };
}

/** Vuelve a leer del servidor los adjuntos de un ticket. */
export async function refrescarDe(ticketId) {
  const lista = await obtener('/adjuntos?ticket=' + encodeURIComponent(ticketId));
  DB.adjuntos = DB.adjuntos.filter(a => a.ticketId !== ticketId).concat(lista);
  return lista.map(normalizar);
}

/** La vista espera `nombre`; la base guarda `nombreOriginal`. */
const normalizar = a => ({ ...a, nombre: a.nombreOriginal || a.nombre || 'archivo' });

export function tamanoLegible(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
  return (n / (1024 * 1024)).toFixed(1) + ' MB';
}
