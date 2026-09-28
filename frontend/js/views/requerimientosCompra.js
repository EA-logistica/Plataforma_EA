import { $, esc } from '../utils/dom.js';
import { soles, fechaCorta, hoyISO, corta } from '../utils/format.js';
import { toast } from '../utils/toast.js';
import * as api from '../api/estado.js';
import { abrirModal, cerrarModal, confirmarEliminacion } from './dispatch.js';

/** Texto seguro dentro de un onclick="fn('…')": escapa \ y ' para JS y después para HTML. Con esc() solo, un nombre como 'NEGOCIACION KIO' SAC rompía el clic. */
const jsStr = s => esc(String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/'/g, "\\'"));

/**
 * Requerimientos de compra: materia prima local e importada (resinas, PP,
 * PE de soplado e inyección), repuestos y servicios que el coordinador de
 * logística tiene que gestionar. Solo lo ve admin (ver tabs.js).
 */
const dolares = n => 'US$ ' + (Number(n) || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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

export function borrarRequerimientoVista(id) {
  confirmarEliminacion({
    titulo: 'Eliminar requerimiento',
    mensaje: 'Se va a eliminar este requerimiento de compra. No se puede deshacer.',
    onConfirmar: async motivo => {
      await api.borrarRequerimiento(id, motivo);
      renderRequerimientos();
      toast('Requerimiento borrado', '', 'warn');
    }
  });
}

/**
 * Historial de requerimientos de compra del ERP (data/
 * requerimientosCompraHistorico.js): solo lectura, vive en el mismo panel
 * porque es la misma pregunta -"qué se requirió comprar"- que el bloque de
 * arriba, solo que resuelta por el ERP en vez de registrada a mano en la app.
 * Paginado en servidor: son ~2200 requerimientos, no caben de una vez.
 */
const RQC_FILAS_POR_PAGINA = 30;
let rqcPagina = 1;
let rqcProveedoresCache = null;
let rqcOpcionesCache = null;
let rqcEstadoFiltro = '';

export function renderRequerimientosHistoricoSiVisible() {
  if ($('aRequerimientos').classList.contains('on')) renderRequerimientosHistorico();
}

function rqcFiltroActual() {
  return {
    q: $('rqcQ').value.trim(),
    proveedor: $('rqcProveedor').value,
    familia: $('rqcFamilia').value,
    linea: $('rqcLinea').value,
    desde: $('rqcDesde').value,
    hasta: $('rqcHasta').value,
    estado: rqcEstadoFiltro
  };
}

export function setFiltroRequerimientosHistorico() { rqcPagina = 1; renderRequerimientosHistorico(); }
export function irPaginaRequerimientosHistorico(n) { rqcPagina = n; renderRequerimientosHistorico(); }
export function limpiarFiltroRequerimientosHistorico() {
  $('rqcQ').value = ''; $('rqcProveedor').value = ''; $('rqcFamilia').value = ''; $('rqcLinea').value = '';
  $('rqcDesde').value = ''; $('rqcHasta').value = ''; rqcEstadoFiltro = '';
  setFiltroRequerimientosHistorico();
}

/** Clic en un chip de estado (Todos / Aprobados / Parcialmente atendidos): filtra y vuelve a pintar los chips con los conteos ya actualizados. */
export function setEstadoRequerimientosHistorico(estado) { rqcEstadoFiltro = estado; setFiltroRequerimientosHistorico(); }

async function rqcAsegurarOpciones() {
  if (rqcProveedoresCache) return;
  const [proveedores, opciones] = await Promise.all([
    api.proveedoresRequerimientosHistorico(),
    api.opcionesRequerimientosHistorico()
  ]);
  rqcProveedoresCache = proveedores;
  rqcOpcionesCache = opciones;
  $('rqcProveedor').innerHTML = '<option value="">Todos los proveedores</option>'
    + proveedores.map(p => '<option value="' + esc(p.proveedor) + '">' + esc(p.proveedor) + ' (' + p.requerimientos + ')</option>').join('');
  $('rqcFamilia').innerHTML = '<option value="">Toda familia</option>' + opciones.familias.map(v => '<option>' + esc(v) + '</option>').join('');
  $('rqcLinea').innerHTML = '<option value="">Toda línea</option>' + opciones.lineas.map(v => '<option>' + esc(v) + '</option>').join('');
}

export async function renderRequerimientosHistorico() {
  try {
    await rqcAsegurarOpciones();
    const filtro = rqcFiltroActual();
    const [resumen, lista] = await Promise.all([
      api.resumenRequerimientosHistorico(filtro),
      api.listarRequerimientosHistorico({ ...filtro, pagina: rqcPagina, porPagina: RQC_FILAS_POR_PAGINA })
    ]);
    rqcPintarMetricas(resumen);
    rqcPintarChipsEstado(resumen);
    rqcPintarTabla(lista);
  } catch (e) {
    $('tRequerimientosHistorico').innerHTML = '<div class="empty"><strong>No se pudo cargar</strong>' + esc(e.message) + '</div>';
  }
}

/**
 * El ERP solo distingue dos estados -Aprobada y Parcialmente atendida-, y en
 * los datos de verdad "Aprobada" siempre significa cero avance (en cuanto se
 * atiende algo, el ERP la pasa a "Parcialmente atendida"): por eso el número
 * es el mismo si se le llama "Aprobados" o "Pendientes" -aquí se usa
 * "Pendientes", que es la lectura operativa (qué falta atender), y NO se
 * repite como "Aprobados" aparte, que sería el mismo número dos veces-.
 */
function rqcPintarMetricas(r) {
  $('rqcMetrics').innerHTML = [
    { c: 'primary', v: r.requerimientos.toLocaleString('es-PE'), k: 'Requerimientos totales', d: 'Según el filtro aplicado' },
    { c: 'info', v: r.pendientes.toLocaleString('es-PE'), k: 'Pendientes', d: 'Aprobados sin ninguna atención iniciada' },
    { c: '', v: r.parciales.toLocaleString('es-PE'), k: 'Parcialmente atendidos', d: 'Con saldo pendiente de recibir' },
    { c: 'ok', v: r.proveedores.toLocaleString('es-PE'), k: 'Proveedores', d: r.productos.toLocaleString('es-PE') + ' productos distintos en el filtro' }
  ].map(tarjeta).join('');
}

function rqcPintarChipsEstado(r) {
  $('rqcChipsEstado').innerHTML = [
    ['', 'Todos', r.requerimientos],
    ['APROBADA', 'Aprobados', r.aprobados],
    ['PARCIALMEN', 'Parcialmente atendidos', r.parciales]
  ].map(([valor, etiqueta, n]) =>
    '<button class="fchip' + (rqcEstadoFiltro === valor ? ' on' : '') + '" onclick="setEstadoRequerimientosHistorico(\'' + valor + '\')">'
    + esc(etiqueta) + ' (' + n.toLocaleString('es-PE') + ')</button>'
  ).join('');
}

function rqcEstadoChip(estado) {
  const clase = estado === 'APROBADA' ? 'st-concluido' : estado === 'PARCIALMEN' ? 'st-transito' : 'st-espera';
  const texto = estado === 'PARCIALMEN' ? 'Parcialmente atendida' : (estado || '—');
  return '<span class="chip ' + clase + '"><i class="dot"></i>' + esc(texto) + '</span>';
}

function rqcPintarTabla(lista) {
  if (!lista.filas.length) {
    $('tRequerimientosHistorico').innerHTML = '<div class="empty"><strong>Sin coincidencias</strong>Prueba con otro filtro.</div>';
    $('rqcPaginacion').innerHTML = '';
    return;
  }
  const filas = lista.filas.map(r => '<tr>'
    + '<td class="nowrap">' + fechaCorta(r.fechaEmision) + '</td>'
    + '<td class="tk">' + esc(r.numeroRequerimiento) + '/' + r.item + '</td>'
    + '<td class="cell-2">' + esc(r.nombreProducto) + '<span>' + esc(r.codigoProducto || '—') + '</span></td>'
    + '<td class="num">' + r.cantidad.toLocaleString('es-PE') + ' ' + esc(r.unidadMedida) + '</td>'
    + '<td class="num">' + r.saldo.toLocaleString('es-PE') + '</td>'
    + '<td>' + (r.proveedor
        ? '<button class="btn btn-sm btn-ghost" onclick="verFacturasProveedorRqc(\'' + jsStr(r.proveedor) + '\')">' + esc(corta(r.proveedor, 28)) + '</button>'
        : '<span class="muted">—</span>')
    + '</td>'
    + '<td>' + rqcEstadoChip(r.estado) + '</td>'
    + '</tr>').join('');

  $('tRequerimientosHistorico').innerHTML = '<table><thead><tr>'
    + '<th>Emisión</th><th>Requerimiento</th><th>Producto</th><th class="num">Cantidad</th><th class="num">Saldo</th><th>Proveedor</th><th>Estado</th>'
    + '</tr></thead><tbody>' + filas + '</tbody></table>';

  const totalPaginas = Math.max(1, Math.ceil(lista.total / lista.porPagina));
  const inicio = (lista.pagina - 1) * lista.porPagina;
  const hasta = Math.min(inicio + lista.porPagina, lista.total);
  $('rqcPaginacion').innerHTML = '<span class="muted small">Mostrando ' + (lista.total ? inicio + 1 : 0) + '–' + hasta + ' de ' + lista.total + '</span>'
    + (totalPaginas > 1
      ? '<button class="btn btn-sm btn-ghost"' + (lista.pagina <= 1 ? ' disabled' : '') + ' onclick="irPaginaRequerimientosHistorico(' + (lista.pagina - 1) + ')">‹ Anterior</button>'
        + '<span class="small">Página ' + lista.pagina + ' de ' + totalPaginas + '</span>'
        + '<button class="btn btn-sm btn-ghost"' + (lista.pagina >= totalPaginas ? ' disabled' : '') + ' onclick="irPaginaRequerimientosHistorico(' + (lista.pagina + 1) + ')">Siguiente ›</button>'
      : '');
}

/**
 * Cruce con Órdenes de Compra: el historial de requerimientos no trae monto
 * ni factura -el ERP de requerimientos y el registro de compras de SUNAT son
 * dos libros distintos-, pero comparten el nombre del proveedor tal cual, así
 * que esta es la pregunta que sí se puede responder con certeza: "¿cuánto le
 * hemos facturado en total a este proveedor?".
 */
export async function verFacturasProveedorRqc(proveedor) {
  let r;
  try {
    r = await api.resumenOrdenesCompra({ proveedor });
  } catch (e) {
    abrirModal(proveedor, '<div class="empty"><strong>No se pudo cargar</strong>' + esc(e.message) + '</div>');
    return;
  }
  const html = r.comprobantes
    ? '<div class="kpis">'
      + tarjeta({ c: 'primary', v: r.comprobantes.toLocaleString('es-PE'), k: 'Comprobantes', d: 'En el registro de compras' })
      + (r.pen.comprobantes ? tarjeta({ c: 'ok', v: soles(r.pen.total), k: 'Valorizado en soles', d: r.pen.comprobantes.toLocaleString('es-PE') + ' comp. · promedio ' + soles(r.pen.ticketPromedio) }) : '')
      + (r.usd.comprobantes ? tarjeta({ c: 'info', v: dolares(r.usd.total), k: 'Valorizado en dólares', d: r.usd.comprobantes.toLocaleString('es-PE') + ' comp. · promedio ' + dolares(r.usd.ticketPromedio) }) : '')
      + '</div>'
    : '<div class="empty"><strong>Sin comprobantes</strong>Este proveedor no aparece en el registro de compras.</div>';
  abrirModal('Órdenes de compra · ' + proveedor, html);
}
