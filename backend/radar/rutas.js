import { Router } from 'express';
import * as radar from './consultas.js';
import { estadoWorker } from './worker.js';
import { requiereSesion, requiereRol } from '../usuarios/middleware.js';
import { asinc } from '../middleware/errores.js';
import { log } from '../seguridad/log.js';

/**
 * Radar de Importaciones dentro de la plataforma (antes la API FastAPI de
 * RADAR-EA en otro puerto). Solo admin, como el resto de Compras y Logística.
 *
 *   GET  /api/radar/estado                 cuánto hay, última carga y el worker
 *   GET  /api/radar/panel                  Panel general (filtros comunes)
 *   GET  /api/radar/historico              Histórico y métricas (grain, compare_start/end)
 *   GET  /api/radar/operaciones            Explorar: series paginadas
 *   GET  /api/radar/operaciones/exportar   CSV de la selección
 *   GET  /api/radar/operaciones/:id        Detalle con original y revisiones
 *   POST /api/radar/operaciones/:id/revision  Corrige la clasificación (bloqueada)
 *   GET  /api/radar/productos              Buscador de productos (?p=hdpe inyeccion)
 *   GET  /api/radar/empresas               Importadores por RUC
 *   GET  /api/radar/empresas/:ruc          Ficha de una empresa
 *   GET  /api/radar/opciones               Valores de los filtros
 *   GET  /api/radar/calidad                Archivos fuente y ejecuciones
 *   POST /api/radar/ejecuciones            Encola una actualización
 *   POST /api/radar/ejecuciones/:id/reanudar
 */
export const rutasRadar = Router();
const soloAdmin = [requiereSesion, requiereRol('admin')];

const get = (ruta, fn) => rutasRadar.get('/radar' + ruta, ...soloAdmin, asinc(async (req, res) => res.json(await fn(req))));

get('/estado', async () => ({ ...(await radar.estado()), worker: estadoWorker() }));
get('/panel', req => radar.panel(req.query));
get('/historico', req => radar.historico(req.query));
rutasRadar.get('/radar/operaciones/exportar', ...soloAdmin, asinc(async (req, res) => {
  const cuerpo = await radar.exportarCsv(req.query);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="radar-importaciones.csv"');
  res.send(cuerpo);
}));
get('/operaciones', req => radar.operaciones(req.query));
get('/operaciones/:id', req => radar.operacion(req.params.id));
get('/productos', req => radar.productos(req.query));
get('/empresas', req => radar.empresas(req.query));
get('/empresas/:ruc', req => radar.empresa(req.params.ruc, req.query));
get('/opciones', () => radar.opciones());
get('/calidad', () => radar.calidad());

rutasRadar.post('/radar/operaciones/:id/revision', ...soloAdmin, asinc(async (req, res) => {
  const r = await radar.revisar(req.params.id, { ...req.body, actor: req.usuario?.usuario });
  await log('radar_revision', req, 'serie ' + req.params.id + ' → ' + req.body?.material);
  res.json(r);
}));
rutasRadar.post('/radar/ejecuciones', ...soloAdmin, asinc(async (req, res) => {
  const r = await radar.encolar(req.body || {});
  await log('radar_ejecucion', req, (req.body?.kind || 'bulk') + ' ' + r.id);
  res.status(202).json(r);
}));
rutasRadar.post('/radar/ejecuciones/:id/reanudar', ...soloAdmin, asinc(async (req, res) => res.json(await radar.reanudar(req.params.id))));
