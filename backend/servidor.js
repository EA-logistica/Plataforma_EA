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
 * Servidor de PLANSA Delivery.
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
  abrir();
  fs.mkdirSync(CONFIG.subidas, { recursive: true });
  sembrar({ silencioso });

  const app = crearApp();
  const servidor = app.listen(puerto, host, () => {
    if (silencioso) return;
    const dir = servidor.address();
    console.log('\n  PLANSA Delivery');
    console.log('  en esta PC   http://localhost:' + dir.port);
    for (const url of direccionesDeRed(dir.port)) console.log('  en la red    ' + url);
    console.log('  base         ' + CONFIG.baseDatos);
    console.log('  subidas      ' + CONFIG.subidas + '\n');
  });

  const apagar = () => {
    servidor.close(() => { cerrar(); process.exit(0); });
    // Si alguna conexión se resiste, no dejamos el proceso colgado.
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGINT', apagar);
  process.on('SIGTERM', apagar);

  return servidor;
}
