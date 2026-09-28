import { $, esc } from '../utils/dom.js';
import { corta } from '../utils/format.js';
import * as api from '../api/estado.js';

/**
 * Proveedores: "¿cuánto le compramos a quién, desde cuándo y a qué precio?".
 *
 * Junta dos fuentes que miran la misma compra desde lados distintos:
 *   - Registro de compras (SUNAT): las facturas que el proveedor emitió y
 *     contabilidad registró. Es lo efectivamente FACTURADO.
 *   - Historial de Órdenes de Compra (ERP): lo que PLANSA le PIDIÓ al
 *     proveedor, ítem por ítem, con cantidad y costo unitario.
 * Una misma compra suele aparecer en ambas, así que acá se muestran lado a
 * lado y nunca se suman. El detalle fino (tablas, filtros) sigue viviendo en
 * sus pestañas: cada ficha tiene atajos con el proveedor ya elegido.
 *
 * Sin proveedor elegido se ve el panorama (ranking con participación y
 * concentración); con uno, su ficha. El buscador filtra la lista en el
 * navegador -son ~900 nombres- con sugerencias navegables con teclado.
 */
let proveedorActual = '';
let listaCache = null;      // [{ proveedor, ruc, comprobantes, ordenes, totalPen, totalUsd, totalEquivalente, ocEquivalente, primera, ultima }]
let sugerencias = [];       // índices de listaCache que se están mostrando
let sugerenciaActiva = -1;
let tokenRender = 0;

const MAX_SUGERENCIAS = 8;
const dec2 = { minimumFractionDigits: 2, maximumFractionDigits: 2 };
const soles = n => 'S/ ' + (Number(n) || 0).toLocaleString('es-PE', dec2);
const dolares = n => 'US$ ' + (Number(n) || 0).toLocaleString('es-PE', dec2);
const moneda = (n, m) => (m === 'USD' ? dolares(n) : soles(n));
const entero = n => (Number(n) || 0).toLocaleString('es-PE');
const pct = (n, d = 1) => (Number.isFinite(n) ? n : 0).toLocaleString('es-PE', { minimumFractionDigits: d, maximumFractionDigits: d }) + '%';
const simbolo = m => (m === 'USD' ? 'US$' : 'S/');

/** 1 234 567 -> "1,2 M"; 35 400 -> "35,4 k": para etiquetas dentro de un gráfico, donde no cabe el monto entero. */
function compacto(n) {
  const v = Math.abs(Number(n) || 0);
  if (v >= 1e6) return (n / 1e6).toLocaleString('es-PE', { maximumFractionDigits: 1 }) + ' M';
  if (v >= 1e3) return (n / 1e3).toLocaleString('es-PE', { maximumFractionDigits: 1 }) + ' k';
  return (Number(n) || 0).toLocaleString('es-PE', { maximumFractionDigits: v < 10 ? 2 : 0 });
}

/**
 * "2025-01-02" -> "02/01/2025" leyendo el texto, sin pasar por Date: con
 * new Date('2025-01-02') el navegador lo toma como medianoche UTC y en Lima
 * (UTC-5) se pinta el día anterior.
 */
const fechaDia = iso => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4) : '—');
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'set', 'oct', 'nov', 'dic'];
const nombreMes = mes => MESES[+mes.slice(5, 7) - 1] + ' ' + mes.slice(2, 4);
const mesHoy = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); };
const diasEntre = (a, b) => Math.round((Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10)) - Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10))) / 86400000);
const normalizar = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();

/** Todos los meses entre el primero y el último con datos (los que faltan, en cero): así se ve cuándo NO se compró. */
function rellenarMeses(filas) {
  const validas = filas.filter(f => f.mes && f.mes <= mesHoy()).sort((a, b) => (a.mes < b.mes ? -1 : 1));
  if (!validas.length) return [];
  const porMes = new Map(validas.map(f => [f.mes, f]));
  const out = [];
  let [a, m] = validas[0].mes.split('-').map(Number);
  const fin = validas[validas.length - 1].mes;
  for (let guard = 0; guard < 240; guard++) {
    const k = a + '-' + String(m).padStart(2, '0');
    out.push(porMes.get(k) || { mes: k, v: 0, n: 0 });
    if (k === fin) break;
    m++; if (m > 12) { m = 1; a++; }
  }
  return out;
}

/**
 * Columnas mensuales con el valor escrito: encima de cada barra si caben
 * (hasta 18 meses), y si no, solo en el máximo y en el último; el resto
 * aparece al pasar el mouse (CSS .prov-col:hover), además del <title> nativo.
 */
function columnas(meses, fmt, etiquetaConteo) {
  if (!meses.length) return '<div class="empty prov-empty"><strong>Sin movimiento</strong>No hay registros con fecha válida.</div>';
  const n = meses.length;
  const gl = 44, gr = 10; // margen para las etiquetas del eje y para que la última no se corte
  const W = Math.max(520, n * 24 + gl + gr), H = 220, pb = 24, pt = 22;
  const alto = H - pb - pt;
  const max = Math.max.apply(null, meses.map(m => m.v));
  if (!(max > 0)) return '<div class="empty prov-empty"><strong>Sin montos</strong>Hay registros en ' + n + (n === 1 ? ' mes' : ' meses') + ', pero todos valorizados en cero.</div>';
  const ancho = (W - gl - gr) / n;
  const barra = Math.max(4, Math.min(ancho - 5, 26));
  const iMax = meses.findIndex(m => m.v === max);
  const todas = n <= 18;
  let g = '';
  for (let i = 0; i <= 3; i++) {
    const y = pt + alto - alto * i / 3;
    g += '<line x1="' + gl + '" y1="' + y.toFixed(1) + '" x2="' + (W - gr) + '" y2="' + y.toFixed(1) + '" stroke="var(--chart-grid)" stroke-width="1"'
      + (i ? ' stroke-dasharray="3 4"' : '') + '/>';
    g += '<text x="' + (gl - 6) + '" y="' + (y + 3).toFixed(1) + '" class="prov-axis" text-anchor="end">' + esc(i ? compacto(max * i / 3) : '0') + '</text>';
  }
  const paso = Math.max(1, Math.ceil(n / 14));
  meses.forEach((m, i) => {
    const h = m.v ? Math.max(3, (m.v / max) * alto) : 0;
    const x = gl + i * ancho + (ancho - barra) / 2;
    const y = pt + alto - h;
    const fijo = m.v && (todas || i === iMax || i === n - 1);
    const tip = nombreMes(m.mes) + ': ' + fmt(m.v) + (etiquetaConteo && m.n ? ' · ' + m.n + ' ' + etiquetaConteo : '');
    g += '<g class="prov-col' + (fijo ? ' fijo' : '') + '"><title>' + esc(tip) + '</title>'
      + '<rect x="' + (gl + i * ancho).toFixed(1) + '" y="0" width="' + ancho.toFixed(1) + '" height="' + (H - pb) + '" fill="transparent"/>'
      + (h ? '<rect class="prov-col-bar" x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + barra.toFixed(1) + '" height="' + h.toFixed(1) + '" rx="3"/>' : '')
      + (m.v ? '<text class="prov-col-v" x="' + Math.min(x + barra / 2, W - gr - 16).toFixed(1) + '" y="' + (y - 5).toFixed(1) + '" text-anchor="middle">' + esc(compacto(m.v)) + '</text>' : '')
      + '</g>';
    if ((i % paso === 0 && n - 1 - i >= Math.max(2, paso * 0.75)) || i === n - 1)
      g += '<text x="' + (i === n - 1 && n > 1 ? x + barra : x + barra / 2).toFixed(1) + '" y="' + (H - 8) + '" class="prov-axis" text-anchor="' + (i === n - 1 && n > 1 ? 'end' : 'middle') + '">' + nombreMes(m.mes) + '</text>';
  });
  return '<div class="prov-chart"><svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" style="min-width:' + Math.round(W * 0.62) + 'px" role="img" aria-label="Gráfico mensual">' + g + '</svg></div>';
}

/** Mini-línea del costo unitario mes a mes de un ítem. */
function sparkline(serie, m) {
  const pts = serie.filter(s => s.costo > 0);
  if (pts.length < 2) return '<span class="muted small">—</span>';
  const W = 96, H = 26;
  const vals = pts.map(p => p.costo);
  const min = Math.min.apply(null, vals), max = Math.max.apply(null, vals);
  const rango = max - min || 1;
  const xy = pts.map((p, i) => [(i / (pts.length - 1)) * (W - 4) + 2, H - 3 - ((p.costo - min) / rango) * (H - 6)]);
  const tip = pts.map(p => nombreMes(p.mes) + ': ' + moneda(p.costo, m)).join('\n');
  const ult = xy[xy.length - 1];
  return '<svg class="prov-spark" viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '"><title>' + esc(tip) + '</title>'
    + '<polyline fill="none" stroke="var(--chart-1)" stroke-width="1.6" stroke-linejoin="round" points="' + xy.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ') + '"/>'
    + '<circle cx="' + ult[0].toFixed(1) + '" cy="' + ult[1].toFixed(1) + '" r="2.4" fill="var(--chart-1)"/></svg>';
}

export function renderProveedoresSiVisible() { if ($('aProveedores').classList.contains('on')) renderProveedores(); }

/** Une los dos padrones de proveedor -SUNAT y OC- por nombre (en esta data el mismo RUC siempre trae el mismo nombre en ambos). */
async function asegurarLista() {
  if (listaCache) return listaCache;
  const [sunat, oc] = await Promise.all([api.proveedoresOrdenesCompra(), api.todosLosProveedoresOC()]);
  const mapa = new Map();
  sunat.filter(p => p.proveedor).forEach(p => mapa.set(p.proveedor, {
    proveedor: p.proveedor, ruc: p.ruc || '', comprobantes: p.comprobantes || 0, ordenes: 0,
    totalPen: p.totalPen || 0, totalUsd: p.totalUsd || 0, totalEquivalente: p.totalEquivalente || 0, ocEquivalente: 0,
    primera: p.primera || null, ultima: p.ultima || null
  }));
  oc.filter(p => p.proveedor).forEach(p => {
    const e = mapa.get(p.proveedor) || {
      proveedor: p.proveedor, ruc: '', comprobantes: 0, ordenes: 0, totalPen: 0, totalUsd: 0,
      totalEquivalente: 0, ocEquivalente: 0, primera: null, ultima: null
    };
    e.ordenes = p.ordenes || 0;
    e.ocEquivalente = p.totalEquivalente || 0;
    if (!e.ruc) e.ruc = p.ruc || '';
    if (p.ultima && (!e.ultima || p.ultima > e.ultima)) e.ultima = p.ultima;
    mapa.set(p.proveedor, e);
  });
  listaCache = [...mapa.values()].sort((a, b) => (b.totalEquivalente + b.ocEquivalente) - (a.totalEquivalente + a.ocEquivalente));
  listaCache.forEach(p => { p._n = normalizar(p.proveedor); });
  return listaCache;
}

const indiceDe = nombre => (listaCache || []).findIndex(p => p.proveedor === nombre);

export async function renderProveedores() {
  const miToken = ++tokenRender;
  try {
    await asegurarLista();
    if (proveedorActual) await renderDetalleProveedor(proveedorActual, miToken);
    else await renderPanorama(miToken);
  } catch (e) {
    if (miToken === tokenRender) $('provCuerpo').innerHTML = '<div class="empty"><strong>No se pudo cargar</strong>' + esc(e.message) + '</div>';
  }
}

/** Por nombre (lo usan otros módulos y las pruebas). '' vuelve al panorama. */
export function elegirProveedorSeccion(proveedor) {
  proveedorActual = proveedor || '';
  cerrarSugerencias();
  if ($('provBuscar')) $('provBuscar').value = '';
  if (typeof scrollTo === 'function') scrollTo(0, 0);
  return renderProveedores();
}

/** Por índice en la lista: así el nombre nunca viaja dentro de un onclick="..." (comillas, &, etc.). */
export function elegirProveedorIndice(i) {
  const p = listaCache && listaCache[i];
  return elegirProveedorSeccion(p ? p.proveedor : '');
}

// ------------------------------------------------------------ buscador
function resaltar(texto, q) {
  const i = q ? texto.toUpperCase().indexOf(q.toUpperCase()) : -1;
  if (i < 0) return esc(texto);
  return esc(texto.slice(0, i)) + '<mark>' + esc(texto.slice(i, i + q.length)) + '</mark>' + esc(texto.slice(i + q.length));
}

/** Filtra en el navegador: coincide con el nombre (sin tildes) o con el RUC; primero los que EMPIEZAN con lo escrito. */
export async function buscarProveedorSeccion(texto) {
  await asegurarLista();
  const q = String(texto || '').trim();
  const qn = normalizar(q);
  let idx;
  if (!qn) idx = listaCache.map((_, i) => i).slice(0, MAX_SUGERENCIAS);
  else {
    const empieza = [], contiene = [];
    listaCache.forEach((p, i) => {
      const pos = p._n.indexOf(qn);
      if (pos === 0 || (p.ruc && p.ruc.startsWith(q))) empieza.push(i);
      else if (pos > 0 || (p.ruc && p.ruc.includes(q))) contiene.push(i);
    });
    idx = empieza.concat(contiene);
  }
  const total = idx.length;
  sugerencias = idx.slice(0, MAX_SUGERENCIAS);
  sugerenciaActiva = sugerencias.length ? 0 : -1;
  pintarSugerencias(q, total);
  return sugerencias.map(i => listaCache[i].proveedor);
}

function pintarSugerencias(q, total) {
  const caja = $('provSugerencias');
  if (!sugerencias.length) {
    caja.innerHTML = '<div class="prov-sug-vacio">Ningún proveedor coincide con «' + esc(q) + '». Prueba con parte del nombre o el RUC.</div>';
  } else {
    caja.innerHTML = (q ? '' : '<div class="prov-sug-cab">Los que más se compran</div>')
      + sugerencias.map((i, k) => {
        const p = listaCache[i];
        const meta = [p.ruc ? 'RUC ' + p.ruc : 'Sin RUC (extranjero)', p.comprobantes ? entero(p.comprobantes) + ' comp.' : '', p.ordenes ? entero(p.ordenes) + ' OC' : '']
          .filter(Boolean).join(' · ');
        const monto = p.totalEquivalente || p.ocEquivalente;
        return '<div class="prov-sug-item' + (k === sugerenciaActiva ? ' on' : '') + '" role="option" data-prov="' + esc(p.proveedor) + '"'
          + ' onmousedown="event.preventDefault();elegirProveedorIndice(' + i + ')">'
          + '<div class="prov-sug-nombre">' + resaltar(corta(p.proveedor, 60), q) + '<span>' + resaltar(meta, q) + '</span></div>'
          + '<div class="prov-sug-monto">' + esc(soles(monto)) + '<span>' + (p.totalEquivalente ? 'facturado' : 'en OC') + '</span></div>'
          + '</div>';
      }).join('')
      + (total > sugerencias.length ? '<div class="prov-sug-pie">' + entero(total - sugerencias.length) + ' más… sigue escribiendo para acotar</div>' : '');
  }
  caja.classList.add('on');
  $('provBuscar').setAttribute('aria-expanded', 'true');
}

function cerrarSugerencias() {
  const caja = $('provSugerencias');
  if (!caja) return;
  caja.classList.remove('on');
  if ($('provBuscar')) $('provBuscar').setAttribute('aria-expanded', 'false');
}

/** Al salir del campo: con una pausa corta, para no ganarle al clic en una sugerencia. */
export function cerrarSugerenciasProveedor() { setTimeout(cerrarSugerencias, 150); }

/** Flechas para moverse, Enter para abrir, Escape para cerrar. */
export function teclaProveedorSeccion(e) {
  const caja = $('provSugerencias');
  if (e.key === 'Escape') { cerrarSugerencias(); return; }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    if (!caja.classList.contains('on')) { buscarProveedorSeccion($('provBuscar').value); return; }
    if (!sugerencias.length) return;
    sugerenciaActiva = (sugerenciaActiva + (e.key === 'ArrowDown' ? 1 : -1) + sugerencias.length) % sugerencias.length;
    const items = caja.querySelectorAll('.prov-sug-item');
    items.forEach((el, k) => el.classList.toggle('on', k === sugerenciaActiva));
    if (items[sugerenciaActiva] && items[sugerenciaActiva].scrollIntoView) items[sugerenciaActiva].scrollIntoView({ block: 'nearest' });
    return;
  }
  if (e.key === 'Enter') {
    e.preventDefault();
    if (sugerenciaActiva >= 0 && sugerencias[sugerenciaActiva] != null) elegirProveedorIndice(sugerencias[sugerenciaActiva]);
  }
}

// ------------------------------------------------------------ panorama
const tarjeta = (clase, v, k, d, titulo) => '<div class="kpi ' + clase + '"' + (titulo ? ' title="' + esc(titulo) + '"' : '') + '><div class="v">' + esc(String(v))
  + '</div><div class="k">' + esc(k) + '</div><div class="d">' + esc(d) + '</div></div>';

/** Ranking con # de puesto, participación sobre el total y barra proporcional al primero. */
function ranking(filas, total, detalle) {
  if (!filas.length) return '<div class="empty prov-empty"><strong>Sin datos</strong></div>';
  const max = filas[0].v || 1;
  let acumulado = 0;
  return '<div class="prov-rank">' + filas.map((f, k) => {
    const share = total ? f.v / total * 100 : 0;
    acumulado += share;
    const i = indiceDe(f.proveedor);
    return '<button type="button" class="prov-rank-row" onclick="elegirProveedorIndice(' + i + ')" title="' + esc(f.proveedor + ' · acumulado ' + pct(acumulado)) + '">'
      + '<span class="prov-rank-n">' + (k + 1) + '</span>'
      + '<span class="prov-rank-nom">' + esc(corta(f.proveedor, 46)) + '<small>' + esc(detalle(f)) + '</small></span>'
      + '<span class="prov-rank-val">' + esc(soles(f.v)) + '<small>' + pct(share) + ' del total</small></span>'
      + '<span class="prov-rank-bar"><i style="width:' + Math.max(1.5, f.v / max * 100).toFixed(1) + '%"></i></span>'
      + '</button>';
  }).join('') + '</div>';
}

const montoMixto = p => [p.totalPen ? soles(p.totalPen) : '', p.totalUsd ? dolares(p.totalUsd) : ''].filter(Boolean).join(' + ') || soles(0);

async function renderPanorama(miToken) {
  const [resumenSunat, resumenOc, proveedoresOc] = await Promise.all([api.resumenOrdenesCompra({}), api.resumenOC({}), api.proveedoresOC({})]);
  if (miToken !== tokenRender) return;
  const conFactura = listaCache.filter(p => p.comprobantes > 0).sort((a, b) => b.totalEquivalente - a.totalEquivalente);
  const totalSunat = conFactura.reduce((a, p) => a + p.totalEquivalente, 0);
  const totalOc = proveedoresOc.reduce((a, p) => a + (p.totalEquivalente || 0), 0);
  const top5 = conFactura.slice(0, 5).reduce((a, p) => a + p.totalEquivalente, 0);
  const share5 = totalSunat ? top5 / totalSunat * 100 : 0;
  let acum = 0, para80 = 0;
  for (const p of conFactura) { acum += p.totalEquivalente; para80++; if (acum >= totalSunat * 0.8) break; }
  const hace12 = (() => { const d = new Date(); d.setFullYear(d.getFullYear() - 1); return d.toISOString().slice(0, 10); })();
  const activos = listaCache.filter(p => p.ultima && p.ultima >= hace12).length;
  const ambos = listaCache.filter(p => p.comprobantes && p.ordenes).length;
  const primeras = listaCache.map(p => p.primera).filter(Boolean).sort();
  const ultimas = listaCache.map(p => p.ultima).filter(Boolean).sort();
  const periodo = primeras.length ? fechaDia(primeras[0]) + ' – ' + fechaDia(ultimas[ultimas.length - 1]) : '—';

  $('provCuerpo').innerHTML = '<div class="prov-explica">'
    + '<div><b>Registro de compras (SUNAT)</b><span>Facturas que el proveedor nos emitió y contabilidad registró: lo <em>facturado</em>. Trae el total del comprobante, no el detalle de ítems.</span></div>'
    + '<div><b>Historial de Órdenes de Compra (ERP)</b><span>Lo que PLANSA le <em>pidió</em> al proveedor, ítem por ítem, con cantidad y costo unitario. De acá sale la evolución de precios.</span></div>'
    + '<div><b>¿Por qué no se suman?</b><span>Una misma compra suele estar en las dos (primero la OC, luego la factura). Se comparan lado a lado; los montos en US$ se llevan a soles solo para ordenar.</span></div>'
    + '</div>'

    + '<div class="kpis">'
    + tarjeta('primary', entero(conFactura.length), 'Proveedores con facturas', entero(listaCache.length) + ' en total · ' + entero(ambos) + ' con factura y OC')
    + tarjeta('ok', entero(activos), 'Activos (últimos 12 meses)', 'con alguna factura u OC desde ' + fechaDia(hace12))
    + tarjeta(share5 >= 50 ? 'bad' : 'info', pct(share5), 'Concentración top 5', para80 + ' proveedores explican el 80% de lo facturado',
      'Qué parte de lo facturado se llevan los 5 mayores proveedores. Más de 50% indica dependencia alta de pocos proveedores.')
    + tarjeta('', soles(totalSunat), 'Facturado (equivalente S/)', montoMixto({ totalPen: resumenSunat.pen.total, totalUsd: resumenSunat.usd.total }))
    + '</div>'
    + '<p class="prov-periodo">Período de los datos: <b>' + esc(periodo) + '</b> · ' + entero(resumenSunat.comprobantes) + ' comprobantes SUNAT y '
    + entero(resumenOc.ordenes) + ' órdenes de compra.</p>'

    + '<div class="grid2 prov-grid">'
    + '<div class="panel"><h3>Top proveedores por lo facturado (SUNAT)</h3>'
    + '<p class="sub">Participación sobre el total facturado. Clic en uno para ver su ficha.'
    + (conFactura[0] && /SUPERINTENDENCIA NACIONAL DE ADUANAS/i.test(conFactura[0].proveedor)
      ? ' El n.º 1 es SUNAT: son tributos y derechos de importación que el registro anota como comprobante, no un proveedor de bienes.' : '')
    + '</p>'
    + ranking(conFactura.slice(0, 10).map(p => ({ proveedor: p.proveedor, v: p.totalEquivalente, p })), totalSunat,
      f => montoMixto(f.p) + ' · ' + entero(f.p.comprobantes) + ' comp.')
    + '</div>'
    + '<div class="panel"><h3>Top proveedores por lo ordenado (OC)</h3>'
    + '<p class="sub">Participación sobre el total de las órdenes de compra del ERP.</p>'
    + ranking(proveedoresOc.slice(0, 10).map(p => ({ proveedor: p.proveedor, v: p.totalEquivalente || 0, p })), totalOc,
      f => montoMixto(f.p) + ' · ' + entero(f.p.ordenes) + ' OC')
    + '</div>'
    + '</div>';
}

// ------------------------------------------------------------ ficha
async function renderDetalleProveedor(proveedor, miToken) {
  $('provCuerpo').innerHTML = '<div class="empty"><strong>Cargando ficha…</strong></div>';
  const [sunat, ocHist, evolucion, mesesOc, perfil] = await Promise.all([
    api.resumenOrdenesCompra({ proveedor }),
    api.resumenOC({ proveedor }),
    api.evolucionProveedorCompra(proveedor),
    api.mesesOC({ proveedor }),
    api.perfilProveedor(proveedor)
  ]);
  if (miToken !== tokenRender) return;
  const ps = perfil.sunat, po = perfil.oc;
  const item = listaCache[indiceDe(proveedor)] || {};
  const ruc = ps.ruc || po.ruc || '';

  // Moneda principal: la de más comprobantes (un proveedor casi siempre factura en una sola).
  const monedaSunat = sunat.usd.comprobantes > sunat.pen.comprobantes ? 'USD' : 'PEN';
  const monedaOc = ocHist.usd.ordenes > ocHist.pen.ordenes ? 'USD' : 'PEN';
  const ticket = monedaSunat === 'USD' ? sunat.usd.ticketPromedio : sunat.pen.ticketPromedio;

  const fechas = [ps.primera, po.primera].filter(Boolean).sort();
  const ultimasF = [ps.ultima, po.ultima].filter(Boolean).sort();
  const primera = fechas[0] || null, ultima = ultimasF[ultimasF.length - 1] || null;
  const nCompras = sunat.comprobantes || ocHist.ordenes;
  const frecuencia = primera && ultima && nCompras > 1
    ? (() => { const d = diasEntre(primera, ultima) / (nCompras - 1); return d < 1 ? 'varias por día' : d < 1.5 ? 'casi a diario' : 'cada ~' + Math.round(d) + ' días'; })()
    : (nCompras === 1 ? 'una sola compra' : '—');
  const hace12 = (() => { const d = new Date(); d.setFullYear(d.getFullYear() - 1); return d.toISOString().slice(0, 10); })();
  const activo = ultima && ultima >= hace12;
  const iniciales = proveedor.replace(/[^A-Za-zÁÉÍÓÚÑ0-9 ]/g, '').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('') || '?';

  const dato = (k, v, d) => '<div class="prov-dato"><span>' + esc(k) + '</span><b>' + esc(v) + '</b>' + (d ? '<small>' + esc(d) + '</small>' : '') + '</div>';

  const facturadoMes = rellenarMeses(evolucion.filter(f => f.moneda === monedaSunat).map(f => ({ mes: f.mes, v: f.totalNeto, n: f.comprobantes })));
  const ocMes = rellenarMeses(mesesOc.map(m => ({ mes: m.mes, v: monedaOc === 'USD' ? m.totalUsd : m.totalPen, n: m.ordenes })));
  const otraMonedaSunat = sunat.pen.comprobantes && sunat.usd.comprobantes;
  const otraMonedaOc = ocHist.pen.ordenes && ocHist.usd.ordenes;

  const i = indiceDe(proveedor);
  $('provCuerpo').innerHTML = '<div class="prov-migas"><button type="button" class="btn btn-sm btn-ghost" onclick="elegirProveedorSeccion(\'\')">← Todos los proveedores</button>'
    + '<span class="muted small">Proveedores › ' + esc(corta(proveedor, 60)) + '</span></div>'

    + '<div class="panel prov-hero">'
    + '<div class="prov-hero-cab"><div class="prov-avatar" aria-hidden="true">' + esc(iniciales.toUpperCase()) + '</div>'
    + '<div class="prov-hero-nom"><h3>' + esc(proveedor) + '</h3>'
    + '<div class="prov-tags">' + (ruc ? '<span class="prov-tag">RUC ' + esc(ruc) + '</span>' : '<span class="prov-tag">Sin RUC · proveedor del exterior</span>')
    + '<span class="prov-tag ' + (activo ? 'ok' : 'off') + '">' + (activo ? 'Activo' : 'Sin compras en 12 meses') + '</span>'
    + (!sunat.comprobantes ? '<span class="prov-tag">Solo en OC</span>' : !ocHist.ordenes ? '<span class="prov-tag">Solo en SUNAT</span>' : '')
    + '</div></div>'
    + '<div class="prov-hero-acc">'
    + (sunat.comprobantes ? '<button type="button" class="btn btn-sm" onclick="irARegistroDeProveedor(' + i + ')">Ver sus comprobantes →</button>' : '')
    + (ocHist.ordenes ? '<button type="button" class="btn btn-sm btn-ghost" onclick="irAOCDeProveedor(' + i + ')">Ver sus órdenes de compra →</button>' : '')
    + '</div></div>'
    + '<div class="prov-datos">'
    + (sunat.comprobantes
      ? dato('Facturado en soles', soles(sunat.pen.total), entero(sunat.pen.comprobantes) + ' comprobantes')
        + dato('Facturado en dólares', dolares(sunat.usd.total), entero(sunat.usd.comprobantes) + ' comprobantes')
      : dato('Facturado (SUNAT)', '—', 'sin comprobantes en el registro') + dato('Ordenado en OC', montoMixto({ totalPen: ocHist.pen.total, totalUsd: ocHist.usd.total }), 'valor neto de sus OC'))
    + dato('Órdenes de compra', entero(ocHist.ordenes), entero(ocHist.items) + ' ítems · ' + montoMixto({ totalPen: ocHist.pen.total, totalUsd: ocHist.usd.total }))
    + dato('Ticket promedio', sunat.comprobantes ? moneda(ticket, monedaSunat) : '—', 'por comprobante en ' + simbolo(monedaSunat))
    + dato('Primera compra', fechaDia(primera), '')
    + dato('Última compra', fechaDia(ultima), ps.fechasFuturas ? ps.fechasFuturas + ' comprobante(s) con fecha futura, ignorados' : '')
    + dato('Frecuencia', frecuencia, (() => { const m = Math.max(ps.mesesActivos, po.mesesActivos); return entero(m) + (m === 1 ? ' mes' : ' meses') + ' con compras'; })())
    + dato('Participación', item.totalEquivalente && listaCache ? pct(item.totalEquivalente / listaCache.reduce((a, p) => a + p.totalEquivalente, 0) * 100, 2) : '—', 'de todo lo facturado')
    + '</div></div>'

    + '<div class="' + (sunat.comprobantes && ocHist.ordenes ? 'grid2 ' : '') + 'prov-grid prov-graficos">'
    + (!sunat.comprobantes ? '' : '<div class="panel"><h3>Facturado por mes · ' + simbolo(monedaSunat) + '</h3>'
    + '<p class="sub">Suma de los comprobantes SUNAT de cada mes' + (otraMonedaSunat ? ' (solo los emitidos en ' + simbolo(monedaSunat) + '; también factura en la otra moneda)' : '')
    + '. Los meses en blanco son meses sin compras. Pasa el mouse para ver el monto.</p>'
    + columnas(facturadoMes, v => moneda(v, monedaSunat), 'comp.') + '</div>')
    + (!ocHist.ordenes ? '' : '<div class="panel"><h3>Órdenes de compra por mes · ' + simbolo(monedaOc) + '</h3>'
    + '<p class="sub">Valor neto de las OC emitidas cada mes' + (otraMonedaOc ? ' (solo las OC en ' + simbolo(monedaOc) + ')' : '') + '.</p>'
    + columnas(ocMes, v => moneda(v, monedaOc), 'OC') + '</div>')
    + '</div>'

    + '<div class="panel"><h3>Qué se le compra y a qué precio</h3>'
    + '<p class="sub">Los ítems con más valor en sus órdenes de compra (sin OC anuladas). El costo promedio está ponderado por cantidad; la variación compara el último costo contra ese promedio. '
    + 'El registro SUNAT no detalla ítems, por eso esto sale solo del historial de OC.</p>'
    + tablaProductos(po.topProductos)
    + '</div>';
}

function tablaProductos(productos) {
  if (!productos || !productos.length) {
    return '<div class="empty prov-empty"><strong>Sin órdenes de compra con ítems</strong>Este proveedor solo aparece en el registro SUNAT, que no trae el detalle de lo comprado.</div>';
  }
  const filas = productos.map(p => {
    const varPct = p.ultimoCosto != null && p.costoPromedio ? (p.ultimoCosto - p.costoPromedio) / p.costoPromedio * 100 : null;
    const claseVar = varPct == null || Math.abs(varPct) < 1 ? 'muted' : varPct > 0 ? 'prov-sube' : 'prov-baja';
    return '<tr>'
      + '<td class="cell-2">' + esc(corta(p.descripcion || 'Sin descripción', 48)) + '<span>' + esc(p.codigo || '—') + ' · ' + entero(p.ordenes) + ' OC · ' + fechaDia(p.primera) + ' – ' + fechaDia(p.ultima) + '</span></td>'
      + '<td class="num">' + (Number(p.cantidad) || 0).toLocaleString('es-PE', { maximumFractionDigits: 2 }) + '</td>'
      + '<td class="num">' + moneda(p.total, p.moneda) + '</td>'
      + '<td class="num">' + moneda(p.costoPromedio, p.moneda) + '<span class="prov-rango">' + moneda(p.costoMin, p.moneda) + ' – ' + moneda(p.costoMax, p.moneda) + '</span></td>'
      + '<td class="num">' + (p.ultimoCosto != null ? moneda(p.ultimoCosto, p.moneda) : '—') + '</td>'
      + '<td class="num ' + claseVar + '">' + (varPct == null ? '—' : (varPct > 0 ? '▲ +' : varPct < 0 ? '▼ ' : '') + pct(varPct)) + '</td>'
      + '<td>' + (p.serie && p.serie.length ? sparkline(p.serie, p.moneda) : '<span class="muted small">—</span>') + '</td>'
      + '</tr>';
  }).join('');
  return '<div class="table-wrap prov-tabla"><table><thead><tr>'
    + '<th>Ítem</th><th class="num">Cantidad</th><th class="num">Total neto</th><th class="num">Costo unit. prom.</th><th class="num">Último costo</th><th class="num">Variación</th><th>Tendencia</th>'
    + '</tr></thead><tbody>' + filas + '</tbody></table></div>';
}

/** Atajos a las pestañas de detalle con el proveedor ya puesto como filtro. */
export function irARegistroDeProveedor(i) {
  const p = listaCache && listaCache[i];
  if (!p) return;
  window.tabAdmin('ordenesCompra');
  return window.elegirProveedorOrdenesCompra(p.proveedor);
}
export function irAOCDeProveedor(i) {
  const p = listaCache && listaCache[i];
  if (!p) return;
  window.tabAdmin('ordenesCompra');
  return window.elegirProveedorOC(p.proveedor);
}
