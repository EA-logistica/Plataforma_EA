import { randomBytes } from 'node:crypto';

/**
 * Puente de autenticación hacia el módulo de Almacén (ALMACEN-LOS-OLIVOS),
 * que es otro proyecto sin login propio -hoy cualquiera con la URL entra-.
 * Ocultar el botón del sidebar no alcanza para "solo admin tiene acceso": eso
 * es "seguridad falsa" (ocultar en la pantalla, no en el servidor). Este
 * módulo cierra esa puerta de verdad, con el mismo patrón de sesiones.js:
 * tokens al azar en memoria, no una tabla ni una clave nueva que gestionar.
 *
 * Flujo:
 *   1. El admin ya autenticado en PLANSA_DELIVERY pide un ticket
 *      (POST /api/almacen/ticket, protegido por requiereSesion+admin).
 *   2. El ticket es de un solo uso y vence en 60s: solo sirve para canjearlo
 *      por una sesión de Almacén, nunca para repetir la entrada.
 *   3. El iframe carga /almacen/?ticket=XXXX. Si el canje sale bien, se pone
 *      una cookie httpOnly propia de /almacen (12 h, igual que logística) y
 *      se redirige sin el ticket en la URL. De ahí en más, esa cookie es la
 *      que autoriza tanto el HTML del shell como sus propias llamadas a
 *      /almacen/api/*.
 */

const TICKET_MS = 60 * 1000;
const SESION_MS = 12 * 60 * 60 * 1000;
const COOKIE = 'almacen_sesion';

const tickets = new Map();  // ticket -> expira
const sesiones = new Map(); // token -> expira

function purgar(mapa, ahora) {
  for (const [k, exp] of mapa) if (exp <= ahora) mapa.delete(k);
}

/** Lo llama la ruta ya protegida por requiereSesion+requiereRol('admin'). */
export function emitirTicket() {
  const ahora = Date.now();
  if (tickets.size > 200) purgar(tickets, ahora);
  const t = randomBytes(16).toString('hex');
  tickets.set(t, ahora + TICKET_MS);
  return t;
}

/** Un ticket se borra al intentarlo, sea válido o no: no da una segunda oportunidad. */
function canjearTicket(ticket) {
  const exp = tickets.get(ticket);
  tickets.delete(ticket);
  if (!exp || exp <= Date.now()) return null;
  if (sesiones.size > 200) purgar(sesiones, Date.now());
  const token = randomBytes(24).toString('hex');
  sesiones.set(token, Date.now() + SESION_MS);
  return token;
}

function sesionValida(token) {
  const exp = token && sesiones.get(token);
  if (!exp || exp <= Date.now()) { if (token) sesiones.delete(token); return false; }
  return true;
}

/**
 * Un mismo nombre de cookie puede llegar repetido si el navegador guarda
 * variantes en más de un Path (p. ej. una vieja de /almacen de antes de este
 * cambio, junto a la nueva de /): el navegador manda ambas en la misma
 * cabecera Cookie, más específica primero. Tomar solo "la primera" -como
 * hacía esto antes- puede agarrar la vieja y rechazar una sesión que sí es
 * válida. Se prueban todas y se usa la primera que de verdad valga.
 */
function tokenValidoDeCookie(req) {
  const header = String(req.headers.cookie || '');
  const re = new RegExp('(?:^|;\\s*)' + COOKIE + '=([0-9a-f]+)', 'g');
  let m;
  while ((m = re.exec(header))) {
    if (sesionValida(m[1])) return m[1];
  }
  return null;
}

/**
 * Middleware de Express montado en /almacen: canjea el ticket si viene uno
 * en la URL, o exige la cookie de sesión ya puesta por un canje anterior.
 */
export function protegerAlmacen(req, res, next) {
  if (req.query.ticket) {
    const token = canjearTicket(String(req.query.ticket));
    if (!token) {
      res.status(401);
      return res.send('Ticket inválido o vencido. Vuelve a intentar desde el panel de administración de PLANSA.');
    }
    // Path=/ y no /almacen: el shell carga cada módulo en su propio iframe
    // desde /modules/..., y esa ruta también exige esta cookie (ver
    // exigirSesionAlmacen). Sigue siendo httpOnly y SameSite=Strict.
    // La segunda cabecera borra cualquier cookie vieja que haya quedado con
    // Path=/almacen (de antes de este cambio): sin esto, conviven las dos
    // para siempre y cada request las manda ambas.
    res.setHeader('Set-Cookie', [
      COOKIE + '=' + token + '; Path=/; HttpOnly; SameSite=Strict; Max-Age=' + Math.floor(SESION_MS / 1000),
      COOKIE + '=; Path=/almacen; HttpOnly; SameSite=Strict; Max-Age=0'
    ]);
    const limpio = req.originalUrl.replace(/([?&])ticket=[^&]*&?/, '$1').replace(/[?&]$/, '');
    return res.redirect(limpio);
  }

  return exigirSesionAlmacen(req, res, next);
}

/**
 * Para /modules/*: los tres módulos del shell (mapa, radar, plano). No
 * aceptan ticket, solo la cookie ya puesta por el canje: radar_naranjal.html
 * trae adentro toda la data de almacenes (direcciones, precios, contactos) y
 * sin esto quedaba abierta a cualquiera en la red.
 */
export function exigirSesionAlmacen(req, res, next) {
  if (!tokenValidoDeCookie(req)) {
    res.status(401);
    return res.send('Sesión no autorizada. Entra al módulo de Almacén desde el panel de administración de PLANSA.');
  }
  next();
}
