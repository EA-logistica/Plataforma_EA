import { Router } from 'express';
import * as exportaciones from '../db/repos/exportaciones.js';
import * as requerimientos from '../db/repos/requerimientosCompra.js';
import * as servicios from '../db/repos/serviciosLogistica.js';
import { requiereSesion, requiereRol } from '../usuarios/middleware.js';
import { log } from '../seguridad/log.js';

/**
 * Compras y Logística: exportaciones (muestras al exterior), requerimientos
 * de compra y servicios que gestiona el coordinador de logística. Los tres
 * son simples de propósito -alta, edición, baja- así que comparten un mismo
 * módulo de rutas en vez de uno por recurso.
 *
 * Todo exige sesión de admin: "seguimiento" no administra compras, solo
 * despacha (ver requiereRol('admin') en cada ruta).
 */
export const compras = Router();

const soloAdmin = [requiereSesion, requiereRol('admin')];

// ------------------------------------------------------------ exportaciones
compras.get('/exportaciones', ...soloAdmin, (req, res) => res.json(exportaciones.listar()));
compras.post('/exportaciones', ...soloAdmin, (req, res) => {
  const f = exportaciones.crear(req.body || {}, req.usuario.usuario);
  log('exportacion_creada', req, f.paisDestino + ' · ' + f.descripcion);
  res.status(201).json(f);
});
compras.patch('/exportaciones/:id', ...soloAdmin, (req, res) => {
  const f = exportaciones.actualizar(req.params.id, req.body || {});
  log('exportacion_actualizada', req, 'id ' + req.params.id + ' → ' + f.estado);
  res.json(f);
});
compras.delete('/exportaciones/:id', ...soloAdmin, (req, res) => {
  const r = exportaciones.eliminar(req.params.id);
  log('exportacion_eliminada', req, 'id ' + req.params.id);
  res.json(r);
});

// ------------------------------------------------------ requerimientos de compra
compras.get('/requerimientos-compra', ...soloAdmin, (req, res) => res.json(requerimientos.listar()));
compras.post('/requerimientos-compra', ...soloAdmin, (req, res) => {
  const f = requerimientos.crear(req.body || {}, req.usuario.usuario);
  log('requerimiento_creado', req, 'REQ-C' + f.correlativo + ' · ' + f.descripcion);
  res.status(201).json(f);
});
compras.patch('/requerimientos-compra/:id', ...soloAdmin, (req, res) => {
  const f = requerimientos.actualizar(req.params.id, req.body || {});
  log('requerimiento_actualizado', req, 'id ' + req.params.id + ' → ' + f.estado);
  res.json(f);
});
compras.delete('/requerimientos-compra/:id', ...soloAdmin, (req, res) => {
  const r = requerimientos.eliminar(req.params.id);
  log('requerimiento_eliminado', req, 'id ' + req.params.id);
  res.json(r);
});

// ------------------------------------------------------------ servicios de logística
compras.get('/servicios-logistica', ...soloAdmin, (req, res) => res.json(servicios.listar()));
compras.post('/servicios-logistica', ...soloAdmin, (req, res) => {
  const f = servicios.crear(req.body || {}, req.usuario.usuario);
  log('servicio_logistica_creado', req, f.tipoServicio + ' · ' + f.descripcion);
  res.status(201).json(f);
});
compras.patch('/servicios-logistica/:id', ...soloAdmin, (req, res) => {
  const f = servicios.actualizar(req.params.id, req.body || {});
  log('servicio_logistica_actualizado', req, 'id ' + req.params.id + ' → ' + f.estado);
  res.json(f);
});
compras.delete('/servicios-logistica/:id', ...soloAdmin, (req, res) => {
  const r = servicios.eliminar(req.params.id);
  log('servicio_logistica_eliminado', req, 'id ' + req.params.id);
  res.json(r);
});
