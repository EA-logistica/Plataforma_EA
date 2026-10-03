import { $, esc } from '../../utils/dom.js';
import { toast } from '../../utils/toast.js';
import * as api from '../../api/radar.js';
import { abrirModal, cerrarModal } from '../dispatch.js';
import { filtrosComunes, entero, fecha, vacio, tabla } from './comun.js';
import { pintarPanel } from './panel.js';
import { pintarHistorico, granoRadar } from './historico.js';
import { pintarExplorar, exportarExplorar, verSerie, guardarRevision, paginaExplorarRadar, reiniciarPaginaRadar } from './explorar.js';
import { pintarProductos, paginaProductosRadar, ordenProductosRadar, reiniciarProductosRadar } from './productos.js';
import { pintarEmpresas, filtrarEmpresas, elegirEmpresaRadar, buscarEmpresaPorNombre } from './empresas.js';

/**
 * Radar de Importaciones dentro de la plataforma: un apartado con cinco
 * pestañas (Panel general, Histórico, Explorar, Productos, Empresas) que leen
 * /api/radar/* -la misma PostgreSQL que el resto de la plataforma-. Los
 * filtros de la barra superior valen para todas las pestañas.
 */
const PESTANAS = { panel: 'riSubPanel', historico: 'riSubHistorico', explorar: 'riSubExplorar', productos: 'riSubProductos', empresas: 'riSubEmpresas' };
let pestana = 'panel';
let opciones = null;
let token = 0;
let busquedaEmpresa = '';

async function asegurarOpciones() {
  if (opciones) return;
  opciones = await api.opcionesRadar();
  $('riMaterial').innerHTML = '<option value="">Todos</option>' + opciones.materials.map(m => '<option>' + esc(m) + '</option>').join('');
  $('riOrigen').innerHTML = '<option value="">Todos</option>' + opciones.origins.map(m => '<option>' + esc(m) + '</option>').join('');
}

async function pintarEstado() {
  try {
    const e = await api.estadoRadar();
    const u = e.ultimaEjecucion;
    const ejecucion = u ? 'última carga ' + new Date(u.started_at).toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'short' })
      + ' (' + ({ completed: 'completada', failed: 'falló', running: 'en curso', queued: 'en cola' }[u.status] || u.status) + ')' : 'sin cargas todavía';
    $('riEstado').innerHTML = entero(e.series) + ' series de ' + entero(e.importers) + ' importadores · datos del ' + fecha(e.desde) + ' al ' + fecha(e.hasta)
      + ' · ' + esc(ejecucion) + (e.corriendo ? ' · <b>actualizando…</b>' : e.en_cola ? ' · ' + e.en_cola + ' en cola' : '')
      + (e.worker.activo ? '' : ' · <span class="txt-bad" title="' + esc(e.worker.motivo) + '">ETL detenido</span>');
  } catch (_) { /* el estado es informativo: si falla, la pestaña igual se pinta */ }
}

export async function renderRadar() {
  const mio = ++token;
  const cont = $('riCuerpo');
  Object.entries(PESTANAS).forEach(([k, id]) => $(id).classList.toggle('on', k === pestana));
  pintarEstado();
  try {
    await asegurarOpciones();
    if (mio !== token) return;
    const f = filtrosComunes();
    // Cada pestaña dibuja su propia barra; al cambiar de pestaña se vacía el contenedor.
    if (cont.dataset.pestana !== pestana) { cont.innerHTML = '<div class="empty cargando mp-empty"><strong>Cargando…</strong></div>'; cont.dataset.pestana = pestana; }
    if (pestana === 'panel') await pintarPanel(cont, f);
    else if (pestana === 'historico') await pintarHistorico(cont, f);
    else if (pestana === 'explorar') await pintarExplorar(cont, f, opciones);
    else if (pestana === 'productos') await pintarProductos(cont, f);
    else await pintarEmpresas(cont, f, busquedaEmpresa);
    busquedaEmpresa = '';
  } catch (e) {
    if (mio === token) cont.innerHTML = vacio('No se pudo cargar Radar', ' ' + e.message);
  }
}

export function subtabRadar(k) {
  if (pestana !== k) $('riCuerpo').innerHTML = '';
  pestana = k;
  return renderRadar();
}

export function filtrarRadar() { reiniciarPaginaRadar(); reiniciarProductosRadar(); return renderRadar(); }

export function limpiarFiltrosRadar() {
  ['riDesde', 'riHasta', 'riMaterial', 'riOrigen'].forEach(id => { $(id).value = ''; });
  $('riAlcance').value = 'plastics';
  return filtrarRadar();
}

// ------------------------------------------------------- acciones de pestañas
let espera = null;
const conPausa = fn => { clearTimeout(espera); espera = setTimeout(fn, 300); };

export function granoHistoricoRadar(g) { granoRadar(g); return renderRadar(); }
export function buscarExplorarRadar() { conPausa(() => { reiniciarPaginaRadar(); renderRadar(); }); }
export function irPaginaExplorarRadar(n) { paginaExplorarRadar(n); return renderRadar(); }
export function exportarExplorarRadar() { return exportarExplorar(filtrosComunes()); }
export const verSerieRadar = id => verSerie(id);
export const guardarRevisionRadar = id => guardarRevision(id, renderRadar);
export function buscarProductosRadar() { conPausa(() => { reiniciarProductosRadar(); renderRadar(); }); }
export function ordenarProductosRadar(o) { ordenProductosRadar(o); return renderRadar(); }
export function irPaginaProductosRadar(n) { paginaProductosRadar(n); return renderRadar(); }
export function filtrarEmpresasRadar() { filtrarEmpresas(); }
export function verEmpresaRadar(ruc) { elegirEmpresaRadar(ruc); return subtabRadar('empresas'); }
export function verEmpresaRadarPorNombre(nombre) { busquedaEmpresa = buscarEmpresaPorNombre(nombre); return subtabRadar('empresas'); }
export function cerrarEmpresaRadar() { elegirEmpresaRadar(null); $('riEmpresaFicha').innerHTML = ''; }

// --------------------------------------------------------- actualizar datos
const ESTADO_RUN = { completed: ['Completada', 'st-concluido'], failed: ['Falló', 'st-cancelado'], running: ['En curso', 'st-transito'], queued: ['En cola', 'st-espera'] };

/** Encolar una carga (bases semanales o consulta por RUC/subpartida) y ver las anteriores. */
export async function abrirActualizarRadar() {
  let c;
  try { c = await api.calidadRadar(); } catch (e) { toast('No se pudo abrir', e.message, 'bad'); return; }
  abrirModal('Actualizar datos de Radar',
    '<p class="card-note">El servidor actualiza solo cada día las últimas semanas publicadas por SUNAT. Desde aquí puedes pedir una carga ahora; '
    + 'la procesa el ETL en segundo plano y los datos aparecen en todas las pestañas al terminar.</p>'
    + '<div class="row"><div class="field"><label for="riTipoCarga">Qué cargar</label><select class="select" id="riTipoCarga" onchange="tipoCargaRadar()">'
    + '<option value="bulk">Bases semanales SUNAT (MA/MB)</option><option value="importer">Consulta por RUC</option><option value="hs">Consulta por subpartida</option></select></div>'
    + '<div class="field" id="riCampoSemanas"><label for="riSemanas">Semanas publicadas</label><input class="input" id="riSemanas" type="number" min="1" max="12" value="2"></div></div>'
    + '<div class="row" id="riCamposConsulta" style="display:none"><div class="field"><label for="riValor">RUC / subpartida</label><input class="input" id="riValor" inputmode="numeric" maxlength="11"></div>'
    + '<div class="field"><label for="riCDesde">Desde</label><input class="input" id="riCDesde" type="date"></div><div class="field"><label for="riCHasta">Hasta</label><input class="input" id="riCHasta" type="date"></div></div>'
    + '<label class="muted small"><input type="checkbox" id="riForzar"> Volver a descargar aunque ya esté (detecta rectificaciones)</label>'
    + '<div class="err" id="eRadarCarga"></div>'
    + '<div style="display:flex;gap:8px;margin:10px 0 18px"><button class="btn" onclick="confirmarActualizarRadar()">Encolar carga</button><button class="btn btn-ghost" onclick="cerrarModal()">Cerrar</button></div>'
    + '<h4>Ejecuciones recientes</h4>'
    + tabla(c.runs, [
      { t: 'Inicio', h: r => new Date(r.started_at).toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'short' }) },
      { t: 'Tipo', h: r => esc(r.kind === 'bulk' ? 'Bases ' + (r.parameters?.weeks || '') + ' sem.' : 'Consulta ' + (r.parameters?.value || '')) },
      { t: 'Estado', h: r => { const [t, cl] = ESTADO_RUN[r.status] || [r.status, '']; return '<span class="chip ' + cl + '">' + esc(t) + '</span>'
        + (r.status === 'failed' ? ' <button class="btn btn-sm btn-ghost" onclick="reanudarEjecucionRadar(\'' + esc(r.id) + '\')">Reanudar</button><div class="muted small">' + esc((r.error || '').slice(0, 140)) + '</div>' : ''); } }
    ], { vacia: 'Sin ejecuciones' })
    + '<p class="muted small">' + entero(c.artifacts.length) + ' archivos originales SUNAT guardados con su hash. ' + esc(c.scope) + ' ' + esc(c.supplier_note) + '</p>', { ancho: 'wide' });
}

export function tipoCargaRadar() {
  const bulk = $('riTipoCarga').value === 'bulk';
  $('riCampoSemanas').style.display = bulk ? '' : 'none';
  $('riCamposConsulta').style.display = bulk ? 'none' : '';
}

export async function confirmarActualizarRadar() {
  const tipo = $('riTipoCarga').value;
  const datos = tipo === 'bulk'
    ? { kind: 'bulk', weeks: Number($('riSemanas').value), force: $('riForzar').checked }
    : { kind: 'query', query_kind: tipo, value: $('riValor').value.trim(), start: $('riCDesde').value, end: $('riCHasta').value, force: $('riForzar').checked };
  try {
    await api.encolarRadar(datos);
  } catch (e) { $('eRadarCarga').textContent = e.message; $('eRadarCarga').classList.add('on'); return; }
  toast('Carga encolada', 'El ETL la procesa en segundo plano.');
  cerrarModal();
  pintarEstado();
}

export async function reanudarEjecucionRadar(id) {
  try { await api.reanudarRadar(id); toast('Ejecución reanudada', 'Vuelve a la cola.'); } catch (e) { toast('No se pudo reanudar', e.message, 'bad'); }
  abrirActualizarRadar();
}
