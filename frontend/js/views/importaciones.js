import { $, esc } from '../utils/dom.js';
import { fechaCorta, mesCorto, usd, usdCorto, entero, decimal, hoyISO } from '../utils/format.js';
import * as api from '../api/estado.js';
import { abrirModal } from './dispatch.js';
import { columnas, ranking, apilada } from '../ui/graficos.js';
import { esqueletoKpis, esqueletoTabla, esqueletoPanel } from '../ui/esqueleto.js';
import { sello, fechaSincronizacion } from '../ui/frescura.js';
import { rango, enRango, alCambiarPeriodo } from '../state/periodo.js';
import { ESTADOS, ENVIOS, PRIORIDADES } from '#shared/importaciones.js';

/**
 * Importaciones: seguimiento de cada OC importada, de la emisión a la
 * llegada a planta, con lo que un logístico necesita para moverla -qué está
 * atrasado, qué llega, qué hay que pagar y qué datos faltan-. Los datos son
 * del bot de logística (Mongo), copiados cada 30 minutos; se editan allá.
 *
 * Todo llega en una sola respuesta (~150 filas ya analizadas por
 * shared/importaciones.js): filtros, orden y paginación se resuelven aquí.
 */

const POR_PAGINA = 25;
let datos = null;
let pagina = 1;
let orden = { k: 'atraso', asc: false };
const filtro = { q: '', estado: 'curso', familia: '', envio: '', prioridad: '', atrasadas: false, periodo: false, mes: '' };

const CLASE_ESTADO = {
  COTIZACION_SOLICITADA: 'est-cot', ORDEN_CONFIRMADA: 'est-conf', EN_TRANSITO: 'est-trans',
  ARRIBADO: 'est-puerto', NACIONALIZADO: 'est-puerto', EN_PLANTA: 'est-planta', ANULADO: 'est-anul'
};
const CLASE_PRIORIDAD = { 'CRÍTICO': 'bad', URGENTE: 'bad', ALTA: 'warn', NORMAL: '', BAJA: 'muted' };
const ICONO_ENVIO = {
  MAR: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 17c1.5 1.2 3 1.2 4.5 0s3-1.2 4.5 0 3 1.2 4.5 0 3-1.2 4.5 0M5 14l-1-4h16l-2 4M8 10V6h6l2 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  AIRE: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.5 3.5c.6-.6 1.9-.4 2.3.4l1.7 5.6 5 2.4c.6.3.6 1.2 0 1.5l-5 1.6-1.7 5.6c-.4.8-1.7 1-2.3.4l.7-6.3-4.1-1.2-1.6 1.8H3.9l1.1-3.3-1.1-3.3h1.6l1.6 1.8 4.1-1.2z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
  TERRESTRE: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 7h11v9H2zM13 10h4l3 3v3h-7M6 19a2 2 0 1 0 0-.1M17 19a2 2 0 1 0 0-.1" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>'
};

const chip = (clase, texto, titulo = '') => '<span class="est ' + clase + '"' + (titulo ? ' title="' + esc(titulo) + '"' : '') + '>' + esc(texto) + '</span>';
const tarjeta = (clase, v, k, d, extra = '') => '<div class="kpi ' + clase + '"><div class="v">' + esc(String(v)) + '</div><div class="k">' + esc(k) + '</div><div class="d">' + d + '</div>' + extra + '</div>';
const variacion = (a, b, texto) => (!b ? '<span class="muted">sin ' + esc(texto) + ' para comparar</span>'
  : '<span class="' + (a >= b ? 'txt-ok' : 'txt-bad') + '">' + (a >= b ? '▲ ' : '▼ ') + decimal(Math.abs((a - b) / b * 100), 0) + '%</span> vs. ' + esc(texto));

function chipPago(i) {
  if (i.estadoPago === 'PAGADO') return chip('ok', 'Pagado');
  if (i.estadoPago === 'PARCIAL') return chip('warn', 'Pago parcial');
  if (i.estado === 'COTIZACION_SOLICITADA' || i.estado === 'ANULADO') return '';
  return chip('bad', 'Por pagar', i.vencFactura ? 'Vence el ' + fechaCorta(i.vencFactura) : i.vencFacturaTexto || 'Sin fecha de vencimiento');
}
function chipDocs(i) {
  if (i.estadoDocs === 'LIBERADO') return chip('ok', 'Liberado');
  if (i.estadoDocs === 'COMPLETO') return chip('ok', 'Docs completos');
  if (i.estadoDocs === 'EN_REVISION_ADUANAS') return chip('warn', 'En aduanas');
  if (i.estado === 'COTIZACION_SOLICITADA' || i.estado === 'ANULADO' || i.estado === 'EN_PLANTA') return '';
  return chip('warn', 'Docs pend.');
}

// ------------------------------------------------------------------ carga
export async function renderImportaciones() {
  $('impHero').innerHTML = esqueletoKpis(6);
  $('impCuerpo').innerHTML = esqueletoPanel() + esqueletoTabla(8, 7);
  try {
    const [d, sinc] = await Promise.all([api.listarImportaciones(), fechaSincronizacion()]);
    datos = d;
    $('impSello').innerHTML = sello(sinc, 'Copia del bot de logística (MongoDB)');
    poblarFiltros();
    pintar();
  } catch (e) {
    $('impHero').innerHTML = '';
    $('impCuerpo').innerHTML = '<div class="empty"><strong>No se pudieron cargar las importaciones</strong>' + esc(e.message) + '</div>';
  }
}

alCambiarPeriodo(() => { if (datos && $('aImportaciones').classList.contains('on')) pintar(); });

function poblarFiltros() {
  const opciones = (lista, actual, todas) => '<option value="">' + esc(todas) + '</option>' + lista.map(x => '<option' + (x === actual ? ' selected' : '') + '>' + esc(x) + '</option>').join('');
  const familias = [...new Set(datos.filas.map(i => i.familia).filter(Boolean))].sort();
  $('impFamilia').innerHTML = opciones(familias, filtro.familia, 'Toda familia');
  $('impEstado').innerHTML = '<option value="curso">En curso</option><option value="">Todas</option>'
    + ESTADOS.map(e => '<option value="' + e.k + '">' + esc(e.t) + '</option>').join('');
  $('impEstado').value = filtro.estado;
  $('impEnvio').innerHTML = '<option value="">Toda vía</option>' + Object.entries(ENVIOS).map(([k, t]) => '<option value="' + k + '">' + esc(t) + '</option>').join('') + '<option value="-">Sin definir</option>';
  $('impEnvio').value = filtro.envio;
  $('impPrioridad').innerHTML = opciones(PRIORIDADES, filtro.prioridad, 'Toda prioridad');
  // Lo que dejó preparado otra pantalla (Dashboard, buscador) se ve en los controles.
  $('impQ').value = filtro.q;
  $('impAtrasadas').checked = filtro.atrasadas;
  $('impPeriodo').checked = filtro.periodo;
}

// --------------------------------------------------------------- pintado
function pintar() {
  const r = datos.resumen, k = r.kpis, per = rango();
  const emitidas = datos.filas.filter(i => i.estado !== 'ANULADO' && i.oc && enRango(i.emision, per));
  const emitidasPrev = datos.filas.filter(i => i.estado !== 'ANULADO' && i.oc && enRango(i.emision, per.previo));
  const valor = xs => xs.reduce((a, i) => a + i.costoPlanta, 0);
  const lt = r.leadTime;

  $('impHero').innerHTML = [
    tarjeta('primary', usdCorto(k.valorEnCurso), 'En curso · puesto en planta', entero(k.enCurso) + ' OC: ' + entero(k.porEmbarcar) + ' por embarcar, ' + entero(k.enTransito) + ' en tránsito, ' + entero(k.enPuerto) + ' en puerto'),
    tarjeta(k.atrasadas ? 'bad' : 'ok', entero(k.atrasadas), 'Atrasadas', k.atrasadas ? usdCorto(k.valorAtrasado) + ' · atraso mediano ' + entero(k.atrasoMediano) + ' días' : 'Todas dentro de su fecha'),
    tarjeta('info', entero(k.llegan30), 'Llegan en 30 días', usdCorto(k.valorLlegan30) + ' a puerto o planta'),
    tarjeta(k.nPagosVencidos ? 'bad' : '', usdCorto(k.pagos30), 'Pagos en 30 días', k.nPagosVencidos ? esc(entero(k.nPagosVencidos) + ' vencidos: ' + usdCorto(k.pagosVencidos)) : 'Sin pagos vencidos'),
    tarjeta('', lt.todas == null ? '—' : entero(lt.todas) + ' días', 'Ciclo OC → planta', 'Mediana 12 meses · marítimo ' + (lt.MAR == null ? '—' : entero(lt.MAR) + ' d') + ' · aéreo ' + (lt.AIRE == null ? '—' : entero(lt.AIRE) + ' d')),
    tarjeta('', entero(emitidas.length), 'OC emitidas · ' + per.etiqueta, usdCorto(valor(emitidas)) + ' · ' + variacion(valor(emitidas), valor(emitidasPrev), per.previo.etiqueta))
  ].join('');

  const avisos = [];
  if (k.posiblesLlegadas) avisos.push(['warn', entero(k.posiblesLlegadas) + ' importación(es) figuran ATENDIDAS en el ERP pero siguen abiertas en el bot', 'Lo más probable es que ya llegaron: actualiza su estado en el bot. No se cuentan como atrasadas.', 'impFiltroRapido(\'posible\')']);
  if (k.sugerencias) avisos.push(['info', entero(k.sugerencias) + ' sugerencia(s) del rastreo automático sin revisar', 'La naviera o el courier reportan un avance que el bot todavía no aplicó.', 'impFiltroRapido(\'sugerencia\')']);
  if (k.completitud < 80) avisos.push(['warn', 'Datos de embarque completos al ' + k.completitud + '%', 'A las importaciones en curso les falta naviera, BL, país, incoterm o almacén. Sin esos datos no hay rastreo ni costo confiable.', 'impFiltroRapido(\'incompletas\')']);
  if (k.nPagosPorConfirmar) avisos.push(['', entero(k.nPagosPorConfirmar) + ' pago(s) vencidos hace más de 60 días, por confirmar', usdCorto(k.pagosPorConfirmar) + ' que casi seguro ya se pagaron y no se marcaron en el bot. No se suman a los pendientes.', 'impVerPorConfirmar()']);
  $('impAvisos').innerHTML = avisos.map(([c, t, d, fn]) => '<button class="aviso ' + c + '" onclick="' + fn + '"><b>' + esc(t) + '</b><span>' + esc(d) + '</span></button>').join('');

  const etapas = r.etapas.filter(e => e.k !== 'EN_PLANTA' && e.k !== 'COTIZACION_SOLICITADA');
  // Orden de la página: primero la tabla (lo que se trabaja), debajo los
  // gráficos que la resumen y al final pagos y proveedores.
  const graficos = '<div class="grid2">'
    + '<div class="panel"><h3>En curso por etapa</h3><p class="sub">Valor puesto en planta (sin IGV) de lo que ya tiene OC y no llega. Clic para filtrar la tabla.</p>'
    + ranking(etapas, {
      nombre: e => e.t, valor: e => e.valor, texto: e => usdCorto(e.valor), detalle: e => entero(e.n) + ' OC',
      tip: e => e.t + '\n' + entero(e.n) + ' importaciones\n' + usd(e.valor) + ' puesto en planta',
      clic: e => 'impFiltrarEstado(\'' + e.k + '\')'
    })
    + '<div style="margin-top:16px"><p class="sub" style="margin-bottom:8px">Vía de envío de lo que está en curso</p>'
    + apilada(r.porEnvio.map((x, i) => ({ t: x.k, v: x.valor, texto: usdCorto(x.valor) + ' · ' + x.n + ' OC', clase: 's' + (3 - Math.min(i, 2)) })))
    + '</div></div>'
    + '<div class="panel"><h3>Llegadas a planta por mes</h3><p class="sub">6 meses atrás (llegó) y 5 adelante (programado, más claro). Clic en un mes para ver sus importaciones.</p>'
    + columnas(r.meses, {
      etiqueta: m => mesCorto(m.mes), valor: m => m.valor, corto: v => usdCorto(v).replace('US$ ', ''),
      tenue: m => m.futuro,
      tip: m => mesCorto(m.mes) + (m.futuro ? ' · programado' : m.actual ? ' · mes en curso' : ' · llegó') + '\n' + entero(m.n) + ' importaciones\n' + usd(m.valor) + ' puesto en planta',
      clic: m => 'impFiltrarMes(\'' + m.mes + '\')', aria: 'Valor de llegadas a planta por mes'
    })
    + '</div></div>';

  $('impCuerpo').innerHTML = '<div class="panel imp-seguimiento"><div class="mp-cabecera"><div><h3>Seguimiento</h3><p class="sub" id="impResumenTabla"></p></div>'
    + '<div class="tools"><button class="btn btn-sm btn-ghost" onclick="impLimpiar()">Limpiar filtros</button></div></div>'
    + '<div id="impTabla"></div><div class="tools" id="impPaginacion" style="justify-content:center;margin-top:10px"></div></div>'

    + graficos

    + '<div class="grid2">'
    + '<div class="panel"><h3>Calendario de pagos</h3><p class="sub">Proveedor (vencimiento de factura), impuestos al nacionalizar y servicio logístico. Montos en US$.</p><div id="impPagos"></div></div>'
    + '<div class="panel"><h3>Proveedores con más valor en curso</h3><p class="sub">Clic para ver sus importaciones.</p>'
    + ranking(r.porProveedor, {
      nombre: x => x.k, valor: x => x.valor, texto: x => usdCorto(x.valor), detalle: x => x.n + ' OC',
      tip: x => x.k + '\n' + x.n + ' importaciones en curso\n' + usd(x.valor),
      clic: x => 'impBuscar(' + esc(JSON.stringify(x.k)) + ')'
    })
    + '<p class="sub" style="margin:16px 0 8px">Por familia</p>'
    + ranking(r.porFamilia, { nombre: x => x.k, valor: x => x.valor, texto: x => usdCorto(x.valor), detalle: x => x.n + ' OC', clic: x => 'impFiltrarFamilia(' + esc(JSON.stringify(x.k)) + ')' })
    + '</div></div>';

  pintarPagos();
  pintarTabla();
}

function pintarPagos() {
  const pagos = datos.resumen.pagos.filter(p => p.fecha && p.diasParaPago <= 56);
  const sinFecha = datos.resumen.pagos.filter(p => !p.fecha);
  if (!pagos.length && !sinFecha.length) { $('impPagos').innerHTML = '<div class="empty" style="padding:20px 0"><strong>Sin pagos pendientes</strong></div>'; return; }
  // Por semana: vencidos primero, luego cada semana de las próximas 8.
  const semanas = new Map();
  for (const p of pagos) {
    const s = p.vencido ? 'Vencidos' : p.diasParaPago < 7 ? 'Esta semana' : 'En ' + Math.floor(p.diasParaPago / 7) + ' semana' + (Math.floor(p.diasParaPago / 7) > 1 ? 's' : '');
    if (!semanas.has(s)) semanas.set(s, []);
    semanas.get(s).push(p);
  }
  $('impPagos').innerHTML = '<div class="pagos">' + [...semanas.entries()].map(([s, ps]) =>
    '<div class="pagos-sem"><div class="pagos-cab' + (s === 'Vencidos' ? ' bad' : '') + '"><b>' + esc(s) + '</b><span>' + usd(ps.reduce((a, p) => a + p.monto, 0)) + '</span></div>'
    + ps.map(p => '<button class="pago" onclick="impDetalle(\'' + esc(p.id) + '\')"><span class="pago-f">' + fechaCorta(p.fecha) + '</span>'
      + '<span class="pago-d"><b>' + esc(p.tipo) + (p.parcial ? ' (saldo)' : '') + '</b>' + esc((p.oc ? 'OC ' + p.oc + ' · ' : '') + p.proveedor) + '</span>'
      + '<span class="pago-m num">' + usd(p.monto) + '</span></button>').join('') + '</div>').join('') + '</div>'
    + (sinFecha.length ? '<p class="sub" style="margin:12px 0 0">' + entero(sinFecha.length) + ' pago(s) sin fecha por ' + usd(sinFecha.reduce((a, p) => a + p.monto, 0)) + ': falta el vencimiento de la factura en el bot.</p>' : '');
}

// ---------------------------------------------------------- tabla y filtros
const normal = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * Búsqueda por palabras, en cualquier orden: "hdpe montachem", "montachem
 * hdpe 4512" o "EBKG177" encuentran lo mismo. Cada palabra tiene que estar en
 * algún lado -OC, proveedor, descripción o ítems, código, BL/booking, naviera,
 * agente, país, almacén, comentarios-; sin tildes ni mayúsculas.
 */
const palabras = q => normal(q).split(/[\s,;]+/).filter(Boolean);
const textoBuscable = i => normal([
  i.oc, i.descripcion, i.proveedor, i.codigo, i.bl, i.naviera, i.agente, i.linea, i.familia, i.pais, i.incoterm,
  i.almacen, i.etiquetaEstado, i.comentarios, i.nota, ...i.items.flatMap(x => [x.codigo, x.descripcion])
].join(' '));

function filtradas() {
  const q = palabras(filtro.q), per = rango();
  return datos.filas.filter(i => {
    if (filtro.estado === 'curso' ? !i.enCurso : filtro.estado && i.estado !== filtro.estado) return false;
    if (filtro.familia && i.familia !== filtro.familia) return false;
    if (filtro.envio && (filtro.envio === '-' ? i.envio : i.envio !== filtro.envio)) return false;
    if (filtro.prioridad && i.prioridad !== filtro.prioridad) return false;
    if (filtro.atrasadas && !(i.atraso > 0)) return false;
    if (filtro.rapido === 'posible' && !i.posibleLlegada) return false;
    if (filtro.rapido === 'sugerencia' && !i.sugerencias.length) return false;
    if (filtro.rapido === 'incompletas' && !i.faltantes.length) return false;
    if (filtro.periodo && !enRango(i.emision, per)) return false;
    if (filtro.mes && ((i.enCurso ? i.planta || i.eta : i.llegada) || '').slice(0, 7) !== filtro.mes) return false;
    if (q.length) { const t = textoBuscable(i); if (!q.every(p => t.includes(p))) return false; }
    return true;
  });
}

const ORDENES = {
  atraso: i => i.atraso, costo: i => i.costoPlanta, emision: i => i.emision || '', proxima: i => i.proxima || i.llegada || '',
  oc: i => i.oc || '', prioridad: i => -PRIORIDADES.indexOf(i.prioridad)
};

function ordenadas(xs) {
  const f = ORDENES[orden.k];
  return [...xs].sort((a, b) => {
    const va = f(a), vb = f(b);
    const c = typeof va === 'number' ? va - vb : String(va).localeCompare(String(vb));
    return orden.asc ? c : -c;
  });
}

function fila(i) {
  const linea = (t, f, atraso, plan) => '<div class="tl-l' + (atraso ? ' tarde' : f && f <= hoyISO() ? ' ok' : '') + '"><span class="tl-i"></span><span class="tl-t">' + t + '</span><span class="tl-f">'
    + (f ? fechaCorta(f) : '<span class="muted">—</span>') + (atraso ? ' <b class="txt-bad">+' + atraso + 'd</b>' : '')
    + (plan && f && plan !== f ? ' <span class="muted" title="Fecha planificada">(plan ' + fechaCorta(plan) + ')</span>' : '') + '</span></div>';
  // Varias líneas en la OC: se ven las dos primeras (lo que identifica la
  // compra) y el resto en un "+N" con la lista en el tooltip.
  const multi = i.items.length > 1;
  const resto = i.items.slice(2);
  const producto = !multi ? '<b>' + esc(i.descripcion) + '</b>'
    : '<ul class="imp-items">' + i.items.slice(0, 2).map(x => '<li><b>' + esc(x.descripcion) + '</b>'
        + (x.cantidad ? '<small>' + entero(x.cantidad) + ' ' + esc((x.um || '').toLowerCase()) + '</small>' : '') + '</li>').join('')
      + (resto.length ? '<li class="imp-mas" data-tip="' + esc('Otros ' + resto.length + ' ítems\n' + resto.slice(0, 12).map(x => '· ' + x.descripcion).join('\n')
        + (resto.length > 12 ? '\n… y ' + (resto.length - 12) + ' más' : '')) + '"><span>+' + resto.length + '</span> ' + (resto.length === 1 ? 'ítem más' : 'ítems más') + '</li>' : '')
      + '</ul>';
  const items = multi ? i.items.length + ' ítems' : '';
  return '<tr class="mp-fila' + (i.atraso ? ' fila-alerta' : '') + '" onclick="impDetalle(\'' + esc(i.id) + '\')">'
    + '<td>' + chip(CLASE_PRIORIDAD[i.prioridad] ?? '', i.prioridad) + '</td>'
    + '<td><div class="est-pila">' + chip(CLASE_ESTADO[i.estado] || '', i.etiquetaEstado) + '<div>' + chipPago(i) + chipDocs(i) + '</div>'
    + (i.posibleLlegada ? '<div class="muted small">ERP: ' + esc(i.ocEstadoErp) + '</div>' : '') + '</div></td>'
    + '<td class="envio" title="' + esc(ENVIOS[i.envio] || 'Vía sin definir') + '">' + (ICONO_ENVIO[i.envio] || '<span class="muted">—</span>') + '</td>'
    + '<td class="tk">' + (i.oc ? esc(i.oc) : chip('est-cot', 'Solicitud')) + '</td>'
    + '<td class="imp-prod">' + producto + '<span>' + esc(i.proveedor || '—') + '</span>'
    + '<div class="imp-tags">' + [i.familia, i.linea, i.pais].filter(Boolean).map(t => '<em>' + esc(t) + '</em>').join('') + (items ? '<em>' + items + '</em>' : '')
    + (i.faltantes.length ? '<em class="falta" title="Falta: ' + esc(i.faltantes.join(', ')) + '">Faltan ' + i.faltantes.length + ' datos</em>' : '') + '</div></td>'
    + '<td class="num"><b>' + usd(i.costoPlanta) + '</b><div class="muted small">' + usd(i.valorUsd) + ' + ' + usd(i.servicioUsd) + (i.servicioEstimado ? ' est.' : '') + '</div>'
    + (i.porKg ? '<div class="muted small">' + usd(i.porKg, 3) + '/kg</div>' : '') + '</td>'
    + '<td class="tl">' + linea('Emisión', i.emision)
    + linea('Puerto', i.eta, i.atrasoPuerto, i.etaPlanificada)
    + linea('Planta', i.plantaReal || i.planta, i.atrasoPlanta, i.plantaPlanificada) + '</td>'
    + '</tr>';
}

function pintarTabla() {
  const xs = ordenadas(filtradas());
  const total = Math.max(1, Math.ceil(xs.length / POR_PAGINA));
  pagina = Math.min(pagina, total);
  const vista = xs.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA);
  const th = (k, t, num) => '<th' + (num ? ' class="num"' : '') + (k ? ' class="ordenable' + (num ? ' num' : '') + (orden.k === k ? ' on' : '') + '" onclick="impOrdenar(\'' + k + '\')"' : '') + '>'
    + esc(t) + (orden.k === k ? (orden.asc ? ' ▲' : ' ▼') : '') + '</th>';
  $('impResumenTabla').textContent = entero(xs.length) + ' importaciones · ' + usd(xs.reduce((a, i) => a + i.costoPlanta, 0)) + ' puesto en planta'
    + (filtro.mes ? ' · llegada en ' + mesCorto(filtro.mes) : '') + (filtro.periodo ? ' · emitidas en ' + rango().etiqueta.toLowerCase() : '');
  $('impTabla').innerHTML = !xs.length ? '<div class="empty"><strong>Ninguna importación con estos filtros</strong>Prueba con "Todas" en Etapa o limpia los filtros.</div>'
    : '<div class="table-wrap imp-tabla" data-exportar="exportarImportaciones"><table><thead><tr>'
      + th('prioridad', 'Prio') + th('', 'Estados') + th('', 'Vía') + th('oc', 'OC') + th('', 'Producto / proveedor')
      + th('costo', 'Costo puesto en planta', true) + th('proxima', 'Línea de tiempo')
      + '</tr></thead><tbody>' + vista.map(fila).join('') + '</tbody></table></div>';
  $('impPaginacion').innerHTML = total > 1
    ? '<button class="btn btn-sm btn-ghost" ' + (pagina <= 1 ? 'disabled' : 'onclick="impPagina(' + (pagina - 1) + ')"') + '>← Anterior</button>'
      + '<span class="muted small" style="align-self:center">Página ' + pagina + ' de ' + total + '</span>'
      + '<button class="btn btn-sm btn-ghost" ' + (pagina >= total ? 'disabled' : 'onclick="impPagina(' + (pagina + 1) + ')"') + '>Siguiente →</button>' : '';
}

function leerFiltros() {
  filtro.q = $('impQ').value;
  filtro.estado = $('impEstado').value;
  filtro.familia = $('impFamilia').value;
  filtro.envio = $('impEnvio').value;
  filtro.prioridad = $('impPrioridad').value;
  filtro.atrasadas = $('impAtrasadas').checked;
  filtro.periodo = $('impPeriodo').checked;
}

export function filtrarImportaciones() { if (!datos) return; leerFiltros(); filtro.rapido = ''; pagina = 1; pintarTabla(); }
export function impPagina(p) { pagina = p; pintarTabla(); $('impTabla').scrollIntoView({ block: 'start', behavior: 'smooth' }); }
export function impOrdenar(k) { orden = orden.k === k ? { k, asc: !orden.asc } : { k, asc: k === 'proxima' || k === 'oc' }; pintarTabla(); }

function aplicarYVer() {
  $('impQ').value = filtro.q; $('impEstado').value = filtro.estado; $('impFamilia').value = filtro.familia;
  $('impEnvio').value = filtro.envio; $('impPrioridad').value = filtro.prioridad;
  $('impAtrasadas').checked = filtro.atrasadas; $('impPeriodo').checked = filtro.periodo;
  pagina = 1;
  pintarTabla();
  $('impTabla').scrollIntoView({ block: 'start', behavior: 'smooth' });
}
export function impFiltrarEstado(k) { filtro.estado = k; filtro.mes = ''; aplicarYVer(); }
export function impFiltrarFamilia(f) { filtro.familia = f; aplicarYVer(); }
export function impFiltrarMes(m) { filtro.mes = filtro.mes === m ? '' : m; filtro.estado = ''; aplicarYVer(); }
export function impBuscar(q) { filtro.q = q; filtro.estado = ''; aplicarYVer(); }
export function impFiltroRapido(tipo) {
  Object.assign(filtro, { estado: 'curso', mes: '', atrasadas: false, rapido: tipo });
  aplicarYVer();
}
export function impLimpiar() {
  Object.assign(filtro, { q: '', estado: 'curso', familia: '', envio: '', prioridad: '', atrasadas: false, periodo: false, mes: '', rapido: '' });
  aplicarYVer();
}

/** Desde otra pantalla (Dashboard, buscador): abre Importaciones ya filtrada. */
export function impPreparar(cambios) {
  Object.assign(filtro, { q: '', estado: 'curso', familia: '', envio: '', prioridad: '', atrasadas: false, periodo: false, mes: '', rapido: '' }, cambios);
  pagina = 1;
}

export function impVerPorConfirmar() {
  const ps = datos.resumen.pagosPorConfirmar;
  abrirModal('Pagos por confirmar en el bot', '<p class="sub" style="margin-top:0">Vencidos hace más de 60 días y la importación ya está en planta o avanzada. Si ya se pagaron, márcalos como pagados en el bot y desaparecen de aquí.</p>'
    + '<div class="table-wrap"><table><thead><tr><th>Vencimiento</th><th>Concepto</th><th>OC</th><th>Proveedor</th><th class="num">Monto</th></tr></thead><tbody>'
    + ps.map(p => '<tr class="mp-fila" onclick="impDetalle(\'' + esc(p.id) + '\')"><td>' + fechaCorta(p.fecha) + '</td><td>' + esc(p.tipo) + '</td><td class="tk">' + esc(p.oc || '—') + '</td><td>' + esc(p.proveedor) + '</td><td class="num">' + usd(p.monto) + '</td></tr>').join('')
    + '</tbody></table></div>', { ancho: 'wide' });
}

/** Para la barra de la tabla: exporta TODO lo filtrado, no solo la página. */
export function exportarImportaciones() {
  const cols = [
    ['OC', i => i.oc || 'Solicitud'], ['Prioridad', i => i.prioridad], ['Etapa', i => i.etiquetaEstado], ['Pago', i => i.estadoPago], ['Documentos', i => i.estadoDocs],
    ['Producto', i => i.descripcion], ['Proveedor', i => i.proveedor], ['Familia', i => i.familia], ['Línea', i => i.linea], ['País', i => i.pais],
    ['Vía', i => ENVIOS[i.envio] || ''], ['Naviera / agente', i => i.naviera || i.agente], ['BL', i => i.bl], ['Incoterm', i => i.incoterm], ['Almacén destino', i => i.almacen],
    ['Cantidad', i => i.cantidad, true], ['UM', i => i.um], ['Valor compra US$', i => i.valorUsd, true], ['Servicio logístico US$', i => i.servicioUsd, true],
    ['Servicio estimado', i => (i.servicioEstimado ? 'Sí' : '')], ['Costo en planta US$', i => i.costoPlanta, true], ['US$/kg', i => i.porKg ?? '', true], ['IGV importación US$', i => i.impuestoUsd, true],
    ['Emisión', i => i.emision], ['ETD', i => i.etd], ['ETA', i => i.eta], ['Nacionalización', i => i.nacionalizacion], ['Llegada a planta', i => i.plantaReal || i.planta],
    ['Atraso (días)', i => i.atraso, true], ['Datos faltantes', i => i.faltantes.join(', ')]
  ];
  return {
    titulo: 'Importaciones',
    columnas: cols.map(([t, , num]) => ({ t, num: Boolean(num) })),
    filas: ordenadas(filtradas()).map(i => cols.map(([, f]) => f(i) ?? ''))
  };
}

// ---------------------------------------------------------------- detalle
const dato = (k, v) => '<div class="dato"><span>' + esc(k) + '</span><b>' + (v === '' || v == null ? '<span class="muted">—</span>' : v) + '</b></div>';

export async function impDetalle(id) {
  abrirModal('Importación', esqueletoKpis(3), { ancho: 'wide' });
  let i;
  try { i = await api.detalleImportacion(id); } catch (e) { $('modalBody').innerHTML = '<div class="empty"><strong>No se pudo abrir</strong>' + esc(e.message) + '</div>'; return; }
  $('modalTitle').textContent = (i.oc ? 'OC ' + i.oc : 'Solicitud') + ' · ' + i.descripcion;
  const hoy = hoyISO();
  const pasos = [
    ['Emisión', i.emision, ''], ['Zarpe (ETD)', i.etd, ''], ['Puerto (ETA)', i.eta, i.etaPlanificada],
    ['Nacionalización', i.nacionalizacion, ''], ['Planta', i.plantaReal || i.planta, i.plantaPlanificada]
  ];
  const orden = ['ORDEN_CONFIRMADA', 'EN_TRANSITO', 'ARRIBADO', 'NACIONALIZADO', 'EN_PLANTA'];
  const hecho = Math.max(0, orden.indexOf(i.estado)) + (i.estado === 'EN_PLANTA' ? 1 : 0);
  const linea = '<ol class="hitos">' + pasos.map(([t, f, plan], n) => {
    const cls = n < hecho || (n === 0 && i.emision) ? 'hecho' : f && f < hoy ? 'vencido' : '';
    return '<li class="' + cls + '"><i></i><b>' + esc(t) + '</b><span>' + (f ? fechaCorta(f) : 'Sin fecha') + '</span>'
      + (plan && plan !== f ? '<small>Plan: ' + fechaCorta(plan) + '</small>' : '') + '</li>';
  }).join('') + '</ol>';
  const avisos = [
    ...(i.atraso ? [['bad', 'Atrasada ' + i.atraso + ' días', i.atrasoPuerto ? 'La ETA a puerto venció y sigue sin arribar.' : 'La fecha de llegada a planta ya pasó.']] : []),
    ...(i.posibleLlegada ? [['warn', 'El ERP la da por ' + i.ocEstadoErp, 'Probablemente ya llegó: actualiza el estado en el bot.']] : []),
    ...i.sugerencias.map(s => ['info', 'Sugerencia del rastreo', s]),
    ...i.avisos.map(s => ['warn', 'Aviso de coherencia', s]),
    ...(i.faltantes.length ? [['warn', 'Faltan datos de embarque', i.faltantes.join(', ')]] : []),
    ...(i.revisionesEta > 2 ? [['', 'La fecha se movió ' + i.revisionesEta + ' veces', 'Revisa la confiabilidad del proveedor o del agente.']] : [])
  ];
  $('modalBody').innerHTML = '<div class="imp-det-cab">' + chip(CLASE_PRIORIDAD[i.prioridad] ?? '', i.prioridad) + chip(CLASE_ESTADO[i.estado] || '', i.etiquetaEstado) + chipPago(i) + chipDocs(i)
    + '<span class="muted small">Actualizado ' + esc(fechaCorta(i.actualizado)) + (i.actualizadoPor ? ' por ' + esc(i.actualizadoPor) : '') + '</span></div>'
    + linea
    + (avisos.length ? '<div class="avisos-det">' + avisos.map(([c, t, d]) => '<div class="aviso ' + c + '"><b>' + esc(t) + '</b><span>' + esc(d) + '</span></div>').join('') + '</div>' : '')
    + '<div class="grid3 det-grid">'
    + '<div class="panel"><h3>Costo puesto en planta</h3>'
    + dato('Valor de compra', usd(i.valorUsd, 2) + (i.moneda === 'PEN' ? ' <span class="muted">(en soles, TC ' + decimal(i.tc, 3) + ')</span>' : ''))
    + dato('Servicio logístico', usd(i.servicioUsd, 2) + (i.servicioEstimado ? ' <span class="muted" title="Sin cotización en el bot: se estima con el % típico de importaciones parecidas">estimado</span>' : ''))
    + dato('Total en planta (sin IGV)', '<span class="txt-strong">' + usd(i.costoPlanta, 2) + '</span>')
    + dato('Por kg', i.porKg ? usd(i.porKg, 3) : '')
    + dato('IGV de importación', usd(i.impuestoUsd, 2) + ' <span class="muted">· ' + esc(i.pagoImpuestos || 'sin estado') + '</span>')
    + '</div>'
    + '<div class="panel"><h3>Embarque</h3>'
    + dato('Vía', esc(ENVIOS[i.envio] || '')) + dato('País de origen', esc(i.pais)) + dato('Incoterm', esc(i.incoterm))
    + dato('Naviera', esc(i.naviera)) + dato('BL / booking', esc(i.bl)) + dato('Contenedores', i.contenedores ? entero(i.contenedores) : '')
    + dato('Agente logístico', esc(i.agente)) + dato('Almacén destino', esc(i.almacen))
    + '</div>'
    + '<div class="panel"><h3>Compra y pago</h3>'
    + dato('Proveedor', esc(i.proveedor)) + dato('Cantidad', i.cantidad ? entero(i.cantidad) + ' ' + esc(i.um) : '')
    + dato('Estado en el ERP', esc(i.ocEstadoErp)) + dato('Pago al proveedor', esc(i.estadoPago)) + dato('Tipo de pago', esc(i.tipoPago))
    + dato('Vence la factura', i.vencFactura ? fechaCorta(i.vencFactura) : esc(i.vencFacturaTexto))
    + dato('Pago del servicio logístico', i.pagoServLog ? fechaCorta(i.pagoServLog) : '')
    + '</div></div>'
    + (i.items.length ? '<h3 class="det-h">Ítems de la OC</h3><div class="table-wrap"><table><thead><tr><th>Código</th><th>Descripción</th><th class="num">Cantidad</th><th class="num">Costo unit.</th><th class="num">Valor</th></tr></thead><tbody>'
      + i.items.map(x => '<tr><td class="tk">' + esc(x.codigo) + '</td><td>' + esc(x.descripcion) + '</td><td class="num">' + entero(x.cantidad) + ' ' + esc(x.um) + '</td><td class="num">' + decimal(x.costoUnit, 3) + '</td><td class="num">' + usd(x.valor, 2) + '</td></tr>').join('')
      + '</tbody></table></div>' : '')
    + (i.eventos.length ? '<h3 class="det-h">Rastreo del transportista</h3><ul class="eventos">' + i.eventos.map(e => '<li><b>' + esc(fechaCorta(e.fecha.slice(0, 10))) + '</b> ' + esc(e.descripcion || e.hito)
      + '<span class="muted small"> · ' + esc([e.transportista, e.referencia, e.ubicacion].filter(Boolean).join(' · ')) + '</span></li>').join('') + '</ul>' : '')
    + (i.comentarios || i.nota ? '<h3 class="det-h">Comentarios</h3><p class="det-nota">' + esc([i.comentarios, i.nota].filter(Boolean).join('\n')) + '</p>' : '')
    + (i.historial.length ? '<details class="det-hist"><summary>Últimos cambios en el bot (' + i.historial.length + ')</summary><ul class="eventos">'
      + i.historial.map(h => '<li><b>' + esc(fechaCorta(h.fecha.slice(0, 10))) + '</b> ' + esc(h.campo) + (h.nuevo && h.nuevo.length < 80 ? ': ' + esc(h.anterior ? h.anterior + ' → ' : '') + esc(h.nuevo) : '')
        + '<span class="muted small"> · ' + esc(h.por) + (h.motivo ? ' · ' + esc(h.motivo) : '') + '</span></li>').join('') + '</ul></details>' : '');
}
