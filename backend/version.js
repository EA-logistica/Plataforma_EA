import fs from 'node:fs';
import path from 'node:path';
import { RAIZ } from './config.js';

/**
 * ¿El servidor que está corriendo es el mismo código que hay en disco?
 *
 * El navegador lee sus archivos directo del disco en cada carga, pero el
 * servidor carga su código UNA vez, al arrancar. Tras una actualización, la
 * pantalla ya se ve nueva mientras el servidor sigue con la versión anterior:
 * las rutas nuevas responden "No existe la ruta" y parece que no hay datos.
 * Pasó varias veces (mapa, muestras). Esto lo detecta: huella del código del
 * servidor al arrancar vs. la de ahora; si difieren, hay un reinicio
 * pendiente y la pantalla de logística lo avisa (ver ui/actualizacion.js).
 */

const CARPETAS = ['backend', 'shared'];
const IGNORAR = /[\\/](storage|cache|node_modules)[\\/]/;

function huella() {
  let ultima = 0, archivos = 0;
  const recorrer = dir => {
    let entradas;
    try { entradas = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entradas) {
      const ruta = path.join(dir, e.name);
      if (IGNORAR.test(ruta + path.sep)) continue;
      if (e.isDirectory()) recorrer(ruta);
      else if (/\.(js|mjs|sql)$/.test(e.name)) {
        archivos++;
        try { ultima = Math.max(ultima, fs.statSync(ruta).mtimeMs); } catch { /* se borró en el medio */ }
      }
    }
  };
  for (const c of CARPETAS) recorrer(path.join(RAIZ, c));
  return { ultima, archivos };
}

const alArrancar = huella();
const arranque = new Date().toISOString();

// Recorrer ~120 archivos es barato, pero no hace falta en cada petición.
let cache = null;
export function estadoVersion() {
  const ahora = Date.now();
  if (!cache || ahora - cache.en > 30000) {
    const h = huella();
    cache = {
      en: ahora,
      pendiente: h.ultima > alArrancar.ultima + 1000 || h.archivos !== alArrancar.archivos,
      codigo: h.ultima ? new Date(h.ultima).toISOString() : ''
    };
  }
  return { arranque, pendiente: cache.pendiente, codigoActualizado: cache.codigo };
}
