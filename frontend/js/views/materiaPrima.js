import { $, esc } from '../utils/dom.js';
import { corta, fechaCorta } from '../utils/format.js';
import * as api from '../api/estado.js';
import { abrirModal } from './dispatch.js';

/**
 * Materia Prima: stock valorizado del ERP (data/materiaPrimaStock.js), foto
 * al último cálculo del reporte -no un histórico-. Primero se elige el Tipo
 * -MATERIA PRIMA o MATERIA PRIMA - TINTAS, la columna cruda del ERP que
 * separa ambos mundos- y dentro de ese tipo se navega Categoría → Línea →
 * Producto ("categoría" sí es derivada por palabra clave de la familia, ver
 * backend/db/repos/materiaPrimaStock.js), más el corte por almacén -con
 * clic directo para ver qué SKU tiene cada uno-.
 *
 * Todas las tablas son ordenables (clic en el encabezado) y paginadas de 20
 * en 20; cada fila trae su participación sobre el valorizado del nivel. Las
 * filas se abren por índice (filaMateriaPrima), nunca con el nombre metido
 * en un onclick: hay familias con "/" y almacenes con dobles espacios.
 */
let tipoActual = null;
let tiposCache = null;
let nivel = 'categorias'; // 'categorias' | 'lineas' | 'productos'
let categoriaActual = null;
let familiaActual = null;
let tokenBusqueda = 0;
let tokenNivel = 0;

const POR_PAGINA = 20;
const tablas = {}; // id -> { cont, filas, cols, sort, dir, pagina, clic, total, vacio }

export function renderMateriaPrimaSiVisible() {
  if ($('aMateriaPrima').classList.contains('on')) renderMateriaPrima();
}

const dolares = n => 'US$ ' + (Number(n) || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const entero = n => (Number(n) || 0).toLocaleString('es-PE');
const cantidad = n => (Number(n) || 0).toLocaleString('es-PE', { maximumFractionDigits: 2 });
const pct = n => (Number.isFinite(n) ? n : 0).toLocaleString('es-PE', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';

/** "1,234.5 KG" o, si mezcla unidades, "1,234.5 KG · 3 UND" (nunca se suma kg con unidades). */
function formatoStockPorUm(lista, max = 3) {
  if (!lista || !lista.length) return '<span class="muted">Sin stock</span>';
  const orden = [...lista].sort((a, b) => (b.stock || 0) - (a.stock || 0));
  const extra = orden.length > max ? ' <span class="muted small">+' + (orden.length - max) + ' UM</span>' : '';
  return orden.slice(0, max).map(u => cantidad(u.stock) + ' ' + esc(u.um || 'UND')).join(' · ') + extra;
}
const stockOrden = lista => (lista || []).reduce((a, u) => a + (Number(u.stock) || 0), 0);

const tarjeta = (clase, v, k, d, titulo) => '<div class="kpi ' + clase + '"' + (titulo ? ' title="' + esc(titulo) + '"' : '') + '><div class="v">' + v
  + '</div><div class="k">' + esc(k) + '</div><div class="d">' + d + '</div></div>';

function barraShare(v, total) {
  const p = total ? v / total * 100 : 0;
  return '<div class="mp-share" title="' + esc(pct(p) + ' del valorizado de este nivel') + '"><b class="mp-track"><i style="width:' + Math.min(100, Math.max(p ? 1.5 : 0, p)).toFixed(1) + '%"></i></b><span>' + pct(p) + '</span></div>';
}

// ------------------------------------------------------------ tabla genérica
function tabla(id, cont, filas, cols, opciones) {
  filas.forEach((f, i) => { f._i = i; });
  tablas[id] = {
    cont, filas, cols, sort: opciones.sort, dir: opciones.dir || 'desc', pagina: 1,
    clic: opciones.clic || null, vacio: opciones.vacio || 'Sin datos',
    total: filas.reduce((a, f) => a + (Number(f.valorizadoUsd) || 0), 0)
  };
  return htmlTabla(id);
}

function htmlTabla(id) {
  const t = tablas[id];
  if (!t.filas.length) return '<div class="empty mp-empty"><strong>' + esc(t.vacio) + '</strong></div>';
  const col = t.cols.find(c => c.k === t.sort) || t.cols[0];
  const signo = t.dir === 'asc' ? 1 : -1;
  const ordenadas = [...t.filas].sort((a, b) => {
    const va = col.v(a), vb = col.v(b);
    if (typeof va === 'string' || typeof vb === 'string') return String(va).localeCompare(String(vb), 'es') * signo;
    return ((va || 0) - (vb || 0)) * signo;
  });
  const paginas = Math.max(1, Math.ceil(ordenadas.length / POR_PAGINA));
  if (t.pagina > paginas) t.pagina = paginas;
  const desde = (t.pagina - 1) * POR_PAGINA;
  const visibles = ordenadas.slice(desde, desde + POR_PAGINA);

  const thead = t.cols.map(c => {
    if (c.v == null) return '<th>' + esc(c.t) + '</th>';
    const on = c.k === t.sort;
    return '<th class="' + (c.num ? 'num ' : '') + 'mp-th' + (on ? ' on' : '') + '" aria-sort="' + (on ? (t.dir === 'asc' ? 'ascending' : 'descending') : 'none') + '">'
      + '<button type="button" onclick="ordenarMateriaPrima(\'' + id + '\',\'' + c.k + '\')" title="Ordenar por ' + esc(c.t.toLowerCase()) + '">'
      + esc(c.t) + '<span class="mp-flecha">' + (on ? (t.dir === 'asc' ? '▲' : '▼') : '↕') + '</span></button></th>';
  }).join('');
  const tbody = visibles.map(f => '<tr' + (t.clic ? ' class="mp-fila" onclick="filaMateriaPrima(\'' + id + '\',' + f._i + ')" title="' + esc(t.clic) + '"' : '') + '>'
    + t.cols.map(c => '<td' + (c.num ? ' class="num"' : c.cls ? ' class="' + c.cls + '"' : '') + '>' + c.h(f, t) + '</td>').join('')
    + '</tr>').join('');

  const pie = '<div class="mp-pie"><span class="muted small">' + (ordenadas.length > POR_PAGINA
    ? 'Mostrando ' + (desde + 1) + '–' + (desde + visibles.length) + ' de ' + entero(ordenadas.length)
    : entero(ordenadas.length) + (ordenadas.length === 1 ? ' fila' : ' filas')) + ' · valorizado ' + dolares(t.total) + '</span>'
    + (paginas > 1
      ? '<span class="tools"><button type="button" class="btn btn-sm btn-ghost"' + (t.pagina <= 1 ? ' disabled' : '') + ' onclick="paginaMateriaPrima(\'' + id + '\',' + (t.pagina - 1) + ')">‹ Anterior</button>'
        + '<span class="small">Página ' + t.pagina + ' de ' + paginas + '</span>'
        + '<button type="button" class="btn btn-sm btn-ghost"' + (t.pagina >= paginas ? ' disabled' : '') + ' onclick="paginaMateriaPrima(\'' + id + '\',' + (t.pagina + 1) + ')">Siguiente ›</button></span>'
      : '')
    + '</div>';
  return '<div class="table-wrap mp-tabla"><table><thead><tr>' + thead + '</tr></thead><tbody>' + tbody + '</tbody></table></div>' + pie;
}

function repintar(id) {
  const t = tablas[id];
  const el = t && document.getElementById(t.cont);
  if (el) el.innerHTML = htmlTabla(id);
}

/** Clic en un encabezado: ordena por esa columna; otro clic invierte el sentido. */
export function ordenarMateriaPrima(id, k) {
  const t = tablas[id];
  if (!t) return;
  if (t.sort === k) t.dir = t.dir === 'asc' ? 'desc' : 'asc';
  else { t.sort = k; const c = t.cols.find(x => x.k === k); t.dir = c && c.texto ? 'asc' : 'desc'; }
  t.pagina = 1;
  repintar(id);
}

export function paginaMateriaPrima(id, n) {
  const t = tablas[id];
  if (!t) return;
  t.pagina = Math.max(1, n);
  repintar(id);
}

/** Clic en una fila: baja un nivel o abre el detalle, según la tabla. */
export function filaMateriaPrima(id, i) {
  const t = tablas[id];
  const f = t && t.filas[i];
  if (!f) return;
  if (id === 'cat') return abrirCategoriaMateriaPrima(f.categoria);
  if (id === 'lin') return abrirLineaMateriaPrima(f.familia);
  if (id === 'alm') return verProductosDeAlmacenMateriaPrima(f.almacen);
  if (id === 'nuevos') return verAlmacenesProductoMateriaPrima(f.codigo);
  return verAlmacenesProductoMateriaPrima(f.codigo);
}

// Columnas reutilizadas
const colShare = { k: 'share', t: '% del nivel', v: f => f.valorizadoUsd, h: (f, t) => barraShare(f.valorizadoUsd, t.total) };
const colValor = { k: 'valor', t: 'Valorizado', num: true, v: f => f.valorizadoUsd, h: f => dolares(f.valorizadoUsd) };
const colStockUm = { k: 'stock', t: 'Stock', num: true, v: f => stockOrden(f.stockPorUm), h: f => formatoStockPorUm(f.stockPorUm) };
const colsProducto = (conUbicacion) => [
  { k: 'codigo', t: 'Código', texto: true, cls: 'tk', v: f => f.codigo || '', h: f => esc(f.codigo) },
  { k: 'desc', t: 'Descripción', texto: true, v: f => f.descripcion || '', h: f => '<div class="cell-2">' + esc(corta(f.descripcion, 50))
    + (conUbicacion ? '<span>' + esc(f.categoria || '—') + ' · ' + esc(corta(f.familia, 30) || '—') + '</span>' : '') + '</div>' },
  { k: 'alm', t: 'Almacenes', num: true, v: f => f.almacenes, h: f => entero(f.almacenes) },
  { k: 'stock', t: 'Stock', num: true, v: f => f.stock, h: f => cantidad(f.stock) + ' ' + esc(f.unidadMedida || 'UND') },
  { k: 'costo', t: 'Costo prom.', num: true, v: f => (f.stock > 0 ? f.valorizadoUsd / f.stock : 0),
    h: f => (f.stock > 0 ? dolares(f.valorizadoUsd / f.stock) + '<span class="mp-um">/' + esc(f.unidadMedida || 'UND') + '</span>' : '<span class="muted">—</span>') },
  colValor, colShare,
  { k: 'acc', t: '', h: () => '<span class="mp-ver">Ver almacenes ›</span>' }
];

// ------------------------------------------------------------ carga
async function asegurarTipos() {
  // Una lista vacía se vuelve a pedir: si la pestaña se abrió antes de que
  // llegara la primera foto del ERP, se quedaba en "Sin stock" hasta recargar.
  if (tiposCache && tiposCache.length) return;
  tiposCache = await api.tiposMateriaPrima();
  $('mpTipo').innerHTML = tiposCache.map(t =>
    '<option value="' + esc(t.tipo) + '">' + esc(t.tipo) + ' (' + entero(t.productos) + ' prod.)</option>').join('');
  if (!tipoActual && tiposCache.length) tipoActual = tiposCache[0].tipo;
  $('mpTipo').value = tipoActual;
}

export function cambiarTipoMateriaPrima() {
  tipoActual = $('mpTipo').value;
  nivel = 'categorias'; categoriaActual = null; familiaActual = null;
  $('mpQ').value = '';
  renderMateriaPrima();
}

export async function renderMateriaPrima() {
  const miToken = ++tokenNivel;
  try {
    await asegurarTipos();
    if (!tiposCache.length) {
      $('mpMetrics').innerHTML = '';
      $('mpAlmacenes').innerHTML = '';
      $('mpBreadcrumb').innerHTML = '';
      $('mpNivel').innerHTML = '<div class="empty"><strong>Sin stock de materia prima cargado</strong>El reporte del ERP todavía no se ha importado.</div>';
      return;
    }
    const [resumen, categorias, almacenes] = await Promise.all([
      api.resumenMateriaPrima(tipoActual), api.categoriasMateriaPrima(tipoActual), api.almacenesMateriaPrima(tipoActual)
    ]);
    if (miToken !== tokenNivel) return;
    pintarMetricas(resumen, categorias);
    pintarAlmacenes(almacenes);
    pintarCodigosNuevosMateriaPrima();
    if ($('mpQ').value.trim()) { buscarProductosMateriaPrima(); return; }
    if (nivel === 'categorias') { pintarBreadcrumb(); pintarCategorias(categorias); } else if (nivel === 'lineas') await cargarLineas();
    else await cargarProductos();
  } catch (e) {
    if (miToken === tokenNivel) $('mpNivel').innerHTML = '<div class="empty"><strong>No se pudo cargar</strong>' + esc(e.message) + '</div>';
  }
}

function pintarMetricas(r, categorias) {
  const top = categorias[0];
  const share = top && r.valorizadoUsd ? top.valorizadoUsd / r.valorizadoUsd * 100 : 0;
  $('mpMetrics').innerHTML = [
    tarjeta('primary', esc('US$ ' + Math.round(r.valorizadoUsd || 0).toLocaleString('es-PE')), 'Valorizado total', 'Stock × costo promedio del ERP', dolares(r.valorizadoUsd)),
    tarjeta('', entero(r.productos), 'Productos (SKU)', entero(r.categorias) + ' categorías'),
    (() => {
      // En la tarjeta solo cabe la unidad principal; las demás van debajo (nunca se suman KG con UND).
      const um = [...(r.stockPorUm || [])].sort((a, b) => (b.stock || 0) - (a.stock || 0));
      const principal = um[0];
      return tarjeta('info', principal ? esc(Math.round(principal.stock).toLocaleString('es-PE') + ' ' + (principal.um || 'UND')) : '—', 'Cantidad en stock',
        um.length > 1 ? 'y ' + um.slice(1, 3).map(u => cantidad(u.stock) + ' ' + esc(u.um || 'UND')).join(' · ') + (um.length > 3 ? ' · …' : '') : 'Sumada en todos los almacenes',
        um.map(u => cantidad(u.stock) + ' ' + (u.um || 'UND')).join(' · '));
    })(),
    tarjeta('', entero(r.almacenes), 'Almacenes', 'Con stock de este tipo'),
    tarjeta(share >= 60 ? 'bad' : 'ok', pct(share), 'Concentración', top ? 'en ' + esc(top.categoria) + ', la categoría mayor' : 'Sin categorías',
      'Qué parte del valorizado se concentra en una sola categoría.')
  ].join('');
}

function pintarBreadcrumb(textoBusqueda) {
  const miga = (texto, onclick, activa) => activa
    ? '<span class="mp-miga on" aria-current="page">' + esc(texto) + '</span>'
    : '<button type="button" class="mp-miga" onclick="' + onclick + '">' + esc(texto) + '</button>';
  const sep = '<span class="mp-sep" aria-hidden="true">›</span>';
  let partes;
  let ayuda;
  if (textoBusqueda != null) {
    partes = [miga(tipoActual || 'Materia prima', 'limpiarBusquedaMateriaPrima()', false), sep, miga('Resultados de «' + textoBusqueda + '»', '', true)];
    ayuda = 'Búsqueda en todos los tipos, por código o descripción (máx. 50 resultados). Borra el texto para volver.';
  } else {
    partes = [miga(tipoActual || 'Materia prima', 'irACategoriasMateriaPrima()', nivel === 'categorias')];
    if (categoriaActual) partes.push(sep, miga(categoriaActual, 'volverACategoriaMateriaPrima()', nivel === 'lineas'));
    if (familiaActual) partes.push(sep, miga(corta(familiaActual, 40), '', true));
    ayuda = nivel === 'categorias' ? 'Paso 1 de 3 · Categorías: clic en una para ver sus líneas.'
      : nivel === 'lineas' ? 'Paso 2 de 3 · Líneas (familias del ERP): clic en una para ver sus productos.'
        : 'Paso 3 de 3 · Productos: clic en uno para ver en qué almacenes está.';
  }
  $('mpBreadcrumb').innerHTML = '<nav class="mp-migas" aria-label="Nivel">' + partes.join('') + '</nav><p class="mp-ayuda">' + esc(ayuda) + '</p>';
}

function pintarCategorias(categorias) {
  nivel = 'categorias'; categoriaActual = null; familiaActual = null;
  $('mpNivel').innerHTML = tabla('cat', 'mpNivel', categorias, [
    { k: 'nombre', t: 'Categoría', texto: true, v: f => f.categoria, h: f => '<b>' + esc(f.categoria) + '</b>' },
    { k: 'lineas', t: 'Líneas', num: true, v: f => f.lineas, h: f => entero(f.lineas) },
    { k: 'prod', t: 'Productos', num: true, v: f => f.productos, h: f => entero(f.productos) },
    colStockUm, colValor, colShare
  ], { sort: 'valor', clic: 'Ver las líneas de esta categoría', vacio: 'Sin categorías en este tipo' });
}

export function irACategoriasMateriaPrima() {
  nivel = 'categorias'; categoriaActual = null; familiaActual = null;
  $('mpQ').value = '';
  renderMateriaPrima();
}

export async function abrirCategoriaMateriaPrima(categoria) {
  categoriaActual = categoria; familiaActual = null; nivel = 'lineas';
  await cargarLineas();
}

export function volverACategoriaMateriaPrima() { return abrirCategoriaMateriaPrima(categoriaActual); }

async function cargarLineas() {
  const miToken = ++tokenNivel;
  pintarBreadcrumb();
  $('mpNivel').innerHTML = '<div class="empty cargando mp-empty"><strong>Cargando…</strong></div>';
  let lineas;
  try {
    lineas = await api.lineasDeCategoriaMateriaPrima(categoriaActual, tipoActual);
  } catch (e) {
    if (miToken === tokenNivel) $('mpNivel').innerHTML = '<div class="empty"><strong>No se pudo cargar</strong>' + esc(e.message) + '</div>';
    return;
  }
  if (miToken !== tokenNivel) return;
  $('mpNivel').innerHTML = tabla('lin', 'mpNivel', lineas, [
    { k: 'nombre', t: 'Línea (familia)', texto: true, v: f => f.familia, h: f => '<b>' + esc(corta(f.familia, 44)) + '</b>' },
    { k: 'prod', t: 'Productos', num: true, v: f => f.productos, h: f => entero(f.productos) },
    { k: 'alm', t: 'Almacenes', num: true, v: f => f.almacenes, h: f => (f.almacenes == null ? '—' : entero(f.almacenes)) },
    colStockUm, colValor, colShare
  ], { sort: 'valor', clic: 'Ver los productos de esta línea', vacio: 'Sin líneas en esta categoría' });
}

export async function abrirLineaMateriaPrima(familia) {
  familiaActual = familia; nivel = 'productos';
  await cargarProductos();
}

async function cargarProductos() {
  const miToken = ++tokenNivel;
  pintarBreadcrumb();
  $('mpNivel').innerHTML = '<div class="empty cargando mp-empty"><strong>Cargando…</strong></div>';
  let productos;
  try {
    productos = await api.productosDeLineaMateriaPrima(familiaActual, tipoActual);
  } catch (e) {
    if (miToken === tokenNivel) $('mpNivel').innerHTML = '<div class="empty"><strong>No se pudo cargar</strong>' + esc(e.message) + '</div>';
    return;
  }
  if (miToken !== tokenNivel) return;
  $('mpNivel').innerHTML = tabla('prod', 'mpNivel', productos, colsProducto(false),
    { sort: 'valor', clic: 'Ver en qué almacenes está', vacio: 'Sin productos en esta línea' });
}

/** Corte por almacén de un producto: responde "cuánta cantidad hay en los almacenes". */
export async function verAlmacenesProductoMateriaPrima(codigo) {
  let filas;
  try {
    filas = await api.almacenesDeProductoMateriaPrima(codigo);
  } catch (e) {
    abrirModal('Almacenes', '<div class="empty"><strong>No se pudo cargar</strong>' + esc(e.message) + '</div>');
    return;
  }
  if (!filas.length) {
    abrirModal('Almacenes de ' + codigo, '<div class="empty"><strong>Sin stock registrado</strong></div>');
    return;
  }
  const total = filas.reduce((a, f) => a + (Number(f.valorizadoUsd) || 0), 0);
  const cuerpo = filas.map(f => '<tr>'
    + '<td class="cell-2">' + esc(f.almacen) + '<span>' + esc(f.ubicacion || 'Sin ubicación') + '</span></td>'
    + '<td class="num">' + cantidad(f.stock) + ' ' + esc(f.unidadMedida || 'UND') + '</td>'
    + '<td class="num">' + dolares(f.costoPromedioUsd) + '</td>'
    + '<td class="num">' + dolares(f.valorizadoUsd) + '</td>'
    + '<td>' + barraShare(f.valorizadoUsd, total) + '</td>'
    + '</tr>').join('');
  abrirModal('Almacenes de ' + codigo,
    '<p class="sub" style="margin-top:-6px">' + filas.length + (filas.length === 1 ? ' almacén' : ' almacenes') + ' · ' + dolares(total) + ' valorizado</p>'
    + '<div class="table-wrap mp-tabla"><table><thead><tr><th>Almacén</th><th class="num">Stock</th><th class="num">Costo prom.</th><th class="num">Valorizado</th><th>% del producto</th></tr></thead><tbody>'
    + cuerpo + '</tbody></table></div>', { ancho: 'wide' });
}

function pintarAlmacenes(almacenes) {
  $('mpAlmacenes').innerHTML = tabla('alm', 'mpAlmacenes', almacenes, [
    { k: 'nombre', t: 'Almacén', texto: true, v: f => f.almacen, h: f => '<b>' + esc(f.almacen) + '</b>' },
    { k: 'prod', t: 'Productos', num: true, v: f => f.productos, h: f => entero(f.productos) },
    colStockUm, colValor, colShare,
    { k: 'acc', t: '', h: () => '<span class="mp-ver">Ver SKU ›</span>' }
  ], { sort: 'valor', clic: 'Ver qué productos tiene este almacén', vacio: 'Sin almacenes con stock' });
}

/**
 * Códigos de materia prima recién dados de alta en el ERP, con o sin stock:
 * la foto de stock no los muestra hasta que entran al almacén, y aquí se ven
 * desde el día en que Mongo los trae. Clic en uno: dónde tiene stock.
 */
export async function pintarCodigosNuevosMateriaPrima() {
  let filas;
  try {
    filas = await api.codigosNuevosMateriaPrima($('mpNuevosDias').value);
  } catch (e) {
    $('mpNuevos').innerHTML = '<div class="empty mp-empty"><strong>No se pudo cargar</strong>' + esc(e.message) + '</div>';
    return;
  }
  filas.forEach(f => { f.valorizadoUsd = f.valorizadoUsd || 0; });
  $('mpNuevos').innerHTML = tabla('nuevos', 'mpNuevos', filas, [
    { k: 'alta', t: 'Alta', texto: true, v: f => f.fechaAlta, h: f => '<span class="nowrap">' + esc(fechaCorta(f.fechaAlta)) + '</span>' },
    { k: 'codigo', t: 'Código', texto: true, cls: 'tk', v: f => f.codigo || '', h: f => esc(f.codigo) },
    { k: 'desc', t: 'Descripción', texto: true, v: f => f.descripcion || '', h: f => '<div class="cell-2">' + esc(corta(f.descripcion, 54)) + '<span>' + esc(f.linea || '—') + ' · ' + esc(f.tipo) + '</span></div>' },
    { k: 'stock', t: 'Stock', num: true, v: f => f.stock, h: f => (f.stock > 0 ? cantidad(f.stock) + ' ' + esc(f.unidadMedida || 'UND') : '<span class="muted">Sin stock aún</span>') },
    colValor,
    { k: 'muestra', t: 'Muestra', texto: true, v: f => f.estadoMuestra || '', h: f => (f.estadoMuestra ? esc(f.estadoMuestra) + '<div class="muted small">' + esc(fechaCorta(f.fechaMuestra)) + '</div>' : '<span class="muted">—</span>') }
  ], { sort: 'alta', clic: 'Ver en qué almacenes está',
    vacio: 'Sin códigos nuevos en este periodo. La fecha de alta llega con la sincronización de Mongo.' });
}

/** Clic directo en un almacén: qué SKU tiene (del tipo elegido), sin pasar por Categoría → Línea. */
export async function verProductosDeAlmacenMateriaPrima(almacen) {
  let filas;
  try {
    filas = await api.productosDeAlmacenMateriaPrima(almacen, tipoActual);
  } catch (e) {
    abrirModal(almacen, '<div class="empty"><strong>No se pudo cargar</strong>' + esc(e.message) + '</div>');
    return;
  }
  if (!filas.length) {
    abrirModal(almacen, '<div class="empty"><strong>Sin SKU registrados</strong></div>');
    return;
  }
  const html = tabla('mod', 'mpModalTabla', filas, [
    { k: 'codigo', t: 'Código', texto: true, cls: 'tk', v: f => f.codigo || '', h: f => esc(f.codigo) },
    { k: 'desc', t: 'Producto', texto: true, v: f => f.descripcion || '', h: f => '<div class="cell-2">' + esc(corta(f.descripcion, 40)) + '<span>' + esc(f.categoria) + ' · ' + esc(corta(f.familia, 26)) + '</span></div>' },
    { k: 'stock', t: 'Stock', num: true, v: f => f.stock, h: f => cantidad(f.stock) + ' ' + esc(f.unidadMedida || 'UND') },
    colValor, colShare
  ], { sort: 'valor', vacio: 'Sin SKU registrados' });
  abrirModal(almacen + ' · ' + (tipoActual || ''),
    '<p class="sub" style="margin-top:-6px">' + entero(filas.length) + ' SKU · ' + dolares(tablas.mod.total) + ' valorizado · solo ' + esc(tipoActual || 'materia prima') + '</p>'
    + '<div id="mpModalTabla">' + html + '</div>', { ancho: 'wide' });
}

/** Búsqueda libre: sustituye el nivel actual mientras haya texto, y lo devuelve al nivel donde estaba al limpiar. */
export async function buscarProductosMateriaPrima() {
  const q = $('mpQ').value.trim();
  const miToken = ++tokenBusqueda;
  if (!q) { tokenNivel++; renderNivelActual(); return; }
  pintarBreadcrumb(q);
  $('mpNivel').innerHTML = '<div class="empty cargando mp-empty"><strong>Buscando…</strong></div>';
  try {
    const resultados = await api.buscarMateriaPrima(q);
    if (miToken !== tokenBusqueda) return; // llegó una búsqueda más nueva antes que esta
    if (!resultados.length) {
      $('mpNivel').innerHTML = '<div class="empty mp-empty"><strong>Sin coincidencias</strong>Prueba con otro código o palabra.</div>';
      return;
    }
    $('mpNivel').innerHTML = tabla('busq', 'mpNivel', resultados, colsProducto(true),
      { sort: 'valor', clic: 'Ver en qué almacenes está', vacio: 'Sin coincidencias' });
  } catch (e) {
    if (miToken !== tokenBusqueda) return;
    $('mpNivel').innerHTML = '<div class="empty"><strong>No se pudo buscar</strong>' + esc(e.message) + '</div>';
  }
}

function renderNivelActual() {
  if (nivel === 'lineas') return cargarLineas();
  if (nivel === 'productos') return cargarProductos();
  return renderMateriaPrima();
}

export function limpiarBusquedaMateriaPrima() {
  $('mpQ').value = '';
  return buscarProductosMateriaPrima();
}
