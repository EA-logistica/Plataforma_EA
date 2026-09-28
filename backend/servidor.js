import express from 'express';
import compression from 'compression';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { CONFIG } from './config.js';
import { abrir, cerrar } from './db/conexion.js';
import { sembrar } from './db/sembrar.js';
import { api } from './rutas/index.js';
import { noEncontrado, manejarErrores } from './middleware/errores.js';
import { cabeceras, soloDatosPublicos } from './middleware/limites.js';
import { origenPropio } from './middleware/origen.js';
import { protegerAlmacen, exigirSesionAlmacen } from './almacen/acceso.js';
import { handleApi } from './almacen/src/routes/api.js';
import { sendError } from './almacen/src/lib/http.js';

/**
 * Servidor de Plataforma EA.
 *
 * Sirve dos cosas: la API en /api y la aplicación del navegador. Está pensado
 * para correr en la red interna de la planta o por Tailscale, no expuesto a
 * internet abierto. La red de confianza es una capa más, no un reemplazo de
 * la autenticación: hay usuarios de logística con clave (ver backend/usuarios/)
 * y el resto de la API se protege igual que si estuviera en internet.
 */

export function crearApp() {
  const app = express();

  // No anunciar el motor: es gratis y le ahorra el primer paso a un curioso.
  app.disable('x-powered-by');
  // Detrás de un proxy local (Tailscale Serve, nginx en la misma máquina)
  // req.ip debe ser el del cliente y no el del proxy, o el freno de intentos
  // castigaría a todos por igual. Se confía SOLO en el proxy de loopback, no
  // en cualquiera: con 'trust proxy' abierto, un cliente remoto se salta el
  // freno mandando la cabecera X-Forwarded-For que se le antoje.
  app.set('trust proxy', 'loopback');

  app.use(cabeceras);

  // Blindaje contra un desajuste de decodificación entre cómo Express hace
  // calzar `app.use('/modules', ...)` / `app.use('/almacen', ...)` (compara
  // el path tal cual llega, sin decodificar "%XX") y cómo `express.static`
  // resuelve el archivo en disco más abajo (sí decodifica antes de buscarlo).
  // Sin esto, "/%6dodules/almacen-los-olivos/layout...html" no calza con el
  // prefijo "/modules" -así que se salta exigirSesionAlmacen por completo-,
  // pero de todos modos el estático general de la línea de abajo lo decodifica
  // a "/modules/..." y lo sirve sin sesión. Se rechaza cualquier pedido cuyo
  // PRIMER segmento decodificado sea "modules" o "almacen" pero no venga ya
  // escrito así -lo demás del path (p.ej. espacios en el nombre de archivo)
  // sigue codificándose normal, no se toca-.
  app.use((req, res, next) => {
    const primerSegmento = req.path.split('/')[1] || '';
    let decodificado;
    try { decodificado = decodeURIComponent(primerSegmento); } catch { return res.status(400).end('Ruta inválida'); }
    if (decodificado !== primerSegmento && (decodificado === 'modules' || decodificado === 'almacen')) {
      return res.status(400).json({ error: 'Ruta inválida' });
    }
    next();
  });

  // El estado completo ronda el megabyte con el histórico cargado, y se pide
  // cada vez que alguien abre la pantalla. Comprimido viaja una fracción de
  // eso, que sobre Tailscale es la diferencia entre instantáneo y notarlo. Se
  // usa el middleware de Express y no uno propio: Vary, los umbrales y los
  // flujos tienen más filo del que parece.
  app.use(compression());

  app.use(express.json({ limit: '1mb' }));
  // Sin express.urlencoded(): nada en el frontend manda formularios
  // codificados así (todo va en JSON o multipart), y tenerlo montado dejaba
  // que un <form> de una página ajena, con enctype por defecto, se
  // interpretara igual que una petición legítima (ver middleware/origen.js).

  app.use('/api', origenPropio, api);

  // --- módulo de Almacén (otro repositorio, ALMACEN-LOS-OLIVOS, integrado
  // acá dentro): protegido de verdad -ticket de un solo uso + cookie propia,
  // ver almacen/acceso.js-, no solo un botón escondido en el sidebar. Su
  // propio /api queda namespaced bajo /almacen/api para no chocar con el
  // /api de arriba, que es otro sistema con otra sesión.
  app.use('/almacen', protegerAlmacen, async (req, res, next) => {
    if (req.url === '/' || req.url === '') {
      return res.sendFile(path.join(CONFIG.estaticos.frontend, 'almacen', 'index.html'));
    }
    if (req.url.startsWith('/api/')) {
      try {
        await handleApi(req, res, new URL(req.url, 'http://localhost'));
      } catch (err) {
        if (!res.headersSent) sendError(req, res, err);
      }
      return;
    }
    next();
  }, express.static(path.join(CONFIG.estaticos.frontend, 'almacen')));
  // Los módulos del shell viven en frontend/modules (sus rutas absolutas no
  // se reescribieron), pero con la misma puerta que el shell.
  app.use('/modules', exigirSesionAlmacen);

  // --- estáticos ---
  // Librerías de terceros (Leaflet): no cambian entre versiones de la app,
  // así que se cachean una semana en vez de revalidarse en cada carga -con 50
  // navegadores abriendo el mapa, son decenas de peticiones menos por
  // pantalla-. Lo propio (js/, css/) sigue revalidando por ETag, porque cambia
  // con cada actualización y no lleva la versión en el nombre.
  app.use('/vendor', express.static(path.join(CONFIG.estaticos.frontend, 'vendor'), { maxAge: '7d' }));
  // frontend/ es la raíz: lo que pida el navegador sale de ahí.
  app.use(express.static(CONFIG.estaticos.frontend, { index: 'index.html' }));

  // shared/ y data/ se publican aparte porque los usan el servidor Y el
  // navegador. El import map de index.html traduce "#shared/..." a estas URL;
  // en Node, el campo "imports" de package.json hace lo mismo contra el disco.
  // Un solo archivo, dos formas de resolverlo, cero duplicación.
  app.use('/shared', express.static(CONFIG.estaticos.shared));
  // De data/ solo sale lo declarado público: el padrón y el histórico se
  // quedan en el servidor. Ver soloDatosPublicos en middleware/limites.js.
  app.use('/data', soloDatosPublicos, express.static(CONFIG.estaticos.data));

  // uploads/ NO se publica como carpeta estática a propósito: los archivos se
  // sirven por /api/adjuntos/:id/archivo, que comprueba que el adjunto exista
  // en la base. Exponer la carpeta permitiría listar y adivinar nombres.

  app.use(noEncontrado);
  app.use(manejarErrores);

  return app;
}

/**
 * Direcciones por las que otra PC puede entrar. Se imprimen al arrancar porque
 * la pregunta de siempre —"¿qué enlace les paso?"— tiene aquí su respuesta, y
 * porque la de Tailscale (100.x) no hay forma de adivinarla.
 */
function direccionesDeRed(puerto) {
  const urls = [];
  for (const nics of Object.values(os.networkInterfaces())) {
    for (const nic of nics || []) {
      if (nic.family !== 'IPv4' || nic.internal) continue;
      const tailscale = nic.address.startsWith('100.');
      urls.push('http://' + nic.address + ':' + puerto + (tailscale ? '   (Tailscale)' : ''));
    }
  }
  return urls;
}

export function iniciar({ puerto = CONFIG.puerto, host = CONFIG.host, silencioso = false } = {}) {
  // Un error de programación en una sola petición no debe tumbar el servidor
  // para las otras 49 personas conectadas: Express ya atrapa lo síncrono y
  // asinc() lo asíncrono; esto es la última red para lo que se escape (un
  // callback de un flujo, una promesa olvidada), que queda en el log.
  if (!process.listenerCount('unhandledRejection')) {
    process.on('unhandledRejection', err => console.error('[unhandledRejection]', err));
  }

  abrir();
  fs.mkdirSync(CONFIG.subidas, { recursive: true });
  sembrar({ silencioso });

  const app = crearApp();
  const servidor = app.listen(puerto, host, () => {
    if (silencioso) return;
    const dir = servidor.address();
    console.log('\n  Plataforma EA');
    console.log('  en esta PC   http://localhost:' + dir.port);
    for (const url of direccionesDeRed(dir.port)) console.log('  en la red    ' + url);
    console.log('  base         ' + CONFIG.baseDatos);
    console.log('  subidas      ' + CONFIG.subidas + '\n');
  });

  // Apagado ordenado: dejar de aceptar, cerrar las conexiones keep-alive
  // ociosas (sin esto, el sondeo de cada navegador mantenía el servidor
  // abierto y SIEMPRE se llegaba al exit forzado del timeout, que salía sin
  // cerrar la base ni volcar el WAL) y cerrar SQLite. El timeout sigue como
  // red de seguridad, pero ahora también cierra la base.
  let apagando = false;
  const apagar = senal => {
    if (apagando) return;
    apagando = true;
    if (!silencioso) console.log('\n  ' + senal + ': cerrando…');
    const salir = codigo => { try { cerrar(); } catch (_) { /* ya cerrada */ } process.exit(codigo); };
    servidor.close(() => salir(0));
    servidor.closeIdleConnections?.();
    setTimeout(() => { servidor.closeAllConnections?.(); salir(0); }, 3000).unref();
  };
  process.on('SIGINT', () => apagar('SIGINT'));
  process.on('SIGTERM', () => apagar('SIGTERM'));
  // En Windows, cerrar la ventana de consola del .bat llega como SIGHUP: sin
  // esto el proceso moría sin cerrar la base.
  process.on('SIGHUP', () => apagar('SIGHUP'));

  return servidor;
}
