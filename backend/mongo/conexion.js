import { MongoClient } from 'mongodb';
import '../config.js';

/**
 * MongoDB del bot de logística (Bot_logistic_net_rec). Único punto del
 * proyecto que lo abre.
 *
 * El usuario de MONGO_URI (lector_logistica) es de SOLO LECTURA y no ve
 * `sesiones` ni `usuarios_equipo`: aquí tampoco se expone nada que escriba.
 * El servidor vive detrás de Tailscale; si esta PC no está en esa red, la
 * conexión falla y el resto de la plataforma sigue funcionando igual -Mongo
 * se abre recién cuando alguien lo pide, no en el arranque-.
 */

let cliente = null;
let abriendo = null;

export const configurado = () => Boolean(process.env.MONGO_URI);

export async function db() {
  if (cliente) return cliente.db();
  if (!configurado()) throw Object.assign(new Error('Falta MONGO_URI en .env.'), { status: 503 });
  abriendo ??= (async () => {
    const c = new MongoClient(process.env.MONGO_URI, { serverSelectionTimeoutMS: 5000, readPreference: 'primaryPreferred' });
    try {
      await c.connect();
      cliente = c;
    } catch (e) {
      await c.close().catch(() => {});
      throw Object.assign(new Error('No se pudo conectar a MongoDB (' + describir() + '): ' + e.message
        + '\n¿Está conectada esta PC a Tailscale?'), { status: 503, cause: e });
    } finally {
      abriendo = null;
    }
  })();
  await abriendo;
  return cliente.db();
}

/** usuario@host/base, sin la clave: para logs y /salud. */
export function describir(url = process.env.MONGO_URI) {
  try {
    const u = new URL(url);
    return (u.username ? u.username + '@' : '') + u.host + u.pathname;
  } catch (_) { return '(MONGO_URI inválida)'; }
}

export async function cerrar() {
  const c = cliente; cliente = null;
  if (c) await c.close();
}
