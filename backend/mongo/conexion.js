import { MongoClient } from 'mongodb';
import '../config.js';

/**
 * MongoDB del bot de logística (Bot_logistic_net_rec). Único punto del
 * proyecto que lo abre.
 *
 * El usuario de MONGO_URI (logistica_lectura) es de SOLO LECTURA y no ve
 * `sesiones` ni `usuarios_equipo`: aquí tampoco se expone nada que escriba.
 * El servidor se alcanza por Tailscale (MONGO_URI) o por la red local
 * 192.168.1.0/24 (MONGO_URI_ALTERNATIVA): se prueban en ese orden y se queda
 * la primera que responde. Si ninguna, la conexión falla y el resto de la
 * plataforma sigue funcionando igual -Mongo se abre recién cuando alguien lo
 * pide, no en el arranque-.
 */

let cliente = null;
let abriendo = null;
let enUso = null;

const candidatas = () => [process.env.MONGO_URI, process.env.MONGO_URI_ALTERNATIVA].filter(Boolean);

export const configurado = () => Boolean(process.env.MONGO_URI);

export async function db() {
  if (cliente) return cliente.db();
  if (!configurado()) throw Object.assign(new Error('Falta MONGO_URI en .env.'), { status: 503 });
  abriendo ??= (async () => {
    const fallos = [];
    try {
      for (const uri of candidatas()) {
        const c = new MongoClient(uri, { serverSelectionTimeoutMS: 5000, readPreference: 'primaryPreferred' });
        try {
          await c.connect();
          cliente = c;
          enUso = uri;
          return;
        } catch (e) {
          await c.close().catch(() => {});
          fallos.push(describir(uri) + ': ' + e.message);
        }
      }
      throw Object.assign(new Error('No se pudo conectar a MongoDB (' + fallos.join(' | ') + ')'
        + '\n¿Está conectada esta PC a Tailscale o a la red de la planta?'), { status: 503 });
    } finally {
      abriendo = null;
    }
  })();
  await abriendo;
  return cliente.db();
}

/** usuario@host/base, sin la clave: para logs y /salud. */
export function describir(url = enUso || process.env.MONGO_URI) {
  try {
    const u = new URL(url);
    return (u.username ? u.username + '@' : '') + u.host + u.pathname;
  } catch (_) { return '(MONGO_URI inválida)'; }
}

export async function cerrar() {
  const c = cliente; cliente = null; enUso = null;
  if (c) await c.close();
}
