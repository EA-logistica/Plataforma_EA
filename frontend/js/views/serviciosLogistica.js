import { $, esc } from '../utils/dom.js';
import { fechaCorta, hoyISO } from '../utils/format.js';
import { toast } from '../utils/toast.js';
import * as api from '../api/estado.js';
import { abrirModal, cerrarModal } from './dispatch.js';

/**
 * Servicios que contrata logística -mantenimiento, transporte especializado,
 * certificaciones, agenciamiento de aduana-, distintos de la mensajería.
 * Solo lo ve admin (ver tabs.js).
 */
const TIPOS = ['Mantenimiento', 'Transporte especializado', 'Certificación', 'Agenciamiento de aduana', 'Consultoría', 'Otro'];
const ESTADOS = ['Cotizando', 'Aprobado', 'En ejecución', 'Concluido', 'Cancelado'];
const MONEDAS = ['PEN', 'USD'];
let cache = [];

export function renderServiciosLogisticaSiVisible() {
  if ($('aServiciosLogistica').classList.contains('on')) renderServiciosLogistica();
}

export async function renderServiciosLogistica() {
  try {
    cache = await api.listarServiciosLogistica();
  } catch (e) {
    $('tServiciosLogistica').innerHTML = '<div class="empty"><strong>No se pudo cargar</strong>' + esc(e.message) + '</div>';
    return;
  }

  const enEjecucion = cache.filter(s => s.estado === 'En ejecución').length;
  const cotizando = cache.filter(s => s.estado === 'Cotizando').length;
  const montoEnPen = cache.filter(s => s.estado !== 'Cancelado' && s.moneda === 'PEN').reduce((a, s) => a + (s.costo || 0), 0);
  const montoEnUsd = cache.filter(s => s.estado !== 'Cancelado' && s.moneda === 'USD').reduce((a, s) => a + (s.costo || 0), 0);
  $('servMetrics').innerHTML = [
    { c: 'primary', v: cache.length, k: 'Servicios registrados', d: 'Histórico completo' },
    { c: 'info', v: enEjecucion, k: 'En ejecución', d: 'Contratados y en curso' },
    { c: '', v: cotizando, k: 'Cotizando', d: 'Pendientes de aprobar' },
    { c: 'ok', v: 'S/ ' + montoEnPen.toLocaleString('es-PE', { minimumFractionDigits: 2 }), k: 'Monto en soles', d: 'Sin contar cancelados' },
    { c: 'ok', v: 'US$ ' + montoEnUsd.toLocaleString('es-PE', { minimumFractionDigits: 2 }), k: 'Monto en dólares', d: 'Sin contar cancelados' }
  ].map(tarjeta).join('');

  if (!cache.length) {
    $('tServiciosLogistica').innerHTML = '<div class="empty"><strong>Sin servicios registrados</strong>Registra el primero con "Nuevo servicio".</div>';
    return;
  }

  const filas = cache.map(s => '<tr>'
    + '<td class="nowrap">' + fechaCorta(s.fechaSolicitud) + '</td>'
    + '<td>' + esc(s.tipoServicio) + '</td>'
    + '<td>' + esc(s.proveedor || '—') + '</td>'
    + '<td class="cell-2">' + esc(s.descripcion) + '</td>'
    + '<td class="num">' + (s.costo != null ? (s.moneda === 'USD' ? 'US$ ' : 'S/ ') + s.costo.toLocaleString('es-PE', { minimumFractionDigits: 2 }) : '<span class="muted">N/D</span>') + '</td>'
    + '<td class="nowrap">' + (s.fechaInicio ? fechaCorta(s.fechaInicio) : '—') + (s.fechaTermino ? ' → ' + fechaCorta(s.fechaTermino) : '') + '</td>'
    + '<td>' + estadoChip(s.estado) + '</td>'
    + '<td class="nowrap"><button class="btn btn-sm btn-ghost" onclick="editarServicioLogistica(' + s.id + ')">Editar</button> '
    + '<button class="btn btn-sm btn-ghost" onclick="borrarServicioLogisticaVista(' + s.id + ')">Borrar</button></td>'
    + '</tr>').join('');

  $('tServiciosLogistica').innerHTML = '<table><thead><tr>'
    + '<th>Solicitud</th><th>Tipo</th><th>Proveedor</th><th>Descripción</th><th class="num">Costo</th>'
    + '<th>Vigencia</th><th>Estado</th><th></th>'
    + '</tr></thead><tbody>' + filas + '</tbody></table>';
}

const tarjeta = x => '<div class="kpi ' + x.c + '"><div class="v">' + esc(String(x.v)) + '</div>'
  + '<div class="k">' + esc(x.k) + '</div><div class="d">' + esc(x.d) + '</div></div>';

function estadoChip(estado) {
  const clase = estado === 'Concluido' ? 'st-concluido' : estado === 'Cancelado' ? 'st-cancelado'
    : estado === 'Cotizando' ? 'st-espera' : 'st-transito';
  return '<span class="chip ' + clase + '"><i class="dot"></i>' + esc(estado) + '</span>';
}

const campo = (id, label, type, value, extra) => '<div class="field" style="margin:0 0 14px"><label for="' + id + '">'
  + esc(label) + '</label><input class="input" id="' + id + '" type="' + type + '"' + (extra || '')
  + ' value="' + esc(value == null ? '' : value) + '"></div>';
const selector = (id, label, opciones, actual) => '<div class="field" style="margin:0 0 14px"><label for="' + id + '">'
  + esc(label) + '</label><select class="select" id="' + id + '">'
  + opciones.map(o => '<option' + (o === actual ? ' selected' : '') + '>' + esc(o) + '</option>').join('') + '</select></div>';

export function abrirNuevoServicioLogistica() { abrirFormServicio(null); }
export function editarServicioLogistica(id) { abrirFormServicio(cache.find(s => s.id === id)); }

function abrirFormServicio(s) {
  const v = s || {};
  const html = '<div class="row">'
    + campo('servFechaSolicitud', 'Fecha de solicitud *', 'date', v.fechaSolicitud || hoyISO())
    + selector('servTipo', 'Tipo de servicio', TIPOS, v.tipoServicio || 'Otro')
    + '</div>'
    + campo('servProveedor', 'Proveedor / prestador', 'text', v.proveedor || '')
    + '<div class="field" style="margin-bottom:14px"><label for="servDescripcion">Descripción *</label>'
    + '<textarea class="textarea" id="servDescripcion">' + esc(v.descripcion || '') + '</textarea></div>'
    + '<div class="row">'
    + campo('servCosto', 'Costo', 'number', v.costo, ' step="0.01" min="0"')
    + selector('servMoneda', 'Moneda', MONEDAS, v.moneda || 'PEN')
    + '</div>'
    + '<div class="row">'
    + selector('servEstado', 'Estado', ESTADOS, v.estado || 'Cotizando')
    + campo('servResponsable', 'Responsable', 'text', v.responsable || '')
    + '</div>'
    + '<div class="row">'
    + campo('servFechaInicio', 'Fecha de inicio', 'date', v.fechaInicio || '')
    + campo('servFechaTermino', 'Fecha de término', 'date', v.fechaTermino || '')
    + '</div>'
    + '<div class="field" style="margin-bottom:14px"><label for="servObservaciones">Observaciones</label>'
    + '<textarea class="textarea" id="servObservaciones">' + esc(v.observaciones || '') + '</textarea></div>'
    + '<div class="err" id="eServicioLogistica"></div>'
    + '<button class="btn btn-sm" onclick="guardarServicioLogistica(' + (s ? s.id : 'null') + ')">Guardar</button>';
  abrirModal(s ? 'Editar servicio' : 'Nuevo servicio', html);
}

export async function guardarServicioLogistica(id) {
  const datos = {
    fechaSolicitud: $('servFechaSolicitud').value,
    tipoServicio: $('servTipo').value,
    proveedor: $('servProveedor').value.trim(),
    descripcion: $('servDescripcion').value.trim(),
    costo: $('servCosto').value,
    moneda: $('servMoneda').value,
    estado: $('servEstado').value,
    responsable: $('servResponsable').value.trim(),
    fechaInicio: $('servFechaInicio').value,
    fechaTermino: $('servFechaTermino').value,
    observaciones: $('servObservaciones').value.trim()
  };
  try {
    if (id) await api.actualizarServicioLogistica(id, datos); else await api.crearServicioLogistica(datos);
  } catch (e) {
    $('eServicioLogistica').textContent = e.message;
    $('eServicioLogistica').classList.add('on');
    return;
  }
  cerrarModal();
  renderServiciosLogistica();
  toast(id ? 'Servicio actualizado' : 'Servicio registrado');
}

export async function borrarServicioLogisticaVista(id) {
  if (!confirm('¿Borrar este servicio? No se puede deshacer.')) return;
  try {
    await api.borrarServicioLogistica(id);
  } catch (e) {
    toast('No se pudo borrar', e.message, 'bad');
    return;
  }
  renderServiciosLogistica();
  toast('Servicio borrado', '', 'warn');
}
