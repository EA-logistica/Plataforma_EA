import { $, esc } from '../utils/dom.js';
import { fechaHora, fechaCorta, horasEntre, corta, soles, isoDia, hoyISO } from '../utils/format.js';
import { toast } from '../utils/toast.js';
import * as api from '../api/estado.js';
import { DB } from '../api/estado.js';
import { sesion } from '../state/sessionState.js';
import { chipEstado, origenTexto, origenCorto, railHTML, oGuion, cancelacionHTML, iconoVehiculo, vehiculoHTML, paradasExtraHTML } from './presenters.js';
import { tarifaDe } from '#data/destinos.js';
import { adjuntosHTML, indicadorAdjuntos, refrescarAdjuntos } from './attachments.js';
import { renderKpiSiVisible } from './kpi.js';
import { MOTIVOS_CANCELACION } from '#shared/cancelacion.js';
// Import circular intencional: render.js también importa de este módulo.
// Es seguro porque renderTodo solo se invoca desde manejadores de eventos
// (avanzar), nunca durante la carga inicial de los módulos.
import { renderTodo } from '../render.js';

/**
 * Bandeja de despacho de logística: filtrado, asignación de transporte/tarifa,
 * avance de estado y modal de detalle/gestión de un ticket.
 */
let filtroBandeja = 'Activos';

export function buscar(id) { return DB.solicitudes.find(s => s.id === id); }

// "Activos" es lo que todavía puede pasar algo: ni concluido ni cancelado.
const esActivo = s => s.estado === 'En espera' || s.estado === 'En tránsito';

// La Bandeja es la cola de trabajo del día, no un archivo: un concluido o
// cancelado se ve acá el resto de ESE día (para confirmar que se cerró bien),
// y al día siguiente ya no aparece -para entonces vive en el Histórico, que
// es quien de verdad lo conserva-. Se compara por fecha LOCAL (isoDia lee
// getFullYear/Mes/Día, no UTC), para no perder por un rato un ticket cerrado
// de noche cuando UTC ya cruzó la medianoche y acá todavía no.
const mismoDia = iso => !!iso && isoDia(iso) === hoyISO();
const enBandejaHoy = s => {
  if (s.estado === 'Concluido') return mismoDia(s.tsConcluido);
  if (s.estado === 'Cancelado') return mismoDia(s.tsCancelado);
  return true;
};

export function renderBandeja() {
  const base = DB.solicitudes.filter(enBandejaHoy);
  const activos = base.filter(esActivo);
  $('cntBandeja').textContent = activos.length;

  // Sin "Todos" a propósito: ya se repite lo que se ve en el Histórico, y
  // acá el punto es la cola de trabajo del día, no un espejo de todo.
  const opciones = [
    ['Activos', 'En curso'],
    ['En espera', 'En espera'],
    ['En tránsito', 'En tránsito'],
    ['Concluido', 'Concluidos'],
    ['Cancelado', 'Cancelados']
  ];
  $('fBandeja').innerHTML = opciones.map(([k, l]) => {
    const n = k === 'Activos' ? activos.length : base.filter(s => s.estado === k).length;
    return '<button class="fchip' + (filtroBandeja === k ? ' on' : '') + '" onclick="setFiltroBandeja(\'' + k + '\')">' + l + ' (' + n + ')</button>';
  }).join('');

  let lista = base.slice();
  if (filtroBandeja === 'Activos') lista = lista.filter(esActivo);
  else lista = lista.filter(s => s.estado === filtroBandeja);
  const orden = { 'En espera': 0, 'En tránsito': 1, 'Concluido': 2, 'Cancelado': 3 };
  lista.sort((a, b) => (orden[a.estado] - orden[b.estado]) || (a.fechaProg + a.horaProg).localeCompare(b.fechaProg + b.horaProg));

  if (!lista.length) {
    $('tBandeja').innerHTML = '<div class="empty"><strong>No hay servicios en este filtro</strong>Cambia el filtro o espera nuevas solicitudes.</div>';
    return;
  }

  const filas = lista.map(s => {
    const bloqueado = s.estado === 'Concluido' || s.estado === 'Cancelado';
    const ref = tarifaDe(s.destino);
    return '<tr>'
      + '<td><span class="tk">' + s.id + '</span>' + indicadorAdjuntos(s.id)
      + '<div class="small muted">' + fechaHora(s.creado).slice(0, 10) + '</div></td>'
      + '<td class="cell-2">' + esc(corta(s.nombre, 22)) + '<span>' + esc(s.area) + '</span></td>'
      + '<td class="cell-2">' + s.tipo + '<span>' + esc(corta(s.servicio || '—', 24)) + '</span></td>'
      + '<td class="cell-2">' + esc(corta(s.destino, 38)) + (s.paradas && s.paradas.length ? ' <span class="clip">+' + s.paradas.length + '</span>' : '')
      + '<span>Desde ' + esc(origenCorto(s)) + ' · ' + esc(oGuion(s.contacto)) + ' · ' + esc(oGuion(s.telefono)) + '</span></td>'
      + '<td class="nowrap">' + fechaCorta(s.fechaProg) + '<div class="small muted">' + esc(oGuion(s.horaProg)) + '</div></td>'
      + '<td><div class="veh-pick">' + iconoVehiculo(s.vehiculo)
      + '<select class="mini-select" ' + (bloqueado ? 'disabled' : '') + ' onchange="setVehiculo(\'' + s.id + '\',this.value)">'
      + '<option value=""' + (!s.vehiculo ? ' selected' : '') + '>Sin asignar</option>'
      + '<option' + (s.vehiculo === 'Motorizado' ? ' selected' : '') + '>Motorizado</option>'
      + '<option' + (s.vehiculo === 'Carro' ? ' selected' : '') + '>Carro</option></select></div></td>'
      + '<td><input class="mini-input" type="number" min="0" step="0.5"'
      + ' placeholder="' + (ref ? ref.tarifa.toFixed(2) : '0.00') + '"'
      + (ref ? ' title="Tarifa habitual de este destino: ' + soles(ref.tarifa) + ' en ' + ref.viajes + ' viajes de 2026"' : '')
      + (bloqueado ? ' disabled' : '')
      + ' value="' + (s.costo != null ? s.costo : '') + '" onchange="setCosto(\'' + s.id + '\',this.value)"></td>'
      + '<td>' + chipEstado(s.estado) + '</td>'
      + '<td class="nowrap">' + accionesHTML(s) + '</td>'
      + '</tr>';
  }).join('');

  $('tBandeja').innerHTML = '<table><thead><tr>'
    + '<th>Ticket</th><th>Solicitante</th><th>Servicio</th><th>Destino</th><th>Programado</th>'
    + '<th>Transporte</th><th>Tarifa S/</th><th>Estado</th><th>Acciones</th>'
    + '</tr></thead><tbody>' + filas + '</tbody></table>';
}

function accionesHTML(s) {
  let b = '';
  if (s.estado === 'En espera') b += '<button class="btn btn-sm btn-info" onclick="avanzar(\'' + s.id + '\')">Pasar a tránsito</button> ';
  if (s.estado === 'En tránsito') b += '<button class="btn btn-sm btn-ok" onclick="avanzar(\'' + s.id + '\')">Finalizar</button> ';
  b += '<button class="btn btn-sm btn-ghost" onclick="verDetalle(\'' + s.id + '\')">Gestionar</button>';
  return b;
}

export function setFiltroBandeja(k) { filtroBandeja = k; renderBandeja(); }

export async function setVehiculo(id, v) {
  try {
    const s = await api.actualizarSolicitud(id, { vehiculo: v || null });
    toast('Transporte actualizado', s.id + ': ' + (s.vehiculo || 'sin asignar'));
  } catch (e) {
    toast('No se pudo actualizar', e.message, 'bad');
    renderBandeja();
  }
}

export async function setCosto(id, v) {
  const n = parseFloat(v);
  try {
    const s = await api.actualizarSolicitud(id, { costo: isNaN(n) ? null : n });
    toast('Tarifa actualizada', s.id + ': ' + (s.costo != null ? soles(s.costo) : 'sin tarifa'));
    renderKpiSiVisible();
  } catch (e) {
    toast('No se pudo actualizar', e.message, 'bad');
    renderBandeja();
  }
}

export async function avanzar(id) {
  // Las condiciones (transporte para salir, tarifa para cerrar) las impone el
  // servidor; aquí solo se muestra lo que responda.
  try {
    const s = await api.avanzarSolicitud(id);
    if (s.estado === 'En tránsito') toast(s.id + ' en tránsito', 'El conductor está en ruta.');
    else toast(s.id + ' concluido', 'La data pasó al módulo de indicadores.');
  } catch (e) {
    toast('No se pudo avanzar', e.message, e.status === 409 ? 'warn' : 'bad');
    return;
  }
  renderTodo();
}

export function verDetalle(id) {
  const s = buscar(id); if (!s) return;
  const he = horasEntre(s.tsEspera, s.tsTransito);
  const ht = horasEntre(s.tsTransito, s.tsConcluido);
  const admin = sesion && sesion.tipo === 'admin';
  const ref = tarifaDe(s.destino);
  // Lo que se pagó históricamente por ir a ese destino, para no tarifar a ciegas.
  const referencia = ref
    ? '<div class="hint" style="margin-top:10px">Tarifa habitual de este destino: <b>' + soles(ref.tarifa) + '</b>'
      + ' · ' + ref.viajes + ' viajes en 2026, entre ' + soles(ref.min) + ' y ' + soles(ref.max) + '. '
      + '<button class="btn btn-sm btn-ghost" onclick="setCosto(\'' + s.id + '\',' + ref.tarifa + ');verDetalle(\'' + s.id + '\')">Aplicar</button></div>'
    : '<div class="hint" style="margin-top:10px">Destino sin historial de tarifas: no está entre los habituales de 2026.</div>';
  const terminado = s.estado === 'Concluido' || s.estado === 'Cancelado';
  let gestion = '';
  if (admin && !terminado) {
    const sel = v => (s.vehiculo === v ? ' selected' : '');
    gestion = '<div class="card card-pad" style="background:var(--surface2);margin-bottom:18px">'
      + '<div class="row">'
      + '<div class="field" style="margin:0"><label>Tipo de transporte</label>'
      + '<div class="veh-pick">' + iconoVehiculo(s.vehiculo)
      + '<select class="select" onchange="setVehiculo(\'' + s.id + '\',this.value);verDetalle(\'' + s.id + '\')">'
      + '<option value=""' + (s.vehiculo ? '' : ' selected') + '>Sin asignar</option>'
      + '<option' + sel('Motorizado') + '>Motorizado</option><option' + sel('Carro') + '>Carro</option></select></div></div>'
      + '<div class="field" style="margin:0"><label>Tarifa del servicio (S/)</label>'
      + '<input class="input" type="number" min="0" step="0.5" placeholder="0.00" value="' + (s.costo != null ? s.costo : '') + '"'
      + ' onchange="setCosto(\'' + s.id + '\',this.value);verDetalle(\'' + s.id + '\')"></div></div>'
      + referencia
      + '<div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap">'
      + (s.estado === 'En espera'
        ? '<button class="btn btn-sm btn-info" onclick="avanzar(\'' + s.id + '\');verDetalle(\'' + s.id + '\')">Pasar a en tránsito</button>'
        : '<button class="btn btn-sm btn-ok" onclick="avanzar(\'' + s.id + '\');verDetalle(\'' + s.id + '\')">Marcar como concluido</button>')
      + '<button class="btn btn-sm btn-ghost" onclick="abrirCancelarSolicitud(\'' + s.id + '\')">Cancelar servicio</button>'
      + '</div></div>';
  }
  const html = gestion + (terminado && s.estado === 'Cancelado' ? cancelacionHTML(s) : railHTML(s))
    + '<dl class="detail-grid">'
    + '<dt>Estado</dt><dd>' + chipEstado(s.estado) + '</dd>'
    + '<dt>Solicitante</dt><dd>' + esc(s.nombre) + (s.dni ? ' · DNI ' + esc(s.dni) : '') + '<br><span class="muted small">' + esc(oGuion(s.area)) + '</span></dd>'
    + '<dt>Acción</dt><dd>' + s.tipo + '</dd>'
    + '<dt>Tipo de servicio</dt><dd>' + esc(s.servicio || 'N/D') + '</dd>'
    + '<dt>Motivo</dt><dd>' + esc(oGuion(s.motivo)) + '</dd>'
    + '<dt>Origen</dt><dd>' + esc(origenTexto(s)) + '</dd>'
    + '<dt>Destino</dt><dd>' + esc(s.destino) + (s.paradas && s.paradas.length
        ? ' <span class="muted small">+' + s.paradas.length + ' parada' + (s.paradas.length > 1 ? 's' : '') + '</span>' : '') + '</dd>'
    + '<dt>Recibe</dt><dd>' + esc(oGuion(s.contacto)) + ' · ' + esc(oGuion(s.telefono)) + '</dd>'
    + '<dt>Programado</dt><dd>' + fechaCorta(s.fechaProg) + (s.horaProg ? ' a las ' + esc(s.horaProg) : '') + '</dd>'
    + '<dt>Registrado</dt><dd>' + fechaHora(s.creado) + '</dd>'
    + '<dt>Salida</dt><dd>' + fechaHora(s.tsTransito) + '</dd>'
    + '<dt>Cierre</dt><dd>' + fechaHora(s.tsConcluido) + '</dd>'
    + '<dt>Transporte</dt><dd>' + vehiculoHTML(s.vehiculo) + '</dd>'
    + '<dt>Costo</dt><dd>' + (s.costo != null ? soles(s.costo) : 'Sin tarifa') + '</dd>'
    + '<dt>Espera</dt><dd>' + (he != null ? he.toFixed(1) + ' h' : 'N/D') + '</dd>'
    + '<dt>Tránsito</dt><dd>' + (ht != null ? ht.toFixed(1) + ' h' : 'N/D') + '</dd>'
    + '<dt>Origen del dato</dt><dd>' + (s.fuente === 'historico'
        ? 'Planilla de logística 2026 <span class="muted small">(solo consta el día del servicio)</span>'
        : 'Registrado en la aplicación') + '</dd>'
    + '</dl>'
    + paradasExtraHTML(s)
    + adjuntosHTML(s.id, admin);
  abrirModal('Ticket ' + s.id, html);
  // El índice de archivos puede haber cambiado en otra pestaña: se repinta
  // el bloque de adjuntos en cuanto termine la lectura del almacenamiento.
  refrescarAdjuntos(s.id, admin);
}

export function abrirModal(t, html) { $('modalTitle').textContent = t; $('modalBody').innerHTML = html; $('overlay').classList.add('on'); }
export function cerrarModal() { $('overlay').classList.remove('on'); }

/**
 * Cancelar desde logística (admin o seguimiento) sí pide motivo, a diferencia
 * del autoservicio del solicitante: reemplaza el modal de "Gestionar" por uno
 * chico con el desplegable de los tres motivos fijos y, si el motivo es
 * "Otros", el detalle en texto libre que el servidor exige para ese caso.
 */
export function abrirCancelarSolicitud(id) {
  const s = buscar(id); if (!s) return;
  const opciones = MOTIVOS_CANCELACION.map(m => '<option>' + esc(m) + '</option>').join('');
  const html = '<p class="card-note">El servicio ' + s.id + ' no se va a ejecutar. Esta acción no se puede deshacer.</p>'
    + '<div class="field"><label for="cancMotivo">Motivo</label>'
    + '<select class="select" id="cancMotivo" onchange="mostrarDetalleCancelacion()">' + opciones + '</select></div>'
    + '<div class="field" id="wrapCancDetalle" style="display:none">'
    + '<label for="cancDetalle">Detalle</label>'
    + '<textarea class="textarea" id="cancDetalle" placeholder="Escribe el motivo"></textarea></div>'
    + '<div class="err" id="eCanc"></div>'
    + '<div style="display:flex;gap:8px;margin-top:6px">'
    + '<button class="btn btn-sm btn-danger" onclick="confirmarCancelarSolicitud(\'' + s.id + '\')">Confirmar cancelación</button>'
    + '<button class="btn btn-sm btn-ghost" onclick="verDetalle(\'' + s.id + '\')">Volver</button>'
    + '</div>';
  abrirModal('Cancelar ' + s.id, html);
}

/** El detalle de texto libre solo hace falta -y solo se ve- para "Otros". */
export function mostrarDetalleCancelacion() {
  $('wrapCancDetalle').style.display = $('cancMotivo').value === 'Otros' ? 'block' : 'none';
}

export async function confirmarCancelarSolicitud(id) {
  const motivo = $('cancMotivo').value;
  const detalle = $('cancDetalle').value.trim();
  if (motivo === 'Otros' && !detalle) {
    $('eCanc').textContent = 'Escribe el detalle del motivo.';
    $('eCanc').classList.add('on');
    return;
  }
  try {
    await api.cancelarSolicitud(id, motivo, detalle);
  } catch (e) {
    $('eCanc').textContent = e.message;
    $('eCanc').classList.add('on');
    return;
  }
  toast('Servicio cancelado', id + ' · ' + motivo, 'warn');
  renderTodo();
  cerrarModal();
}
