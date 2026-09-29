import { todos, uno, ejecutar, aCamel } from '../conexion.js';
import { tocar } from './ajustes.js';

/**
 * Servicios que contrata logística -mantenimiento, transporte especializado,
 * certificaciones, agenciamiento de aduana-, distintos de la mensajería
 * (`solicitudes`). Solo admin lo administra.
 */

const error = (msg, status = 400) => Object.assign(new Error(msg), { status });

const TIPOS = ['Mantenimiento', 'Transporte especializado', 'Certificación', 'Agenciamiento de aduana', 'Consultoría', 'Otro'];
const ESTADOS = ['Cotizando', 'Aprobado', 'En ejecución', 'Concluido', 'Cancelado'];
const MONEDAS = ['PEN', 'USD'];
const LARGO_MAX = { descripcion: 400, proveedor: 150, responsable: 120, observaciones: 500 };

function tope(campo, valor) {
  if (String(valor || '').length > LARGO_MAX[campo]) {
    throw error('El campo "' + campo + '" no puede superar los ' + LARGO_MAX[campo] + ' caracteres.');
  }
}

function normalizar(d) {
  const fechaSolicitud = String(d.fechaSolicitud || '').trim();
  const descripcion = String(d.descripcion || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaSolicitud)) throw error('Indica la fecha de solicitud (AAAA-MM-DD).');
  if (descripcion.length < 3) throw error('Describe el servicio.');
  if (d.fechaInicio && !/^\d{4}-\d{2}-\d{2}$/.test(d.fechaInicio)) throw error('La fecha de inicio no es válida.');
  if (d.fechaTermino && !/^\d{4}-\d{2}-\d{2}$/.test(d.fechaTermino)) throw error('La fecha de término no es válida.');
  if (d.costo != null && d.costo !== '' && (!isFinite(Number(d.costo)) || Number(d.costo) < 0)) {
    throw error('El costo debe ser un número positivo.');
  }

  const tipoServicio = TIPOS.includes(d.tipoServicio) ? d.tipoServicio : 'Otro';
  const estado = ESTADOS.includes(d.estado) ? d.estado : 'Cotizando';
  const moneda = MONEDAS.includes(d.moneda) ? d.moneda : 'PEN';

  const fila = {
    fecha_solicitud: fechaSolicitud,
    tipo_servicio: tipoServicio,
    proveedor: String(d.proveedor || '').trim(),
    descripcion,
    costo: d.costo != null && d.costo !== '' ? Number(d.costo) : null,
    moneda,
    estado,
    fecha_inicio: String(d.fechaInicio || '').trim(),
    fecha_termino: String(d.fechaTermino || '').trim(),
    responsable: String(d.responsable || '').trim(),
    observaciones: String(d.observaciones || '').trim()
  };
  tope('descripcion', fila.descripcion); tope('proveedor', fila.proveedor);
  tope('responsable', fila.responsable); tope('observaciones', fila.observaciones);
  return fila;
}

export async function listar() {
  return (await todos('SELECT * FROM servicios_logistica ORDER BY fecha_solicitud DESC, id DESC')).map(aCamel);
}

export async function porId(id) {
  return aCamel(await uno('SELECT * FROM servicios_logistica WHERE id = ?', [Number(id)]));
}

export async function crear(datos, creadoPor) {
  const f = normalizar(datos);
  const r = await ejecutar(
    'INSERT INTO servicios_logistica (fecha_solicitud, tipo_servicio, proveedor, descripcion, costo, moneda, '
    + 'estado, fecha_inicio, fecha_termino, responsable, observaciones, creado_por) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) '
    + 'RETURNING id',
    [f.fecha_solicitud, f.tipo_servicio, f.proveedor, f.descripcion, f.costo, f.moneda, f.estado,
      f.fecha_inicio, f.fecha_termino, f.responsable, f.observaciones, String(creadoPor || '')]
  );
  await tocar('app');
  return porId(r.filas[0].id);
}

export async function actualizar(id, datos) {
  const actual = await porId(id);
  if (!actual) throw error('No existe el servicio ' + id + '.', 404);
  const f = normalizar({ ...actual, ...datos });
  await ejecutar(
    'UPDATE servicios_logistica SET fecha_solicitud=?, tipo_servicio=?, proveedor=?, descripcion=?, costo=?, '
    + 'moneda=?, estado=?, fecha_inicio=?, fecha_termino=?, responsable=?, observaciones=? WHERE id=?',
    [f.fecha_solicitud, f.tipo_servicio, f.proveedor, f.descripcion, f.costo, f.moneda, f.estado,
      f.fecha_inicio, f.fecha_termino, f.responsable, f.observaciones, Number(id)]
  );
  await tocar('app');
  return porId(id);
}

export async function eliminar(id) {
  const r = await ejecutar('DELETE FROM servicios_logistica WHERE id = ?', [Number(id)]);
  if (!r.changes) throw error('No existe el servicio ' + id + '.', 404);
  await tocar('app');
  return { id: Number(id) };
}
