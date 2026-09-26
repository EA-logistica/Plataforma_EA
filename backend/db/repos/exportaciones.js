import { db, aCamel } from '../conexion.js';
import { tocar } from './ajustes.js';

/**
 * Muestras enviadas a proveedores en el exterior, con trazabilidad de
 * envío. Solo admin lo administra (ver requiereRol('admin') en las rutas).
 */

const error = (msg, status = 400) => Object.assign(new Error(msg), { status });

const ESTADOS = ['En tránsito', 'Entregado', 'Devuelto', 'Perdido'];
const LARGO_MAX = { descripcion: 400, motivo: 300, notas: 500, oc: 60, transportista: 120, tracking: 80 };

function tope(campo, valor) {
  if (String(valor || '').length > LARGO_MAX[campo]) {
    throw error('El campo "' + campo + '" no puede superar los ' + LARGO_MAX[campo] + ' caracteres.');
  }
}

function normalizar(d) {
  const fechaEnvio = String(d.fechaEnvio || '').trim();
  const descripcion = String(d.descripcion || '').trim();
  const paisDestino = String(d.paisDestino || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaEnvio)) throw error('Indica la fecha de envío (AAAA-MM-DD).');
  if (descripcion.length < 3) throw error('Describe el producto enviado.');
  if (paisDestino.length < 2) throw error('Indica el país destino.');
  if (d.fechaLlegadaProveedor && !/^\d{4}-\d{2}-\d{2}$/.test(d.fechaLlegadaProveedor)) {
    throw error('La fecha de llegada al proveedor no es válida.');
  }
  if (d.costoEnvio != null && d.costoEnvio !== '' && (!isFinite(Number(d.costoEnvio)) || Number(d.costoEnvio) < 0)) {
    throw error('El costo de envío debe ser un número positivo.');
  }
  const estado = d.estado && ESTADOS.includes(d.estado) ? d.estado : 'En tránsito';

  const fila = {
    fecha_envio: fechaEnvio,
    oc: String(d.oc || '').trim(),
    costo_envio: d.costoEnvio != null && d.costoEnvio !== '' ? Number(d.costoEnvio) : null,
    descripcion,
    pais_destino: paisDestino,
    fecha_llegada_proveedor: String(d.fechaLlegadaProveedor || '').trim(),
    motivo: String(d.motivo || '').trim(),
    transportista: String(d.transportista || '').trim(),
    tracking: String(d.tracking || '').trim(),
    estado,
    responsable: String(d.responsable || '').trim(),
    notas: String(d.notas || '').trim()
  };
  tope('descripcion', fila.descripcion); tope('motivo', fila.motivo); tope('notas', fila.notas);
  tope('oc', fila.oc); tope('transportista', fila.transportista); tope('tracking', fila.tracking);
  return fila;
}

export function listar() {
  return db().prepare('SELECT * FROM exportaciones ORDER BY fecha_envio DESC, id DESC').all().map(aCamel);
}

export function porId(id) {
  return aCamel(db().prepare('SELECT * FROM exportaciones WHERE id = ?').get(Number(id)));
}

export function crear(datos, creadoPor) {
  const f = normalizar(datos);
  const r = db().prepare(
    'INSERT INTO exportaciones (fecha_envio, oc, costo_envio, descripcion, pais_destino, '
    + 'fecha_llegada_proveedor, motivo, transportista, tracking, estado, responsable, notas, creado_por) '
    + 'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(f.fecha_envio, f.oc, f.costo_envio, f.descripcion, f.pais_destino, f.fecha_llegada_proveedor,
        f.motivo, f.transportista, f.tracking, f.estado, f.responsable, f.notas, String(creadoPor || ''));
  tocar();
  return porId(r.lastInsertRowid);
}

export function actualizar(id, datos) {
  if (!porId(id)) throw error('No existe la exportación ' + id + '.', 404);
  const f = normalizar({ ...porId(id), ...datos });
  db().prepare(
    'UPDATE exportaciones SET fecha_envio=?, oc=?, costo_envio=?, descripcion=?, pais_destino=?, '
    + 'fecha_llegada_proveedor=?, motivo=?, transportista=?, tracking=?, estado=?, responsable=?, notas=? WHERE id=?'
  ).run(f.fecha_envio, f.oc, f.costo_envio, f.descripcion, f.pais_destino, f.fecha_llegada_proveedor,
        f.motivo, f.transportista, f.tracking, f.estado, f.responsable, f.notas, Number(id));
  tocar();
  return porId(id);
}

export function eliminar(id) {
  const r = db().prepare('DELETE FROM exportaciones WHERE id = ?').run(Number(id));
  if (!r.changes) throw error('No existe la exportación ' + id + '.', 404);
  tocar();
  return { id: Number(id) };
}
