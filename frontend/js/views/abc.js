import { $, esc } from '../utils/dom.js';
import { fechaCorta, usd, usdCorto, entero, decimal, pct } from '../utils/format.js';
import * as api from '../api/estado.js';
import { pareto, apilada } from '../ui/graficos.js';
import { esqueletoKpis, esqueletoTabla, esqueletoPanel } from '../ui/esqueleto.js';
import { sello, fechaSincronizacion } from '../ui/frescura.js';
import { ESTADOS_REORDEN, ETIQUETA_REORDEN, MESES_EXCESO } from '#shared/abc.js';

/**
 * Materia Prima → ABC y reorden. Clasificación ABC por consumo valorizado
 * anual (shared/abc.js), con la cobertura de cada código y si ya toca
 * pedirlo. Responde las dos preguntas de un comprador: "¿en qué códigos se
 * me va la plata?" (A) y "¿qué tengo que pedir ya?" (punto de reorden).
 */

const POR_PAGINA = 30;
let datos = null;
let pagina = 1;
let orden = { k: 'rango', asc: true };
const filtro = { q: '', clase: '', estado: '', linea: '' };

const CLASE_TONO = { A: 's3', B: 's2', C: 's1' };
const TONO_ESTADO = { pedir: 'bad', pronto: 'warn', ok: 'ok', exceso: 'info', inmovilizado: 'muted' };
const chipClase = c => (c ? '<span class="abc abc-' + c + '">' + c + '</span>' : '<span class="muted">—</span>');
const chipEstado = e => (e ? '<span class="est ' + TONO_ESTADO[e] + '">' + esc(ETIQUETA_REORDEN[e]) + '</span>' : '<span class="muted">—</span>');
const tarjeta = (clase, v, k, d) => '<div class="kpi ' + clase + '"><div class="v">' + esc(String(v)) + '</div><div class="k">' + esc(k) + '</div><div class="d">' + d + '</div></div>';
const cant = (n, um) => (n == null ? '—' : entero(n) + (um ? ' ' + esc(um.toLowerCase()) : ''));

export async function renderAbc() {
  $('abcMetrics').innerHTML = esqueletoKpis(6);
  $('abcCuerpo').innerHTML = esqueletoPanel();
  $('abcTabla').innerHTML = esqueletoTabla(8, 8);
  try {
    const [d, sinc] = await Promise.all([api.abcMateriaPrima($('abcTipo').value), fechaSincronizacion()]);
    datos = d;
    $('abcSello').innerHTML = sello(sinc, 'Consumo y lead time calculados por el bot de logística');
    const lineas = [...new Set(d.filas.map(f => f.linea).filter(Boolean))].sort();
    $('abcLinea').innerHTML = '<option value="">Toda línea</option>' + lineas.map(l => '<option' + (l === filtro.linea ? ' selected' : '') + '>' + esc(l) + '</option>').join('');
    pintar();
  } catch (e) {
    $('abcMetrics').innerHTML = '';
    $('abcCuerpo').innerHTML = '<div class="empty"><strong>No se pudo cargar la clasificación</strong>' + esc(e.message) + '</div>';
    $('abcTabla').innerHTML = '';
  }
}

function pintar() {
  const r = datos.resumen;
  const [A, B, C] = r.clases;
  if (!r.codigos) {
    $('abcMetrics').innerHTML = '';
    $('abcCuerpo').innerHTML = '<div class="empty"><strong>Todavía no hay datos de consumo</strong>Llegan con la sincronización de MongoDB (planeación del bot).</div>';
    $('abcTabla').innerHTML = '';
    return;
  }
  $('abcMetrics').innerHTML = [
    tarjeta('primary', usdCorto(r.valorAnual), 'Consumo valorizado anual', entero(r.codigos) + ' códigos con consumo en 12 meses'),
    tarjeta('', entero(A.n) + ' códigos', 'Clase A', pct(A.pct) + ' del consumo con ' + pct(A.n / r.codigos) + ' de los códigos'),
    tarjeta(r.pedirA ? 'bad' : 'ok', entero(r.pedirA), 'Clase A por pedir', r.pedirA ? 'En o bajo el punto de reorden' : 'Toda la clase A está cubierta'),
    tarjeta(r.pedir ? 'bad' : '', entero(r.pedir), 'Por pedir (todas)', 'Compra sugerida ' + usdCorto(r.compraSugeridaUsd)),
    tarjeta(r.excesoUsd ? 'warn' : '', usdCorto(r.excesoUsd), 'Exceso de stock', 'Por encima de ' + MESES_EXCESO + ' meses de cobertura'),
    tarjeta(r.inmovilizados ? 'warn' : '', usdCorto(r.inmovilizadoUsd), 'Stock sin consumo', entero(r.inmovilizados) + ' códigos sin consumo en 12 meses')
  ].join('');

  const celda = (c, e) => {
    const n = (r.matriz[c] || {})[e] || 0;
    return '<td class="num">' + (n ? '<button class="celda-matriz ' + TONO_ESTADO[e] + '" onclick="abcFiltrarMatriz(\'' + c + '\',\'' + e + '\')" title="Ver los ' + n + ' códigos ' + c + ' en ' + esc(ETIQUETA_REORDEN[e]) + '">' + n + '</button>' : '<span class="muted">·</span>') + '</td>';
  };
  const estados = ESTADOS_REORDEN.filter(e => e.k !== 'inmovilizado');
  $('abcCuerpo').innerHTML = '<div class="grid2">'
    + '<div class="panel"><h3>Curva de Pareto</h3><p class="sub">Qué parte del consumo valorizado explican los códigos, de mayor a menor. Pasa el mouse por la curva para ver cada código.</p>'
    + pareto(r.pareto, {
      bandas: [{ t: 'A', hasta: A.n / r.codigos, clase: 'banda-a' }, { t: 'B', hasta: (A.n + B.n) / r.codigos, clase: 'banda-b' }, { t: 'C', hasta: 1, clase: 'banda-c' }],
      tip: p => 'Código n.º ' + p.rango + ' (clase ' + p.clase + ')\n' + pct(p.pctCodigos, 1) + ' de los códigos\n' + pct(p.acumulado, 1) + ' del consumo valorizado',
      aria: 'Curva de Pareto del consumo de materia prima'
    })
    + '<div style="margin-top:12px">' + apilada(r.clases.map(c => ({
      t: 'Clase ' + c.clase, v: c.valorAnual, texto: pct(c.pct) + ' · ' + entero(c.n) + ' cód.', clase: CLASE_TONO[c.clase],
      tip: 'Clase ' + c.clase + '\n' + entero(c.n) + ' códigos\n' + usd(c.valorAnual) + ' de consumo anual\n' + usd(c.stockUsd) + ' en stock',
      clic: 'abcFiltrarMatriz(\'' + c.clase + '\',\'\')'
    }))) + '</div></div>'
    + '<div class="panel"><h3>Clase × situación de stock</h3><p class="sub">Dónde poner la atención primero: la fila A. Clic en un número para ver esos códigos.</p>'
    + '<div class="table-wrap" data-sin-barra><table class="matriz"><thead><tr><th>Clase</th>' + estados.map(e => '<th class="num" title="' + esc(e.d) + '">' + esc(e.t) + '</th>').join('') + '<th class="num">Stock US$</th></tr></thead><tbody>'
    + r.clases.map(c => '<tr><td>' + chipClase(c.clase) + ' <span class="muted small">' + entero(c.n) + ' cód.</span></td>' + estados.map(e => celda(c.clase, e.k)).join('') + '<td class="num">' + usdCorto(c.stockUsd) + '</td></tr>').join('')
    + '</tbody></table></div>'
    + '<ul class="leyenda-reorden">' + ESTADOS_REORDEN.map(e => '<li>' + chipEstado(e.k) + ' <span class="muted small">' + esc(e.d) + '</span></li>').join('') + '</ul>'
    + '<p class="sub" style="margin:10px 0 0">Punto de reorden = consumo mensual × lead time × (1 + % de seguridad), contra stock + lo ya pedido. Consumo, lead time y seguridad son los que calcula el bot.</p>'
    + '</div></div>';
  pintarTabla();
}

const normal = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
function filtradas() {
  const q = normal(filtro.q);
  return datos.filas.filter(f => (!filtro.clase || f.clase === filtro.clase)
    && (!filtro.estado || f.estado === filtro.estado)
    && (!filtro.linea || f.linea === filtro.linea)
    && (!q || normal(f.codigo + ' ' + f.descripcion + ' ' + f.proveedorUltima).includes(q))
    && (filtro.clase || filtro.estado || q || f.clase || f.estado === 'inmovilizado'));
}
const ORDENES = {
  rango: f => f.rango ?? 1e9, valor: f => f.valorAnual, cobertura: f => f.coberturaTotal ?? 1e9, stock: f => f.stockUsd,
  sugerida: f => f.compraSugeridaUsd || 0, codigo: f => f.codigo
};
function ordenadas(xs) {
  const g = ORDENES[orden.k];
  return [...xs].sort((a, b) => { const va = g(a), vb = g(b); const c = typeof va === 'number' ? va - vb : String(va).localeCompare(vb); return orden.asc ? c : -c; });
}

function barraCobertura(f) {
  if (f.coberturaTotal == null) return '<span class="muted">—</span>';
  const max = MESES_EXCESO * 1.5, lt = f.leadTime || 1;
  const w = Math.min(100, f.coberturaTotal / max * 100), marca = Math.min(100, (f.puntoReorden / (f.consumoMes || 1)) / max * 100);
  return '<div class="cob" title="' + esc(decimal(f.coberturaTotal) + ' meses con lo que hay y lo que viene · lead time ' + decimal(lt) + ' meses') + '"><span>' + decimal(f.coberturaTotal) + ' m</span>'
    + '<b><i class="' + TONO_ESTADO[f.estado] + '" style="width:' + w.toFixed(1) + '%"></i><em style="left:' + marca.toFixed(1) + '%"></em></b></div>';
}

function pintarTabla() {
  const xs = ordenadas(filtradas());
  const total = Math.max(1, Math.ceil(xs.length / POR_PAGINA));
  pagina = Math.min(pagina, total);
  const th = (k, t, num, titulo = '') => '<th class="' + (k ? 'ordenable ' : '') + (num ? 'num ' : '') + (orden.k === k ? 'on' : '') + '"' + (k ? ' onclick="abcOrdenar(\'' + k + '\')"' : '')
    + (titulo ? ' title="' + esc(titulo) + '"' : '') + '>' + esc(t) + (orden.k === k ? (orden.asc ? ' ▲' : ' ▼') : '') + '</th>';
  $('abcResumen').textContent = entero(xs.length) + ' códigos' + (filtro.clase ? ' · clase ' + filtro.clase : '') + (filtro.estado ? ' · ' + ETIQUETA_REORDEN[filtro.estado].toLowerCase() : '');
  $('abcTabla').innerHTML = !xs.length ? '<div class="empty"><strong>Ningún código con estos filtros</strong></div>'
    : '<div class="table-wrap" data-exportar="exportarAbc"><table><thead><tr>'
      + th('rango', 'N.º', true) + th('', 'Clase') + th('codigo', 'Código') + th('', 'Descripción') + th('', 'Consumo / mes', true)
      + th('valor', 'Consumo anual', true, 'Consumo mensual × 12 × costo unitario (US$)') + th('', '% acum.', true)
      + th('stock', 'Stock', true) + th('', 'En camino', true, 'OC abiertas todavía no recibidas') + th('cobertura', 'Cobertura', false, 'Meses de consumo con stock + en camino. La marca es el punto de reorden.')
      + th('', 'Situación') + th('sugerida', 'Compra sugerida', true, 'Lo que sugiere el bot, en US$')
      + '</tr></thead><tbody>'
      + xs.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA).map(f => '<tr' + (f.estado === 'pedir' && f.clase === 'A' ? ' class="fila-alerta"' : '') + '>'
        + '<td class="num">' + (f.rango ?? '—') + '</td><td>' + chipClase(f.clase) + '</td><td class="tk">' + esc(f.codigo) + '</td>'
        + '<td class="cell-2 abc-desc"><b>' + esc(f.descripcion) + '</b><span>' + esc(f.linea) + (f.proveedorUltima ? ' · últ. compra ' + esc(f.proveedorUltima) + (f.fechaUltimaCompra ? ' (' + fechaCorta(f.fechaUltimaCompra) + ')' : '') : '') + '</span></td>'
        + '<td class="num">' + cant(f.consumoMes, f.unidadMedida) + '</td><td class="num">' + usd(f.valorAnual) + '</td>'
        + '<td class="num">' + (f.acumulado == null ? '—' : pct(f.acumulado, 1)) + '</td>'
        + '<td class="num">' + cant(f.stock, f.unidadMedida) + '<div class="muted small">' + usd(f.stockUsd) + '</div></td>'
        + '<td class="num">' + (f.enCamino ? cant(f.enCamino, f.unidadMedida) : '<span class="muted">—</span>') + '</td>'
        + '<td>' + barraCobertura(f) + '</td><td>' + chipEstado(f.estado) + '</td>'
        + '<td class="num">' + (f.compraSugeridaUsd ? usd(f.compraSugeridaUsd) + '<div class="muted small">' + cant(f.compraSugerida, f.unidadMedida) + '</div>' : '<span class="muted">—</span>') + '</td></tr>').join('')
      + '</tbody></table></div>';
  $('abcPaginacion').innerHTML = total > 1
    ? '<button class="btn btn-sm btn-ghost" ' + (pagina <= 1 ? 'disabled' : 'onclick="abcPagina(' + (pagina - 1) + ')"') + '>← Anterior</button>'
      + '<span class="muted small" style="align-self:center">Página ' + pagina + ' de ' + total + '</span>'
      + '<button class="btn btn-sm btn-ghost" ' + (pagina >= total ? 'disabled' : 'onclick="abcPagina(' + (pagina + 1) + ')"') + '>Siguiente →</button>' : '';
}

export function filtrarAbc() {
  if (!datos) return;
  filtro.q = $('abcQ').value; filtro.clase = $('abcClase').value; filtro.estado = $('abcEstado').value; filtro.linea = $('abcLinea').value;
  pagina = 1; pintarTabla();
}
export function abcFiltrarMatriz(clase, estado) {
  filtro.clase = clase; filtro.estado = estado;
  $('abcClase').value = clase; $('abcEstado').value = estado;
  pagina = 1; pintarTabla();
  $('abcTabla').scrollIntoView({ block: 'start', behavior: 'smooth' });
}
export function limpiarAbc() {
  Object.assign(filtro, { q: '', clase: '', estado: '', linea: '' });
  ['abcQ', 'abcClase', 'abcEstado', 'abcLinea'].forEach(id => { $(id).value = ''; });
  pagina = 1; pintarTabla();
}
export function abcOrdenar(k) { orden = orden.k === k ? { k, asc: !orden.asc } : { k, asc: k === 'rango' || k === 'cobertura' || k === 'codigo' }; pintarTabla(); }
export function abcPagina(p) { pagina = p; pintarTabla(); $('abcTabla').scrollIntoView({ block: 'start', behavior: 'smooth' }); }

/** Desde el Dashboard / buscador: abre ABC ya filtrado. */
export function abcPreparar(cambios) {
  Object.assign(filtro, { q: '', clase: '', estado: '', linea: '' }, cambios);
  $('abcQ').value = filtro.q; $('abcClase').value = filtro.clase; $('abcEstado').value = filtro.estado;
  pagina = 1;
}

export function exportarAbc() {
  const cols = [
    ['N.º', f => f.rango ?? '', true], ['Clase', f => f.clase], ['Código', f => f.codigo], ['Descripción', f => f.descripcion], ['Tipo', f => f.tipo], ['Línea', f => f.linea], ['UM', f => f.unidadMedida],
    ['Consumo mensual', f => f.consumoMes, true], ['Costo unitario US$', f => f.costoUsd, true], ['Consumo anual US$', f => f.valorAnual, true], ['% acumulado', f => (f.acumulado == null ? '' : f.acumulado * 100), true],
    ['Stock', f => f.stock, true], ['Stock US$', f => f.stockUsd, true], ['En camino', f => f.enCamino, true], ['Lead time (meses)', f => f.leadTime ?? '', true],
    ['Punto de reorden', f => f.puntoReorden, true], ['Cobertura (meses)', f => f.coberturaTotal ?? '', true], ['Situación', f => ETIQUETA_REORDEN[f.estado] || ''],
    ['Compra sugerida', f => f.compraSugerida, true], ['Compra sugerida US$', f => f.compraSugeridaUsd, true], ['Último proveedor', f => f.proveedorUltima], ['Última compra', f => f.fechaUltimaCompra]
  ];
  return { titulo: 'Materia prima - ABC y reorden', columnas: cols.map(([t, , num]) => ({ t, num: Boolean(num) })), filas: ordenadas(filtradas()).map(f => cols.map(([, g]) => g(f) ?? '')) };
}
