import { CONFIG } from '../config.js';
import { registrar } from '../db/repos/eventosSeguridad.js';

/**
 * Dos defensas mínimas para cuando la aplicación deja de estar sola en una PC
 * y pasa a escucharse en la red: freno a los intentos de clave y cabeceras
 * que le dicen al navegador que no se tome libertades.
 *
 * No reemplazan a la autenticación de verdad, que este proyecto todavía no
 * tiene. Son lo que evita que una prueba con gente conectada se convierta en
 * un problema por algo tonto.
 */

// ------------------------------------------------------------ fuerza bruta
/**
 * Freno por IP para las rutas de ingreso.
 *
 * La clave de logística es una sola palabra: sin freno, un script prueba el
 * diccionario entero en segundos, y el servidor responde encantado porque
 * comparar cadenas no le cuesta nada. Con esto, cada IP tiene un presupuesto
 * de intentos fallidos y luego espera.
 *
 * El contador vive en memoria, no en la base: se pierde al reiniciar y no
 * sirve contra un atacante con muchas IP. Para una planta con una red interna
 * y una prueba en la red privada de la empresa, alcanza; si esto sale a
 * internet, hace falta sesiones de verdad, no un contador.
 */
const intentos = new Map();          // ip -> { n, hasta }

/** Se limpia sola: sin esto, la tabla crece con cada IP que pasa alguna vez. */
function purgar(ahora) {
  for (const [ip, e] of intentos) if (e.hasta <= ahora) intentos.delete(ip);
}

export function limitarIntentos({ maximo = CONFIG.limites.intentos, ventanaMs = CONFIG.limites.ventanaMs } = {}) {
  return function (req, res, next) {
    const ahora = Date.now();
    if (intentos.size > 1000) purgar(ahora);

    const ip = req.ip || req.socket.remoteAddress || 'desconocida';
    const e = intentos.get(ip);
    if (e && e.hasta > ahora && e.n >= maximo) {
      const faltan = Math.ceil((e.hasta - ahora) / 1000);
      res.setHeader('Retry-After', String(faltan));
      return res.status(429).json({
        error: 'Demasiados intentos fallidos. Espera ' + faltan + ' segundos y vuelve a probar.'
      });
    }

    // Solo cuentan los fallos: quien acierta no gasta presupuesto, y al
    // acertar se le borra el que había gastado.
    res.on('finish', () => {
      if (res.statusCode < 400) { intentos.delete(ip); return; }
      if (res.statusCode === 429) return;
      const previo = intentos.get(ip);
      const vigente = previo && previo.hasta > Date.now() ? previo : { n: 0, hasta: 0 };
      const nuevoTotal = vigente.n + 1;
      intentos.set(ip, { n: nuevoTotal, hasta: Date.now() + ventanaMs });
      // Se registra solo el momento en que se cruza el máximo, no cada 429
      // mientras dura el freno: eso solo repetiría la misma fila sin agregar
      // nada, mil veces si alguien insiste con el freno puesto.
      if (nuevoTotal === maximo) {
        registrar('actividad_sospechosa', {
          ip, detalle: maximo + ' intentos fallidos seguidos en ' + req.method + ' ' + req.originalUrl
        });
      }
    });

    next();
  };
}

/** Para las pruebas: deja el contador como recién arrancado. */
export const olvidarIntentos = () => intentos.clear();

// -------------------------------------------------------------- inundación
/**
 * Tope de peticiones por IP en una ventana, sin importar si salen bien o mal
 * -a diferencia de `limitarIntentos`, que solo cuenta fallos-. Es para las
 * rutas públicas que escriben (nadie necesita clave para pedir un servicio o
 * un alta): sin este freno, un script podría registrar miles de solicitudes
 * falsas o cancelar tickets probando id tras id, sin siquiera fallar nunca.
 */
const peticiones = new Map();          // clave -> { n, hasta }

function purgarPeticiones(ahora) {
  for (const [k, e] of peticiones) if (e.hasta <= ahora) peticiones.delete(k);
}

export function limitarPeticiones({ maximo, ventanaMs, mensaje, nombre = '' }) {
  return function (req, res, next) {
    const ahora = Date.now();
    if (peticiones.size > 2000) purgarPeticiones(ahora);

    const ip = req.ip || req.socket.remoteAddress || 'desconocida';
    const clave = nombre + ':' + ip;
    let e = peticiones.get(clave);
    if (!e || e.hasta <= ahora) { e = { n: 0, hasta: ahora + ventanaMs }; peticiones.set(clave, e); }
    e.n++;

    if (e.n > maximo) {
      const faltan = Math.ceil((e.hasta - ahora) / 1000);
      res.setHeader('Retry-After', String(faltan));
      if (e.n === maximo + 1) {
        registrar('actividad_sospechosa', {
          ip, detalle: 'más de ' + maximo + ' peticiones a ' + req.method + ' ' + req.originalUrl + ' en poco tiempo'
        });
      }
      return res.status(429).json({ error: mensaje || 'Demasiadas solicitudes. Espera un momento y vuelve a intentar.' });
    }
    next();
  };
}

/** Para las pruebas: deja el contador de inundación como recién arrancado. */
export const olvidarPeticiones = () => peticiones.clear();

// ------------------------------------------------------- cabeceras básicas
/**
 * Cabeceras de seguridad. Son pocas y todas por un motivo concreto:
 *
 *  - nosniff          el navegador no adivina el tipo de un archivo subido.
 *  - DENY en frames   nadie puede meter la app en un iframe y engañar al clic.
 *  - Referrer         al abrir un enlace externo no se filtra la ruta interna.
 *  - CSP              los scripts salen de este servidor y de ningún otro; si
 *                     algún día entra un texto con <script>, no se ejecuta
 *                     nada traído de fuera. 'unsafe-inline' sigue habilitado
 *                     porque el HTML usa atributos onclick; quitarlos es la
 *                     mejora siguiente, no esta.
 *
 * /almacen/* es la única excepción a "DENY": ese módulo se abre a propósito
 * dentro de un <iframe> del propio panel de admin (mismo origen), así que
 * necesita poder ser enmarcado por sí mismo -nunca por un origen ajeno, de
 * ahí 'self' y no una lista abierta-. Las teselas del mapa (OpenStreetMap,
 * Esri) pasan por el proxy con caché del propio servidor
 * (backend/almacen/src/services/tiles.js), no se piden directo desde el
 * navegador, así que img-src no necesita abrirse a ningún host externo.
 */
export function cabeceras(req, res, next) {
  // /modules/* son los módulos que el shell de /almacen abre en su propio
  // iframe (mapa, radar, plano): necesitan el mismo trato que el shell.
  const esAlmacen = /^\/(almacen|modules)(\/|$)/.test(req.path);

  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', esAlmacen ? 'SAMEORIGIN' : 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  // Solo tiene efecto cuando el navegador llegó por HTTPS -el link oficial de
  // Tailscale Serve, ver README-; por HTTP simple (127.0.0.1, LAN) el propio
  // navegador la ignora, así que no hace falta condicionarla.
  res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    // Google Fonts (Inter): la hoja de estilos y los archivos de fuente son
    // lo único externo que se permite, y solo como estilo/fuente, no script.
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    esAlmacen ? "frame-ancestors 'self'" : "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    // Nada de plugins (Flash y similares): esta app no usa ninguno, y es la
    // única línea de la CSP que no tiene costo -no rompe nada- cerrarla del todo.
    "object-src 'none'"
  ].join('; '));
  next();
}

// --------------------------------------------------- estáticos de data/
/**
 * `data/` tiene dos clases de archivos muy distintas: los supuestos del
 * payback, que el navegador necesita, y el padrón y el histórico, que son
 * datos personales y de costos y no tienen por qué salir del servidor.
 *
 * Publicar la carpeta entera dejaba `/data/padron.js` —114 nombres con su
 * DNI— al alcance de cualquiera que escribiera la URL. Aquí se invierte la
 * regla: solo se sirve lo que está declarado como público y lo demás no
 * existe para el navegador, así que un archivo nuevo en `data/` nace privado.
 */
export function soloDatosPublicos(req, res, next) {
  const pedido = decodeURIComponent(req.path).replace(/^\/+/, '');
  const publico = CONFIG.datosPublicos.some(p =>
    p.endsWith('/') ? pedido.startsWith(p) : pedido === p);
  if (publico) return next();
  res.status(404).json({ error: 'No existe /data/' + pedido });
}
