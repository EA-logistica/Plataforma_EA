import { $, esc } from '../utils/dom.js';
import { soles } from '../utils/format.js';
import * as api from '../api/estado.js';
import { DB } from '../api/estado.js';

/**
 * Dashboard: lo primero que ve admin al entrar -un panorama de todos los
 * módulos (mensajería, compras, almacén, productos, requerimientos y
 * servicios), cada uno con sus números y un atajo a su propia pestaña para
 * el detalle. No reemplaza a "Indicadores" ni a los demás tabs -esos siguen
 * con su propio filtro y su propia tabla-, es la carátula que antes no
 * existía.
 */
const dolares = n => 'US$ ' + (Number(n) || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const entero = n => (Number(n) || 0).toLocaleString('es-PE');

export function renderDashboardSiVisible() { if ($('aDashboard').classList.contains('on')) renderDashboard(); }

const tarjeta = (clase, v, k, d) => '<div class="kpi ' + clase + '"><div class="v">' + esc(String(v))
  + '</div><div class="k">' + esc(k) + '</div><div class="d">' + esc(d) + '</div></div>';

function panel(titulo, tab, cuerpo) {
  return '<div class="panel" style="margin-top:18px">'
    + '<div class="section-head" style="margin-bottom:14px">'
    + '<h3 style="margin:0">' + esc(titulo) + '</h3>'
    + '<button class="btn btn-sm btn-ghost" onclick="tabAdmin(\'' + tab + '\')">Ver detalle →</button>'
    + '</div>' + cuerpo + '</div>';
}

function barras(items) {
  if (!items.length) return '<div class="empty" style="padding:20px 0"><strong>Sin datos</strong></div>';
  const max = Math.max.apply(null, items.map(i => i.v)) || 1;
  return '<div class="bars">' + items.map(i =>
    '<div class="bar-row"><div class="bar-lbl">' + esc(i.k) + '</div><div class="bar-val">' + esc(i.t) + '</div>'
    + '<div class="bar-track"><div class="bar-fill" style="width:' + Math.max(2, (i.v / max) * 100).toFixed(1) + '%"></div></div></div>'
  ).join('') + '</div>';
}

const contarPor = (lista, campo) => lista.reduce((m, x) => (m.set(x[campo], (m.get(x[campo]) || 0) + 1), m), new Map());

export async function renderDashboard() {
  $('dashboardBody').innerHTML = '<div class="empty"><strong>Cargando…</strong></div>';
  let compras, ocHist, requerimientos, requerimientosHist, stock, productos, rotacion, servicios, exportaciones;
  try {
    [compras, ocHist, requerimientos, requerimientosHist, stock, productos, rotacion, servicios, exportaciones] = await Promise.all([
      api.resumenOrdenesCompra({}),
      api.resumenOC({}),
      api.listarRequerimientos(),
      api.resumenRequerimientosHistorico({}),
      api.resumenStockValorizadoGlobal(),
      api.resumenProductos({}),
      api.resumenRotacionProductos({}),
      api.listarServiciosLogistica(),
      api.listarExportaciones()
    ]);
  } catch (e) {
    $('dashboardBody').innerHTML = '<div class="empty"><strong>No se pudo cargar</strong>' + esc(e.message) + '</div>';
    return;
  }

  // Mensajería: mismo criterio que Indicadores (kpi.js), pero sobre TODO el
  // histórico -acá es panorama, no un rango-. Un cancelado no se ejecutó, no
  // entra al valorizado.
  const todosLosServicios = DB.solicitudes || [];
  const cancelados = todosLosServicios.filter(s => s.estado === 'Cancelado').length;
  const ejecutados = todosLosServicios.filter(s => s.estado !== 'Cancelado');
  const costoMensajeria = ejecutados.filter(s => s.costo != null).reduce((a, s) => a + s.costo, 0);
  const enCurso = ejecutados.filter(s => s.estado !== 'Concluido').length;

  const porEstadoReq = contarPor(requerimientos, 'estado');
  const porEstadoServ = contarPor(servicios, 'estado');
  const porEstadoExp = contarPor(exportaciones, 'estado');
  const totalRotacion = (rotacion.a || 0) + (rotacion.b || 0) + (rotacion.c || 0);
  const pctClaseC = totalRotacion ? ((rotacion.c || 0) / totalRotacion * 100).toFixed(0) + '%' : '—';

  $('dashboardHero').innerHTML = [
    tarjeta('primary', dolares(stock.valorizadoUsd), 'Valorizado de inventario', stock.productos.toLocaleString('es-PE') + ' SKU en ' + stock.almacenes + ' almacenes'),
    tarjeta('ok', entero(ejecutados.length), 'Servicios de mensajería', cancelados ? cancelados + ' cancelados aparte' : 'Histórico completo'),
    tarjeta('info', entero(compras.comprobantes), 'Comprobantes de compra', entero(compras.proveedores) + ' proveedores (registro SUNAT)'),
    tarjeta('', entero(productos.productos), 'Productos catalogados', pctClaseC + ' en rotación baja (clase C)')
  ].join('');

  $('dashboardBody').innerHTML = [
    panel('Mensajería y despacho', 'kpi',
      '<div class="kpis" style="margin-bottom:0">'
      + tarjeta('primary', entero(ejecutados.length), 'Viajes totales', 'Sin contar cancelados')
      + tarjeta('ok', soles(costoMensajeria), 'Costo valorizado', 'Servicios con tarifa cargada')
      + tarjeta('info', entero(enCurso), 'En curso', 'Aún no concluidos')
      + tarjeta(cancelados ? 'bad' : '', entero(cancelados), 'Cancelados', 'Fuera del valorizado')
      + '</div>'),

    panel('Compras', 'ordenesCompra',
      '<div class="kpis" style="margin-bottom:0">'
      + tarjeta('primary', entero(compras.comprobantes), 'Comprobantes (SUNAT)', entero(compras.proveedores) + ' proveedores')
      + tarjeta('ok', soles(compras.pen.total), 'Valorizado en soles', entero(compras.pen.comprobantes) + ' comprobantes')
      + tarjeta('info', dolares(compras.usd.total), 'Valorizado en dólares', entero(compras.usd.comprobantes) + ' comprobantes')
      + tarjeta('', entero(ocHist.ordenes), 'Órdenes de Compra (ERP)', entero(ocHist.proveedores) + ' proveedores')
      + '</div>'),

    panel('Almacén e inventario', 'materiaPrima',
      '<div class="kpis" style="margin-bottom:14px">'
      + tarjeta('primary', dolares(stock.valorizadoUsd), 'Valorizado total', entero(stock.productos) + ' SKU distintos')
      + tarjeta('', entero(stock.almacenes), 'Almacenes con stock', 'Todos los tipos de producto')
      + '</div>'
      + '<div class="grid2" style="margin-bottom:0">'
      + '<div><p class="sub" style="margin:0 0 8px">Valorizado por tipo de producto</p>'
      + barras(stock.porTipo.map(t => ({
          k: t.tipoProducto || '(sin tipo)', v: t.valorizadoUsd,
          t: dolares(t.valorizadoUsd) + ' · ' + entero(t.productos) + ' SKU'
        }))) + '</div>'
      + '<div><p class="sub" style="margin:0 0 8px">Top almacenes por valorizado</p>'
      + barras(stock.porAlmacen.map(a => ({ k: a.almacen, v: a.valorizadoUsd, t: dolares(a.valorizadoUsd) }))) + '</div>'
      + '</div>'),

    panel('Productos (catálogo ERP)', 'productos',
      '<div class="kpis" style="margin-bottom:0">'
      + tarjeta('primary', entero(productos.productos), 'Catalogados', entero(productos.familias) + ' familias')
      + tarjeta('ok', entero(productos.conStock), 'Con stock', productos.productos ? (productos.conStock / productos.productos * 100).toFixed(0) + '% del catálogo' : '—')
      + tarjeta('', entero(rotacion.a), 'Clase A · alta rotación', '')
      + tarjeta(rotacion.c ? 'bad' : '', entero(rotacion.c), 'Clase C · baja o sin rotación', pctClaseC + ' del catálogo')
      + '</div>'),

    panel('Requerimientos de compra', 'requerimientos',
      '<div class="kpis" style="margin-bottom:0">'
      + tarjeta('primary', entero(requerimientos.length), 'Registrados (admin)', (porEstadoReq.get('Pendiente') || 0) + ' pendientes')
      + tarjeta('info', entero((porEstadoReq.get('Cotizando') || 0) + (porEstadoReq.get('Aprobado') || 0)), 'En gestión', 'Cotizando + Aprobado')
      + tarjeta('', entero(requerimientosHist.requerimientos), 'Historial ERP', entero(requerimientosHist.proveedores) + ' proveedores')
      + tarjeta('', entero(requerimientosHist.pendientes), 'Pendientes (ERP)', 'Aprobados sin atender')
      + '</div>'),

    panel('Servicios y exportaciones', 'servicios',
      '<div class="kpis" style="margin-bottom:0">'
      + tarjeta('primary', entero(servicios.length), 'Servicios de logística', entero(porEstadoServ.get('En ejecución') || 0) + ' en ejecución')
      + tarjeta('ok', entero(porEstadoServ.get('Concluido') || 0), 'Concluidos', '')
      + tarjeta('info', entero(exportaciones.length), 'Exportaciones', entero(porEstadoExp.get('En tránsito') || 0) + ' en tránsito')
      + tarjeta('', entero(porEstadoExp.get('Entregado') || 0), 'Entregadas', '')
      + '</div>'),

    panel('Payback de la mensajería', 'payback',
      '<div class="empty" style="padding:10px 0"><strong>Tercerizar vs. motorizado propio</strong>Simulador de escenarios y recuperación de la inversión.</div>')
  ].join('');
}
