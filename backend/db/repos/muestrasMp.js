import { todos, uno, ejecutar, aCamel, enTransaccion } from '../conexion.js';
import { tocar } from './ajustes.js';

/**
 * Muestras de materia prima que llegan al almacén (pestaña "Muestras" de
 * Materia Prima). Registro propio de logística, no del ERP: qué llegó, de
 * qué proveedor, cuántos kg, a qué precio y cómo terminó su evaluación.
 *
 * Cada escritura llama a tocar() SIN ámbito: estas rutas viven bajo
 * /api/materia-prima, que el caché agrupa con los reportes del ERP
 * (middleware/cache.js); con tocar('app') la lista seguiría mostrando la
 * versión anterior hasta la próxima recarga del ERP.
 *
 * El subtotal no se guarda: es cantidad × precio y se calcula al leer, así
 * nunca queda desalineado si se corrige uno de los dos.
 */

const error = (msg, status = 400) => Object.assign(new Error(msg), { status });

export const ESTADOS = ['Recibida', 'En evaluación', 'Aprobada', 'Rechazada'];
const LARGO_MAX = { descripcion: 300, familia: 120, proveedor: 200, observaciones: 800, codigoProducto: 30 };

const numero = (v, campo) => {
  if (v == null || v === '') return 0;
  const n = Number(String(v).replace(/,/g, ''));
  if (!Number.isFinite(n) || n < 0) throw error('El campo "' + campo + '" debe ser un número positivo.');
  return n;
};

/** Acepta AAAA-MM-DD o dd/mm/aaaa (como viene de Excel). */
function fecha(v) {
  const t = String(v || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0');
  return '';
}

function normalizar(d) {
  const f = {
    fecha_llegada: fecha(d.fechaLlegada),
    ruc_proveedor: String(d.rucProveedor || '').replace(/\D/g, ''),
    proveedor: String(d.proveedor || '').trim(),
    descripcion: String(d.descripcion || '').trim(),
    familia: String(d.familia || '').trim().toUpperCase(),
    codigo_producto: String(d.codigoProducto || '').trim(),
    cantidad_kg: numero(d.cantidadKg, 'cantidad'),
    precio_kg: numero(d.precioKg, 'precio por kg'),
    moneda: d.moneda === 'PEN' ? 'PEN' : 'USD',
    estado: ESTADOS.includes(d.estado) ? d.estado : 'Recibida',
    observaciones: String(d.observaciones || '').trim()
  };
  if (!f.fecha_llegada) throw error('Indica la fecha de llegada (AAAA-MM-DD o dd/mm/aaaa).');
  if (f.ruc_proveedor && f.ruc_proveedor.length !== 11) throw error('El RUC del proveedor debe tener 11 dígitos.');
  if (f.descripcion.length < 3) throw error('Describe la muestra.');
  if (!f.cantidad_kg) throw error('Indica la cantidad recibida en kg.');
  for (const [campo, largo] of Object.entries(LARGO_MAX)) {
    const col = campo.replace(/[A-Z]/g, c => '_' + c.toLowerCase());
    if (String(f[col] || '').length > largo) throw error('El campo "' + campo + '" no puede superar los ' + largo + ' caracteres.');
  }
  return f;
}

const conSubtotal = m => m && ({ ...m, subtotal: Math.round(m.cantidadKg * m.precioKg * 100) / 100 });

/** Nombre del proveedor por su RUC, tomado del historial de OC (si le hemos comprado alguna vez). */
export async function proveedorPorRuc(ruc) {
  const r = String(ruc || '').replace(/\D/g, '');
  if (r.length !== 11) return '';
  const f = await uno(
    'SELECT proveedor FROM ordenes_compra_detalle WHERE ruc_proveedor = ? AND proveedor <> \'\' ORDER BY fecha_emision DESC LIMIT 1', [r]
  ) || await uno('SELECT proveedor FROM muestras_mp WHERE ruc_proveedor = ? AND proveedor <> \'\' LIMIT 1', [r]);
  return f ? f.proveedor : '';
}

async function completarProveedor(f) {
  if (!f.proveedor && f.ruc_proveedor) f.proveedor = await proveedorPorRuc(f.ruc_proveedor);
  return f;
}

export async function listar() {
  return (await todos('SELECT * FROM muestras_mp ORDER BY fecha_llegada DESC, id DESC')).map(aCamel).map(conSubtotal);
}

export async function porId(id) {
  return conSubtotal(aCamel(await uno('SELECT * FROM muestras_mp WHERE id = ?', [Number(id)])));
}

const COLS = ['fecha_llegada', 'ruc_proveedor', 'proveedor', 'descripcion', 'familia', 'codigo_producto',
  'cantidad_kg', 'precio_kg', 'moneda', 'estado', 'observaciones'];

async function insertar(f, creadoPor) {
  const r = await ejecutar(
    'INSERT INTO muestras_mp (' + COLS.join(', ') + ', creado_por) VALUES (' + COLS.map(() => '?').join(', ') + ', ?) RETURNING id',
    [...COLS.map(c => f[c]), String(creadoPor || '')]
  );
  return r.filas[0].id;
}

export async function crear(datos, creadoPor) {
  const f = await completarProveedor(normalizar(datos));
  const id = await insertar(f, creadoPor);
  await tocar();
  return porId(id);
}

/**
 * Varias muestras de una vez -lo que se pega desde el Excel de muestras-.
 * Todo o nada: si una fila no es válida, no se guarda ninguna y se dice cuál.
 */
export async function crearLote(filas, creadoPor) {
  if (!Array.isArray(filas) || !filas.length) throw error('No llegó ninguna fila.');
  if (filas.length > 500) throw error('Son demasiadas filas de una vez (máximo 500).');
  const normalizadas = [];
  for (let i = 0; i < filas.length; i++) {
    try { normalizadas.push(await completarProveedor(normalizar(filas[i]))); }
    catch (e) { throw error('Fila ' + (i + 1) + ': ' + e.message); }
  }
  const ids = await enTransaccion(async () => {
    const salida = [];
    for (const f of normalizadas) salida.push(await insertar(f, creadoPor));
    return salida;
  });
  await tocar();
  return { creadas: ids.length };
}

export async function actualizar(id, datos) {
  const actual = await porId(id);
  if (!actual) throw error('No existe la muestra ' + id + '.', 404);
  const f = normalizar({ ...actual, ...datos });
  if (!('proveedor' in datos) || f.ruc_proveedor !== actual.rucProveedor) await completarProveedor(f);
  await ejecutar(
    'UPDATE muestras_mp SET ' + COLS.map(c => c + ' = ?').join(', ') + ', actualizado_en = ahora_txt() WHERE id = ?',
    [...COLS.map(c => f[c]), Number(id)]
  );
  await tocar();
  return porId(id);
}

export async function eliminar(id) {
  const r = await ejecutar('DELETE FROM muestras_mp WHERE id = ?', [Number(id)]);
  if (!r.changes) throw error('No existe la muestra ' + id + '.', 404);
  await tocar();
  return { id: Number(id) };
}

// ----------------------------------------------------------------- indicadores
const mesDe = f => String(f || '').slice(0, 7);
const mesAnteriorDe = mes => {
  const [a, m] = mes.split('-').map(Number);
  return m === 1 ? (a - 1) + '-12' : a + '-' + String(m - 1).padStart(2, '0');
};

function acumular(lista) {
  const provs = new Set(lista.map(x => x.rucProveedor || x.proveedor).filter(Boolean));
  const suma = (mon) => lista.filter(x => x.moneda === mon).reduce((a, x) => a + x.subtotal, 0);
  return {
    muestras: lista.length,
    kg: lista.reduce((a, x) => a + x.cantidadKg, 0),
    usd: suma('USD'),
    pen: suma('PEN'),
    proveedores: provs.size,
    gratuitas: lista.filter(x => !x.precioKg).length
  };
}

/**
 * Todo lo que pinta la pestaña, calculado sobre un mes (por defecto el
 * actual) y su año: el volumen de muestras, lo invertido (US$ y S/ por
 * separado, nunca sumados), el embudo de evaluación, lo pendiente de evaluar
 * y cuánto cuesta la muestra frente al costo actual en stock de su familia
 * -la pregunta de gerencia: ¿estas alternativas son más baratas?-.
 */
export async function resumen(mesPedido) {
  const todas = await listar();
  const hoy = new Date();
  const mes = /^\d{4}-\d{2}$/.test(String(mesPedido || '')) ? mesPedido
    : hoy.getFullYear() + '-' + String(hoy.getMonth() + 1).padStart(2, '0');
  const anio = mes.slice(0, 4);

  const delMes = todas.filter(x => mesDe(x.fechaLlegada) === mes);
  const delAnterior = todas.filter(x => mesDe(x.fechaLlegada) === mesAnteriorDe(mes));
  const delAnio = todas.filter(x => x.fechaLlegada.startsWith(anio) && mesDe(x.fechaLlegada) <= mes);

  // Proveedores cuya PRIMERA muestra cae en el mes: fuentes nuevas.
  const primera = new Map();
  for (const x of [...todas].sort((a, b) => a.fechaLlegada.localeCompare(b.fechaLlegada))) {
    const k = x.rucProveedor || x.proveedor;
    if (k && !primera.has(k)) primera.set(k, mesDe(x.fechaLlegada));
  }
  const proveedoresNuevos = [...primera.values()].filter(m => m === mes).length;

  // Últimos 12 meses hasta el elegido.
  const meses = [];
  let m = mes;
  for (let i = 0; i < 12; i++) { meses.unshift(m); m = mesAnteriorDe(m); }
  const porMes = meses.map(k => ({ mes: k, ...acumular(todas.filter(x => mesDe(x.fechaLlegada) === k)) }));

  // Embudo de evaluación (sobre el año).
  const estados = Object.fromEntries(ESTADOS.map(e => [e, delAnio.filter(x => x.estado === e).length]));
  const evaluadas = estados['Aprobada'] + estados['Rechazada'];
  const pendientes = todas.filter(x => x.estado === 'Recibida' || x.estado === 'En evaluación')
    .map(x => ({ id: x.id, descripcion: x.descripcion, proveedor: x.proveedor, fechaLlegada: x.fechaLlegada,
      dias: Math.max(0, Math.floor((hoy - new Date(x.fechaLlegada + 'T00:00:00')) / 86400000)) }))
    .sort((a, b) => b.dias - a.dias);

  // Precio de la muestra vs costo promedio en stock de su familia (US$/kg).
  const costos = await todos(
    "SELECT familia, SUM(valorizado_usd) AS v, SUM(stock) AS s FROM materia_prima_stock WHERE unidad_medida = 'KG' AND stock > 0 GROUP BY familia"
  );
  const costoDe = familia => {
    const f = String(familia || '').toUpperCase();
    if (!f) return null;
    const exacta = costos.find(c => c.familia === f) || costos.find(c => c.familia.startsWith(f) || f.startsWith(c.familia));
    return exacta && exacta.s ? exacta.v / exacta.s : null;
  };
  const familias = new Map();
  for (const x of delAnio) {
    const k = x.familia || 'SIN FAMILIA';
    if (!familias.has(k)) familias.set(k, []);
    familias.get(k).push(x);
  }
  const porFamilia = [...familias].map(([familia, lista]) => {
    const pagadas = lista.filter(x => x.precioKg > 0 && x.moneda === 'USD');
    const kgPagados = pagadas.reduce((a, x) => a + x.cantidadKg, 0);
    const precio = kgPagados ? pagadas.reduce((a, x) => a + x.subtotal, 0) / kgPagados : null;
    const costo = costoDe(familia);
    return {
      familia, ...acumular(lista),
      aprobadas: lista.filter(x => x.estado === 'Aprobada').length,
      precioPromedioUsd: precio, costoStockUsd: costo,
      diferenciaPct: precio != null && costo ? (precio - costo) / costo * 100 : null
    };
  }).sort((a, b) => b.muestras - a.muestras);

  const proveedores = new Map();
  for (const x of delAnio) {
    const k = x.rucProveedor || x.proveedor || 'SIN PROVEEDOR';
    if (!proveedores.has(k)) proveedores.set(k, []);
    proveedores.get(k).push(x);
  }
  const porProveedor = [...proveedores].map(([k, lista]) => ({
    ruc: lista[0].rucProveedor, proveedor: lista.find(x => x.proveedor)?.proveedor || (lista[0].rucProveedor ? 'RUC ' + k : k),
    ...acumular(lista), aprobadas: lista.filter(x => x.estado === 'Aprobada').length
  })).sort((a, b) => b.muestras - a.muestras || b.kg - a.kg).slice(0, 10);

  return {
    mes, anio,
    total: todas.length,
    mesActual: acumular(delMes),
    mesAnterior: acumular(delAnterior),
    anioActual: acumular(delAnio),
    proveedoresNuevos,
    porMes, estados,
    tasaAprobacion: evaluadas ? estados['Aprobada'] / evaluadas * 100 : null,
    pendientes: pendientes.slice(0, 8), totalPendientes: pendientes.length,
    porFamilia, porProveedor
  };
}
