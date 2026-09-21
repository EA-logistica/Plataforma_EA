import { sesion } from '../state/sessionState.js';

/**
 * Cliente HTTP contra la API. Único punto del navegador que habla con el
 * servidor: si mañana cambia la URL base o hay que mandar un token, se toca
 * aquí y nada más.
 *
 * Todos los errores de la API salen como `{ error: "mensaje" }`, así que este
 * cliente los convierte en un Error con ese mensaje. Quien llama puede mostrar
 * `e.message` directamente al usuario sin inventar textos genéricos.
 */

const BASE = '/api';

async function pedir(metodo, ruta, cuerpo, opciones = {}) {
  const init = { method: metodo, headers: {} };

  // Logística lo tiene desde que entra con usuario y clave; el solicitante,
  // desde que entra con DNI + credencial de área (backend/areas/). Las rutas
  // públicas -crear un ticket, pedir autorización- simplemente lo ignoran.
  if (sesion && sesion.token) init.headers['Authorization'] = 'Bearer ' + sesion.token;

  if (cuerpo instanceof FormData) {
    // Sin Content-Type: el navegador pone el boundary de multipart, que multer
    // necesita para separar los campos del archivo.
    init.body = cuerpo;
  } else if (cuerpo !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(cuerpo);
  }

  let res;
  try {
    res = await fetch(BASE + ruta, init);
  } catch (e) {
    throw new Error('No hay conexión con el servidor. ¿Está corriendo? (npm start)');
  }

  if (opciones.crudo) return res;

  const texto = await res.text();
  let datos = null;
  try { datos = texto ? JSON.parse(texto) : null; } catch (e) { /* respuesta no JSON */ }

  if (!res.ok) {
    const msg = (datos && datos.error) || 'Error ' + res.status + ' al llamar a ' + ruta;
    throw Object.assign(new Error(msg), { status: res.status });
  }
  return datos;
}

export const obtener  = (ruta, op)        => pedir('GET', ruta, undefined, op);
export const crear    = (ruta, cuerpo)    => pedir('POST', ruta, cuerpo);
export const modificar = (ruta, cuerpo)   => pedir('PATCH', ruta, cuerpo);
export const reemplazar = (ruta, cuerpo)  => pedir('PUT', ruta, cuerpo);
export const borrar   = ruta              => pedir('DELETE', ruta);

/** URL directa de un archivo adjunto, para abrirlo en otra pestaña. */
export const urlAdjunto = id => BASE + '/adjuntos/' + encodeURIComponent(id) + '/archivo';
