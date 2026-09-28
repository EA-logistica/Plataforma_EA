import { $, esc } from '../utils/dom.js';
import { fechaCorta, corta } from '../utils/format.js';
import * as api from '../api/estado.js';
import { abrirModal } from './dispatch.js';

/** Texto seguro dentro de un onclick="fn('…')": escapa \ y ' para JS y después para HTML. Con esc() solo, un nombre como 'NEGOCIACION KIO' SAC rompía el clic. */
const jsStr = s => esc(String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/'/g, "\\'"));

/**
 * Órdenes de compra: registro de compras de SUNAT (data/compras.js), cargado
 * una sola vez en el servidor. Es de solo lectura y el volumen -catorce mil
 * comprobantes y creciendo- no cabe en una tabla del navegador de una sola
 * vez, así que el filtro, el resumen y la paginación los resuelve el
 * servidor (ver backend/db/repos/ordenesCompra.js); acá solo se pinta lo que
 * llega.
 *
 * El registro mezcla comprobantes en soles y en dólares: todo lo que muestra
 * plata está separado por moneda (tarjetas, meses); lo único que junta ambas
 * es el ranking de proveedores, y ahí con el equivalente en soles que ya
 * calcula el servidor, nunca sumando los montos tal cual.
 */
const FILAS_POR_PAGINA = 30;
let pagina = 1;
let proveedoresCache = null;
let cargando = false;
let otraVez = false;

export function renderOrdenesCompraSiVisible() {
  if ($('aOrdenesCompra').classList.contains('on')) renderOrdenesCompra();
}

function filtroActual() {
  return {
    q: $('ocQ').value.trim(),
    proveedor: $('ocProveedor').value,
    desde: $('ocDesde').value,
    hasta: $('ocHasta').value,
    moneda: $('ocMoneda').value
  };
}

export function setFiltroOrdenesCompra() { pagina = 1; renderOrdenesCompra(); }
export function irPaginaOrdenesCompra(n) { pagina = n; renderOrdenesCompra(); }

export function limpiarFiltroOrdenesCompra() {
  $('ocQ').value = ''; $('ocProveedor').value = ''; $('ocDesde').value = ''; $('ocHasta').value = ''; $('ocMoneda').value = '';
  setFiltroOrdenesCompra();
}

/** Clic en una barra mensual: acota el rango de fechas a ese mes completo, sin tocar el resto del filtro (proveedor incluido). */
export function filtrarOrdenesCompraPorMes(mes) {
  const [anio, mesNum] = mes.split('-').map(Number);
  const ultimoDia = new Date(anio, mesNum, 0).getDate();
  $('ocDesde').value = mes + '-01';
  $('ocHasta').value = mes + '-' + String(ultimoDia).padStart(2, '0');
  setFiltroOrdenesCompra();
}

/**
 * Clic en una barra de proveedor (o atajo desde la sección Proveedores): lo
 * selecciona también como filtro y para ver su evolución. Espera a que el
 * <select> tenga sus opciones: si se llegaba desde otra pestaña antes de
 * que cargaran, el navegador descartaba el valor y el filtro quedaba vacío.
 */
export async function elegirProveedorOrdenesCompra(proveedor) {
  try { await asegurarProveedores(); } catch (e) { /* renderOrdenesCompra mostrará el error */ }
  $('ocProveedor').value = proveedor;
  $('ocEvolProveedor').value = proveedor;
  setFiltroOrdenesCompra();
}

// Una sola carga aunque la pidan dos a la vez (abrir la pestaña + un atajo):
// si no, la segunda volvía a escribir las <option> y borraba lo elegido.
let proveedoresPromesa = null;
function asegurarProveedores() {
  if (!proveedoresPromesa) proveedoresPromesa = cargarProveedores().catch(e => { proveedoresPromesa = null; throw e; });
  return proveedoresPromesa;
}
async function cargarProveedores() {
  proveedoresCache = await api.proveedoresOrdenesCompra();
  const opciones = proveedoresCache.map(p =>
    '<option value="' + esc(p.proveedor) + '">' + esc(corta(p.proveedor, 46)) + ' (' + p.comprobantes + ')</option>').join('');
  $('ocProveedor').innerHTML = '<option value="">Todos los proveedores</option>' + opciones;
  $('ocEvolProveedor').innerHTML = '<option value="">Elige un proveedor…</option>' + opciones;
  return proveedoresCache;
}

export async function renderOrdenesCompra() {
  // Si llega un pedido mientras otro está en curso (p. ej. cambiar el filtro
  // antes de que termine la carga), no se pierde: se repite al terminar.
  if (cargando) { otraVez = true; return; }
  cargando = true;
  try {
    await asegurarProveedores();
    const filtro = filtroActual();
    if (filtro.proveedor && !$('ocEvolProveedor').value) $('ocEvolProveedor').value = filtro.proveedor;
    const [resumen, lista] = await Promise.all([
      api.resumenOrdenesCompra(filtro),
      api.listarOrdenesCompra({ ...filtro, pagina, porPagina: FILAS_POR_PAGINA })
    ]);
    pintarMetricas(resumen);
    pintarProveedores(resumen.porProveedor);
    pintarMeses(resumen.porMes);
    pintarTabla(lista);
    if (!$('ocEvolProveedor').value && proveedoresCache.length) {
      $('ocEvolProveedor').value = proveedoresCache[0].proveedor;
    }
    renderEvolucionProveedorCompra();
  } catch (e) {
    $('tOrdenesCompra').innerHTML = '<div class="empty"><strong>No se pudo cargar</strong>' + esc(e.message) + '</div>';
  } finally {
    cargando = false;
    if (otraVez) { otraVez = false; renderOrdenesCompra(); }
  }
}

const tarjeta = (clase, v, k, d) => '<div class="kpi ' + clase + '"><div class="v">' + esc(String(v))
  + '</div><div class="k">' + esc(k) + '</div><div class="d">' + esc(d) + '</div></div>';

const soles = n => 'S/ ' + (Number(n) || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dolares = n => 'US$ ' + (Number(n) || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const moneda = (n, m) => (m === 'USD' ? dolares(n) : soles(n));

function pintarMetricas(r) {
  $('ocMetrics').innerHTML = [
    tarjeta('primary', r.comprobantes.toLocaleString('es-PE'), 'Comprobantes', r.proveedores + ' proveedores en el filtro'),
    tarjeta('ok', soles(r.pen.total), 'Valorizado en soles', r.pen.comprobantes.toLocaleString('es-PE') + ' comprobantes · promedio ' + soles(r.pen.ticketPromedio)),
    tarjeta('info', dolares(r.usd.total), 'Valorizado en dólares', r.usd.comprobantes.toLocaleString('es-PE') + ' comprobantes · promedio ' + dolares(r.usd.ticketPromedio))
  ].join('');
}

function barras(items) {
  if (!items.length) return '<div class="empty" style="padding:26px 0"><strong>Sin datos todavía</strong>Ajusta el filtro para ver resultados.</div>';
  const max = Math.max.apply(null, items.map(i => i.v)) || 1;
  return '<div class="bars">' + items.map(i =>
    '<div class="bar-row"' + (i.onclick ? ' style="cursor:pointer" onclick="' + i.onclick + '"' : '') + '>'
    + '<div class="bar-lbl">' + esc(i.k) + '</div>'
    + '<div class="bar-val">' + esc(i.t) + '</div>'
    + '<div class="bar-track"><div class="bar-fill" style="width:' + Math.max(2, (i.v / max) * 100).toFixed(1) + '%"></div></div>'
    + '</div>').join('') + '</div>';
}

function pintarProveedores(porProveedor) {
  $('ocProveedores').innerHTML = barras(
    porProveedor.map(p => ({
      k: corta(p.proveedor, 40),
      v: p.totalEquivalente,
      t: (p.totalPen ? soles(p.totalPen) + (p.totalUsd ? ' + ' : '') : '') + (p.totalUsd ? dolares(p.totalUsd) : '') + ' · ' + p.comprobantes + ' comp.',
      onclick: 'elegirProveedorOrdenesCompra(\'' + jsStr(p.proveedor) + '\')'
    }))
  );
}

function columnas(meses, formatoValor, alClic) {
  if (!meses.length) return '<div class="empty" style="padding:26px 0"><strong>Sin movimiento en el rango</strong>Amplía el filtro de fechas.</div>';
  const W = Math.max(520, meses.length * 26), H = 190, pb = 30, pl = 4;
  const max = Math.max.apply(null, meses.map(m => m.v)) || 1;
  const ancho = (W - pl * 2) / meses.length;
  const barra = Math.min(ancho - 4, 22);
  let g = '';
  for (let i = 0; i <= 2; i++) {
    const y = (H - pb) - ((H - pb) * i / 2);
    g += '<line x1="0" y1="' + y.toFixed(1) + '" x2="' + W + '" y2="' + y.toFixed(1) + '" stroke="var(--chart-grid)" stroke-width="1"/>';
  }
  meses.forEach((m, i) => {
    const h = Math.max(2, (m.v / max) * (H - pb - 14));
    const x = pl + i * ancho + (ancho - barra) / 2;
    const y = (H - pb) - h;
    g += '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + barra.toFixed(1) + '" height="' + h.toFixed(1)
      + '" rx="3" fill="var(--chart-1)" opacity="' + (m.v ? 1 : .3) + '"'
      + (alClic ? ' style="cursor:pointer" onclick="' + alClic(m) + '"' : '')
      + '><title>' + m.k + ': ' + formatoValor(m.v) + (alClic ? ' (clic para filtrar por este mes)' : '') + '</title></rect>';
    if (i % Math.max(1, Math.round(meses.length / 16)) === 0 || i === meses.length - 1)
      g += '<text x="' + (x + barra / 2).toFixed(1) + '" y="' + (H - 10) + '" fill="var(--chart-label)" font-size="10" font-family="ui-monospace,monospace" text-anchor="middle">' + m.k + '</text>';
  });
  return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" height="' + H + '" role="img" aria-label="Gráfico mensual">' + g + '</svg>';
}

const nombreMes = mes => {
  const MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'set', 'oct', 'nov', 'dic'];
  return MES[+mes.slice(5, 7) - 1] + ' ' + mes.slice(2, 4);
};

function pintarMeses(porMes) {
  const alClic = m => 'filtrarOrdenesCompraPorMes(\'' + m.mesIso + '\')';
  $('ocMesesPen').innerHTML = columnas(
    porMes.map(m => ({ k: nombreMes(m.mes), v: m.totalPen, mesIso: m.mes })), soles, alClic
  );
  $('ocMesesUsd').innerHTML = columnas(
    porMes.map(m => ({ k: nombreMes(m.mes), v: m.totalUsd, mesIso: m.mes })), dolares, alClic
  );
}

export async function renderEvolucionProveedorCompra() {
  const proveedor = $('ocEvolProveedor').value;
  if (!proveedor) { $('ocEvolucion').innerHTML = '<div class="empty" style="padding:26px 0"><strong>Elige un proveedor</strong>Para ver la evolución de su ticket promedio mes a mes.</div>'; return; }
  let filas;
  try {
    filas = await api.evolucionProveedorCompra(proveedor);
  } catch (e) {
    $('ocEvolucion').innerHTML = '<div class="empty"><strong>No se pudo cargar</strong>' + esc(e.message) + '</div>';
    return;
  }
  if (!filas.length) { $('ocEvolucion').innerHTML = '<div class="empty" style="padding:26px 0"><strong>Sin comprobantes</strong></div>'; return; }

  // Un proveedor casi siempre factura en una sola moneda; si tiene ambas, se
  // grafica la que tenga más comprobantes y se avisa en el subtítulo, para no
  // mezclar soles y dólares en la misma barra.
  const porMoneda = {};
  filas.forEach(f => { porMoneda[f.moneda] = (porMoneda[f.moneda] || 0) + f.comprobantes; });
  const monedaDominante = Object.entries(porMoneda).sort((a, b) => b[1] - a[1])[0][0];
  const enMoneda = filas.filter(f => f.moneda === monedaDominante);

  const aviso = Object.keys(porMoneda).length > 1
    ? ' (solo comprobantes en ' + (monedaDominante === 'USD' ? 'US$' : 'S/') + '; este proveedor también tiene comprobantes en otra moneda)'
    : '';
  $('ocEvolucion').innerHTML = '<p class="sub" style="margin-top:10px">Promedio por comprobante, mes a mes' + aviso + '. Clic en un mes filtra la tabla de abajo por ese rango.</p>'
    + columnas(
      enMoneda.map(f => ({ k: nombreMes(f.mes), v: f.promedioNeto, mesIso: f.mes })),
      v => moneda(v, monedaDominante),
      m => 'filtrarOrdenesCompraPorMes(\'' + m.mesIso + '\')'
    );
}

function pintarTabla(lista) {
  if (!lista.filas.length) {
    $('tOrdenesCompra').innerHTML = '<div class="empty"><strong>Sin coincidencias</strong>Prueba con otro filtro.</div>';
    $('ocPaginacion').innerHTML = '';
    return;
  }
  const filas = lista.filas.map(f => '<tr>'
    + '<td class="nowrap">' + fechaCorta(f.fechaEmision) + '</td>'
    + '<td class="cell-2">' + esc(corta(f.proveedor, 34)) + '<span>RUC ' + esc(f.ruc || '—') + '</span></td>'
    + '<td class="cell-2">' + esc(f.tipoComprobante) + '<span>' + esc(f.numeroDoc || '—') + '</span></td>'
    + '<td>' + esc(corta(f.glosa, 40) || '—') + '</td>'
    + '<td class="num">' + moneda(f.total, f.moneda) + '</td>'
    + '</tr>').join('');

  $('tOrdenesCompra').innerHTML = '<table><thead><tr>'
    + '<th>Emisión</th><th>Proveedor</th><th>Comprobante</th><th>Glosa</th><th class="num">Neto</th>'
    + '</tr></thead><tbody>' + filas + '</tbody></table>';

  const totalPaginas = Math.max(1, Math.ceil(lista.total / lista.porPagina));
  const inicio = (lista.pagina - 1) * lista.porPagina;
  const hasta = Math.min(inicio + lista.porPagina, lista.total);
  $('ocPaginacion').innerHTML = '<span class="muted small">Mostrando ' + (lista.total ? inicio + 1 : 0) + '–' + hasta + ' de ' + lista.total + '</span>'
    + (totalPaginas > 1
      ? '<button class="btn btn-sm btn-ghost"' + (lista.pagina <= 1 ? ' disabled' : '') + ' onclick="irPaginaOrdenesCompra(' + (lista.pagina - 1) + ')">‹ Anterior</button>'
        + '<span class="small">Página ' + lista.pagina + ' de ' + totalPaginas + '</span>'
        + '<button class="btn btn-sm btn-ghost"' + (lista.pagina >= totalPaginas ? ' disabled' : '') + ' onclick="irPaginaOrdenesCompra(' + (lista.pagina + 1) + ')">Siguiente ›</button>'
      : '');
}

/**
 * Historial de Órdenes de Compra (OC) del ERP: OTRO documento que el registro
 * de compras de arriba -la OC es lo que se le pide al proveedor, no lo que el
 * proveedor factura después-. Vive en el mismo módulo/tab porque es la misma
 * pregunta de fondo ("qué se le compró a quién"), resuelta desde el otro lado
 * del proceso. Paginado en servidor: son ~12 200 OC.
 */
const OCD_FILAS_POR_PAGINA = 30;
let ocdPagina = 1;
let ocdTodosProveedoresCache = null;

export function renderOCSiVisible() {
  if ($('aOrdenesCompra').classList.contains('on')) renderOC();
}

/**
 * Un único filtro -proveedor, fecha, moneda- del que cuelga todo lo demás:
 * tarjetas, gráficos de mes y ranking de proveedores se recalculan sobre
 * este mismo objeto en cada renderOC(). Clic en un mes o en un proveedor
 * simplemente pone un valor acá y vuelve a llamar a renderOC().
 */
function ocdFiltroActual() {
  return {
    proveedor: $('ocdProveedor').value,
    desde: $('ocdDesde').value,
    hasta: $('ocdHasta').value,
    moneda: $('ocdMoneda').value
  };
}

export function setFiltroOC() { ocdPagina = 1; return renderOC(); }
export function irPaginaOC(n) { ocdPagina = n; return renderOC(); }
export function limpiarFiltroOC() {
  $('ocdProveedor').value = ''; $('ocdDesde').value = ''; $('ocdHasta').value = ''; $('ocdMoneda').value = '';
  setFiltroOC();
}

/** Clic en una barra mensual: acota el rango de fechas a ese mes completo. */
export function filtrarOCPorMes(mes) {
  const [anio, mesNum] = mes.split('-').map(Number);
  const ultimoDia = new Date(anio, mesNum, 0).getDate();
  $('ocdDesde').value = mes + '-01';
  $('ocdHasta').value = mes + '-' + String(ultimoDia).padStart(2, '0');
  setFiltroOC();
}

/** Clic en una barra de proveedor (o atajo desde Proveedores): lo deja como filtro, con el <select> ya poblado, y baja hasta la sección. */
export async function elegirProveedorOC(proveedor) {
  try { await ocdAsegurarProveedores(); } catch (e) { /* renderOC mostrará el error */ }
  $('ocdProveedor').value = proveedor;
  const titulo = $('ocdTitulo');
  if (titulo && titulo.scrollIntoView) titulo.scrollIntoView({ behavior: 'smooth', block: 'start' });
  return setFiltroOC();
}

let ocdProveedoresPromesa = null;
function ocdAsegurarProveedores() {
  if (!ocdProveedoresPromesa) ocdProveedoresPromesa = ocdCargarProveedores().catch(e => { ocdProveedoresPromesa = null; throw e; });
  return ocdProveedoresPromesa;
}
async function ocdCargarProveedores() {
  ocdTodosProveedoresCache = await api.todosLosProveedoresOC();
  $('ocdProveedor').innerHTML = '<option value="">Todos los proveedores</option>'
    + ocdTodosProveedoresCache.map(p => '<option value="' + esc(p.proveedor) + '">' + esc(corta(p.proveedor, 46)) + ' (' + p.ordenes + ')</option>').join('');
}

let ocdToken = 0;
export async function renderOC() {
  // Dos renderOC() seguidos (abrir la pestaña y elegir un proveedor): solo
  // pinta el último, para que una respuesta vieja no pise al filtro nuevo.
  const miToken = ++ocdToken;
  try {
    await ocdAsegurarProveedores();
    const filtro = ocdFiltroActual();
    const [resumen, meses, proveedores, lista] = await Promise.all([
      api.resumenOC(filtro),
      api.mesesOC(filtro),
      api.proveedoresOC({ desde: filtro.desde, hasta: filtro.hasta, moneda: filtro.moneda }),
      api.listarOC({ ...filtro, pagina: ocdPagina, porPagina: OCD_FILAS_POR_PAGINA })
    ]);
    if (miToken !== ocdToken) return;
    ocdPintarMetricas(resumen);
    ocdPintarMeses(meses);
    ocdPintarProveedores(proveedores);
    ocdPintarTabla(lista);
  } catch (e) {
    if (miToken !== ocdToken) return;
    $('tOC').innerHTML = '<div class="empty"><strong>No se pudo cargar</strong>' + esc(e.message) + '</div>';
  }
}

function ocdPintarMetricas(r) {
  $('ocdMetrics').innerHTML = [
    tarjeta('primary', r.ordenes.toLocaleString('es-PE'), 'Órdenes de compra', r.proveedores + ' proveedores en el filtro'),
    tarjeta('ok', soles(r.pen.total), 'Valorizado en soles', r.pen.ordenes.toLocaleString('es-PE') + ' OC en soles'),
    tarjeta('info', dolares(r.usd.total), 'Valorizado en dólares', r.usd.ordenes.toLocaleString('es-PE') + ' OC en dólares')
  ].join('');
}

function ocdEstadoChip(estado) {
  const clase = ['ATENDIDA', 'APROBADA'].includes(estado) ? 'st-concluido' : estado === 'ANULADA' ? 'st-cancelado' : 'st-transito';
  return '<span class="chip ' + clase + '"><i class="dot"></i>' + esc(estado || '—') + '</span>';
}

function ocdPintarMeses(meses) {
  const alClic = m => 'filtrarOCPorMes(\'' + m.mesIso + '\')';
  $('ocdMesesPen').innerHTML = columnas(meses.map(m => ({ k: nombreMes(m.mes), v: m.totalPen, mesIso: m.mes })), soles, alClic);
  $('ocdMesesUsd').innerHTML = columnas(meses.map(m => ({ k: nombreMes(m.mes), v: m.totalUsd, mesIso: m.mes })), dolares, alClic);
}

function ocdPintarProveedores(proveedores) {
  $('ocdProveedores').innerHTML = barras(
    proveedores.map(p => ({
      k: corta(p.proveedor, 40),
      v: p.totalEquivalente,
      t: (p.totalPen ? soles(p.totalPen) + (p.totalUsd ? ' + ' : '') : '') + (p.totalUsd ? dolares(p.totalUsd) : '') + ' · ' + p.ordenes + ' OC',
      onclick: 'elegirProveedorOC(\'' + jsStr(p.proveedor) + '\')'
    }))
  );
}

function ocdPintarTabla(lista) {
  if (!lista.filas.length) {
    $('tOC').innerHTML = '<div class="empty"><strong>Sin coincidencias</strong>Prueba con otro filtro.</div>';
    $('ocdPaginacion').innerHTML = '';
    return;
  }
  const filas = lista.filas.map(f => '<tr>'
    + '<td class="tk">' + esc(f.numeroOc) + '</td>'
    + '<td class="nowrap">' + fechaCorta(f.fechaEmision) + '</td>'
    + '<td class="cell-2">' + esc(corta(f.proveedor, 34)) + '<span>RUC ' + esc(f.rucProveedor || '—') + '</span></td>'
    + '<td>' + esc(f.area || '—') + '</td>'
    + '<td class="num">' + f.items + '</td>'
    + '<td class="num">' + moneda(f.valorizado, f.moneda) + '</td>'
    + '<td>' + ocdEstadoChip(f.estado) + '</td>'
    + '<td><button class="btn btn-sm btn-ghost" onclick="verItemsOC(\'' + jsStr(f.numeroOc) + '\')">Ver ítems</button></td>'
    + '</tr>').join('');

  $('tOC').innerHTML = '<table><thead><tr>'
    + '<th>OC</th><th>Emisión</th><th>Proveedor</th><th>Área</th><th class="num">Ítems</th><th class="num">Valorizado</th><th>Estado</th><th></th>'
    + '</tr></thead><tbody>' + filas + '</tbody></table>';

  const totalPaginas = Math.max(1, Math.ceil(lista.total / lista.porPagina));
  const inicio = (lista.pagina - 1) * lista.porPagina;
  const hasta = Math.min(inicio + lista.porPagina, lista.total);
  $('ocdPaginacion').innerHTML = '<span class="muted small">Mostrando ' + (lista.total ? inicio + 1 : 0) + '–' + hasta + ' de ' + lista.total + '</span>'
    + (totalPaginas > 1
      ? '<button class="btn btn-sm btn-ghost"' + (lista.pagina <= 1 ? ' disabled' : '') + ' onclick="irPaginaOC(' + (lista.pagina - 1) + ')">‹ Anterior</button>'
        + '<span class="small">Página ' + lista.pagina + ' de ' + totalPaginas + '</span>'
        + '<button class="btn btn-sm btn-ghost"' + (lista.pagina >= totalPaginas ? ' disabled' : '') + ' onclick="irPaginaOC(' + (lista.pagina + 1) + ')">Siguiente ›</button>'
      : '');
}

/** Detalle de una OC: sus ítems (producto, cantidad, costo unitario, neto). */
export async function verItemsOC(numeroOc) {
  let items;
  try {
    items = await api.itemsDeOC(numeroOc);
  } catch (e) {
    abrirModal('OC ' + numeroOc, '<div class="empty"><strong>No se pudo cargar</strong>' + esc(e.message) + '</div>');
    return;
  }
  if (!items.length) {
    abrirModal('OC ' + numeroOc, '<div class="empty"><strong>Sin ítems</strong></div>');
    return;
  }
  const cuerpo = items.map(it => '<tr>'
    + '<td class="cell-2">' + esc(corta(it.descripcionProducto, 40)) + '<span>' + esc(it.codigoProducto || '—') + '</span></td>'
    + '<td class="num">' + it.cantidad.toLocaleString('es-PE') + '</td>'
    + '<td class="num">' + moneda(it.costoUnitario, it.moneda) + '</td>'
    + '<td class="num">' + moneda(it.montoNeto, it.moneda) + '</td>'
    + '</tr>').join('');
  const primero = items[0];
  abrirModal('OC ' + numeroOc + ' · ' + primero.proveedor,
    '<p class="sub" style="margin-top:-6px">' + fechaCorta(primero.fechaEmision) + ' · ' + esc(primero.area || '—')
    + ' · ' + ocdEstadoChip(primero.estado) + '</p>'
    + '<div class="table-wrap"><table><thead><tr><th>Producto</th><th class="num">Cantidad</th>'
    + '<th class="num">Costo unit.</th><th class="num">Neto</th></tr></thead><tbody>' + cuerpo + '</tbody></table></div>', { ancho: 'wide' });
}
