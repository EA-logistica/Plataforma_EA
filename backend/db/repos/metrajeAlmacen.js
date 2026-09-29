import { todos, uno, ejecutar, insertarLote, aCamel, enTransaccion } from '../conexion.js';
import { tocar } from './ajustes.js';

/**
 * Metraje ocupado y costo del alquiler del almacén Los Olivos (CO LOGISTIC
 * PERU), por semana o como renta base fija del mes. Se siembra una vez con el
 * histórico de METRAJE ALMACEN LOS OLIVOS.xlsx (data/metrajeAlmacen.js) y de
 * ahí en adelante admin agrega/edita filas a mano -por eso, a diferencia de
 * `ordenesCompra` (solo lectura), tiene CRUD completo-.
 */

const error = (msg, status = 400) => Object.assign(new Error(msg), { status });

// Código de PostgreSQL para "unique_violation" (antes se reconocía por el
// texto 'UNIQUE' del mensaje de SQLite).
const esDuplicado = e => e && e.code === '23505';

const TIPOS = ['semanal', 'mensual'];
const LARGO_MAX = { mesLabel: 20, factura: 30, observaciones: 1000 };

function tope(campo, valor) {
  if (String(valor || '').length > LARGO_MAX[campo]) {
    throw error('El campo "' + campo + '" no puede superar los ' + LARGO_MAX[campo] + ' caracteres.');
  }
}

function fechaValida(v) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
}

function numOpcional(v, campo) {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!isFinite(n) || n < 0) throw error('El campo "' + campo + '" debe ser un número positivo.');
  return n;
}

function normalizar(d) {
  const tipo = TIPOS.includes(d.tipo) ? d.tipo : 'semanal';
  const fechaDesde = String(d.fechaDesde || '').trim();
  const fechaHasta = String(d.fechaHasta || '').trim();
  if (!fechaValida(fechaDesde)) throw error('Indica la fecha "de" (AAAA-MM-DD).');
  if (!fechaValida(fechaHasta)) throw error('Indica la fecha "hasta" (AAAA-MM-DD).');
  if (fechaHasta < fechaDesde) throw error('La fecha "hasta" no puede ser anterior a "de".');

  const precioM2 = Number(d.precioM2);
  if (!isFinite(precioM2) || precioM2 < 0) throw error('El precio por m² debe ser un número positivo.');

  const metraje = numOpcional(d.metraje, 'metraje');
  const precioSinIgv = numOpcional(d.precioSinIgv, 'precio sin IGV');
  const totalConIgv = numOpcional(d.totalConIgv, 'total con IGV');

  const fila = {
    tipo,
    fecha_desde: fechaDesde,
    fecha_hasta: fechaHasta,
    mes_label: String(d.mesLabel || '').trim(),
    precio_m2: precioM2,
    metraje,
    precio_sin_igv: precioSinIgv,
    total_con_igv: totalConIgv,
    factura: String(d.factura || '').trim().toUpperCase(),
    pendiente_validar: d.pendienteValidar ? 1 : 0,
    observaciones: String(d.observaciones || '').trim(),
  };
  tope('mesLabel', fila.mes_label); tope('factura', fila.factura); tope('observaciones', fila.observaciones);
  return fila;
}

export async function total() {
  return (await uno('SELECT COUNT(*) AS n FROM metraje_almacen')).n;
}

export async function listar() {
  return (await todos('SELECT * FROM metraje_almacen ORDER BY fecha_desde ASC, (tipo = \'mensual\') DESC, id ASC')).map(aCamel);
}

export async function porId(id) {
  return aCamel(await uno('SELECT * FROM metraje_almacen WHERE id = ?', [Number(id)]));
}

/**
 * Carga inicial idempotente: cada fila del histórico tiene una clave natural
 * (tipo, fecha_desde, fecha_hasta) única en el esquema, así que una recarga
 * con el mismo archivo no duplica nada (ON CONFLICT DO NOTHING). No pisa
 * filas que admin ya haya editado a mano.
 */
export async function cargarInicial(filas) {
  const columnas = ['tipo', 'fecha_desde', 'fecha_hasta', 'mes_label', 'precio_m2', 'metraje', 'precio_sin_igv',
    'total_con_igv', 'factura', 'pendiente_validar', 'observaciones', 'creado_por'];
  return enTransaccion(() => insertarLote('metraje_almacen', columnas, filas.map(f => ({
    tipo: f.tipo, fecha_desde: f.fechaDesde, fecha_hasta: f.fechaHasta, mes_label: f.mesLabel || '',
    precio_m2: f.precioM2, metraje: f.metraje ?? null, precio_sin_igv: f.precioSinIgv ?? null,
    total_con_igv: f.totalConIgv ?? null, factura: f.factura || '', pendiente_validar: f.pendienteValidar ? 1 : 0,
    observaciones: f.observaciones || '', creado_por: 'siembra',
  })), 'ON CONFLICT (tipo, fecha_desde, fecha_hasta) DO NOTHING'));
}

export async function crear(datos, creadoPor) {
  const f = normalizar(datos);
  let r;
  try {
    r = await ejecutar(
      'INSERT INTO metraje_almacen (tipo, fecha_desde, fecha_hasta, mes_label, precio_m2, metraje, precio_sin_igv, '
      + 'total_con_igv, factura, pendiente_validar, observaciones, creado_por) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) '
      + 'RETURNING id',
      [f.tipo, f.fecha_desde, f.fecha_hasta, f.mes_label, f.precio_m2, f.metraje, f.precio_sin_igv,
        f.total_con_igv, f.factura, f.pendiente_validar, f.observaciones, String(creadoPor || '')]
    );
  } catch (e) {
    if (esDuplicado(e)) throw error('Ya existe una fila ' + f.tipo + ' con ese rango de fechas.');
    throw e;
  }
  await tocar();
  return porId(r.filas[0].id);
}

export async function actualizar(id, datos) {
  const actual = await porId(id);
  if (!actual) throw error('No existe la fila ' + id + '.', 404);
  const f = normalizar({ ...actual, ...datos });
  try {
    await ejecutar(
      'UPDATE metraje_almacen SET tipo=?, fecha_desde=?, fecha_hasta=?, mes_label=?, precio_m2=?, metraje=?, '
      + 'precio_sin_igv=?, total_con_igv=?, factura=?, pendiente_validar=?, observaciones=?, actualizado_en=ahora_txt() WHERE id=?',
      [f.tipo, f.fecha_desde, f.fecha_hasta, f.mes_label, f.precio_m2, f.metraje, f.precio_sin_igv,
        f.total_con_igv, f.factura, f.pendiente_validar, f.observaciones, Number(id)]
    );
  } catch (e) {
    if (esDuplicado(e)) throw error('Ya existe una fila ' + f.tipo + ' con ese rango de fechas.');
    throw e;
  }
  await tocar();
  return porId(id);
}

export async function eliminar(id) {
  const r = await ejecutar('DELETE FROM metraje_almacen WHERE id = ?', [Number(id)]);
  if (!r.changes) throw error('No existe la fila ' + id + '.', 404);
  await tocar();
  return { id: Number(id) };
}

/**
 * Indicadores para las tarjetas y gráficos: última semana confirmada, renta
 * base del mes en curso, promedio $/m² y totales -todo excluyendo filas
 * `pendiente_validar` de las sumas, aunque sí siguen viéndose en la tabla-.
 * Los totales son SIN IGV: el 18% de IGV es crédito fiscal (se descuenta del
 * que la empresa ya paga por sus ventas), no un costo real -mismo criterio
 * que payback, ver frontend/js/views/payback/vista.js-.
 */
export async function resumen() {
  const filas = await listar();
  const semanas = filas.filter(f => f.tipo === 'semanal' && !f.pendienteValidar);
  const meses = filas.filter(f => f.tipo === 'mensual' && !f.pendienteValidar);
  const pendientes = filas.filter(f => f.pendienteValidar);

  const ultimaSemana = semanas[semanas.length - 1] || null;
  const ultimoMes = meses[meses.length - 1] || null;

  const metrajeTotal = semanas.reduce((s, f) => s + (f.metraje || 0), 0);
  const costoSemanalTotal = semanas.reduce((s, f) => s + (f.precioSinIgv || 0), 0);
  const costoMensualBaseTotal = meses.reduce((s, f) => s + (f.precioSinIgv || 0), 0);
  const promedioMetraje = semanas.length ? metrajeTotal / semanas.length : 0;
  const promedioPrecioM2 = semanas.length ? semanas.reduce((s, f) => s + (f.precioM2 || 0), 0) / semanas.length : 0;

  return {
    ultimaSemana,
    ultimoMes,
    pendientesValidar: pendientes.length,
    semanasRegistradas: semanas.length,
    mesesRegistrados: meses.length,
    metrajeTotalAcumulado: metrajeTotal,
    costoSemanalTotalAcumulado: costoSemanalTotal,
    costoMensualBaseTotalAcumulado: costoMensualBaseTotal,
    promedioMetrajeSemanal: promedioMetraje,
    promedioPrecioM2: promedioPrecioM2,
  };
}
