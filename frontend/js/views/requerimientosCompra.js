import { $, esc } from '../utils/dom.js';
import { soles, fechaCorta, hoyISO } from '../utils/format.js';
import { toast } from '../utils/toast.js';
import * as api from '../api/estado.js';
import { abrirModal, cerrarModal } from './dispatch.js';

/**
 * Requerimientos de compra: materia prima local e importada (resinas, PP,
 * PE de soplado e inyección), repuestos y servicios que el coordinador de
 * logística tiene que gestionar. Solo lo ve admin (ver tabs.js).
 */
const CATEGORIAS = ['Materia prima local', 'Materia prima importada', 'Repuestos', 'Servicios', 'Otros'];
const PRIORIDADES = ['Urgente', 'Alta', 'Normal', 'Baja'];
const ESTADOS = ['Pendiente', 'Cotizando', 'Aprobado', 'OC emitida', 'Recibido', 'Rechazado', 'Cancelado'];
const MONEDAS = ['PEN', 'USD'];
let cache = [];

export function renderRequerimientosSiVisible() {
  if ($('aRequerimientos').classList.contains('on')) renderRequerimientos();
}

export async function renderRequerimientos() {
  try {
    cache = await api.listarRequerimientos();
  } catch (e) {
    $('tRequerimientos').innerHTML = '<div class="empty"><strong>No se pudo cargar</strong>' + esc(e.message) + '</div>';
    return;
  }

  const abiertos = cache.filter(r => !['Recibido', 'Rechazado', 'Cancelado'].includes(r.estado));
  const urgentes = cache.filter(r => r.prioridad === 'Urgente' && !['Recibido', 'Rechazado', 'Cancelado'].includes(r.estado));
  const importados = cache.filter(r => r.categoria === 'Materia prima importada').length;
  const montoEnCurso = abiertos.reduce((a, r) => a + (r.costoEstimado || 0), 0);
  $('reqMetrics').innerHTML = [
    { c: 'primary', v: cache.length, k: 'Requerimientos totales', d: abiertos.length + ' en curso' },
    { c: urgentes.length ? 'bad' : '', v: urgentes.length, k: 'Urgentes en curso', d: 'Prioridad más alta' },
    { c: 'info', v: importados, k: 'Materia prima importada', d: 'Del total de requerimientos' },
    { c: 'ok', v: soles(montoEnCurso), k: 'Monto estimado en curso', d: 'Solo lo no cerrado (S/, referencial)' }
  ].map(tarjeta).join('');

  if (!cache.length) {
    $('tRequerimientos').innerHTML = '<div class="empty"><strong>Sin requerimientos registrados</strong>Registra el primero con "Nuevo requerimiento".</div>';
    return;
  }

  const filas = cache.map(r => '<tr>'
    + '<td class="tk">REQ-C' + String(r.correlativo).padStart(4, '0') + '</td>'
    + '<td class="nowrap">' + fechaCorta(r.fechaSolicitud) + '</td>'
    + '<td class="cell-2">' + esc(r.descripcion) + '<span>' + esc(r.categoria) + '</span></td>'
    + '<td>' + esc(r.areaSolicitante || '—') + '</td>'
    + '<td class="num">' + (r.cantidad != null ? r.cantidad.toLocaleString('es-PE') + ' ' + esc(r.unidadMedida || '') : '<span class="muted">N/D</span>') + '</td>'
    + '<td>' + prioridadChip(r.prioridad) + '</td>'
    + '<td class="num">' + (r.costoEstimado != null ? (r.moneda === 'USD' ? 'US$ ' : 'S/ ') + r.costoEstimado.toLocaleString('es-PE', { minimumFractionDigits: 2 }) : '<span class="muted">N/D</span>') + '</td>'
    + '<td>' + estadoChip(r.estado) + '</td>'
    + '<td class="nowrap"><button class="btn btn-sm btn-ghost" onclick="editarRequerimiento(' + r.id + ')">Editar</button> '
    + '<button class="btn btn-sm btn-ghost" onclick="borrarRequerimientoVista(' + r.id + ')">Borrar</button></td>'
    + '</tr>').join('');

  $('tRequerimientos').innerHTML = '<table><thead><tr>'
    + '<th>Código</th><th>Solicitud</th><th>Descripción</th><th>Área</th><th class="num">Cantidad</th>'
    + '<th>Prioridad</th><th class="num">Costo est.</th><th>Estado</th><th></th>'
    + '</tr></thead><tbody>' + filas + '</tbody></table>';
}

const tarjeta = x => '<div class="kpi ' + x.c + '"><div class="v">' + esc(String(x.v)) + '</div>'
  + '<div class="k">' + esc(x.k) + '</div><div class="d">' + esc(x.d) + '</div></div>';

function prioridadChip(p) {
  const clase = p === 'Urgente' ? 'st-cancelado' : p === 'Alta' ? 'st-espera' : p === 'Baja' ? 'st-concluido' : 'st-transito';
  return '<span class="chip ' + clase + '"><i class="dot"></i>' + esc(p) + '</span>';
}
function estadoChip(estado) {
  const clase = ['Recibido'].includes(estado) ? 'st-concluido'
    : ['Rechazado', 'Cancelado'].includes(estado) ? 'st-cancelado'
    : estado === 'Pendiente' ? 'st-espera' : 'st-transito';
  return '<span class="chip ' + clase + '"><i class="dot"></i>' + esc(estado) + '</span>';
}

const campo = (id, label, type, value, extra) => '<div class="field" style="margin:0 0 14px"><label for="' + id + '">'
  + esc(label) + '</label><input class="input" id="' + id + '" type="' + type + '"' + (extra || '')
  + ' value="' + esc(value == null ? '' : value) + '"></div>';
const selector = (id, label, opciones, actual) => '<div class="field" style="margin:0 0 14px"><label for="' + id + '">'
  + esc(label) + '</label><select class="select" id="' + id + '">'
  + opciones.map(o => '<option' + (o === actual ? ' selected' : '') + '>' + esc(o) + '</option>').join('') + '</select></div>';

export function abrirNuevoRequerimiento() { abrirFormRequerimiento(null); }
export function editarRequerimiento(id) { abrirFormRequerimiento(cache.find(r => r.id === id)); }

function abrirFormRequerimiento(r) {
  const v = r || {};
  const html = '<div class="row">'
    + campo('reqFechaSolicitud', 'Fecha de solicitud *', 'date', v.fechaSolicitud || hoyISO())
    + campo('reqAreaSolicitante', 'Área solicitante', 'text', v.areaSolicitante || '')
    + '</div>'
    + '<div class="field" style="margin-bottom:14px"><label for="reqDescripcion">Descripción *</label>'
    + '<textarea class="textarea" id="reqDescripcion">' + esc(v.descripcion || '') + '</textarea></div>'
    + '<div class="row">'
    + selector('reqCategoria', 'Categoría', CATEGORIAS, v.categoria)
    + selector('reqPrioridad', 'Prioridad', PRIORIDADES, v.prioridad || 'Normal')
    + '</div>'
    + '<div class="row">'
    + campo('reqCantidad', 'Cantidad', 'number', v.cantidad, ' step="0.01" min="0"')
    + campo('reqUnidadMedida', 'Unidad de medida', 'text', v.unidadMedida || '', ' placeholder="kg, ton, unidad..."')
    + '</div>'
    + campo('reqProveedorSugerido', 'Proveedor sugerido', 'text', v.proveedorSugerido || '')
    + '<div class="row">'
    + campo('reqFechaRequerida', 'Fecha requerida', 'date', v.fechaRequerida || '')
    + selector('reqEstado', 'Estado', ESTADOS, v.estado || 'Pendiente')
    + '</div>'
    + '<div class="row">'
    + campo('reqNumeroOc', 'N° de OC', 'text', v.numeroOc || '')
    + selector('reqMoneda', 'Moneda', MONEDAS, v.moneda || 'PEN')
    + '</div>'
    + '<div class="row">'
    + campo('reqCostoEstimado', 'Costo estimado', 'number', v.costoEstimado, ' step="0.01" min="0"')
    + campo('reqCostoReal', 'Costo real', 'number', v.costoReal, ' step="0.01" min="0"')
    + '</div>'
    + '<div class="field" style="margin-bottom:14px"><label for="reqObservaciones">Observaciones</label>'
    + '<textarea class="textarea" id="reqObservaciones">' + esc(v.observaciones || '') + '</textarea></div>'
    + '<div class="err" id="eRequerimiento"></div>'
    + '<button class="btn btn-sm" onclick="guardarRequerimiento(' + (r ? r.id : 'null') + ')">Guardar</button>';
  abrirModal(r ? 'Editar requerimiento de compra' : 'Nuevo requerimiento de compra', html);
}

export async function guardarRequerimiento(id) {
  const datos = {
    fechaSolicitud: $('reqFechaSolicitud').value,
    areaSolicitante: $('reqAreaSolicitante').value.trim(),
    descripcion: $('reqDescripcion').value.trim(),
    categoria: $('reqCategoria').value,
    prioridad: $('reqPrioridad').value,
    cantidad: $('reqCantidad').value,
    unidadMedida: $('reqUnidadMedida').value.trim(),
    proveedorSugerido: $('reqProveedorSugerido').value.trim(),
    fechaRequerida: $('reqFechaRequerida').value,
    estado: $('reqEstado').value,
    numeroOc: $('reqNumeroOc').value.trim(),
    moneda: $('reqMoneda').value,
    costoEstimado: $('reqCostoEstimado').value,
    costoReal: $('reqCostoReal').value,
    observaciones: $('reqObservaciones').value.trim()
  };
  try {
    if (id) await api.actualizarRequerimiento(id, datos); else await api.crearRequerimiento(datos);
  } catch (e) {
    $('eRequerimiento').textContent = e.message;
    $('eRequerimiento').classList.add('on');
    return;
  }
  cerrarModal();
  renderRequerimientos();
  toast(id ? 'Requerimiento actualizado' : 'Requerimiento registrado');
}

export async function borrarRequerimientoVista(id) {
  if (!confirm('¿Borrar este requerimiento de compra? No se puede deshacer.')) return;
  try {
    await api.borrarRequerimiento(id);
  } catch (e) {
    toast('No se pudo borrar', e.message, 'bad');
    return;
  }
  renderRequerimientos();
  toast('Requerimiento borrado', '', 'warn');
}
