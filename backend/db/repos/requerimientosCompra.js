import { db, aCamel, enTransaccion } from '../conexion.js';
import { tocar } from './ajustes.js';

/**
 * Requerimientos de compra que gestiona el coordinador de logística: materia
 * prima local e importada (resinas, PP, PE de soplado e inyección),
 * repuestos y servicios. Solo admin lo administra.
 *
 * El correlativo lo asigna el servidor, igual que en solicitudes.js: dos
 * personas guardando a la vez no deben chocar de número.
 */

const error = (msg, status = 400) => Object.assign(new Error(msg), { status });

const CATEGORIAS = ['Materia prima local', 'Materia prima importada', 'Repuestos', 'Servicios', 'Otros'];
const PRIORIDADES = ['Urgente', 'Alta', 'Normal', 'Baja'];
const ESTADOS = ['Pendiente', 'Cotizando', 'Aprobado', 'OC emitida', 'Recibido', 'Rechazado', 'Cancelado'];
const MONEDAS = ['PEN', 'USD'];
const LARGO_MAX = { descripcion: 400, areaSolicitante: 120, unidadMedida: 40, proveedorSugerido: 150, numeroOc: 60, observaciones: 500 };

function tope(campo, valor) {
  if (String(valor || '').length > LARGO_MAX[campo]) {
    throw error('El campo "' + campo + '" no puede superar los ' + LARGO_MAX[campo] + ' caracteres.');
  }
}

const numero = (v, campo) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!isFinite(n) || n < 0) throw error('"' + campo + '" debe ser un número positivo.');
  return n;
};

function normalizar(d) {
  const fechaSolicitud = String(d.fechaSolicitud || '').trim();
  const descripcion = String(d.descripcion || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaSolicitud)) throw error('Indica la fecha de solicitud (AAAA-MM-DD).');
  if (descripcion.length < 3) throw error('Describe qué se necesita comprar.');
  if (d.fechaRequerida && !/^\d{4}-\d{2}-\d{2}$/.test(d.fechaRequerida)) throw error('La fecha requerida no es válida.');

  const categoria = CATEGORIAS.includes(d.categoria) ? d.categoria : 'Otros';
  const prioridad = PRIORIDADES.includes(d.prioridad) ? d.prioridad : 'Normal';
  const estado = ESTADOS.includes(d.estado) ? d.estado : 'Pendiente';
  const moneda = MONEDAS.includes(d.moneda) ? d.moneda : 'PEN';

  const fila = {
    fecha_solicitud: fechaSolicitud,
    area_solicitante: String(d.areaSolicitante || '').trim(),
    descripcion,
    categoria,
    cantidad: numero(d.cantidad, 'Cantidad'),
    unidad_medida: String(d.unidadMedida || '').trim(),
    proveedor_sugerido: String(d.proveedorSugerido || '').trim(),
    prioridad,
    fecha_requerida: String(d.fechaRequerida || '').trim(),
    estado,
    numero_oc: String(d.numeroOc || '').trim(),
    moneda,
    costo_estimado: numero(d.costoEstimado, 'Costo estimado'),
    costo_real: numero(d.costoReal, 'Costo real'),
    observaciones: String(d.observaciones || '').trim()
  };
  tope('descripcion', fila.descripcion); tope('areaSolicitante', fila.area_solicitante);
  tope('unidadMedida', fila.unidad_medida); tope('proveedorSugerido', fila.proveedor_sugerido);
  tope('numeroOc', fila.numero_oc); tope('observaciones', fila.observaciones);
  return fila;
}

export function listar() {
  return db().prepare('SELECT * FROM requerimientos_compra ORDER BY correlativo DESC').all().map(aCamel);
}

export function porId(id) {
  return aCamel(db().prepare('SELECT * FROM requerimientos_compra WHERE id = ?').get(Number(id)));
}

export function crear(datos, creadoPor) {
  const f = normalizar(datos);
  return enTransaccion(base => {
    const max = base.prepare('SELECT COALESCE(MAX(correlativo), 0) AS n FROM requerimientos_compra').get().n;
    const correlativo = max + 1;
    const r = base.prepare(
      'INSERT INTO requerimientos_compra (correlativo, fecha_solicitud, area_solicitante, descripcion, categoria, '
      + 'cantidad, unidad_medida, proveedor_sugerido, prioridad, fecha_requerida, estado, numero_oc, moneda, '
      + 'costo_estimado, costo_real, observaciones, creado_por) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(correlativo, f.fecha_solicitud, f.area_solicitante, f.descripcion, f.categoria, f.cantidad,
          f.unidad_medida, f.proveedor_sugerido, f.prioridad, f.fecha_requerida, f.estado, f.numero_oc,
          f.moneda, f.costo_estimado, f.costo_real, f.observaciones, String(creadoPor || ''));
    tocar('app');
    return aCamel(base.prepare('SELECT * FROM requerimientos_compra WHERE id = ?').get(r.lastInsertRowid));
  });
}

export function actualizar(id, datos) {
  const actual = porId(id);
  if (!actual) throw error('No existe el requerimiento ' + id + '.', 404);
  const f = normalizar({ ...actual, ...datos });
  db().prepare(
    'UPDATE requerimientos_compra SET fecha_solicitud=?, area_solicitante=?, descripcion=?, categoria=?, '
    + 'cantidad=?, unidad_medida=?, proveedor_sugerido=?, prioridad=?, fecha_requerida=?, estado=?, numero_oc=?, '
    + 'moneda=?, costo_estimado=?, costo_real=?, observaciones=? WHERE id=?'
  ).run(f.fecha_solicitud, f.area_solicitante, f.descripcion, f.categoria, f.cantidad, f.unidad_medida,
        f.proveedor_sugerido, f.prioridad, f.fecha_requerida, f.estado, f.numero_oc, f.moneda,
        f.costo_estimado, f.costo_real, f.observaciones, Number(id));
  tocar('app');
  return porId(id);
}

export function eliminar(id) {
  const r = db().prepare('DELETE FROM requerimientos_compra WHERE id = ?').run(Number(id));
  if (!r.changes) throw error('No existe el requerimiento ' + id + '.', 404);
  tocar('app');
  return { id: Number(id) };
}
