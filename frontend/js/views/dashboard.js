import { $, esc } from '../utils/dom.js';
import { soles, usd, usdCorto, entero, decimal, pct, fechaCorta, mesCorto, hoyISO } from '../utils/format.js';
import { toast } from '../utils/toast.js';
import * as api from '../api/estado.js';
import { DB } from '../api/estado.js';
import * as radar from '../api/radar.js';
import { columnas, ranking, apilada, sparkline } from '../ui/graficos.js';
import { esqueletoKpis, esqueletoPanel } from '../ui/esqueleto.js';
import { sello, fechaSincronizacion } from '../ui/frescura.js';
import { rango, enRango, alCambiarPeriodo } from '../state/periodo.js';
import { impPreparar } from './importaciones.js';
import { abcPreparar } from './abc.js';

/**
 * Dashboard: lo primero que ve admin al entrar. Tiene tres perfiles -cada uno
 * mira la operación desde su pregunta-:
 *   - Compras: qué importar, qué pedir, qué pagar.
 *   - Logística: qué llega, qué despachar, qué recibir.
 *   - Gerencia: cuánto capital hay en inventario y en tránsito, y cómo va el costo.
 * Arriba de cada uno: 4-6 indicadores con su meta y su tendencia; debajo,
 * "Acciones pendientes" (lo que alguien tiene que hacer hoy, con el atajo a
 * la pantalla ya filtrada) y los paneles por módulo.
 *
 * Los indicadores "de un lapso" (servicios, costo, OC emitidas) usan el
 * período global de la barra superior y se comparan con el período anterior
 * o con el mismo del año pasado. Compras, Requerimientos y Proveedores están
 * inhabilitadas (views/tabs.js) y no tienen panel.
 */

/** Metas de los indicadores: lo que se considera "bien". */
export const METAS = {
  atrasadas: 0,          // importaciones atrasadas
  claseAPorPedir: 0,     // materias primas clase A en o bajo el punto de reorden
  completitud: 90,       // % de datos de embarque llenos en el bot
  puntualidad: 85,       // % de importaciones que llegan a puerto hasta 3 días después de lo planificado
  pagosVencidos: 0
};

const PERFILES = [
  { k: 'compras', t: 'Compras' },
  { k: 'logistica', t: 'Logística' },
  { k: 'gerencia', t: 'Gerencia' }
];
let perfil = 'compras';
try { perfil = localStorage.getItem('plansa_perfil_dashboard') || perfil; } catch (_) { /* sin almacenamiento */ }
if (!PERFILES.some(p => p.k === perfil)) perfil = 'compras';

export function renderDashboardSiVisible() { if ($('aDashboard').classList.contains('on')) renderDashboard(); }
alCambiarPeriodo(() => renderDashboardSiVisible());

export function setPerfilDashboard(k) {
  perfil = k;
  try { localStorage.setItem('plansa_perfil_dashboard', k); } catch (_) { /* dura hasta recargar */ }
  return renderDashboard();
}

const variacionPct = (a, b) => (b ? (a - b) / Math.abs(b) * 100 : null);
const flecha = (d, texto, mejorSiSube = true) => (d == null ? '<span class="muted">sin ' + esc(texto) + '</span>'
  : '<span class="' + ((d >= 0) === mejorSiSube ? 'txt-ok' : 'txt-bad') + '">' + (d >= 0 ? '▲ ' : '▼ ') + decimal(Math.abs(d), 0) + '%</span> vs. ' + esc(texto));

/**
 * Tarjeta con meta y tendencia. `meta` = { texto, cumple } pinta una línea
 * "Meta: …" con ✓ / ✗ (nunca solo color); `spark` es una serie para la mini
 * línea de tendencia.
 */
function kpi({ tono = '', v, k, d = '', meta = null, spark = null, ir = '' }) {
  return '<div class="kpi kpi-pro ' + tono + (ir ? ' g-clic' : '') + '"' + (ir ? ' onclick="' + ir + '" role="button" tabindex="0" title="Ver detalle"' : '') + '>'
    + '<div class="kpi-top"><div class="v">' + esc(String(v)) + '</div>' + (spark ? sparkline(spark, { aria: 'Tendencia de ' + k }) : '') + '</div>'
    + '<div class="k">' + esc(k) + '</div><div class="d">' + d + '</div>'
    + (meta ? '<div class="kpi-meta ' + (meta.cumple ? 'ok' : 'bad') + '">' + (meta.cumple ? '✓' : '✗') + ' Meta: ' + esc(meta.texto) + '</div>' : '')
    + '</div>';
}
const tarjeta = (clase, v, k, d) => '<div class="kpi ' + clase + '"><div class="v">' + esc(String(v)) + '</div><div class="k">' + esc(k) + '</div><div class="d">' + esc(d) + '</div></div>';

function panel(titulo, tab, cuerpo, sub = '') {
  return '<div class="panel">'
    + '<div class="mp-cabecera" style="margin-bottom:12px"><div><h3 style="margin:0">' + esc(titulo) + '</h3>' + (sub ? '<p class="sub" style="margin:2px 0 0">' + sub + '</p>' : '') + '</div>'
    + (tab ? '<button class="btn btn-sm btn-ghost" onclick="tabAdmin(\'' + tab + '\')">Ver detalle →</button>' : '') + '</div>' + cuerpo + '</div>';
}

const contarPor = (lista, campo) => lista.reduce((m, x) => (m.set(x[campo], (m.get(x[campo]) || 0) + 1), m), new Map());
const sinDatos = texto => '<div class="empty" style="padding:14px 0"><strong>Sin datos</strong>' + esc(texto) + '</div>';

/** Cada módulo se pide por separado: si uno falla (p. ej. Radar sin datos), el resto del Dashboard igual se ve. */
async function pedir(fn, porDefecto) {
  try { return await fn(); } catch (_) { return porDefecto; }
}

/** Últimos 12 meses (incluido el actual) como 'YYYY-MM'. */
function ultimos12() {
  const h = hoyISO(), base = new Date(Date.UTC(Number(h.slice(0, 4)), Number(h.slice(5, 7)) - 1, 1));
  return Array.from({ length: 12 }, (_, i) => new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() - 11 + i, 1)).toISOString().slice(0, 7));
}

// --------------------------------------------------------- acciones pendientes
/**
 * Lo que alguien tiene que hacer, ordenado por gravedad. Cada acción dice
 * cuántos casos hay, por qué importa y lleva a la pantalla ya filtrada.
 */
function acciones(d) {
  const a = [];
  const k = d.imp?.resumen?.kpis;
  const add = (nivel, perfiles, n, titulo, detalle, ir) => { if (n) a.push({ nivel, perfiles, n, titulo, detalle, ir }); };
  if (k) {
    add(3, ['compras', 'logistica', 'gerencia'], k.atrasadas, 'Importaciones atrasadas', usdCorto(k.valorAtrasado) + ' comprometidos · atraso mediano ' + entero(k.atrasoMediano) + ' días', 'dashIr(\'imp-atrasadas\')');
    add(3, ['compras', 'gerencia'], k.nPagosVencidos, 'Pagos de importación vencidos', usd(k.pagosVencidos) + ' sin pagar después de su fecha', 'dashIr(\'imp-pagos\')');
    const pagos7 = d.imp.resumen.pagos.filter(p => p.fecha && p.diasParaPago >= 0 && p.diasParaPago <= 7);
    add(2, ['compras', 'gerencia'], pagos7.length, 'Pagos que vencen esta semana', usd(pagos7.reduce((s, p) => s + p.monto, 0)), 'dashIr(\'imp-pagos\')');
    const llegan7 = d.imp.filas.filter(i => i.enCurso && i.diasParaProxima != null && i.diasParaProxima >= 0 && i.diasParaProxima <= 7);
    add(2, ['logistica', 'compras'], llegan7.length, 'Llegadas de importación en 7 días', 'Coordinar agente, transporte y espacio en almacén: ' + llegan7.slice(0, 3).map(i => i.oc || i.descripcion).join(', '), 'dashIr(\'imp-llegan\')');
    add(1, ['compras', 'logistica'], k.posiblesLlegadas, 'Importaciones que el ERP ya recibió y siguen abiertas en el bot', 'Actualizar su estado en el bot', 'dashIr(\'imp-posible\')');
    add(1, ['compras', 'logistica'], k.sugerencias, 'Avances del rastreo sin revisar', 'La naviera o el courier reportan un cambio de estado', 'dashIr(\'imp-sugerencia\')');
    const incompletas = d.imp.filas.filter(i => i.faltantes.length).length;
    add(1, ['compras', 'logistica'], incompletas, 'Importaciones en curso con datos de embarque incompletos', 'Completitud ' + k.completitud + '% (meta ' + METAS.completitud + '%)', 'dashIr(\'imp-incompletas\')');
  }
  const r = d.abc?.resumen;
  if (r) {
    add(3, ['compras', 'gerencia'], r.pedirA, 'Materia prima clase A por pedir', 'Los códigos que más consumen ya están en su punto de reorden', 'dashIr(\'abc-pedirA\')');
    add(2, ['compras'], r.pedir - r.pedirA, 'Otras materias primas por pedir (B y C)', 'Compra sugerida total ' + usdCorto(r.compraSugeridaUsd), 'dashIr(\'abc-pedir\')');
  }
  add(1, ['compras', 'logistica'], d.muestras?.totalPendientes || 0, 'Muestras esperando evaluación', 'Materia prima recibida sin resultado de calidad', 'dashIr(\'muestras\')');
  add(1, ['compras'], d.porRevisar, 'Homologaciones por revisar', 'El grupo del Excel no cuadra con la categoría del código', 'dashIr(\'homologados\')');
  const enEspera = (DB.solicitudes || []).filter(s => s.estado === 'En espera').length;
  add(2, ['logistica'], enEspera, 'Servicios de mensajería en espera', 'Asignar vehículo y despachar', 'tabAdmin(\'bandeja\')');
  const autorizaciones = (DB.autorizaciones || []).filter(x => x.estado === 'Pendiente').length;
  add(1, ['logistica', 'gerencia'], autorizaciones, 'Autorizaciones de acceso pendientes', 'Personas que pidieron poder solicitar servicios', 'tabAdmin(\'padron\')');
  return a.sort((x, y) => y.nivel - x.nivel || y.n - x.n);
}

function pintarAcciones(lista) {
  if (!lista.length) return '<div class="acciones-vacio"><b>✓ Nada pendiente</b><span>No hay atrasos, pagos vencidos ni compras urgentes para este perfil.</span></div>';
  const NIVEL = { 3: ['bad', 'Urgente'], 2: ['warn', 'Esta semana'], 1: ['info', 'Revisar'] };
  return '<ul class="acciones">' + lista.map(x => '<li><button onclick="' + x.ir + '"><span class="acc-nivel ' + NIVEL[x.nivel][0] + '">' + NIVEL[x.nivel][1] + '</span>'
    + '<span class="acc-n num">' + entero(x.n) + '</span><span class="acc-t"><b>' + esc(x.titulo) + '</b><small>' + esc(x.detalle) + '</small></span><span class="acc-ir" aria-hidden="true">→</span></button></li>').join('') + '</ul>';
}

/** Atajos de "Acciones pendientes": abren la pantalla ya filtrada. */
export function dashIr(que) {
  const imp = c => { impPreparar(c); window.tabAdmin('importaciones'); };
  const mp = (sub, c) => { if (c) abcPreparar(c); window.tabAdmin('materiaPrima'); window.subtabMateriaPrima(sub); };
  ({
    'imp-atrasadas': () => imp({ estado: 'curso', atrasadas: true }),
    'imp-pagos': () => { imp({ estado: 'curso' }); setTimeout(() => $('impPagos') && $('impPagos').scrollIntoView({ behavior: 'smooth' }), 400); },
    'imp-llegan': () => imp({ estado: 'curso' }),
    'imp-posible': () => imp({ estado: 'curso', rapido: 'posible' }),
    'imp-sugerencia': () => imp({ estado: 'curso', rapido: 'sugerencia' }),
    'imp-incompletas': () => imp({ estado: 'curso', rapido: 'incompletas' }),
    'abc-pedirA': () => mp('abc', { clase: 'A', estado: 'pedir' }),
    'abc-pedir': () => mp('abc', { estado: 'pedir' }),
    muestras: () => mp('muestras'),
    homologados: () => mp('homologados')
  })[que]?.();
}

// ------------------------------------------------------------------ render
export async function renderDashboard() {
  $('dashPerfiles').innerHTML = PERFILES.map(p => '<button class="fchip' + (p.k === perfil ? ' on' : '') + '" onclick="setPerfilDashboard(\'' + p.k + '\')">' + esc(p.t) + '</button>').join('');
  $('dashboardHero').innerHTML = esqueletoKpis(6);
  $('dashboardBody').innerHTML = esqueletoPanel() + esqueletoPanel();
  const [stock, productos, rotacion, servicios, exportaciones, mp, homologados, muestras, nuevos, radarHist, radarPanel, imp, abc, sinc] = await Promise.all([
    pedir(() => api.resumenStockValorizadoGlobal(), null),
    pedir(() => api.resumenProductos({}), null),
    pedir(() => api.resumenRotacionProductos({}), {}),
    pedir(() => api.listarServiciosLogistica(), []),
    pedir(() => api.listarExportaciones(), []),
    pedir(() => api.resumenMateriaPrima('MATERIA PRIMA'), null),
    pedir(() => api.listarHomologados(), { filas: [] }),
    pedir(() => api.resumenMuestras(), null),
    pedir(() => api.codigosNuevosMateriaPrima(90), []),
    pedir(() => radar.historicoRadar({}), null),
    pedir(() => radar.panelRadar({}), null),
    pedir(() => api.listarImportaciones(), null),
    pedir(() => api.abcMateriaPrima(''), null),
    fechaSincronizacion()
  ]);
  $('dashSello').innerHTML = sello(sinc, 'Datos del ERP y del bot de logística');

  const per = rango();
  // Mensajería: mismo criterio que Indicadores (kpi.js). Un cancelado no se
  // ejecutó, no entra al valorizado.
  const todosLosServicios = DB.solicitudes || [];
  const ejecutados = todosLosServicios.filter(s => s.estado !== 'Cancelado');
  const delPeriodo = (xs, r) => xs.filter(s => enRango(s.creado, r));
  const servPer = delPeriodo(ejecutados, per), servPrev = delPeriodo(ejecutados, per.previo);
  const costo = xs => xs.filter(s => s.costo != null).reduce((a, s) => a + s.costo, 0);
  const meses = ultimos12();
  const porMes = (xs, f) => meses.map(m => f(xs.filter(s => (s.creado || '').slice(0, 7) === m)));
  const cancelados = todosLosServicios.filter(s => s.estado === 'Cancelado');
  const enCurso = ejecutados.filter(s => s.estado !== 'Concluido').length;

  const ho = homologados.filas || [];
  const aprobados = ho.filter(h => h.estado === 'Aprobado' || h.estado === 'Aprobado c/restricción').length;
  const porRevisar = ho.filter(h => h.coherencia === 'revisar').length;
  const rm = radarHist && radarHist.metrics;
  const rd = radarHist && radarHist.comparison ? radarHist.comparison.deltas : {};

  const k = imp && imp.resumen.kpis;
  const ra = abc && abc.resumen;
  const impMes = imp ? meses.map(m => imp.filas.filter(i => i.oc && (i.emision || '').slice(0, 7) === m && i.estado !== 'ANULADO').reduce((a, i) => a + i.costoPlanta, 0)) : null;
  const ocPer = imp ? imp.filas.filter(i => i.oc && i.estado !== 'ANULADO' && enRango(i.emision, per)) : [];
  const ocPrev = imp ? imp.filas.filter(i => i.oc && i.estado !== 'ANULADO' && enRango(i.emision, per.previo)) : [];
  const valor = xs => xs.reduce((a, i) => a + i.costoPlanta, 0);

  const radarTile = rm ? kpi({ tono: 'info', v: usdCorto(rm.fob_usd), k: 'Importaciones de plásticos (Perú)', d: flecha(rd.fob_usd, 'FOB 28 días previos'), ir: 'tabAdmin(\'radar\')' }) : '';
  const t = {
    impEnCurso: k ? kpi({ tono: 'primary', v: usdCorto(k.valorEnCurso), k: 'Importaciones en curso', d: entero(k.enCurso) + ' OC · puesto en planta sin IGV', spark: impMes, ir: 'tabAdmin(\'importaciones\')' }) : '',
    atrasadas: k ? kpi({ tono: k.atrasadas > METAS.atrasadas ? 'bad' : 'ok', v: entero(k.atrasadas), k: 'Importaciones atrasadas', d: k.atrasadas ? usdCorto(k.valorAtrasado) + ' comprometidos' : 'Todas a tiempo', meta: { texto: METAS.atrasadas + ' atrasadas', cumple: k.atrasadas <= METAS.atrasadas }, ir: 'dashIr(\'imp-atrasadas\')' }) : '',
    pedirA: ra && ra.codigos ? kpi({ tono: ra.pedirA > METAS.claseAPorPedir ? 'bad' : 'ok', v: entero(ra.pedirA), k: 'Clase A por pedir', d: entero(ra.clases[0].n) + ' códigos A = ' + pct(ra.clases[0].pct) + ' del consumo', meta: { texto: 'ninguna clase A bajo reorden', cumple: ra.pedirA <= METAS.claseAPorPedir }, ir: 'dashIr(\'abc-pedirA\')' }) : '',
    pagos: k ? kpi({ tono: k.nPagosVencidos ? 'bad' : '', v: usdCorto(k.pagos30), k: 'Pagos de importación en 30 días', d: k.nPagosVencidos ? entero(k.nPagosVencidos) + ' vencidos: ' + usdCorto(k.pagosVencidos) : 'Sin pagos vencidos', meta: { texto: 'sin pagos vencidos', cumple: k.nPagosVencidos <= METAS.pagosVencidos }, ir: 'dashIr(\'imp-pagos\')' }) : '',
    completitud: k ? kpi({ tono: k.completitud >= METAS.completitud ? 'ok' : 'warn', v: k.completitud + '%', k: 'Datos de embarque completos', d: 'Naviera, BL, país, incoterm y almacén en el bot', meta: { texto: '≥ ' + METAS.completitud + '%', cumple: k.completitud >= METAS.completitud }, ir: 'dashIr(\'imp-incompletas\')' }) : '',
    puntualidad: k && k.puntualidad != null ? kpi({ tono: k.puntualidad >= METAS.puntualidad ? 'ok' : 'warn', v: k.puntualidad + '%', k: 'Puntualidad de llegada a puerto', d: 'Hasta 3 días sobre la ETA planificada · ' + entero(k.nPuntualidad) + ' llegadas', meta: { texto: '≥ ' + METAS.puntualidad + '%', cumple: k.puntualidad >= METAS.puntualidad } }) : '',
    ocPeriodo: imp ? kpi({ v: usdCorto(valor(ocPer)), k: 'OC importadas · ' + per.etiqueta, d: entero(ocPer.length) + ' OC · ' + flecha(variacionPct(valor(ocPer), valor(ocPrev)), per.previo.etiqueta) }) : '',
    servicios: kpi({ tono: 'primary', v: entero(servPer.length), k: 'Servicios de mensajería · ' + per.etiqueta, d: flecha(variacionPct(servPer.length, servPrev.length), per.previo.etiqueta), spark: porMes(ejecutados, xs => xs.length), ir: 'tabAdmin(\'historico\')' }),
    costoMens: kpi({ v: soles(costo(servPer)), k: 'Costo de mensajería · ' + per.etiqueta, d: flecha(variacionPct(costo(servPer), costo(servPrev)), per.previo.etiqueta, false), spark: porMes(ejecutados, costo), ir: 'tabAdmin(\'historico\')' }),
    enCursoMens: kpi({ tono: 'info', v: entero(enCurso), k: 'Servicios en curso ahora', d: entero(ejecutados.filter(s => s.estado === 'En espera').length) + ' en espera de despacho', ir: 'tabAdmin(\'bandeja\')' }),
    llegan: k ? kpi({ tono: 'info', v: entero(k.llegan30), k: 'Llegadas de importación en 30 días', d: usdCorto(k.valorLlegan30) + ' a puerto o planta', ir: 'dashIr(\'imp-llegan\')' }) : '',
    muestras: muestras ? kpi({ v: entero(muestras.totalPendientes), k: 'Muestras por evaluar', d: entero(muestras.mesActual.muestras) + ' recibidas este mes', ir: 'dashIr(\'muestras\')' }) : '',
    inventario: stock ? kpi({ tono: 'primary', v: usdCorto(stock.valorizadoUsd), k: 'Inventario valorizado', d: entero(stock.productos) + ' SKU en ' + entero(stock.almacenes) + ' almacenes', ir: 'tabAdmin(\'almacen\')' }) : '',
    consumo: ra && ra.codigos ? kpi({ v: usdCorto(ra.valorAnual), k: 'Consumo anual de materia prima', d: entero(ra.clases[0].n) + ' códigos A concentran ' + pct(ra.clases[0].pct), ir: 'dashIr(\'abc-pedir\')' }) : '',
    inmovilizado: ra && ra.codigos ? kpi({ tono: 'warn', v: usdCorto(ra.excesoUsd + ra.inmovilizadoUsd), k: 'Capital inmovilizado en MP', d: usdCorto(ra.excesoUsd) + ' de exceso (> 8 meses) + ' + usdCorto(ra.inmovilizadoUsd) + ' sin consumo', ir: 'tabAdmin(\'materiaPrima\')' }) : ''
  };
  const HERO = {
    compras: [t.impEnCurso, t.atrasadas, t.pedirA, t.pagos, t.completitud, radarTile || t.puntualidad],
    logistica: [t.servicios, t.costoMens, t.enCursoMens, t.llegan, t.atrasadas, t.muestras],
    gerencia: [t.inventario, t.impEnCurso, t.consumo, t.inmovilizado, t.costoMens, radarTile || t.ocPeriodo]
  };
  $('dashboardHero').innerHTML = HERO[perfil].filter(Boolean).join('') || tarjeta('', '—', 'Sin datos todavía', 'Esperando la primera sincronización');

  const datos = { imp, abc, muestras, porRevisar };
  const acc = acciones(datos).filter(x => x.perfiles.includes(perfil));

  // ---- paneles por módulo
  const panelImportaciones = !imp ? '' : panel('Importaciones', 'importaciones',
    !imp.filas.length ? sinDatos(' Llegan con la sincronización del bot de logística.')
      : '<div class="grid2" style="margin-bottom:0"><div><p class="sub" style="margin:0 0 8px">En curso por etapa</p>'
        + ranking(imp.resumen.etapas.filter(e => e.k !== 'EN_PLANTA' && e.k !== 'COTIZACION_SOLICITADA'), {
          nombre: e => e.t, valor: e => e.valor, texto: e => usdCorto(e.valor), detalle: e => entero(e.n) + ' OC',
          tip: e => e.t + '\n' + entero(e.n) + ' importaciones\n' + usd(e.valor), clic: e => 'dashImpEtapa(\'' + e.k + '\')'
        }) + '</div>'
        + '<div><p class="sub" style="margin:0 0 8px">Llegadas a planta por mes (claro = programado)</p>'
        + columnas(imp.resumen.meses, {
          etiqueta: m => mesCorto(m.mes), valor: m => m.valor, corto: v => usdCorto(v).replace('US$ ', ''), tenue: m => m.futuro, alto: 170,
          tip: m => mesCorto(m.mes) + (m.futuro ? ' · programado' : '') + '\n' + entero(m.n) + ' importaciones\n' + usd(m.valor),
          clic: m => 'dashImpMes(\'' + m.mes + '\')', aria: 'Llegadas a planta por mes'
        }) + '</div></div>',
    'Ciclo OC → planta: ' + (imp.resumen.leadTime.todas == null ? '—' : entero(imp.resumen.leadTime.todas) + ' días (mediana)'));

  const proximas = imp ? imp.filas.filter(i => i.enCurso && i.diasParaProxima != null && i.diasParaProxima >= -3 && i.diasParaProxima <= 21)
    .sort((a, b) => a.diasParaProxima - b.diasParaProxima).slice(0, 8) : [];
  const panelLlegadas = !imp ? '' : panel('Próximas llegadas', 'importaciones',
    !proximas.length ? sinDatos(' Nada programado para las próximas 3 semanas.')
      : '<ul class="proximas">' + proximas.map(i => '<li><button onclick="impDetalle(\'' + esc(i.id) + '\')"><span class="prox-f"><b>' + esc(fechaCorta(i.proxima)) + '</b>'
        + (i.diasParaProxima < 0 ? '<em class="txt-bad">vencida</em>' : '<em>en ' + i.diasParaProxima + ' d</em>') + '</span>'
        + '<span class="prox-d"><b>' + esc(i.descripcion) + '</b><small>' + esc((i.oc ? 'OC ' + i.oc + ' · ' : '') + i.etiquetaEstado + (i.almacen ? ' → ' + i.almacen : ' · almacén sin definir')) + '</small></span>'
        + '<span class="num">' + usdCorto(i.costoPlanta) + '</span></button></li>').join('') + '</ul>',
    'A puerto o a planta en las próximas 3 semanas: para coordinar agente, transporte y espacio.');

  const panelAbc = !ra || !ra.codigos ? '' : panel('Materia prima · ABC y reorden', 'materiaPrima',
    apilada(ra.clases.map(c => ({
      t: 'Clase ' + c.clase, v: c.valorAnual, texto: pct(c.pct) + ' · ' + entero(c.n) + ' cód.', clase: { A: 's3', B: 's2', C: 's1' }[c.clase],
      tip: 'Clase ' + c.clase + '\n' + entero(c.n) + ' códigos · ' + usd(c.valorAnual) + ' al año\n' + entero(c.pedir) + ' por pedir', clic: 'dashIr(\'abc-pedir\')'
    })))
    + '<div class="kpis kpis-2" style="margin:14px 0 0">'
    + tarjeta(ra.pedirA ? 'bad' : 'ok', entero(ra.pedirA), 'Clase A por pedir', 'En o bajo su punto de reorden')
    + tarjeta(ra.pedir ? 'warn' : '', entero(ra.pedir), 'Por pedir (todas)', 'Compra sugerida ' + usdCorto(ra.compraSugeridaUsd))
    + tarjeta('', usdCorto(ra.excesoUsd), 'Exceso de stock', 'Más de 8 meses de cobertura')
    + tarjeta('', usdCorto(ra.inmovilizadoUsd), 'Sin consumo', entero(ra.inmovilizados) + ' códigos sin consumo en 12 meses')
    + '</div>', 'Clasificación por consumo valorizado anual: A = 80% del gasto.');

  const panelMensajeria = panel('Mensajería y despacho', 'historico',
    '<div class="kpis" style="margin-bottom:14px">'
    + tarjeta('primary', entero(servPer.length), 'Servicios · ' + per.etiqueta, entero(ejecutados.length) + ' en todo el histórico')
    + tarjeta('ok', soles(costo(servPer)), 'Costo · ' + per.etiqueta, soles(costo(ejecutados)) + ' en todo el histórico')
    + tarjeta('info', entero(enCurso), 'En curso', 'Aún no concluidos')
    + tarjeta(cancelados.length ? 'bad' : '', entero(cancelados.length), 'Cancelados', 'Fuera del valorizado')
    + '</div>'
    + columnas(meses.map(m => ({ m, n: ejecutados.filter(s => (s.creado || '').slice(0, 7) === m).length })), {
      etiqueta: x => mesCorto(x.m), valor: x => x.n, corto: v => entero(v), alto: 150,
      tip: x => mesCorto(x.m) + '\n' + entero(x.n) + ' servicios', aria: 'Servicios de mensajería por mes'
    }), 'Servicios por mes, últimos 12 meses.');

  const panelMp = panel('Materia prima', 'materiaPrima',
    '<div class="kpis" style="margin-bottom:0">'
    + (mp ? tarjeta('primary', usd(mp.valorizadoUsd), 'Stock de materia prima', entero(mp.productos) + ' SKU · ' + entero(mp.almacenes) + ' almacenes') : '')
    + tarjeta(nuevos.length ? 'info' : '', entero(nuevos.length), 'Códigos nuevos (90 días)', entero(nuevos.filter(n => n.stock > 0).length) + ' ya con stock')
    + tarjeta('ok', entero(aprobados), 'Homologados aprobados',
      entero(ho.filter(h => h.estado === 'Aprobado c/restricción').length) + ' con restricción · ' + entero(ho.length) + ' códigos')
    + tarjeta(porRevisar ? 'bad' : '', entero(porRevisar), 'Homologación por revisar', 'El grupo del Excel no cuadra con el código')
    + (muestras ? tarjeta('', entero(muestras.mesActual.muestras), 'Muestras este mes', entero(muestras.totalPendientes) + ' esperando evaluación') : '')
    + '</div>');

  const panelRadar = panel('Radar de Importaciones', 'radar', !rm ? sinDatos(' Todavía no hay bases SUNAT cargadas.')
    : '<p class="sub" style="margin:0 0 10px">Últimos 28 días con bases SUNAT (' + esc(fechaCorta(radarHist.current.start)) + ' a ' + esc(fechaCorta(radarHist.current.end))
      + ') frente a los 28 anteriores'
      + (radarHist.comparison.eligible ? '' : ' · sin comparación: ' + esc(radarHist.comparison.reasons.join('; ').toLowerCase())) + '.</p>'
    + '<div class="kpis" style="margin-bottom:14px">'
    + kpi({ tono: 'primary', v: usdCorto(rm.fob_usd), k: 'FOB importado', d: flecha(rd.fob_usd, 'período anterior') })
    + kpi({ tono: 'info', v: entero(Math.round(rm.tonnes || 0)) + ' t', k: 'Volumen', d: flecha(rd.tonnes, 'período anterior') })
    + kpi({ v: rm.usd_kg == null ? '—' : 'US$ ' + rm.usd_kg.toFixed(2) + '/kg', k: 'FOB por kg', d: flecha(rd.usd_kg, 'período anterior', false) })
    + kpi({ v: entero(rm.importers), k: 'Importadores', d: entero(rm.first_observed_importers) + ' aparecen por primera vez' })
    + '</div>'
    + (radarPanel ? '<div class="grid2" style="margin-bottom:0">'
      + '<div><p class="sub" style="margin:0 0 8px">FOB por material (todo lo cargado)</p>'
      + ranking(radarPanel.materials.slice(0, 6), { nombre: m => m.name || '(sin material)', valor: m => m.fob_usd || 0, texto: m => usdCorto(m.fob_usd) }) + '</div>'
      + '<div><p class="sub" style="margin:0 0 8px">Principales importadores</p>'
      + ranking(radarPanel.importers.slice(0, 6), { nombre: m => m.name || '(sin nombre)', valor: m => m.fob_usd || 0, texto: m => usdCorto(m.fob_usd) }) + '</div>'
      + '</div>' : ''));

  const panelAlmacen = panel('Almacén e inventario', 'almacen', !stock ? sinDatos(' Aún no llega la foto del ERP.')
    : '<div class="grid2" style="margin-bottom:0">'
    + '<div><p class="sub" style="margin:0 0 8px">Valorizado por tipo de producto</p>'
    + ranking(stock.porTipo, { nombre: x => x.tipoProducto || '(sin tipo)', valor: x => x.valorizadoUsd, texto: x => usdCorto(x.valorizadoUsd), detalle: x => entero(x.productos) + ' SKU' }) + '</div>'
    + '<div><p class="sub" style="margin:0 0 8px">Top almacenes por valorizado</p>'
    + ranking(stock.porAlmacen, { nombre: x => x.almacen, valor: x => x.valorizadoUsd, texto: x => usdCorto(x.valorizadoUsd) }) + '</div>'
    + '</div>', usd(stock.valorizadoUsd) + ' en ' + entero(stock.productos) + ' SKU y ' + entero(stock.almacenes) + ' almacenes.');

  const porEstadoServ = contarPor(servicios, 'estado');
  const porEstadoExp = contarPor(exportaciones, 'estado');
  const totalRotacion = (rotacion.a || 0) + (rotacion.b || 0) + (rotacion.c || 0);
  const panelProductos = panel('Productos (catálogo ERP)', 'productos', !productos ? sinDatos(' Aún no llega el catálogo del ERP.')
    : '<div class="kpis" style="margin-bottom:0">'
    + tarjeta('primary', entero(productos.productos), 'Catalogados', entero(productos.familias) + ' familias')
    + tarjeta('ok', entero(productos.conStock), 'Con stock', productos.productos ? pct(productos.conStock / productos.productos) + ' del catálogo' : '—')
    + tarjeta('', entero(rotacion.a), 'Clase A · alta rotación', 'Por frecuencia de compra')
    + tarjeta(rotacion.c ? 'bad' : '', entero(rotacion.c), 'Clase C · baja o sin rotación', totalRotacion ? pct((rotacion.c || 0) / totalRotacion) + ' del catálogo' : '—')
    + '</div>');
  const panelServicios = panel('Servicios y exportaciones', 'servicios',
    '<div class="kpis" style="margin-bottom:0">'
    + tarjeta('primary', entero(servicios.length), 'Servicios de logística', entero(porEstadoServ.get('En ejecución') || 0) + ' en ejecución')
    + tarjeta('ok', entero(porEstadoServ.get('Concluido') || 0), 'Concluidos', 'Servicios cerrados')
    + tarjeta('info', entero(exportaciones.length), 'Exportaciones', entero(porEstadoExp.get('En tránsito') || 0) + ' en tránsito')
    + tarjeta('', entero(porEstadoExp.get('Entregado') || 0), 'Entregadas', 'Exportaciones cerradas')
    + '</div>');
  const panelPayback = panel('Payback de la mensajería', 'payback',
    '<div class="empty" style="padding:10px 0"><strong>Tercerizar vs. motorizado propio</strong>Simulador de escenarios y recuperación de la inversión.</div>');

  const accionesHtml = '<div class="panel panel-acciones"><div class="mp-cabecera" style="margin-bottom:10px"><div><h3 style="margin:0">Acciones pendientes</h3>'
    + '<p class="sub" style="margin:2px 0 0">Lo que hay que resolver, de lo más urgente a lo menos. Clic para ir a la pantalla ya filtrada.</p></div></div>'
    + pintarAcciones(acc) + '</div>';

  const CUERPO = {
    compras: [accionesHtml, panelImportaciones, '<div class="grid2">' + panelAbc + panelLlegadas + '</div>', panelMp, panelRadar, panelProductos],
    logistica: [accionesHtml, '<div class="grid2">' + panelLlegadas + panelMensajeria + '</div>', panelImportaciones, panelAlmacen, panelServicios, panelMp, panelRadar],
    gerencia: [accionesHtml, panelImportaciones, '<div class="grid2">' + panelAbc + panelAlmacen + '</div>', panelMensajeria, panelMp, panelRadar, panelProductos, panelServicios, panelPayback]
  };
  $('dashboardBody').innerHTML = CUERPO[perfil].join('');
}

export function dashImpEtapa(k) { impPreparar({ estado: k }); window.tabAdmin('importaciones'); }
export function dashImpMes(m) { impPreparar({ estado: '', mes: m }); window.tabAdmin('importaciones'); }

// ---------------------------------------------------------- reporte semanal
export async function verReporteSemanal() {
  const boton = $('btnReporte');
  boton.classList.add('is-loading');
  try {
    const r = await api.reporteSemanal();
    const v = window.open('', '_blank');
    if (!v) return toast('El navegador bloqueó la ventana', 'Permite las ventanas emergentes de esta página para ver el reporte.', 'warn');
    v.document.write(r.html.replace('</body>', '<div style="position:fixed;top:12px;right:12px" class="no-print"><button onclick="window.print()" style="font:600 13px Segoe UI,Arial;padding:8px 14px;border-radius:8px;border:0;background:#1B4E8E;color:#fff;cursor:pointer">Guardar como PDF</button></div>'
      + '<style>@media print{.no-print{display:none}}</style></body>'));
    v.document.close();
    if (r.correo) toast('Reporte listo', 'También se envía solo por correo cada semana (ver REPORTE_PARA en .env).');
  } catch (e) {
    toast('No se pudo generar el reporte', e.message, 'bad');
  } finally {
    boton.classList.remove('is-loading');
  }
}
