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
import * as muestras from '../db/repos/muestrasMp.js';
import * as homologados from '../db/repos/homologadosMp.js';
import * as importaciones from '../db/repos/importaciones.js';
import * as mpPlaneacion from '../db/repos/mpPlaneacion.js';
import { requiereSesion, requiereRol } from '../usuarios/middleware.js';
import { log } from '../seguridad/log.js';
import { cachearGet } from '../middleware/cache.js';
import { asinc } from '../middleware/errores.js';

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
compras.get('/exportaciones', ...soloAdmin, asinc(async (req, res) => res.json(await exportaciones.listar())));
compras.post('/exportaciones', ...soloAdmin, asinc(async (req, res) => {
  const f = await exportaciones.crear(req.body || {}, req.usuario.usuario);
  await log('exportacion_creada', req, f.paisDestino + ' · ' + f.descripcion);
  res.status(201).json(f);
}));
compras.patch('/exportaciones/:id', ...soloAdmin, asinc(async (req, res) => {
  const f = await exportaciones.actualizar(req.params.id, req.body || {});
  await log('exportacion_actualizada', req, 'id ' + req.params.id + ' → ' + f.estado);
  res.json(f);
}));
compras.delete('/exportaciones/:id', ...soloAdmin, asinc(async (req, res) => {
  const motivo = exigirMotivo(req);
  const r = await exportaciones.eliminar(req.params.id);
  await log('exportacion_eliminada', req, 'id ' + req.params.id + ' · motivo: ' + motivo);
  res.json(r);
}));

// ------------------------------------------------------ requerimientos de compra
compras.get('/requerimientos-compra', ...soloAdmin, asinc(async (req, res) => res.json(await requerimientos.listar())));
compras.post('/requerimientos-compra', ...soloAdmin, asinc(async (req, res) => {
  const f = await requerimientos.crear(req.body || {}, req.usuario.usuario);
  await log('requerimiento_creado', req, 'REQ-C' + f.correlativo + ' · ' + f.descripcion);
  res.status(201).json(f);
}));
compras.patch('/requerimientos-compra/:id', ...soloAdmin, asinc(async (req, res) => {
  const f = await requerimientos.actualizar(req.params.id, req.body || {});
  await log('requerimiento_actualizado', req, 'id ' + req.params.id + ' → ' + f.estado);
  res.json(f);
}));
compras.delete('/requerimientos-compra/:id', ...soloAdmin, asinc(async (req, res) => {
  const motivo = exigirMotivo(req);
  const r = await requerimientos.eliminar(req.params.id);
  await log('requerimiento_eliminado', req, 'id ' + req.params.id + ' · motivo: ' + motivo);
  res.json(r);
}));

// ------------------------------------------------------------ servicios de logística
compras.get('/servicios-logistica', ...soloAdmin, asinc(async (req, res) => res.json(await servicios.listar())));
compras.post('/servicios-logistica', ...soloAdmin, asinc(async (req, res) => {
  const f = await servicios.crear(req.body || {}, req.usuario.usuario);
  await log('servicio_logistica_creado', req, f.tipoServicio + ' · ' + f.descripcion);
  res.status(201).json(f);
}));
compras.patch('/servicios-logistica/:id', ...soloAdmin, asinc(async (req, res) => {
  const f = await servicios.actualizar(req.params.id, req.body || {});
  await log('servicio_logistica_actualizado', req, 'id ' + req.params.id + ' → ' + f.estado);
  res.json(f);
}));
compras.delete('/servicios-logistica/:id', ...soloAdmin, asinc(async (req, res) => {
  const motivo = exigirMotivo(req);
  const r = await servicios.eliminar(req.params.id);
  await log('servicio_logistica_eliminado', req, 'id ' + req.params.id + ' · motivo: ' + motivo);
  res.json(r);
}));

// -------------------------------------------------------------- órdenes de compra
// Registro de compras de SUNAT, cargado una sola vez (ver backend/db/sembrar.js
// y data/compras.js). Es de solo lectura: no hay POST/PATCH/DELETE porque la
// fuente de verdad es la contabilidad, no la app.
compras.get('/ordenes-compra', ...soloAdmin, asinc(async (req, res) => res.json(await ordenesCompra.listar(req.query))));
compras.get('/ordenes-compra/resumen', ...soloAdmin, asinc(async (req, res) => res.json(await ordenesCompra.resumen(req.query))));
compras.get('/ordenes-compra/proveedores', ...soloAdmin, asinc(async (req, res) => res.json(await ordenesCompra.proveedores())));
compras.get('/ordenes-compra/evolucion', ...soloAdmin, asinc(async (req, res) => {
  if (!req.query.proveedor) throw Object.assign(new Error('Indica el proveedor.'), { status: 400 });
  res.json(await ordenesCompra.evolucionProveedor(req.query.proveedor));
}));

// -------------------------------------------------------------------- productos
// Catálogo de productos (SKU) del ERP, cargado en cada arranque (ver
// backend/db/sembrar.js y data/productos.js). Solo lectura.
compras.get('/productos', ...soloAdmin, asinc(async (req, res) => res.json(await productos.listar(req.query))));
compras.get('/productos/resumen', ...soloAdmin, asinc(async (req, res) => res.json(await productos.resumen(req.query))));
compras.get('/productos/resumen-rotacion', ...soloAdmin, asinc(async (req, res) => res.json(await productos.resumenRotacion(req.query))));
compras.get('/productos/resumen-rotacion-por-familia', ...soloAdmin, asinc(async (req, res) => res.json(await productos.resumenRotacionPorFamilia(req.query))));
compras.get('/productos/opciones', ...soloAdmin, asinc(async (req, res) => res.json(await productos.opciones())));
compras.get('/productos/:codigo/requerimientos', ...soloAdmin, asinc(async (req, res) =>
  res.json(await requerimientosHistorico.porProducto(req.params.codigo))));

// -------------------------------------------------- requerimientos de compra (histórico ERP)
// Contraparte de solo lectura de /requerimientos-compra: lo que el ERP ya
// resolvió, no lo que admin registra a mano en la app (ver data/
// requerimientosCompraHistorico.js).
compras.get('/requerimientos-compra-historico', ...soloAdmin, asinc(async (req, res) => res.json(await requerimientosHistorico.listar(req.query))));
compras.get('/requerimientos-compra-historico/resumen', ...soloAdmin, asinc(async (req, res) => res.json(await requerimientosHistorico.resumen(req.query))));
compras.get('/requerimientos-compra-historico/proveedores', ...soloAdmin, asinc(async (req, res) => res.json(await requerimientosHistorico.proveedores())));
compras.get('/requerimientos-compra-historico/opciones', ...soloAdmin, asinc(async (req, res) => res.json(await requerimientosHistorico.opciones())));

// ------------------------------------------------------ historial de órdenes de compra (OC)
// Reporte de OC del ERP, cargado una sola vez (ver backend/db/sembrar.js y
// data/ordenesCompraDetalle.js). Solo lectura. Es un documento distinto del
// registro de compras SUNAT (/ordenes-compra de arriba): la OC es la orden
// al proveedor, no la factura.
compras.get('/oc', ...soloAdmin, asinc(async (req, res) => res.json(await ordenesCompraDetalle.resumenPorOC(req.query))));
compras.get('/oc/resumen', ...soloAdmin, asinc(async (req, res) => res.json(await ordenesCompraDetalle.resumen(req.query))));
compras.get('/oc/meses', ...soloAdmin, asinc(async (req, res) => res.json(await ordenesCompraDetalle.porMes(req.query))));
compras.get('/oc/opciones', ...soloAdmin, asinc(async (req, res) => res.json(await ordenesCompraDetalle.opciones())));
// Ranking de proveedores SEGÚN EL FILTRO activo (fecha/moneda); /todos es la
// lista completa sin filtrar, solo para poblar el selector.
compras.get('/oc/proveedores', ...soloAdmin, asinc(async (req, res) => res.json(await ordenesCompraDetalle.proveedores(req.query))));
compras.get('/oc/proveedores/todos', ...soloAdmin, asinc(async (req, res) => res.json(await ordenesCompraDetalle.todosLosProveedores())));
// Ficha de un proveedor para la sección Proveedores: lo que el registro SUNAT
// y el historial de OC saben de él (RUC, primera/última compra, lo que más se
// le compra y a qué costo). Va antes de /oc/:numeroOc para no confundirse.
compras.get('/proveedores/perfil', ...soloAdmin, asinc(async (req, res) => {
  if (!req.query.proveedor) throw Object.assign(new Error('Indica el proveedor.'), { status: 400 });
  res.json({
    sunat: await ordenesCompra.perfilProveedor(req.query.proveedor),
    oc: await ordenesCompraDetalle.perfilProveedor(req.query.proveedor)
  });
}));
compras.get('/oc/:numeroOc/items', ...soloAdmin, asinc(async (req, res) => res.json(await ordenesCompraDetalle.porOC(req.params.numeroOc))));

// -------------------------------------------------------------------- materia prima
// Stock valorizado de materia prima, cargado en cada arranque desde el
// reporte del ERP (ver backend/db/sembrar.js y data/materiaPrimaStock.js).
// Solo lectura. Navegación en cuatro niveles: Tipo (Materia Prima / Materia
// Prima - Tintas) -> Categoría -> Línea -> Producto, más el corte por
// almacén (con drill-down directo).
compras.get('/materia-prima/tipos', ...soloAdmin, asinc(async (req, res) => res.json(await materiaPrima.tipos())));
compras.get('/materia-prima/resumen', ...soloAdmin, asinc(async (req, res) => res.json(await materiaPrima.resumen(req.query.tipo))));
compras.get('/materia-prima/categorias', ...soloAdmin, asinc(async (req, res) => res.json(await materiaPrima.categorias(req.query.tipo))));
compras.get('/materia-prima/almacenes', ...soloAdmin, asinc(async (req, res) => res.json(await materiaPrima.almacenes(req.query.tipo))));
// Códigos de materia prima dados de alta en los últimos ?dias (90 por defecto), con o sin stock.
compras.get('/materia-prima/codigos-nuevos', ...soloAdmin, asinc(async (req, res) =>
  res.json(await materiaPrima.codigosNuevos(req.query.dias))));
compras.get('/materia-prima/buscar', ...soloAdmin, asinc(async (req, res) => res.json(await materiaPrima.buscarProductos(req.query.q || ''))));
compras.get('/materia-prima/categorias/:categoria/lineas', ...soloAdmin, asinc(async (req, res) =>
  res.json(await materiaPrima.lineasDeCategoria(req.params.categoria, req.query.tipo))));
// almacén va en query por el mismo motivo que familia: nombres como "ALMACEN
// DE  MEZCLA MP" son seguros, pero no vale la pena arriesgarse con :almacen.
compras.get('/materia-prima/almacenes/productos', ...soloAdmin, asinc(async (req, res) => {
  if (!req.query.almacen) throw Object.assign(new Error('Indica el almacén.'), { status: 400 });
  res.json(await materiaPrima.productosDeAlmacen(req.query.almacen, req.query.tipo));
}));
// familia va en query (no en la ruta): algunas familias del ERP traen "/" en
// el nombre ("MP/MB TERCERO"), que rompería el path si fuera :familia.
compras.get('/materia-prima/lineas/productos', ...soloAdmin, asinc(async (req, res) => {
  if (!req.query.familia) throw Object.assign(new Error('Indica la línea (familia).'), { status: 400 });
  res.json(await materiaPrima.productosDeLinea(req.query.familia, req.query.tipo));
}));
compras.get('/materia-prima/productos/:codigo/almacenes', ...soloAdmin, asinc(async (req, res) =>
  res.json(await materiaPrima.almacenesDeProducto(req.params.codigo))));

// ------------------------------------------------------ materias primas homologadas
// Del Excel de CONFIG.homologados, cruzado con el ERP. Sin cachearGet: el
// Excel cambia por fuera de PostgreSQL y la caché por revisión no se enteraría.
compras.get('/materia-prima/homologados', requiereSesion, requiereRol('admin'), asinc(async (req, res) => res.json(await homologados.listar())));

// ------------------------------------------------------- muestras de materia prima
// Registro propio de logística (no viene del ERP): cada muestra que llega al
// almacén, con su costo y su evaluación. Van antes de /materia-prima/:algo
// para que "muestras" no se lea como un parámetro.
compras.get('/materia-prima/muestras', ...soloAdmin, asinc(async (req, res) => res.json(await muestras.listar())));
compras.get('/materia-prima/muestras/resumen', ...soloAdmin, asinc(async (req, res) => res.json(await muestras.resumen(req.query.mes))));
// Candidatos de código interno para la descripción de una muestra.
compras.get('/materia-prima/muestras/codigos', ...soloAdmin, asinc(async (req, res) =>
  res.json(await muestras.sugerirCodigos(req.query.descripcion))));
// Razón social a partir del RUC, para completar el formulario al escribirlo.
compras.get('/materia-prima/muestras/proveedor', ...soloAdmin, asinc(async (req, res) =>
  res.json({ ruc: String(req.query.ruc || ''), proveedor: await muestras.proveedorPorRuc(req.query.ruc) })));
compras.post('/materia-prima/muestras', ...soloAdmin, asinc(async (req, res) => {
  const m = await muestras.crear(req.body || {}, req.usuario.usuario);
  await log('muestra_mp_creada', req, 'id ' + m.id + ' · ' + m.descripcion);
  res.status(201).json(m);
}));
compras.post('/materia-prima/muestras/lote', ...soloAdmin, asinc(async (req, res) => {
  const r = await muestras.crearLote(req.body?.filas, req.usuario.usuario);
  await log('muestras_mp_importadas', req, r.creadas + ' muestras');
  res.status(201).json(r);
}));
compras.patch('/materia-prima/muestras/:id', ...soloAdmin, asinc(async (req, res) => res.json(await muestras.actualizar(req.params.id, req.body || {}))));
compras.delete('/materia-prima/muestras/:id', ...soloAdmin, asinc(async (req, res) => {
  const motivo = exigirMotivo(req);
  const r = await muestras.eliminar(req.params.id);
  await log('muestra_mp_eliminada', req, 'id ' + req.params.id + ' · motivo: ' + motivo);
  res.json(r);
}));

// -------------------------------------------------------------- importaciones
// Seguimiento de las OC importadas (colección importaciones del bot, copiada
// por la sincronización de Mongo). Solo lectura: se editan en el bot. Los
// atrasos dependen de la fecha, así que la caché también varía por día (Lima).
const porDia = [requiereSesion, requiereRol('admin'), cachearGet({ variar: () => importaciones.hoyLima() })];
compras.get('/importaciones', ...porDia, asinc(async (req, res) => res.json(await importaciones.listar())));
compras.get('/importaciones/:id', ...porDia, asinc(async (req, res) => res.json(await importaciones.detalle(req.params.id))));

// ------------------------------------------------- clasificación ABC de materia prima
// Por consumo valorizado anual, con cobertura y punto de reorden (shared/abc.js).
compras.get('/materia-prima/abc', ...soloAdmin, asinc(async (req, res) => res.json(await mpPlaneacion.abc(req.query.tipo || ''))));

// ------------------------------------------------------- stock valorizado (global)
// Todos los almacenes y tipos de producto juntos (Producto Terminado + Materia
// Prima + Activos Fijos, etc.), para el Dashboard. El detalle por almacén ya
// vive en Materia Prima (un solo tipo) y en Almacén Los Olivos (un almacén).
compras.get('/stock-valorizado/resumen', ...soloAdmin, asinc(async (req, res) => res.json(await stockValorizado.resumenGlobal())));
