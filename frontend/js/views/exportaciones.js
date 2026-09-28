import { $, esc } from '../utils/dom.js';
import { soles, fechaCorta, hoyISO } from '../utils/format.js';
import { toast } from '../utils/toast.js';
import * as api from '../api/estado.js';
import { abrirModal, cerrarModal, confirmarEliminacion } from './dispatch.js';

/**
 * Exportaciones: muestras enviadas a proveedores en el exterior, con
 * trazabilidad de envío. Solo lo ve admin (ver tabs.js).
 */
const ESTADOS = ['En tránsito', 'Entregado', 'Devuelto', 'Perdido'];
let cache = [];

export function renderExportacionesSiVisible() {
  if ($('aExportaciones').classList.contains('on')) renderExportaciones();
}

export async function renderExportaciones() {
  try {
    cache = await api.listarExportaciones();
  } catch (e) {
    $('tExportaciones').innerHTML = '<div class="empty"><strong>No se pudo cargar</strong>' + esc(e.message) + '</div>';
    return;
  }

  const costoTotal = cache.reduce((a, e) => a + (e.costoEnvio || 0), 0);
  const enTransito = cache.filter(e => e.estado === 'En tránsito').length;
  const perdidos = cache.filter(e => e.estado === 'Perdido').length;
  const paises = new Set(cache.map(e => e.paisDestino)).size;
  $('expMetrics').innerHTML = [
    { c: 'primary', v: cache.length, k: 'Envíos registrados', d: paises + ' país(es) destino' },
    { c: 'info', v: enTransito, k: 'En tránsito', d: 'Pendientes de confirmar llegada' },
    { c: 'ok', v: soles(costoTotal), k: 'Costo de envío acumulado', d: 'Suma de todos los registros' },
    { c: perdidos ? 'bad' : '', v: perdidos, k: 'Perdidos', d: 'Requieren seguimiento' }
  ].map(tarjeta).join('');

  if (!cache.length) {
    $('tExportaciones').innerHTML = '<div class="empty"><strong>Sin envíos registrados</strong>Registra el primero con "Nuevo envío".</div>';
    return;
  }

  const filas = cache.slice().sort((a, b) => b.fechaEnvio.localeCompare(a.fechaEnvio)).map(e => '<tr>'
    + '<td class="nowrap">' + fechaCorta(e.fechaEnvio) + '</td>'
    + '<td class="tk">' + esc(e.oc || '—') + '</td>'
    + '<td class="cell-2">' + esc(e.descripcion) + '</td>'
    + '<td>' + esc(e.paisDestino) + '</td>'
    + '<td class="num">' + (e.costoEnvio != null ? soles(e.costoEnvio) : '<span class="muted">N/D</span>') + '</td>'
    + '<td class="nowrap">' + (e.fechaLlegadaProveedor ? fechaCorta(e.fechaLlegadaProveedor) : '<span class="muted">N/D</span>') + '</td>'
    + '<td class="cell-2">' + esc(e.motivo || '—') + '</td>'
    + '<td>' + estadoChip(e.estado) + '</td>'
    + '<td class="nowrap"><button class="btn btn-sm btn-ghost" onclick="editarExportacion(' + e.id + ')">Editar</button> '
    + '<button class="btn btn-sm btn-ghost" onclick="borrarExportacionVista(' + e.id + ')">Borrar</button></td>'
    + '</tr>').join('');

  $('tExportaciones').innerHTML = '<table><thead><tr>'
    + '<th>Envío</th><th>OC</th><th>Producto</th><th>País destino</th><th class="num">Costo envío</th>'
    + '<th>Llegada al proveedor</th><th>Motivo</th><th>Estado</th><th></th>'
    + '</tr></thead><tbody>' + filas + '</tbody></table>';
}

const tarjeta = x => '<div class="kpi ' + x.c + '"><div class="v">' + esc(String(x.v)) + '</div>'
  + '<div class="k">' + esc(x.k) + '</div><div class="d">' + esc(x.d) + '</div></div>';

function estadoChip(estado) {
  const clase = estado === 'Entregado' ? 'st-concluido' : estado === 'Perdido' ? 'st-cancelado'
    : estado === 'Devuelto' ? 'st-espera' : 'st-transito';
  return '<span class="chip ' + clase + '"><i class="dot"></i>' + esc(estado) + '</span>';
}

const campo = (id, label, type, value, extra) => '<div class="field" style="margin:0 0 14px"><label for="' + id + '">'
  + esc(label) + '</label><input class="input" id="' + id + '" type="' + type + '"' + (extra || '')
  + ' value="' + esc(value == null ? '' : value) + '"></div>';

export function abrirNuevaExportacion() { abrirFormExportacion(null); }
export function editarExportacion(id) { abrirFormExportacion(cache.find(e => e.id === id)); }

function abrirFormExportacion(e) {
  const v = e || {};
  const html = '<div class="row">'
    + campo('expFechaEnvio', 'Fecha de envío *', 'date', v.fechaEnvio || hoyISO())
    + campo('expOc', 'OC', 'text', v.oc || '')
    + '</div>'
    + '<div class="field" style="margin-bottom:14px"><label for="expDescripcion">Descripción del producto enviado *</label>'
    + '<textarea class="textarea" id="expDescripcion">' + esc(v.descripcion || '') + '</textarea></div>'
    + '<div class="row">'
    + campo('expPaisDestino', 'País destino *', 'text', v.paisDestino || '')
    + campo('expCostoEnvio', 'Costo de envío (S/)', 'number', v.costoEnvio, ' step="0.01" min="0"')
    + '</div>'
    + '<div class="row">'
    + campo('expFechaLlegada', 'Fecha de llegada al proveedor', 'date', v.fechaLlegadaProveedor || '')
    + '<div class="field" style="margin:0 0 14px"><label for="expEstado">Estado</label><select class="select" id="expEstado">'
    + ESTADOS.map(s => '<option' + (s === v.estado ? ' selected' : '') + '>' + esc(s) + '</option>').join('') + '</select></div>'
    + '</div>'
    + campo('expMotivo', 'Motivo', 'text', v.motivo || '')
    + '<div class="row">'
    + campo('expTransportista', 'Transportista', 'text', v.transportista || '')
    + campo('expTracking', 'N° de tracking', 'text', v.tracking || '')
    + '</div>'
    + '<div class="field" style="margin-bottom:14px"><label for="expNotas">Notas</label>'
    + '<textarea class="textarea" id="expNotas">' + esc(v.notas || '') + '</textarea></div>'
    + '<div class="err" id="eExportacion"></div>'
    + '<button class="btn btn-sm" onclick="guardarExportacion(' + (e ? e.id : 'null') + ')">Guardar</button>';
  abrirModal(e ? 'Editar envío al exterior' : 'Nuevo envío al exterior', html);
}

export async function guardarExportacion(id) {
  const datos = {
    fechaEnvio: $('expFechaEnvio').value,
    oc: $('expOc').value.trim(),
    descripcion: $('expDescripcion').value.trim(),
    paisDestino: $('expPaisDestino').value.trim(),
    costoEnvio: $('expCostoEnvio').value,
    fechaLlegadaProveedor: $('expFechaLlegada').value,
    estado: $('expEstado').value,
    motivo: $('expMotivo').value.trim(),
    transportista: $('expTransportista').value.trim(),
    tracking: $('expTracking').value.trim(),
    notas: $('expNotas').value.trim()
  };
  try {
    if (id) await api.actualizarExportacion(id, datos); else await api.crearExportacion(datos);
  } catch (e) {
    $('eExportacion').textContent = e.message;
    $('eExportacion').classList.add('on');
    return;
  }
  cerrarModal();
  renderExportaciones();
  toast(id ? 'Envío actualizado' : 'Envío registrado');
}

export function borrarExportacionVista(id) {
  confirmarEliminacion({
    titulo: 'Eliminar envío',
    mensaje: 'Se va a eliminar este registro de exportación. No se puede deshacer.',
    onConfirmar: async motivo => {
      await api.borrarExportacion(id, motivo);
      renderExportaciones();
      toast('Registro borrado', '', 'warn');
    }
  });
}
