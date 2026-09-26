// Verifica que los archivos originales sigan intactos y que la data del Radar se pueda leer.
// Uso: npm run verificar
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT_DIR, STORAGE_DIR } from '../src/config/env.js';
import { readRadarData } from '../src/data/radar-source.js';

const manifest = JSON.parse(fs.readFileSync(path.join(STORAGE_DIR, 'integridad-originales.json'), 'utf8'));
let ok = true;

for (const [rel, expected] of Object.entries(manifest.archivos)) {
  const file = path.join(ROOT_DIR, rel);
  if (!fs.existsSync(file)) {
    console.log(`✗ FALTA      ${rel}`);
    ok = false;
    continue;
  }
  const actual = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const same = actual === expected;
  ok &&= same;
  console.log(`${same ? '✓ INTACTO   ' : '✗ MODIFICADO'} ${rel}`);
}

try {
  const { data, meta } = readRadarData();
  const regs = Object.values(data.warehouses);
  const conCoords = regs.filter((w) => Number.isFinite(w.lat) && Number.isFinite(w.lon)).length;
  console.log(`✓ DATA       ${meta.registros} registros · ${conCoords} con coordenadas · planta: ${data.plant?.name ?? 'no definida'}`);
} catch (err) {
  ok = false;
  console.log(`✗ DATA       ${err.message}`);
}

console.log(ok ? '\nTodo correcto: la información original permanece intacta.' : '\nATENCIÓN: se detectaron diferencias.');
process.exit(ok ? 0 : 1);
