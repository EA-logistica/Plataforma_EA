// Fuente principal de datos: el objeto `const DATA = {...}` que YA existe en radar_naranjal.html.
// Este módulo SOLO LEE el archivo original; nunca lo modifica ni copia su contenido a otro lugar.
// Si se edita la data en el HTML, el mapa refleja el cambio en la siguiente carga (se relee por mtime).
import fs from 'node:fs';
import path from 'node:path';
import { config, FRONTEND_DIR } from '../config/env.js';

const DATA_PATTERN = /^\s*const\s+DATA\s*=\s*(\{.*\})\s*;\s*$/m;

let cached = null;

export function readRadarData() {
  const file = config.legacyRadarFile;
  const stat = fs.statSync(file);
  if (cached && cached.mtimeMs === stat.mtimeMs) return cached.value;

  const html = fs.readFileSync(file, 'utf8');
  const match = html.match(DATA_PATTERN);
  if (!match) throw new Error(`No se encontró "const DATA = {...}" en ${file}`);

  const data = JSON.parse(match[1]);
  deepFreeze(data); // protege la data original contra mutaciones accidentales en memoria

  const value = {
    data,
    meta: {
      archivo: path.relative(FRONTEND_DIR, file).split(path.sep).join('/'),
      variable: 'DATA',
      modificado: new Date(stat.mtimeMs).toISOString(),
      registros: Object.keys(data.warehouses || {}).length,
    },
  };
  cached = { mtimeMs: stat.mtimeMs, value };
  return value;
}

function deepFreeze(obj) {
  Object.values(obj).forEach((v) => v && typeof v === 'object' && deepFreeze(v));
  return Object.freeze(obj);
}
