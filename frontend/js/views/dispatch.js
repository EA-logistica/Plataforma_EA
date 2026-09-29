import { $, esc } from '../utils/dom.js';
import { fechaHora, fechaCorta, horasEntre, corta, soles, isoDia, hoyISO } from '../utils/format.js';
import { toast } from '../utils/toast.js';
import * as api from '../api/estado.js';
import { DB } from '../api/estado.js';
import { sesion } from '../state/sessionState.js';
import { chipEstado, origenTexto, origenCorto, railHTML, oGuion, cancelacionHTML, iconoVehiculo, vehiculoHTML, paradasExtraHTML, modalidadHTML } from './presenters.js';
import {
  MODALIDADES, modalidad, modalidadDe, contradiccionServicio, claveDestino, esEnlaceMapa, lugarDeEnlace, coordsDeEnlace
} from '#shared/servicios.js';
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
/**
 * Filtros de la bandeja, pensados desde el trabajo del gestor:
 *   - Estado: qué hay que hacer con el ticket. "Por atender" (hay que
 *     despacharlo), "En ruta" (hay que cerrarlo) y "Cerrados hoy" (para
 *     confirmar que se cerró bien). Antes había cinco botones que se pisaban
 *     ("En curso" era la suma de otros dos).
 *   - Acción: solo envíos o solo recojos.
 *   - Modalidad: Envíos / Transporte / Cargo.
 *   - Búsqueda libre: REQ, solicitante, área o destino.
 */
let filtroBandeja = 'En espera';
let filtroAccion = '';
let filtroModalidad = ''; // '' = todas
let textoBusqueda = '';

const ESTADOS_BANDEJA = [
  ['En espera', 'Por atender', s => s.estado === 'En espera'],
  ['En tránsito', 'En ruta', s => s.estado === 'En tránsito'],
  ['Cerrados', 'Cerrados hoy', s => s.estado === 'Concluido' || s.estado === 'Cancelado']
];
const ACCIONES_BANDEJA = [['', 'Envíos y recojos'], ['Entregar', 'Solo envíos'], ['Recoger', 'Solo recojos']];

/**
 * Punto marcado por el solicitante en el mapa del formulario: se abre en
 * Google Maps, que es lo que el mensajero usa para llegar. Solo coordenadas
 * numéricas (ya validadas por el servidor), nada de texto libre en la URL.
 */
function enlaceMapa(lat, lng, compacto = false) {
  if (lat == null || lng == null || !Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) return '';
  const q = Number(lat).toFixed(6) + ',' + Number(lng).toFixed(6);
  return ' <a class="small enlace-mapa" href="https://www.google.com/maps/search/?api=1&query=' + q + '" target="_blank" rel="noopener"'
    + ' title="Abrir el punto en Google Maps">📍' + (compacto ? '' : ' Ver en mapa') + '</a>';
}

/**
 * Cómo se lee un destino en la bandeja. Si el solicitante pegó un enlace de
 * Google Maps, en vez de la URL se muestra el nombre del lugar (si el enlace
 * lo trae) o "Ubicación GPS", con el pin que abre el punto.
 */
export function destinoLegible(s) {
  if (!esEnlaceMapa(s.destino)) return esc(s.destino);
  const lugar = lugarDeEnlace(s.destino);
  return '<span class="destino-gps">' + (lugar ? esc(lugar) : 'Ubicación GPS') + ' <span class="muted small">(enlace de Google Maps)</span></span>';
}

function coordsDestino(s) {
  if (s.destinoLat != null) return { lat: s.destinoLat, lng: s.destinoLng };
  return coordsDeEnlace(s.destino);
}

export function buscar(id) { return DB.solicitudes.find(s => s.id === id); }

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

const coincideBusqueda = (s, q) => {
  if (!q) return true;
  const texto = claveDestino([s.id, s.nombre, s.area, s.destino, lugarDeEnlace(s.destino), s.servicio, s.contacto].join(' '));
  return claveDestino(q).split(' ').every(p => texto.includes(p));
};

export function renderBandeja() {
  const base = DB.solicitudes.filter(enBandejaHoy);
  const porAtender = base.filter(s => s.estado === 'En espera');
  const enRuta = base.filter(s => s.estado === 'En tránsito');
  $('cntBandeja').textContent = porAtender.length + enRuta.length;

  // Los filtros de acción, modalidad y texto se aplican primero; los conteos
  // del estado se calculan sobre ese resultado, para que "Por atender (3)"
  // diga cuántos hay de verdad con lo que ya se eligió.
  const afinado = base.filter(s =>
    (!filtroAccion || s.tipo === filtroAccion)
    && (!filtroModalidad || modalidadDe(s) === filtroModalidad)
    && coincideBusqueda(s, textoBusqueda));

  $('fBandeja').innerHTML = ESTADOS_BANDEJA.map(([k, l, f]) =>
    '<button class="seg-op' + (filtroBandeja === k ? ' on' : '') + '" role="tab" aria-selected="' + (filtroBandeja === k) + '"'
    + ' onclick="setFiltroBandeja(\'' + k + '\')">' + l + ' <span class="seg-n">' + afinado.filter(f).length + '</span></button>').join('');
  $('fBandejaAccion').innerHTML = ACCIONES_BANDEJA.map(([k, l]) =>
    '<button class="seg-op' + (filtroAccion === k ? ' on' : '') + '" onclick="setFiltroAccionBandeja(\'' + k + '\')">' + l + '</button>').join('');
  $('fBandejaModalidad').innerHTML = [['', 'Todas las modalidades'], ...MODALIDADES.map(m => [m.id, m.titulo])]
    .map(([k, l]) => '<option value="' + esc(k) + '"' + (filtroModalidad === k ? ' selected' : '') + '>' + esc(l) + '</option>').join('');

  const sinTarifa = enRuta.filter(s => s.costo == null).length;
  $('bandejaResumen').innerHTML = '<b>' + porAtender.length + '</b> por atender · <b>' + enRuta.length + '</b> en ruta'
    + (sinTarifa ? ' · <span class="txt-bad">' + sinTarifa + ' en ruta sin tarifa</span>' : '')
    + ' · ' + base.filter(s => s.estado === 'Concluido').length + ' concluidos hoy';

  const filtroEstado = ESTADOS_BANDEJA.find(([k]) => k === filtroBandeja)[2];
  const lista = afinado.filter(filtroEstado)
    .sort((a, b) => (a.fechaProg + a.horaProg).localeCompare(b.fechaProg + b.horaProg));

  if (!lista.length) {
    const hayFiltros = filtroAccion || filtroModalidad || textoBusqueda;
    $('tBandeja').innerHTML = '<div class="empty"><strong>' + (hayFiltros ? 'Nada coincide con los filtros' : 'No hay servicios aquí') + '</strong>'
      + (hayFiltros ? 'Quita algún filtro o cambia la búsqueda.' : 'Cuando llegue una solicitud nueva aparecerá en "Por atender".') + '</div>';
    return;
  }
  $('tBandeja').innerHTML = lista.map(filaBandeja).join('');
}

/**
 * Una fila por ticket, en tres bloques: cuándo (programación), qué y a dónde
 * (modalidad, acción, servicio, destino, quién recibe, quién pidió) y qué
 * hacer (tarifa, estado, botones). Así cabe sin scroll horizontal y se lee
 * de izquierda a derecha en el orden en que se despacha.
 */
function filaBandeja(s) {
  const bloqueado = s.estado === 'Concluido' || s.estado === 'Cancelado';
  const m = modalidad(modalidadDe(s));
  const ref = tarifaDe(s.destino);
  const punto = coordsDestino(s);
  const hoy = s.fechaProg === hoyISO();
  const esEnvio = s.tipo === 'Entregar';
  return '<article class="b-fila' + (bloqueado ? ' b-cerrada' : '') + '">'
    // 1. Cuándo
    + '<div class="b-cuando' + (hoy ? ' b-hoy' : '') + '">'
    + '<div class="b-hora">' + esc(oGuion(s.horaProg)) + '</div>'
    + '<div class="b-fecha">' + (hoy ? 'Hoy' : fechaCorta(s.fechaProg)) + '</div>'
    + '<button class="tk b-req" onclick="verDetalle(\'' + s.id + '\')" title="Ver detalle">' + s.id + '</button>' + indicadorAdjuntos(s.id)
    + '</div>'
    // 2. Qué y a dónde
    + '<div class="b-que">'
    + '<div class="b-linea1">' + modalidadHTML(s, false)
    + '<span class="b-accion ' + (esEnvio ? 'es-envio' : 'es-recojo') + '">' + (esEnvio ? 'Envío' : 'Recojo') + '</span>'
    + '<span class="b-servicio">' + esc(s.servicio || m.titulo) + '</span></div>'
    + '<div class="b-destino">' + (esEnvio ? 'Entregar en ' : 'Recoger en ') + '<b>' + destinoLegible(s) + '</b>'
    + (s.destinoTipo ? ' <span class="chip-destino">' + esc(s.destinoTipo) + ' nuevo</span>' : '')
    + (punto ? enlaceMapa(punto.lat, punto.lng) : '')
    + (s.paradas && s.paradas.length ? ' <span class="clip">+' + s.paradas.length + ' parada' + (s.paradas.length > 1 ? 's' : '') + '</span>' : '')
    + '</div>'
    + '<div class="b-meta">Desde ' + esc(origenCorto(s)) + (s.origenLat != null ? enlaceMapa(s.origenLat, s.origenLng, true) : '')
    + ' · Recibe <b>' + esc(oGuion(s.contacto)) + '</b> ' + esc(oGuion(s.telefono))
    + ' · Pide <b>' + esc(corta(s.nombre, 28)) + '</b> (' + esc(s.area) + ')</div>'
    + (s.motivo ? '<div class="b-motivo">' + esc(corta(s.motivo, 110)) + '</div>' : '')
    + '</div>'
    // 3. Qué hacer
    + '<div class="b-hacer">'
    + '<label class="b-tarifa">S/ <input class="mini-input" type="number" min="0" step="0.5" aria-label="Tarifa de ' + s.id + '"'
    + ' placeholder="' + (ref ? ref.tarifa.toFixed(2) : '0.00') + '"'
    + (ref ? ' title="Tarifa habitual de este destino: ' + soles(ref.tarifa) + ' en ' + ref.viajes + ' viajes de 2026"' : '')
    + (bloqueado ? ' disabled' : '')
    + ' value="' + (s.costo != null ? s.costo : '') + '" onchange="setCosto(\'' + s.id + '\',this.value)"></label>'
    + chipEstado(s.estado)
    + '<div class="b-botones">' + accionesHTML(s) + '</div>'
    + '</div>'
    + '</article>';
}

function accionesHTML(s) {
  let b = '';
  if (s.estado === 'En espera') b += '<button class="btn btn-sm btn-info" onclick="avanzar(\'' + s.id + '\')">Despachar</button>';
  if (s.estado === 'En tránsito') b += '<button class="btn btn-sm btn-ok" onclick="avanzar(\'' + s.id + '\')">Finalizar</button>';
  b += '<button class="btn btn-sm btn-ghost" onclick="verDetalle(\'' + s.id + '\')">Gestionar</button>';
  return b;
}

export function setFiltroBandeja(k) { filtroBandeja = k; renderBandeja(); }
export function setFiltroAccionBandeja(k) { filtroAccion = k; renderBandeja(); }
export function setFiltroModalidadBandeja(k) { filtroModalidad = k; renderBandeja(); }
export function buscarEnBandeja(q) { textoBusqueda = String(q || '').trim(); renderBandeja(); }

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

/**
 * Editor de "qué se pidió" dentro de Gestionar: el gestor corrige la
 * modalidad, la acción o el tipo de servicio si el solicitante se equivocó.
 * Las opciones de servicio siguen a la modalidad y la acción elegidas; el
 * servidor rechaza igual una combinación contradictoria.
 */
function editorServicioHTML(s) {
  const mod = modalidadDe(s);
  const m = modalidad(mod);
  const opcionesServicio = m.servicios[s.tipo].map(x => x.nombre);
  if (s.servicio && !opcionesServicio.includes(s.servicio)) opcionesServicio.unshift(s.servicio);
  const op = (v, l, sel) => '<option value="' + esc(v) + '"' + (sel ? ' selected' : '') + '>' + esc(l) + '</option>';
  return '<div class="editor-servicio">'
    + '<div class="paso-sub">Qué se pidió <span class="muted small" style="font-weight:500">· puedes corregirlo</span></div>'
    + '<div class="row3">'
    + '<div class="field" style="margin:0"><label for="gModalidad">Modalidad</label>'
    + '<select class="select" id="gModalidad" onchange="refrescarEditorServicio(\'' + s.id + '\')">'
    + MODALIDADES.map(x => op(x.id, x.titulo, x.id === mod)).join('') + '</select></div>'
    + '<div class="field" style="margin:0"><label for="gAccion">Acción</label>'
    + '<select class="select" id="gAccion" onchange="refrescarEditorServicio(\'' + s.id + '\')">'
    + op('Entregar', m.acciones.Entregar + ' (envío)', s.tipo === 'Entregar') + op('Recoger', m.acciones.Recoger + ' (recojo)', s.tipo === 'Recoger') + '</select></div>'
    + '<div class="field" style="margin:0"><label for="gServicio">Tipo de servicio</label>'
    + '<select class="select" id="gServicio">' + opcionesServicio.map(v => op(v, v, v === s.servicio)).join('') + '</select></div>'
    + '</div>'
    + '<div class="err" id="eGestionServicio"></div>'
    + '<button class="btn btn-sm" style="margin-top:10px" onclick="guardarServicioTicket(\'' + s.id + '\')">Guardar cambios</button>'
    + '</div>';
}

/** Cambiar modalidad o acción en el editor recarga las opciones de servicio. */
export function refrescarEditorServicio() {
  const m = modalidad($('gModalidad').value);
  const accion = $('gAccion').value;
  $('gAccion').options[0].textContent = m.acciones.Entregar + ' (envío)';
  $('gAccion').options[1].textContent = m.acciones.Recoger + ' (recojo)';
  const actual = $('gServicio').value;
  const nombres = m.servicios[accion].map(x => x.nombre);
  $('gServicio').innerHTML = nombres.map(v => '<option value="' + esc(v) + '"' + (v === actual ? ' selected' : '') + '>' + esc(v) + '</option>').join('');
}

export async function guardarServicioTicket(id) {
  const cambios = { modalidad: $('gModalidad').value, tipo: $('gAccion').value, servicio: $('gServicio').value };
  const e = contradiccionServicio(cambios.tipo, cambios.servicio);
  if (e) { $('eGestionServicio').textContent = e; $('eGestionServicio').classList.add('on'); return; }
  try {
    const s = await api.actualizarSolicitud(id, cambios);
    toast('Servicio actualizado', s.id + ': ' + s.modalidad + ' · ' + s.servicio);
  } catch (err) {
    $('eGestionServicio').textContent = err.message; $('eGestionServicio').classList.add('on');
    return;
  }
  renderBandeja();
  verDetalle(id);
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
    gestion = '<div class="card card-pad" style="background:var(--surface2);margin-bottom:18px">'
      + editorServicioHTML(s)
      + '<div class="row" style="margin-top:14px">'
      + '<div class="field" style="margin:0"><label>Tarifa del servicio (S/)</label>'
      + '<input class="input" type="number" min="0" step="0.5" placeholder="0.00" value="' + (s.costo != null ? s.costo : '') + '"'
      + ' onchange="setCosto(\'' + s.id + '\',this.value);verDetalle(\'' + s.id + '\')"></div></div>'
      + referencia
      + '<div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap">'
      + (s.estado === 'En espera'
        ? '<button class="btn btn-sm btn-info" onclick="avanzar(\'' + s.id + '\');verDetalle(\'' + s.id + '\')">Despachar (pasa a en ruta)</button>'
        : '<button class="btn btn-sm btn-ok" onclick="avanzar(\'' + s.id + '\');verDetalle(\'' + s.id + '\')">Marcar como concluido</button>')
      + '<button class="btn btn-sm btn-ghost" onclick="abrirCancelarSolicitud(\'' + s.id + '\')">Cancelar servicio</button>'
      + '</div></div>';
  }
  const html = gestion + (terminado && s.estado === 'Cancelado' ? cancelacionHTML(s) : railHTML(s))
    + '<dl class="detail-grid">'
    + '<dt>Estado</dt><dd>' + chipEstado(s.estado) + '</dd>'
    + '<dt>Solicitante</dt><dd>' + esc(s.nombre) + (s.dni ? ' · DNI ' + esc(s.dni) : '') + '<br><span class="muted small">' + esc(oGuion(s.area)) + '</span></dd>'
    + '<dt>Modalidad</dt><dd>' + modalidadHTML(s) + ' <span class="muted small">' + esc(modalidad(modalidadDe(s)).detalle) + '</span></dd>'
    + '<dt>Acción</dt><dd>' + esc(modalidad(modalidadDe(s)).acciones[s.tipo] || s.tipo) + '</dd>'
    + '<dt>Tipo de servicio</dt><dd>' + esc(s.servicio || 'N/D') + '</dd>'
    + '<dt>Motivo</dt><dd>' + esc(oGuion(s.motivo)) + '</dd>'
    + '<dt>Origen</dt><dd>' + esc(origenTexto(s)) + enlaceMapa(s.origenLat, s.origenLng) + '</dd>'
    + '<dt>Destino</dt><dd>' + destinoLegible(s)
    + (s.destinoTipo ? ' <span class="chip-destino">' + esc(s.destinoTipo) + ' nuevo</span>' : '')
    + (coordsDestino(s) ? enlaceMapa(coordsDestino(s).lat, coordsDestino(s).lng) : '')
    + (esEnlaceMapa(s.destino) && /^https?:\/\//i.test(s.destino)
      ? ' <a class="small" href="' + esc(s.destino) + '" target="_blank" rel="noopener noreferrer">Abrir el enlace original</a>' : '')
    + (s.paradas && s.paradas.length
        ? ' <span class="muted small">+' + s.paradas.length + ' parada' + (s.paradas.length > 1 ? 's' : '') + '</span>' : '') + '</dd>'
    + '<dt>Recibe</dt><dd>' + esc(oGuion(s.contacto)) + ' · ' + esc(oGuion(s.telefono)) + '</dd>'
    + '<dt>Programado</dt><dd>' + fechaCorta(s.fechaProg) + (s.horaProg ? ' a las ' + esc(s.horaProg) : '') + '</dd>'
    + '<dt>Registrado</dt><dd>' + fechaHora(s.creado) + '</dd>'
    + '<dt>Salida</dt><dd>' + fechaHora(s.tsTransito) + '</dd>'
    + '<dt>Cierre</dt><dd>' + fechaHora(s.tsConcluido) + '</dd>'
    + (s.vehiculo ? '<dt>Transporte</dt><dd>' + vehiculoHTML(s.vehiculo) + '</dd>' : '')
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

/**
 * `opciones.ancho === 'wide'` pide la variante ancha del modal (ver
 * `.modal.wide` en styles.css): solo hace falta donde el cuerpo es una tabla
 * de datos que si no fuerza scroll horizontal. Sin `opciones`, el modal
 * queda con el ancho de siempre -la inmensa mayoría de los usos, formularios
 * y listas cortas-.
 */
export function abrirModal(t, html, opciones) {
  $('modalTitle').textContent = t;
  $('modalBody').innerHTML = html;
  $('modal').classList.toggle('wide', !!(opciones && opciones.ancho === 'wide'));
  $('overlay').classList.add('on');
}
export function cerrarModal() { $('overlay').classList.remove('on'); }

/**
 * Confirmación de eliminación con motivo obligatorio: sustituye al `confirm()`
 * nativo en las tablas de admin. El servidor también exige y registra el
 * motivo (ver backend/rutas/compras.js e index.js) -esto no reemplaza esa
 * validación, solo evita el viaje redondo cuando el campo está vacío.
 *
 * `onConfirmar(motivo)` hace el borrado de verdad; si lanza, el error se
 * muestra dentro del propio modal (no se cierra, como con la cancelación de
 * arriba) y si resuelve bien, el modal se cierra solo.
 */
let _eliminarOnConfirmar = null;

export function confirmarEliminacion({ titulo, mensaje, onConfirmar }) {
  _eliminarOnConfirmar = onConfirmar;
  const html = '<p class="card-note">' + esc(mensaje || 'Esta acción no se puede deshacer.') + '</p>'
    + '<div class="field"><label for="elimMotivo">Motivo de la eliminación</label>'
    + '<textarea class="textarea" id="elimMotivo" placeholder="Escribe por qué se elimina este registro"></textarea></div>'
    + '<div class="err" id="eElim"></div>'
    + '<div style="display:flex;gap:8px;margin-top:6px">'
    + '<button class="btn btn-sm btn-danger" onclick="confirmarEliminacionSubmit()">Eliminar</button>'
    + '<button class="btn btn-sm btn-ghost" onclick="cerrarModal()">Cancelar</button>'
    + '</div>';
  abrirModal(titulo || 'Confirmar eliminación', html);
}

export async function confirmarEliminacionSubmit() {
  const motivo = $('elimMotivo').value.trim();
  if (motivo.length < 5) {
    $('eElim').textContent = 'Escribe el motivo de la eliminación (mínimo 5 caracteres).';
    $('eElim').classList.add('on');
    return;
  }
  const onConfirmar = _eliminarOnConfirmar;
  try {
    if (onConfirmar) await onConfirmar(motivo);
  } catch (e) {
    $('eElim').textContent = e.message;
    $('eElim').classList.add('on');
    return;
  }
  cerrarModal();
}

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
