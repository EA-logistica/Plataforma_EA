import { Router } from 'express';
import ExcelJS from 'exceljs';
import { todos } from '../db/conexion.js';
import { requiereSesion, requiereRol } from '../usuarios/middleware.js';
import { cachearGet } from '../middleware/cache.js';
import { asinc } from '../middleware/errores.js';
import { log } from '../seguridad/log.js';
import * as reporte from '../reportes/semanal.js';

/**
 * Herramientas transversales de la vista de logística (solo admin):
 *
 *   GET  /api/buscar?q=           buscador global (Ctrl+K): importaciones, OC,
 *                                 productos y proveedores. Los tickets de
 *                                 mensajería los busca el navegador, que ya
 *                                 los tiene cargados.
 *   POST /api/exportar/xlsx       cualquier tabla de la pantalla a Excel.
 *   GET  /api/reportes/semanal    reporte semanal en HTML (para ver / PDF).
 *   POST /api/reportes/semanal/enviar   lo manda ya por correo.
 */
export const herramientas = Router();

const soloAdmin = [requiereSesion, requiereRol('admin')];
const error = (msg, status) => Object.assign(new Error(msg), { status });

/** Texto de búsqueda → patrón ILIKE seguro (sin comodines del usuario). */
const patron = q => '%' + q.replace(/[\\%_]/g, c => '\\' + c) + '%';

herramientas.get('/buscar', ...soloAdmin, cachearGet(), asinc(async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 80);
  if (q.length < 2) return res.json({ q, grupos: [] });
  const p = patron(q);
  const [imp, oc, prod, prov] = await Promise.all([
    todos("SELECT id, datos->>'oc' AS oc, datos->>'descripcion' AS descripcion, datos->>'proveedor' AS proveedor, "
      + "datos->>'estado' AS estado, datos->>'bl' AS bl FROM importaciones "
      + "WHERE datos->>'oc' ILIKE ? OR datos->>'descripcion' ILIKE ? OR datos->>'proveedor' ILIKE ? OR datos->>'bl' ILIKE ? "
      + "OR datos->>'codigo' ILIKE ? ORDER BY datos->>'emision' DESC NULLS LAST LIMIT 6", [p, p, p, p, p]),
    todos('SELECT numero_oc AS oc, MAX(proveedor) AS proveedor, MAX(fecha_emision) AS fecha, COUNT(*) AS items, '
      + 'MAX(descripcion_producto) AS descripcion FROM ordenes_compra_detalle WHERE numero_oc ILIKE ? '
      + 'GROUP BY numero_oc ORDER BY MAX(fecha_emision) DESC LIMIT 5', [q.replace(/[\\%_]/g, '') + '%']),
    todos('SELECT codigo, descripcion, familia, linea, stock, unidad_medida FROM productos '
      + 'WHERE codigo ILIKE ? OR descripcion ILIKE ? ORDER BY (codigo ILIKE ?) DESC, stock DESC LIMIT 8', [p, p, q.replace(/[\\%_]/g, '') + '%']),
    todos('SELECT proveedor, MAX(ruc_proveedor) AS ruc, COUNT(DISTINCT numero_oc) AS ordenes, MAX(fecha_emision) AS ultima '
      + "FROM ordenes_compra_detalle WHERE proveedor <> '' AND (proveedor ILIKE ? OR ruc_proveedor ILIKE ?) "
      + 'GROUP BY proveedor ORDER BY COUNT(DISTINCT numero_oc) DESC LIMIT 5', [p, p])
  ]);
  res.json({
    q,
    grupos: [
      { tipo: 'importacion', titulo: 'Importaciones', items: imp },
      { tipo: 'oc', titulo: 'Órdenes de compra (ERP)', items: oc },
      { tipo: 'producto', titulo: 'Productos', items: prod },
      { tipo: 'proveedor', titulo: 'Proveedores', items: prov }
    ].filter(g => g.items.length)
  });
}));

// ------------------------------------------------------------- exportar a Excel
const MAX_FILAS = 50000;
herramientas.post('/exportar/xlsx', ...soloAdmin, asinc(async (req, res) => {
  const { titulo = 'Exportación', columnas, filas } = req.body || {};
  if (!Array.isArray(columnas) || !columnas.length || !Array.isArray(filas)) throw error('Faltan las columnas o las filas a exportar.', 400);
  if (filas.length > MAX_FILAS) throw error('Son demasiadas filas para un Excel (' + filas.length + '). Filtra antes de exportar.', 400);
  const nombre = String(titulo).replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, 60) || 'Exportación';

  const libro = new ExcelJS.Workbook();
  libro.creator = 'Plataforma EA';
  const hoja = libro.addWorksheet(nombre.slice(0, 31), { views: [{ state: 'frozen', ySplit: 1 }] });
  hoja.columns = columnas.map((c, i) => ({
    header: String(c.t ?? c), key: 'c' + i,
    width: Math.min(60, Math.max(10, String(c.t ?? c).length + 2, ...filas.slice(0, 200).map(f => String(f[i] ?? '').length + 2)))
  }));
  for (const f of filas) hoja.addRow(columnas.map((c, i) => {
    const v = f[i];
    return c.num && v !== '' && v != null && Number.isFinite(Number(v)) ? Number(v) : (v ?? '');
  }));
  const cab = hoja.getRow(1);
  cab.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  cab.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1B4E8E' } };
  columnas.forEach((c, i) => { if (c.num) hoja.getColumn(i + 1).numFmt = c.formato || '#,##0.00'; });
  hoja.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columnas.length } };

  await log('tabla_exportada', req, nombre + ' · ' + filas.length + ' filas');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="' + encodeURIComponent(nombre) + '.xlsx"');
  await libro.xlsx.write(res);
  res.end();
}));

// ------------------------------------------------------------- reporte semanal
herramientas.get('/reportes/semanal', ...soloAdmin, asinc(async (req, res) => {
  const r = await reporte.generar();
  res.json({ ...r, correo: reporte.correoConfigurado() });
}));
herramientas.post('/reportes/semanal/enviar', ...soloAdmin, asinc(async (req, res) => {
  const r = await reporte.enviar();
  await log('reporte_semanal_enviado', req, r.para.join(', '));
  res.json(r);
}));
