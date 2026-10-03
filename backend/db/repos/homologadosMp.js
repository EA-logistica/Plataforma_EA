import fs from 'node:fs/promises';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { todos } from '../conexion.js';
import { CONFIG } from '../../config.js';
import { parsearFilas, valorCelda, clasificar, categoriaDeGrupo, detectarCategoria, indiceFluidez, ESTADO_HOMOLOGACION } from '#shared/homologados.js';
import { SQL_FECHA_ALTA } from './productos.js';

/**
 * Materias primas homologadas: se leen del Excel de CONFIG.homologados (no
 * van a PostgreSQL) y se cruzan por código con lo que ya trae la plataforma
 * del ERP -familia y línea del catálogo, categoría y stock de materia prima-.
 * La categoría la decide shared/homologados.js (clasificar()), con la línea
 * del ERP de cada código como primera fuente.
 *
 * El Excel se vuelve a leer solo si cambió su fecha de modificación: quien
 * lo reemplaza ve el cambio al refrescar, sin reiniciar el servidor.
 *
 * Además del Excel entran, como "Sin registro":
 *   - las resinas del catálogo del ERP que el Excel no tiene -los códigos
 *     nuevos que va trayendo Mongo-, y
 *   - los códigos de las muestras registradas (pestaña Muestras).
 * Y la evaluación de la última muestra de cada código (Aprobada, Aprobada
 * c/restricción, Rechazada) pasa al estado de homologación si es más
 * reciente que la fecha del Excel; una muestra aún en evaluación marca "En
 * evaluación" a un código que el Excel tenía sin registro.
 */

let cache = { mtime: 0, filas: [] };

async function leerExcel() {
  let info;
  try { info = await fs.stat(CONFIG.homologados); } catch (_) { return null; }
  if (info.mtimeMs !== cache.mtime) {
    const libro = new ExcelJS.Workbook();
    await libro.xlsx.readFile(CONFIG.homologados);
    const hoja = libro.worksheets[0];
    const matriz = [];
    hoja.eachRow(r => matriz.push(r.values.slice(1).map(valorCelda)));
    cache = { mtime: info.mtimeMs, filas: parsearFilas(matriz) };
  }
  return cache;
}

const MP = "('MATERIA PRIMA', 'MATERIA PRIMA - TINTAS')";
const DIAS_NUEVO = 90;
const FINALES = new Set(['Aprobada', 'Aprobada c/restricción', 'Rechazada']);

/** Lo del ERP para esos códigos: catálogo (con fecha de alta) + stock de materia prima sumado por código. */
async function cruceErp(codigos) {
  if (!codigos.length) return new Map();
  const marcas = codigos.map(() => '?').join(',');
  const [catalogo, stock] = await Promise.all([
    todos('SELECT p.codigo, p.familia, p.linea, p.estado, p.unidad_medida, p.stock, ' + SQL_FECHA_ALTA + ' AS fecha_alta '
      + 'FROM productos p LEFT JOIN productos_alta a ON a.codigo = p.codigo WHERE p.codigo IN (' + marcas + ')', codigos),
    todos('SELECT codigo, MAX(categoria) AS categoria, MAX(familia) AS linea, MAX(unidad_medida) AS um, '
      + 'SUM(stock) AS stock, SUM(valorizado_usd) AS valorizado, COUNT(DISTINCT almacen) AS almacenes '
      + 'FROM materia_prima_stock WHERE codigo IN (' + marcas + ') GROUP BY codigo', codigos)
  ]);
  const erp = new Map(codigos.map(c => [c, {}]));
  for (const p of catalogo) Object.assign(erp.get(p.codigo), {
    enErp: true, familiaErp: p.familia, lineaErp: p.linea, estadoErp: p.estado, unidadMedida: p.unidad_medida,
    stock: Number(p.stock) || 0, fechaAlta: p.fecha_alta || ''
  });
  for (const s of stock) Object.assign(erp.get(s.codigo), {
    categoriaErp: s.categoria, lineaErp: erp.get(s.codigo).lineaErp || s.linea,
    unidadMedida: erp.get(s.codigo).unidadMedida || s.um,
    stock: Number(s.stock) || 0, valorizadoUsd: Number(s.valorizado) || 0, almacenes: Number(s.almacenes) || 0
  });
  return erp;
}

/** Fila mínima (como las del Excel) para un código que no está en el Excel. */
function filaFuera(codigo, nombre, origen) {
  const n = String(nombre).toUpperCase();
  return {
    codigo, nombre, familiaExcel: '', grupoExcel: '', detectada: detectarCategoria(nombre), deGrupo: null,
    estado: 'Sin registro', preferencia: '', fecha: '', conNota: false, conAlerta: false,
    indiceFluidez: indiceFluidez(nombre), muestra: /MUESTRA/.test(n), agrupacion: /AGRUPACI/.test(n), duplicado: false, origen
  };
}

/** Si una muestra evaluada es más reciente que el Excel, su resultado es el estado vigente. */
function conMuestra(fila, m) {
  if (!m) return fila;
  const muestra = { id: m.id, estado: m.estado, fecha: m.fecha_llegada, proveedor: m.proveedor };
  if (FINALES.has(m.estado) && (!fila.fecha || m.fecha_llegada >= fila.fecha)) {
    return { ...fila, estado: ESTADO_HOMOLOGACION[m.estado], estadoExcel: fila.estado, fuenteEstado: 'muestra', fecha: m.fecha_llegada, muestraRef: muestra };
  }
  if (!FINALES.has(m.estado) && fila.estado === 'Sin registro') {
    return { ...fila, estado: 'En evaluación', estadoExcel: fila.estado, fuenteEstado: 'muestra', muestraRef: muestra };
  }
  return { ...fila, muestraRef: muestra };
}

export async function listar() {
  const excel = await leerExcel();
  const delExcel = (excel ? excel.filas : []).map(f => ({ ...f, origen: 'excel' }));
  const vistos = new Set(delExcel.map(f => f.codigo));

  // Resinas del catálogo que el Excel no tiene: su línea del ERP es una categoría conocida.
  const catalogo = await todos('SELECT codigo, descripcion, linea FROM productos WHERE familia IN ' + MP);
  const porCodigo = new Map(catalogo.map(p => [p.codigo, p]));
  const resina = linea => { const c = categoriaDeGrupo(linea); return c && c !== 'PP_COPO_AMPLIO'; };
  const delErp = catalogo.filter(p => !vistos.has(p.codigo) && resina(p.linea)).map(p => filaFuera(p.codigo, p.descripcion, 'erp'));
  delErp.forEach(f => vistos.add(f.codigo));

  // Muestras: la última de cada código manda; y sus códigos entran aunque no sean de una línea de resina.
  const muestras = await todos("SELECT id, codigo_producto, descripcion, estado, fecha_llegada, proveedor FROM muestras_mp "
    + "WHERE codigo_producto <> '' ORDER BY fecha_llegada DESC, id DESC");
  const ultima = new Map();
  for (const m of muestras) if (!ultima.has(m.codigo_producto)) ultima.set(m.codigo_producto, m);
  const deMuestras = [...ultima.values()].filter(m => !vistos.has(m.codigo_producto))
    .map(m => filaFuera(m.codigo_producto, porCodigo.get(m.codigo_producto)?.descripcion || m.descripcion, 'muestra'));

  const todas = [...delExcel, ...delErp, ...deMuestras];
  const erp = await cruceErp(todas.map(f => f.codigo));
  const desdeNuevo = new Date(Date.now() - DIAS_NUEVO * 86400000).toISOString().slice(0, 10);
  return {
    archivo: path.basename(CONFIG.homologados),
    disponible: Boolean(excel),
    actualizado: excel ? new Date(excel.mtime).toISOString() : '',
    diasNuevo: DIAS_NUEVO,
    filas: todas.map(f => {
      const e = { enErp: false, familiaErp: '', lineaErp: '', categoriaErp: '', estadoErp: '', fechaAlta: '',
        unidadMedida: '', stock: 0, valorizadoUsd: 0, almacenes: 0, ...erp.get(f.codigo) };
      const { detectada, deGrupo, ...resto } = f;
      const fila = { ...resto, ...e, fuenteEstado: 'excel', estadoExcel: f.estado, muestraRef: null,
        nuevo: Boolean(e.fechaAlta && e.fechaAlta >= desdeNuevo),
        ...clasificar({ detectada, deGrupo, deErp: categoriaDeGrupo(e.lineaErp) }) };
      if (f.origen !== 'excel') fila.fuenteEstado = '';
      return conMuestra(fila, ultima.get(f.codigo));
    })
  };
}
