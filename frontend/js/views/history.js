import { $, esc } from '../utils/dom.js';
import { fechaCorta, horasEntre, corta, hoyISO, soles } from '../utils/format.js';
import { toast } from '../utils/toast.js';
import { DB, exportarExcel } from '../api/estado.js';
import { chipEstado, origenCorto, vehiculoHTML } from './presenters.js';
import { abrirModal, cerrarModal } from './dispatch.js';
import { subtabHistoricoActual } from '../state/historicoSubtab.js';

/**
 * Histórico de servicios: tabla filtrable y paginada, más exportación a Excel.
 */

/**
 * Filas por página. El histórico pasa de mil seiscientos servicios y crece
 * cada día: pintarlo entero en el DOM son ~30 000 celdas, y la tabla se
 * repinta cada vez que alguien cambia algo desde otra PC. Se pagina de a 20 en
 * vez de recortar a un tope fijo, para poder llegar a cualquier fila sin más
 * que ir pasando página. El Excel sí exporta todo, sin paginar.
 */
const FILAS_POR_PAGINA = 20;
let paginaActual = 1;

/** Repinta solo si la pestaña está a la vista, como hace el panel de indicadores. */
export function renderHistoricoSiVisible() {
  if ($('aHistorico').classList.contains('on') && subtabHistoricoActual() === 'listado') renderHistorico();
}

function listaFiltrada() {
  const q = ($('qHist').value || '').toLowerCase().trim();
  const ticket = ($('histTicket').value || '').toLowerCase().trim();
  const destino = ($('histDestino').value || '').toLowerCase().trim();
  const desde = $('histDesde').value || '';
  const hasta = $('histHasta').value || '';

  let lista = DB.solicitudes.slice().sort((a, b) => b.creado.localeCompare(a.creado));
  if (q) lista = lista.filter(s => (s.nombre + ' ' + s.dni).toLowerCase().includes(q));
  if (ticket) lista = lista.filter(s => s.id.toLowerCase().includes(ticket));
  if (destino) lista = lista.filter(s => (s.destino || '').toLowerCase().includes(destino));
  if (desde) lista = lista.filter(s => s.fechaProg >= desde);
  if (hasta) lista = lista.filter(s => s.fechaProg <= hasta);
  return lista;
}

/** Se llama desde los filtros: un filtro nuevo siempre vuelve a la página 1. */
export function filtrarHistorico() { paginaActual = 1; renderHistorico(); }

export function irPaginaHistorico(n) { paginaActual = n; renderHistorico(); }

export function limpiarFiltrosHistorico() {
  $('qHist').value = ''; $('histTicket').value = ''; $('histDestino').value = '';
  $('histDesde').value = ''; $('histHasta').value = '';
  filtrarHistorico();
}

/**
 * Métricas del histórico, recalculadas sobre lo que de verdad se está viendo:
 * si hay un filtro puesto, son las métricas DE ESE filtro, no del histórico
 * completo. Así "¿cuánto se gastó con esta persona?" o "¿cuántos viajes a
 * este destino?" se responde con el mismo filtro que ya se usa para buscar,
 * sin tener que sumarlo a mano fila por fila.
 */
function metricasHTML(lista, filtrado) {
  const conCosto = lista.filter(s => s.costo != null);
  const costoTotal = conCosto.reduce((a, s) => a + s.costo, 0);
  const cancelados = lista.filter(s => s.estado === 'Cancelado').length;
  const concluidos = lista.filter(s => s.estado === 'Concluido').length;
  const enCurso = lista.length - cancelados - concluidos;
  const tiempos = lista.filter(s => s.estado === 'Concluido')
    .map(s => horasEntre(s.tsEspera, s.tsConcluido)).filter(h => h != null);
  const promAtencion = tiempos.length ? tiempos.reduce((a, b) => a + b, 0) / tiempos.length : null;

  const tarjeta = (clase, v, k, d) => '<div class="kpi ' + clase + '"><div class="v">' + esc(String(v))
    + '</div><div class="k">' + esc(k) + '</div><div class="d">' + esc(d) + '</div></div>';

  return '<div class="kpis" id="histMetrics">'
    + tarjeta('primary', lista.length, 'Servicios', filtrado ? 'Según el filtro aplicado' : 'Todo el histórico')
    + tarjeta('ok', soles(costoTotal), 'Costo valorizado', conCosto.length + ' de ' + lista.length + ' con tarifa cargada')
    + tarjeta('', conCosto.length ? soles(costoTotal / conCosto.length) : 'N/D', 'Costo promedio', 'Por viaje con tarifa')
    + tarjeta('info', enCurso, 'En curso', concluidos + ' concluidos en el filtro')
    + tarjeta(cancelados ? 'bad' : '', cancelados, 'Cancelados',
        lista.length ? ((cancelados / lista.length) * 100).toFixed(1) + '% del filtro' : '—')
    + tarjeta('', promAtencion != null ? promAtencion.toFixed(1) + ' h' : 'N/D', 'Atención promedio', 'Del registro al cierre')
    + '</div>';
}

export function renderHistorico() {
  $('cntHist').textContent = DB.solicitudes.length;
  const lista = listaFiltrada();
  const hayFiltro = ['qHist', 'histTicket', 'histDestino', 'histDesde', 'histHasta'].some(id => $(id).value);
  $('histMetricsWrap').innerHTML = metricasHTML(lista, hayFiltro);

  if (!lista.length) {
    $('tHist').innerHTML = '<div class="empty"><strong>Sin coincidencias</strong>Prueba con otro filtro.</div>';
    return;
  }

  const totalPaginas = Math.max(1, Math.ceil(lista.length / FILAS_POR_PAGINA));
  if (paginaActual > totalPaginas) paginaActual = totalPaginas;
  const inicio = (paginaActual - 1) * FILAS_POR_PAGINA;
  const pagina = lista.slice(inicio, inicio + FILAS_POR_PAGINA);

  const filas = pagina.map(s => {
    const he = horasEntre(s.tsEspera, s.tsTransito);
    const ht = horasEntre(s.tsTransito, s.tsConcluido);
    return '<tr>'
      + '<td><span class="tk">' + s.id + '</span></td>'
      + '<td class="nowrap">' + fechaCorta(s.creado) + '</td>'
      + '<td class="cell-2">' + esc(corta(s.nombre, 20)) + '<span>' + esc(s.cargo || s.area) + '</span></td>'
      + '<td class="cell-2">' + s.tipo + '<span>' + esc(corta(s.servicio || '—', 18)) + '</span></td>'
      + '<td>' + esc(origenCorto(s)) + '</td>'
      + '<td>' + esc(corta(s.destino, 34)) + (s.paradas && s.paradas.length ? ' <span class="clip">+' + s.paradas.length + '</span>' : '') + '</td>'
      + '<td>' + vehiculoHTML(s.vehiculo, '<span class="muted">N/D</span>') + '</td>'
      + '<td class="num">' + (s.costo != null ? s.costo.toFixed(2) : '<span class="muted">N/D</span>') + '</td>'
      + '<td class="num">' + (he != null ? he.toFixed(1) : '<span class="muted">N/D</span>') + '</td>'
      + '<td class="num">' + (ht != null ? ht.toFixed(1) : '<span class="muted">N/D</span>') + '</td>'
      + '<td>' + chipEstado(s.estado) + '</td>'
      + '<td><button class="btn btn-sm btn-ghost" onclick="verDetalle(\'' + s.id + '\')">Ver</button></td>'
      + '</tr>';
  }).join('');

  $('tHist').innerHTML = '<table><thead><tr>'
    + '<th>Ticket</th><th>Registro</th><th>Solicitante</th><th>Servicio</th><th>Origen</th><th>Destino</th>'
    + '<th>Transporte</th><th class="num">Costo S/</th><th class="num">Espera h</th><th class="num">Tránsito h</th><th>Estado</th><th></th>'
    + '</tr></thead><tbody>' + filas + '</tbody></table>' + paginacionHTML(paginaActual, totalPaginas, lista.length, inicio);
}

function paginacionHTML(actual, total, totalFilas, inicio) {
  const hasta = Math.min(inicio + FILAS_POR_PAGINA, totalFilas);
  return '<div class="hist-paginacion">'
    + '<span class="muted small">Mostrando ' + (inicio + 1) + '–' + hasta + ' de ' + totalFilas + '</span>'
    + (total > 1
      ? '<div class="tools">'
        + '<button class="btn btn-sm btn-ghost"' + (actual <= 1 ? ' disabled' : '') + ' onclick="irPaginaHistorico(' + (actual - 1) + ')">‹ Anterior</button>'
        + '<span class="small">Página ' + actual + ' de ' + total + '</span>'
        + '<button class="btn btn-sm btn-ghost"' + (actual >= total ? ' disabled' : '') + ' onclick="irPaginaHistorico(' + (actual + 1) + ')">Siguiente ›</button>'
        + '</div>'
      : '')
    + '</div>';
}

/**
 * Reporte de viajes en Excel (columnas tipadas: fecha y número de verdad, no
 * texto) con rango de fechas a elección. Lo arma el servidor
 * (GET /api/solicitudes/exportar), así que hace falta pedir el rango antes de
 * descargar: por eso va en un modal y no es un botón directo como el CSV.
 */
export function abrirExportarExcel() {
  // Si ya hay un rango puesto en los filtros de la tabla, se ofrece igual acá:
  // lo más común es filtrar para MIRAR un rango y de una vez exportar ese mismo.
  const desde = $('histDesde').value || '';
  const hasta = $('histHasta').value || '';
  const html = '<p class="sub">Filtra por la fecha programada del viaje. Deja los campos vacíos para exportar todo el histórico.</p>'
    + '<div class="row">'
    + '<div class="field" style="margin:0"><label for="expDesde">Desde</label><input class="input" id="expDesde" type="date" value="' + desde + '"></div>'
    + '<div class="field" style="margin:0"><label for="expHasta">Hasta</label><input class="input" id="expHasta" type="date" value="' + hasta + '"></div>'
    + '</div>'
    + '<div class="err" id="eExportar"></div>'
    + '<button class="btn btn-sm" style="margin-top:14px" onclick="confirmarExportarExcel()">Descargar Excel</button>';
  abrirModal('Exportar viajes a Excel', html);
}

export async function confirmarExportarExcel() {
  const desde = $('expDesde').value || '';
  const hasta = $('expHasta').value || '';
  if (desde && hasta && desde > hasta) {
    $('eExportar').textContent = 'La fecha "desde" no puede ser posterior a "hasta".';
    $('eExportar').classList.add('on');
    return;
  }
  $('eExportar').classList.remove('on');

  let r;
  try {
    r = await exportarExcel(desde, hasta);
  } catch (e) {
    $('eExportar').textContent = e.message;
    $('eExportar').classList.add('on');
    return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(r.blob);
  a.download = r.nombre;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1500);
  cerrarModal();
  toast('Excel generado', 'Se descargó ' + r.nombre + '.');
}
