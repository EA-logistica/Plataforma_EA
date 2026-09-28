import { $, esc } from '../utils/dom.js';
import { fechaCorta, corta } from '../utils/format.js';
import * as api from '../api/estado.js';
import { abrirModal } from './dispatch.js';

/** Texto seguro dentro de un onclick="fn('…')": escapa \ y ' para JS y después para HTML. Con esc() solo, un nombre como 'NEGOCIACION KIO' SAC rompía el clic. */
const jsStr = s => esc(String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/'/g, "\\'"));

/**
 * Productos: catálogo SKU del ERP (data/productos.js), solo lectura. Mismo
 * patrón que Órdenes de Compra -filtro y paginación resueltos por el
 * servidor, veintitrés mil productos no caben de una vez en el navegador-.
 *
 * Cada fila tiene un botón "Requerimientos" que cruza con el historial de
 * requerimientos de compra por `codigo` (ver
 * backend/db/repos/requerimientosCompraHistorico.js → porProducto): es el
 * único enlace exacto que existe entre el catálogo y una compra -el registro
 * de compras (ordenes_compra) no trae código de producto, solo la glosa
 * libre de la factura-.
 */
const FILAS_POR_PAGINA = 30;
let pagina = 1;
let opcionesCache = null;
let orden = 'descripcion_asc';
let claseFiltro = '';

export function renderProductosSiVisible() {
  if ($('aProductos').classList.contains('on')) renderProductos();
}

function filtroActual() {
  return {
    q: $('prodQ').value.trim(),
    familia: $('prodFamilia').value,
    tipoProducto: $('prodTipo').value,
    estado: $('prodEstado').value,
    soloConStock: $('prodSoloStock').checked ? '1' : '',
    clase: claseFiltro
  };
}

export function setFiltroProductos() { pagina = 1; renderProductos(); }
export function irPaginaProductos(n) { pagina = n; renderProductos(); }

export function limpiarFiltroProductos() {
  $('prodQ').value = ''; $('prodFamilia').value = ''; $('prodTipo').value = ''; $('prodEstado').value = ''; $('prodSoloStock').checked = false;
  claseFiltro = '';
  setFiltroProductos();
}

/** Clic en un chip de rotación (Todos / A / B / C). */
export function setClaseRotacionProductos(clase) { claseFiltro = clase; setFiltroProductos(); }

/** Clic en el encabezado "Stock": alterna mayor→menor / menor→mayor. */
export function ordenarProductosPorStock() {
  orden = orden === 'stock_desc' ? 'stock_asc' : 'stock_desc';
  pagina = 1;
  renderProductos();
}

async function asegurarOpciones() {
  if (opcionesCache) return opcionesCache;
  opcionesCache = await api.opcionesProductos();
  const sel = (id, valores) => { $(id).innerHTML = $(id).firstElementChild.outerHTML + valores.map(v => '<option>' + esc(v) + '</option>').join(''); };
  sel('prodFamilia', opcionesCache.familias);
  sel('prodTipo', opcionesCache.tiposProducto);
  sel('prodEstado', opcionesCache.estados);
  return opcionesCache;
}

export async function renderProductos() {
  try {
    await asegurarOpciones();
    const filtro = filtroActual();
    const [resumen, rotacion, lista] = await Promise.all([
      api.resumenProductos(filtro),
      api.resumenRotacionProductos(filtro),
      api.listarProductos({ ...filtro, orden, pagina, porPagina: FILAS_POR_PAGINA })
    ]);
    pintarMetricas(resumen);
    pintarChipsRotacion(rotacion);
    pintarTabla(lista);
    await pintarFamiliasClaseC(filtro);
  } catch (e) {
    $('tProductos').innerHTML = '<div class="empty"><strong>No se pudo cargar</strong>' + esc(e.message) + '</div>';
  }
}

/**
 * Con el chip "C" activo, un vistazo de qué familias concentran esos SKU de
 * baja o sin rotación -sin esto, para verlo había que ir probando familia
 * por familia en el selector-. Respeta los demás filtros activos (búsqueda,
 * tipo, estado, solo con stock), pero no la propia clase: siempre agrega
 * sobre C, que es la que interesa acá.
 */
async function pintarFamiliasClaseC(filtro) {
  if (claseFiltro !== 'C') { $('prodFamiliasC').innerHTML = ''; return; }
  let filas;
  try {
    filas = await api.resumenRotacionPorFamiliaProductos(filtro);
  } catch (e) {
    $('prodFamiliasC').innerHTML = '';
    return;
  }
  if (!filas.length) { $('prodFamiliasC').innerHTML = ''; return; }
  const filaActiva = $('prodFamilia').value;
  $('prodFamiliasC').innerHTML = '<div class="filters" style="margin-top:-4px;margin-bottom:12px;flex-wrap:wrap">'
    + '<span class="muted small" style="align-self:center">Familias con más rotación baja (clase C):</span>'
    + filas.map(f => '<button class="fchip' + (filaActiva === f.familia ? ' on' : '') + '" onclick="filtrarFamiliaClaseC(\''
      + jsStr(f.familia) + '\')">' + esc(nombreFamilia(f.familia)) + ' (' + f.c.toLocaleString('es-PE')
      + (f.c !== f.total ? ' de ' + f.total.toLocaleString('es-PE') : '') + ')</button>').join('')
    + '</div>';
}

/**
 * "FAMILIAS" es un valor sucio del ERP (el nombre de la columna quedó como
 * dato en vez del dato real, ver data/productos.js): se muestra como "sin
 * familia" para no confundirlo con una familia real, aunque el filtro sigue
 * usando el valor crudo tal cual está en la base.
 */
const nombreFamilia = f => (!f || f === 'FAMILIAS') ? '(sin familia)' : f;

/** Clic en una familia del panel de clase C: la aplica como filtro de familia. */
export function filtrarFamiliaClaseC(familia) {
  $('prodFamilia').value = $('prodFamilia').value === familia ? '' : familia;
  setFiltroProductos();
}

/**
 * Chips de rotación ABC: 'A' = 20% con más compras en 12 meses, 'B' = 30%
 * siguiente, 'C' = el resto -incluye a los que nunca se compraron o cuya
 * última compra fue hace más de un año, candidatos a obsoleto-. Mismo patrón
 * que los chips de estado en Requerimientos de compra: el número y el filtro
 * son la misma cosa.
 */
function pintarChipsRotacion(r) {
  $('prodChipsRotacion').innerHTML = [
    ['', 'Todos', r.a + r.b + r.c],
    ['A', 'A · alta rotación', r.a],
    ['B', 'B · rotación media', r.b],
    ['C', 'C · baja o sin movimiento', r.c]
  ].map(([valor, etiqueta, n]) =>
    '<button class="fchip' + (claseFiltro === valor ? ' on' : '') + '" onclick="setClaseRotacionProductos(\'' + valor + '\')">'
    + esc(etiqueta) + ' (' + (n || 0).toLocaleString('es-PE') + ')</button>'
  ).join('') + (r.sinComprasRegistradas
    ? '<span class="muted small" style="align-self:center;margin-left:8px">' + r.sinComprasRegistradas.toLocaleString('es-PE') + ' nunca comprados por OC (dentro de C)</span>'
    : '');
}

const tarjeta = (clase, v, k, d) => '<div class="kpi ' + clase + '"><div class="v">' + esc(String(v))
  + '</div><div class="k">' + esc(k) + '</div><div class="d">' + esc(d) + '</div></div>';

function pintarMetricas(r) {
  $('prodMetrics').innerHTML = [
    tarjeta('primary', r.productos.toLocaleString('es-PE'), 'Productos', 'Según el filtro aplicado'),
    tarjeta('ok', r.conStock.toLocaleString('es-PE'), 'Con stock', r.productos ? ((r.conStock / r.productos) * 100).toFixed(0) + '% del filtro' : '—'),
    tarjeta('info', r.activos.toLocaleString('es-PE'), 'Activos', 'Estado ACTIVO en el ERP'),
    tarjeta('', r.familias.toLocaleString('es-PE'), 'Familias', 'Distintas en el filtro')
  ].join('');
}

function pintarTabla(lista) {
  if (!lista.filas.length) {
    $('tProductos').innerHTML = '<div class="empty"><strong>Sin coincidencias</strong>Prueba con otro filtro.</div>';
    $('prodPaginacion').innerHTML = '';
    return;
  }
  const filas = lista.filas.map(p => '<tr>'
    + '<td class="tk">' + esc(p.codigo) + '</td>'
    + '<td class="cell-2">' + esc(corta(p.descripcion, 46)) + '<span>' + esc(p.familia || '—') + (p.linea ? ' · ' + esc(p.linea) : '') + '</span></td>'
    + '<td>' + esc(p.unidadMedida || '—') + '</td>'
    + '<td>' + esc(p.tipoProducto || '—') + '</td>'
    + '<td class="num">' + stockHTML(p) + '</td>'
    + '<td>' + estadoChip(p.estado) + '</td>'
    + '<td>' + rotacionChip(p) + '</td>'
    + '<td><button class="btn btn-sm btn-ghost" onclick="verRequerimientosProducto(\'' + jsStr(p.codigo) + '\')">Requerimientos</button></td>'
    + '</tr>').join('');

  const flechaStock = orden === 'stock_desc' ? ' ▼' : orden === 'stock_asc' ? ' ▲' : '';
  $('tProductos').innerHTML = '<table><thead><tr>'
    + '<th>Código</th><th>Descripción</th><th>UM</th><th>Tipo</th>'
    + '<th class="num" style="cursor:pointer;user-select:none" onclick="ordenarProductosPorStock()" title="Ordenar por stock">Stock' + flechaStock + '</th>'
    + '<th>Estado</th><th>Rotación</th><th></th>'
    + '</tr></thead><tbody>' + filas + '</tbody></table>';

  const totalPaginas = Math.max(1, Math.ceil(lista.total / lista.porPagina));
  const inicio = (lista.pagina - 1) * lista.porPagina;
  const hasta = Math.min(inicio + lista.porPagina, lista.total);
  $('prodPaginacion').innerHTML = '<span class="muted small">Mostrando ' + (lista.total ? inicio + 1 : 0) + '–' + hasta + ' de ' + lista.total + '</span>'
    + (totalPaginas > 1
      ? '<button class="btn btn-sm btn-ghost"' + (lista.pagina <= 1 ? ' disabled' : '') + ' onclick="irPaginaProductos(' + (lista.pagina - 1) + ')">‹ Anterior</button>'
        + '<span class="small">Página ' + lista.pagina + ' de ' + totalPaginas + '</span>'
        + '<button class="btn btn-sm btn-ghost"' + (lista.pagina >= totalPaginas ? ' disabled' : '') + ' onclick="irPaginaProductos(' + (lista.pagina + 1) + ')">Siguiente ›</button>'
      : '');
}

function stockHTML(p) {
  if (p.stock <= 0) return '<span class="muted">Sin stock</span>';
  const bajo = p.stockMinimo > 0 && p.stock < p.stockMinimo;
  return '<span' + (bajo ? ' style="color:var(--danger)"' : '') + '>' + p.stock.toLocaleString('es-PE') + '</span>'
    + (bajo ? ' <span class="muted small">(mín. ' + p.stockMinimo.toLocaleString('es-PE') + ')</span>' : '');
}

function estadoChip(estado) {
  const clase = estado === 'ACTIVO' ? 'st-concluido' : 'st-cancelado';
  return '<span class="chip ' + clase + '"><i class="dot"></i>' + esc(estado || '—') + '</span>';
}

function rotacionChip(p) {
  const clase = p.claseAbc === 'A' ? 'st-concluido' : p.claseAbc === 'B' ? 'st-transito' : 'st-cancelado';
  const titulo = p.ultimaCompra
    ? 'Última compra: ' + fechaCorta(p.ultimaCompra) + ' · ' + p.comprasUltimoAnio + ' compras en 12 meses'
    : 'Sin compras registradas en el historial de OC';
  return '<span class="chip ' + clase + '" title="' + esc(titulo) + '"><i class="dot"></i>' + esc(p.claseAbc) + '</span>';
}

/** Cruce con el historial de requerimientos: dónde y cuándo se pidió este producto. */
export async function verRequerimientosProducto(codigo) {
  let filas;
  try {
    filas = await api.requerimientosDeProducto(codigo);
  } catch (e) {
    abrirModal('Requerimientos del producto', '<div class="empty"><strong>No se pudo cargar</strong>' + esc(e.message) + '</div>');
    return;
  }
  if (!filas.length) {
    abrirModal('Requerimientos del producto ' + codigo, '<div class="empty"><strong>Sin requerimientos registrados</strong>Este producto no aparece en el historial de requerimientos de compra del ERP.</div>');
    return;
  }
  const cuerpo = filas.map(r => '<tr>'
    + '<td class="nowrap">' + fechaCorta(r.fechaEmision) + '</td>'
    + '<td class="tk">' + esc(r.numeroRequerimiento) + '/' + r.item + '</td>'
    + '<td class="num">' + r.cantidad.toLocaleString('es-PE') + ' ' + esc(r.unidadMedida) + '</td>'
    + '<td class="num">' + r.saldo.toLocaleString('es-PE') + '</td>'
    + '<td>' + esc(r.proveedor || '—') + '</td>'
    + '<td>' + esc(r.estado) + '</td>'
    + '</tr>').join('');
  abrirModal('Requerimientos de ' + filas[0].nombreProducto + ' (' + codigo + ')',
    '<div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Requerimiento</th><th class="num">Cantidad</th>'
    + '<th class="num">Saldo</th><th>Proveedor</th><th>Estado</th></tr></thead><tbody>' + cuerpo + '</tbody></table></div>', { ancho: 'wide' });
}
