import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { CONFIG } from '../config.js';
import { abrir, cerrar, todos, uno, ejecutar, insertarLote, enTransaccion, describir } from './conexion.js';

/**
 * Trae a PostgreSQL todo lo que había en una base SQLite de antes de la
 * migración: usuarios y claves, solicitudes, adjuntos, padrón, compras…
 *
 *     npm run db:importar-sqlite                       usa plansa.sqlite de la raíz
 *     npm run db:importar-sqlite -- D:/copia/plansa.sqlite
 *     npm run db:importar-sqlite -- <archivo> --reemplazar
 *
 * Por seguridad no pisa nada: si PostgreSQL ya tiene solicitudes registradas
 * en la aplicación o usuarios creados a mano, se detiene y pide --reemplazar.
 * Con --reemplazar vacía TODAS las tablas de PostgreSQL y las llena con lo del
 * archivo, en una sola transacción: si algo falla, PostgreSQL queda como estaba.
 *
 * El servidor debe estar apagado mientras corre (y el SQLite de origen, sin
 * nadie escribiéndolo: si vino de otra PC, copiarlo con su servidor cerrado).
 * Los archivos de uploads/ no pasan por acá: se copian aparte, carpeta entera.
 */

// Orden de carga: primero lo que otras tablas referencian (solicitudes antes
// que paradas y adjuntos).
const TABLAS = [
  'ajustes', 'personal', 'solicitudes', 'paradas', 'adjuntos', 'autorizaciones',
  'credenciales_area', 'pedidos_historico', 'usuarios', 'eventos_seguridad',
  'exportaciones', 'requerimientos_compra', 'servicios_logistica', 'metraje_almacen',
  'ordenes_compra', 'productos', 'requerimientos_compra_detalle', 'ordenes_compra_detalle',
  'materia_prima_stock', 'stock_valorizado'
];

const args = process.argv.slice(2);
const reemplazar = args.includes('--reemplazar');
const origen = path.resolve(args.find(a => !a.startsWith('--')) || CONFIG.baseDatos);

if (!fs.existsSync(origen)) {
  console.error('No existe el archivo SQLite: ' + origen);
  process.exit(1);
}

const sqlite = new DatabaseSync(origen, { readOnly: true });
const tablasOrigen = new Set(sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(t => t.name));

await abrir();
try {
  const conDatos = (await uno("SELECT COUNT(*) AS n FROM solicitudes WHERE fuente = 'app'")).n
    + (await uno("SELECT COUNT(*) AS n FROM usuarios WHERE creado_por <> 'siembra'")).n;
  if (conDatos && !reemplazar) {
    console.error('PostgreSQL (' + describir() + ') ya tiene datos cargados en la aplicación.\n'
      + 'Para vaciarlo y reemplazarlo con ' + origen + ', repite con --reemplazar.');
    process.exitCode = 1;
  } else {
    console.log('Importando ' + origen + '\n     hacia ' + describir() + '\n');
    await enTransaccion(async () => {
      await ejecutar('TRUNCATE ' + TABLAS.join(', ') + ' RESTART IDENTITY CASCADE');
      for (const tabla of TABLAS) {
        if (!tablasOrigen.has(tabla)) { console.log('  ' + tabla.padEnd(32) + '(no está en el SQLite)'); continue; }
        const destino = new Set((await todos(
          'SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = ?', [tabla]
        )).map(c => c.column_name));
        const columnas = sqlite.prepare('PRAGMA table_info(' + tabla + ')').all().map(c => c.name).filter(c => destino.has(c));
        const filas = sqlite.prepare('SELECT ' + columnas.join(', ') + ' FROM ' + tabla).all();
        const n = await insertarLote(tabla, columnas, filas);
        // Las columnas id son IDENTITY: tras insertar con id explícito, la
        // secuencia tiene que seguir desde el máximo, o el próximo alta choca.
        if (destino.has('id') && (await uno('SELECT pg_get_serial_sequence(?, ?) AS s', [tabla, 'id'])).s) {
          await ejecutar("SELECT setval(pg_get_serial_sequence('" + tabla + "', 'id'), COALESCE(MAX(id), 1), MAX(id) IS NOT NULL) FROM " + tabla);
        }
        console.log('  ' + tabla.padEnd(32) + n + ' filas');
      }
    });
    console.log('\nListo. Arranca el servidor como siempre; los usuarios y claves son los de la base importada.');
  }
} finally {
  sqlite.close();
  await cerrar();
}
