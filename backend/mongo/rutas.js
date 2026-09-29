import { Router } from 'express';
import { db, configurado, describir } from './conexion.js';
import { sincronizar, estado } from './sincronizar.js';
import { requiereSesion, requiereRol } from '../usuarios/middleware.js';
import { asinc } from '../middleware/errores.js';

/**
 * Lectura del MongoDB del bot de logística. Solo admin, igual que compras:
 * son datos del negocio (presupuesto, consumos, proveedores), no de la
 * mensajería. No hay rutas de escritura -el usuario de Mongo tampoco puede-.
 *
 *   GET  /api/mongo/estado                  indicador del topbar (público)
 *   POST /api/mongo/sincronizar             copia ya las fotos del ERP (admin)
 *   GET /api/mongo/colecciones              nombres + conteo aproximado
 *   GET /api/mongo/c/:coleccion?limite=50&saltar=0&filtro={"campo":"valor"}&orden={"campo":-1}
 */
export const mongo = Router();

const soloAdmin = [requiereSesion, requiereRol('admin')];
const error = (msg, status) => Object.assign(new Error(msg), { status });

// Operadores que ejecutan JavaScript en el servidor de Mongo: fuera, aunque
// el usuario sea de solo lectura.
const PROHIBIDOS = new Set(['$where', '$function', '$accumulator']);
function revisar(valor) {
  if (valor && typeof valor === 'object') {
    for (const [k, v] of Object.entries(valor)) {
      if (PROHIBIDOS.has(k)) throw error('Operador no permitido: ' + k, 400);
      revisar(v);
    }
  }
  return valor;
}
function json(texto, nombre) {
  if (!texto) return {};
  try { return revisar(JSON.parse(texto)); }
  catch (e) { throw e.status ? e : error('"' + nombre + '" no es JSON válido.', 400); }
}

async function autorizadas(d) {
  const cols = await d.listCollections({}, { nameOnly: true, authorizedCollections: true }).toArray();
  return cols.map(c => c.name).filter(n => !n.startsWith('system.')).sort();
}

// Público a propósito: lo pinta el indicador del topbar para cualquiera. Solo
// dice si la última sincronización salió bien y de cuándo es la foto -nada
// del servidor ni de los datos-. No toca Mongo: lee lo guardado en ajustes.
mongo.get('/mongo/estado', asinc(async (req, res) => {
  if (!configurado()) return res.json({ configurado: false, conectado: false });
  const e = await estado();
  res.json({ configurado: true, conectado: e.ok === true, fechaDatos: e.fechaDatos || '', sincronizado: e.sincronizado || '' });
}));

mongo.get('/mongo/estado/detalle', ...soloAdmin, asinc(async (req, res) =>
  res.json({ configurado: configurado(), servidor: describir(), ...(await estado()) })));

// Forzar la copia ahora, sin esperar los 30 minutos del ciclo automático.
mongo.post('/mongo/sincronizar', ...soloAdmin, asinc(async (req, res) => {
  try { res.json(await sincronizar()); }
  catch (e) { throw Object.assign(new Error('No se pudo sincronizar con MongoDB: ' + e.message), { status: 503 }); }
}));

mongo.get('/mongo/colecciones', ...soloAdmin, asinc(async (req, res) => {
  const d = await db();
  const nombres = await autorizadas(d);
  const colecciones = await Promise.all(nombres.map(async nombre => {
    try { return { nombre, documentos: await d.collection(nombre).estimatedDocumentCount() }; }
    catch (_) { return null; } // sin permiso de lectura: no se lista
  }));
  res.json(colecciones.filter(Boolean));
}));

mongo.get('/mongo/c/:coleccion', ...soloAdmin, asinc(async (req, res) => {
  const d = await db();
  const nombre = req.params.coleccion;
  if (!(await autorizadas(d)).includes(nombre)) throw error('No existe la colección ' + nombre + ' o no hay permiso.', 404);

  const limite = Math.min(Math.max(Number(req.query.limite) || 50, 1), 500);
  const saltar = Math.max(Number(req.query.saltar) || 0, 0);
  const filtro = json(req.query.filtro, 'filtro');
  const orden = json(req.query.orden, 'orden');

  const col = d.collection(nombre);
  const [total, documentos] = await Promise.all([
    col.countDocuments(filtro, { maxTimeMS: 10000 }),
    col.find(filtro, { maxTimeMS: 10000 }).sort(orden).skip(saltar).limit(limite).toArray()
  ]);
  res.json({ coleccion: nombre, total, limite, saltar, documentos });
}));
