import { Router } from 'express';
import * as exportaciones from '../db/repos/exportaciones.js';
import * as requerimientos from '../db/repos/requerimientosCompra.js';
import * as servicios from '../db/repos/serviciosLogistica.js';
import * as ordenesCompra from '../db/repos/ordenesCompra.js';
import * as ordenesCompraDetalle from '../db/repos/ordenesCompraDetalle.js';
import * as productos from '../db/repos/productos.js';
import * as requerimientosHistorico from '../db/repos/requerimientosCompraHistorico.js';
import * as materiaPrima from '../db/repos/materiaPrimaStock.js';
import * as stockValorizado from '../db/repos/stockValorizado.js';
import { requiereSesion, requiereRol } from '../usuarios/middleware.js';
import { log } from '../seguridad/log.js';
import { cachearGet } from '../middleware/cache.js';

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

// cachearGet va después de la sesión y solo actúa en GET: los agregados de
// solo lectura (ranking de proveedores, rotación ABC, etc.) se calculan una
// vez por revisión y no por cada usuario (ver middleware/cache.js). Toda
// escritura de estos módulos pasa por tocar(), que vacía la caché.
const soloAdmin = [requiereSesion, requiereRol('admin'), cachearGet()];

/**
 * Exige un motivo de eliminación en el cuerpo de la petición ANTES de borrar
 * nada: el frontend ya lo pide con un modal (ver confirmarEliminacion en
 * frontend/js/views/dispatch.js), pero no basta con confiar en él -alguien
 * podría llamar al DELETE directo, sin pasar por la pantalla.
 */
function exigirMotivo(req) {
  const motivo = String(req.body?.motivo || '').trim();
  if (motivo.length < 3) throw Object.assign(new Error('Escribe el motivo de la eliminación (mínimo 3 caracteres).'), { status: 400 });
  return motivo;
}

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
  const motivo = exigirMotivo(req);
  const r = exportaciones.eliminar(req.params.id);
  log('exportacion_eliminada', req, 'id ' + req.params.id + ' · motivo: ' + motivo);
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
  const motivo = exigirMotivo(req);
  const r = requerimientos.eliminar(req.params.id);
  log('requerimiento_eliminado', req, 'id ' + req.params.id + ' · motivo: ' + motivo);
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
  const motivo = exigirMotivo(req);
  const r = servicios.eliminar(req.params.id);
  log('servicio_logistica_eliminado', req, 'id ' + req.params.id + ' · motivo: ' + motivo);
  res.json(r);
});

// -------------------------------------------------------------- órdenes de compra
// Registro de compras de SUNAT, cargado una sola vez (ver backend/db/sembrar.js
// y data/compras.js). Es de solo lectura: no hay POST/PATCH/DELETE porque la
// fuente de verdad es la contabilidad, no la app.
compras.get('/ordenes-compra', ...soloAdmin, (req, res) => res.json(ordenesCompra.listar(req.query)));
compras.get('/ordenes-compra/resumen', ...soloAdmin, (req, res) => res.json(ordenesCompra.resumen(req.query)));
compras.get('/ordenes-compra/proveedores', ...soloAdmin, (req, res) => res.json(ordenesCompra.proveedores()));
compras.get('/ordenes-compra/evolucion', ...soloAdmin, (req, res) => {
  if (!req.query.proveedor) throw Object.assign(new Error('Indica el proveedor.'), { status: 400 });
  res.json(ordenesCompra.evolucionProveedor(req.query.proveedor));
});

// -------------------------------------------------------------------- productos
// Catálogo de productos (SKU) del ERP, cargado en cada arranque (ver
// backend/db/sembrar.js y data/productos.js). Solo lectura.
compras.get('/productos', ...soloAdmin, (req, res) => res.json(productos.listar(req.query)));
compras.get('/productos/resumen', ...soloAdmin, (req, res) => res.json(productos.resumen(req.query)));
compras.get('/productos/resumen-rotacion', ...soloAdmin, (req, res) => res.json(productos.resumenRotacion(req.query)));
compras.get('/productos/resumen-rotacion-por-familia', ...soloAdmin, (req, res) => res.json(productos.resumenRotacionPorFamilia(req.query)));
compras.get('/productos/opciones', ...soloAdmin, (req, res) => res.json(productos.opciones()));
compras.get('/productos/:codigo/requerimientos', ...soloAdmin, (req, res) =>
  res.json(requerimientosHistorico.porProducto(req.params.codigo)));

// -------------------------------------------------- requerimientos de compra (histórico ERP)
// Contraparte de solo lectura de /requerimientos-compra: lo que el ERP ya
// resolvió, no lo que admin registra a mano en la app (ver data/
// requerimientosCompraHistorico.js).
compras.get('/requerimientos-compra-historico', ...soloAdmin, (req, res) => res.json(requerimientosHistorico.listar(req.query)));
compras.get('/requerimientos-compra-historico/resumen', ...soloAdmin, (req, res) => res.json(requerimientosHistorico.resumen(req.query)));
compras.get('/requerimientos-compra-historico/proveedores', ...soloAdmin, (req, res) => res.json(requerimientosHistorico.proveedores()));
compras.get('/requerimientos-compra-historico/opciones', ...soloAdmin, (req, res) => res.json(requerimientosHistorico.opciones()));

// ------------------------------------------------------ historial de órdenes de compra (OC)
// Reporte de OC del ERP, cargado una sola vez (ver backend/db/sembrar.js y
// data/ordenesCompraDetalle.js). Solo lectura. Es un documento distinto del
// registro de compras SUNAT (/ordenes-compra de arriba): la OC es la orden
// al proveedor, no la factura.
compras.get('/oc', ...soloAdmin, (req, res) => res.json(ordenesCompraDetalle.resumenPorOC(req.query)));
compras.get('/oc/resumen', ...soloAdmin, (req, res) => res.json(ordenesCompraDetalle.resumen(req.query)));
compras.get('/oc/meses', ...soloAdmin, (req, res) => res.json(ordenesCompraDetalle.porMes(req.query)));
compras.get('/oc/opciones', ...soloAdmin, (req, res) => res.json(ordenesCompraDetalle.opciones()));
// Ranking de proveedores SEGÚN EL FILTRO activo (fecha/moneda); /todos es la
// lista completa sin filtrar, solo para poblar el selector.
compras.get('/oc/proveedores', ...soloAdmin, (req, res) => res.json(ordenesCompraDetalle.proveedores(req.query)));
compras.get('/oc/proveedores/todos', ...soloAdmin, (req, res) => res.json(ordenesCompraDetalle.todosLosProveedores()));
// Ficha de un proveedor para la sección Proveedores: lo que el registro SUNAT
// y el historial de OC saben de él (RUC, primera/última compra, lo que más se
// le compra y a qué costo). Va antes de /oc/:numeroOc para no confundirse.
compras.get('/proveedores/perfil', ...soloAdmin, (req, res) => {
  if (!req.query.proveedor) throw Object.assign(new Error('Indica el proveedor.'), { status: 400 });
  res.json({
    sunat: ordenesCompra.perfilProveedor(req.query.proveedor),
    oc: ordenesCompraDetalle.perfilProveedor(req.query.proveedor)
  });
});
compras.get('/oc/:numeroOc/items', ...soloAdmin, (req, res) => res.json(ordenesCompraDetalle.porOC(req.params.numeroOc)));

// -------------------------------------------------------------------- materia prima
// Stock valorizado de materia prima, cargado en cada arranque desde el
// reporte del ERP (ver backend/db/sembrar.js y data/materiaPrimaStock.js).
// Solo lectura. Navegación en cuatro niveles: Tipo (Materia Prima / Materia
// Prima - Tintas) -> Categoría -> Línea -> Producto, más el corte por
// almacén (con drill-down directo).
compras.get('/materia-prima/tipos', ...soloAdmin, (req, res) => res.json(materiaPrima.tipos()));
compras.get('/materia-prima/resumen', ...soloAdmin, (req, res) => res.json(materiaPrima.resumen(req.query.tipo)));
compras.get('/materia-prima/categorias', ...soloAdmin, (req, res) => res.json(materiaPrima.categorias(req.query.tipo)));
compras.get('/materia-prima/almacenes', ...soloAdmin, (req, res) => res.json(materiaPrima.almacenes(req.query.tipo)));
compras.get('/materia-prima/buscar', ...soloAdmin, (req, res) => res.json(materiaPrima.buscarProductos(req.query.q || '')));
compras.get('/materia-prima/categorias/:categoria/lineas', ...soloAdmin, (req, res) =>
  res.json(materiaPrima.lineasDeCategoria(req.params.categoria, req.query.tipo)));
// almacén va en query por el mismo motivo que familia: nombres como "ALMACEN
// DE  MEZCLA MP" son seguros, pero no vale la pena arriesgarse con :almacen.
compras.get('/materia-prima/almacenes/productos', ...soloAdmin, (req, res) => {
  if (!req.query.almacen) throw Object.assign(new Error('Indica el almacén.'), { status: 400 });
  res.json(materiaPrima.productosDeAlmacen(req.query.almacen, req.query.tipo));
});
// familia va en query (no en la ruta): algunas familias del ERP traen "/" en
// el nombre ("MP/MB TERCERO"), que rompería el path si fuera :familia.
compras.get('/materia-prima/lineas/productos', ...soloAdmin, (req, res) => {
  if (!req.query.familia) throw Object.assign(new Error('Indica la línea (familia).'), { status: 400 });
  res.json(materiaPrima.productosDeLinea(req.query.familia, req.query.tipo));
});
compras.get('/materia-prima/productos/:codigo/almacenes', ...soloAdmin, (req, res) =>
  res.json(materiaPrima.almacenesDeProducto(req.params.codigo)));

// ------------------------------------------------------- stock valorizado (global)
// Todos los almacenes y tipos de producto juntos (Producto Terminado + Materia
// Prima + Activos Fijos, etc.), para el Dashboard. El detalle por almacén ya
// vive en Materia Prima (un solo tipo) y en Almacén Los Olivos (un almacén).
compras.get('/stock-valorizado/resumen', ...soloAdmin, (req, res) => res.json(stockValorizado.resumenGlobal()));
