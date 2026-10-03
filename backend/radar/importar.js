import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { CONFIG } from '../config.js';
import { abrir, cerrar, uno, ejecutar, enTransaccion } from '../db/conexion.js';

/**
 * Migración ÚNICA de una instalación vieja de RADAR-EA (su propia PostgreSQL)
 * al esquema "radar" de la plataforma:
 *
 *   npm run radar:importar -- --origen postgresql://radar:CLAVE@127.0.0.1:54329/radar
 *                             [--raw "C:\…\RADAR-EA\data\raw"] [--forzar]
 *
 *   1. Copia artifacts, runs, operations, revisions, alerts y reviews tal cual
 *      (mismos id, valores exactos: todo viaja como texto y PostgreSQL lo
 *      vuelve a tipar), en UNA transacción: o entra todo o nada.
 *   2. Ajusta las secuencias de los id.
 *   3. Con --raw, MUEVE (no copia: son GB) los originales a CONFIG.radar.raw y
 *      reescribe artifacts.path, conservando los hashes.
 *
 * Se niega si el esquema radar ya tiene series (salvo --forzar, que lo vacía
 * antes): correrlo dos veces no duplica nada. Detén antes el API y el worker
 * de la instalación vieja, para que no sigan escribiendo en la base vieja.
 */

const TABLAS = [
  ['artifacts', 'id'], ['runs', 'id'], ['operations', 'id'], ['revisions', 'id'], ['alerts', 'id'], ['reviews', 'id']
];
const SECUENCIAS = ['operations', 'revisions', 'alerts', 'reviews'];

function argumentos(argv) {
  const a = { forzar: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--origen') a.origen = argv[++i];
    else if (argv[i] === '--raw') a.raw = argv[++i];
    else if (argv[i] === '--forzar') a.forzar = true;
  }
  if (!a.origen) throw new Error('Falta --origen postgresql://usuario:clave@host:puerto/base de la instalación vieja.');
  return a;
}

// Todo como texto: ni números (NUMERIC 22,6), ni fechas, ni JSON se reinterpretan en el camino.
const comoTexto = { getTypeParser: () => v => v };

async function main() {
  const a = argumentos(process.argv.slice(2));
  const origen = new pg.Client({ connectionString: a.origen, types: comoTexto });
  await origen.connect();
  await abrir(); // crea/migra el esquema radar de la plataforma
  try {
    const ya = (await uno('SELECT count(*) AS n FROM radar.operations')).n;
    if (ya && !a.forzar) throw new Error('El esquema radar ya tiene ' + ya + ' series. Usa --forzar para reemplazarlas.');

    const conteos = {};
    await enTransaccion(async () => {
      if (a.forzar) {
        for (const [t] of [...TABLAS].reverse()) await ejecutar('DELETE FROM radar.' + t);
      }
      for (const [tabla, orden] of TABLAS) {
        const { rows, fields } = await origen.query('SELECT * FROM ' + tabla + ' ORDER BY ' + orden);
        const destino = new Set((await ejecutar(
          "SELECT column_name FROM information_schema.columns WHERE table_schema = 'radar' AND table_name = '" + tabla + "'")).filas.map(f => f.column_name));
        const columnas = fields.map(f => f.name).filter(c => destino.has(c));
        for (let i = 0; i < rows.length; i += 500) {
          const lote = rows.slice(i, i + 500);
          const valores = [];
          const marcas = lote.map(f => '(' + columnas.map(c => { valores.push(f[c]); return '$' + valores.length; }).join(', ') + ')');
          // Parámetros $n directos: ejecutar() con un arreglo los pasa tal cual a pg.
          await ejecutar('INSERT INTO radar.' + tabla + ' (' + columnas.join(', ') + ') VALUES ' + marcas.join(', '), valores);
        }
        conteos[tabla] = rows.length;
      }
      for (const t of SECUENCIAS) {
        await ejecutar("SELECT setval(pg_get_serial_sequence('radar." + t + "', 'id'), GREATEST((SELECT max(id) FROM radar." + t + '), 1))');
      }
    });
    console.log('Datos copiados:', conteos);

    if (a.raw) {
      const desde = path.resolve(a.raw), hacia = path.resolve(CONFIG.radar.raw);
      if (!fs.existsSync(desde)) throw new Error('No existe ' + desde);
      if (fs.existsSync(hacia) && fs.readdirSync(hacia).length) throw new Error(hacia + ' ya tiene archivos: no se mezclan originales.');
      fs.mkdirSync(path.dirname(hacia), { recursive: true });
      if (fs.existsSync(hacia)) fs.rmdirSync(hacia);
      fs.renameSync(desde, hacia); // mismo disco: es un renombrado, no una copia de GB
      const r = await ejecutar('UPDATE radar.artifacts SET path = @hacia || substr(path, length(@desde) + 1) WHERE left(path, length(@desde)) = @desde',
        { desde, hacia });
      console.log('Originales movidos a', hacia, '·', r.changes, 'rutas actualizadas');
    }
  } finally {
    await origen.end().catch(() => {});
    await cerrar();
  }
}

main().catch(e => { console.error('No se pudo importar:', e.message); process.exit(1); });
