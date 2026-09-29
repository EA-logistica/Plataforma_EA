// Igual que stockAlmacen.js: mismo proceso Express que backend/db, así que se
// lee y escribe la base principal de PLANSA sin otra API intermedia. A
// diferencia de stockAlmacen.js (solo lectura), esta sí escribe: el metraje y
// costo del alquiler de Los Olivos se agrega/edita a mano desde la propia
// pestaña "Control de Espacios", no viene de un reporte del ERP.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as repo from '../../../db/repos/metrajeAlmacen.js';
import { HttpError } from '../lib/http.js';

// El módulo de Almacén no tiene identidad de usuario propia (ver acceso.js:
// la cookie solo prueba que un admin de PLANSA canjeó un ticket, no quién
// es), así que todo lo que se crea/edita desde acá queda con este autor fijo.
const AUTOR = 'almacen-los-olivos';

// El repositorio es asíncrono: el await va DENTRO del try para que un rechazo
// también se traduzca a HttpError, no solo un throw síncrono.
async function traducir(fn) {
  try {
    return await fn();
  } catch (e) {
    throw new HttpError(e.status || 400, e.message);
  }
}

// Auditoría mínima de este módulo: no hay una tabla de eventos de seguridad
// propia acá (esa es `eventos_seguridad`, de backend/seguridad/log.js, fuera
// de este módulo), así que cada eliminación de una fila de metraje_almacen
// deja una línea en un .jsonl append-only con la fila borrada completa y el
// motivo que dio quien la borró -pensado para auditar a mano, no para leerse
// desde la propia app-.
const ARCHIVO_AUDITORIA = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'storage', 'auditoria-metraje.jsonl');

function validarMotivo(motivo) {
  const m = String(motivo || '').trim();
  if (m.length < 3) throw new HttpError(400, 'Indica un motivo de eliminación (mínimo 3 caracteres).');
  return m;
}

function registrarAuditoria(accion, id, filaEliminada, motivo) {
  const linea = { cuando: new Date().toISOString(), accion, id: Number(id), filaEliminada, motivo };
  try {
    fs.mkdirSync(path.dirname(ARCHIVO_AUDITORIA), { recursive: true });
    fs.appendFileSync(ARCHIVO_AUDITORIA, JSON.stringify(linea) + '\n');
  } catch (e) {
    // No dejamos que un fallo de disco impida la eliminación ya confirmada; solo se avisa por consola.
    console.warn('[metraje-almacen] No se pudo escribir la auditoría de eliminación: ' + e.message);
  }
}

export const listar = async () => repo.listar();
export const resumen = async () => repo.resumen();
export const crear = (datos) => traducir(() => repo.crear(datos, AUTOR));
export const actualizar = (id, datos) => traducir(() => repo.actualizar(id, datos));

export async function eliminar(id, motivo) {
  const motivoValido = validarMotivo(motivo);
  const fila = await repo.porId(id);
  const resultado = await traducir(() => repo.eliminar(id));
  registrarAuditoria('eliminar', id, fila, motivoValido);
  return resultado;
}
