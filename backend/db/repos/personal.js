import { db, aCamel, enTransaccion } from '../conexion.js';
import { normalizarDoc, DOC_VALIDO } from '#shared/documento.js';
import { tocar } from './ajustes.js';

/**
 * Padrón de personal habilitado para pedir servicios.
 *
 * Los documentos se guardan siempre en forma canónica: los DNI de 7 dígitos,
 * que el sistema de RR.HH. entrega sin el cero inicial, quedan completados a 8.
 * Así quien escribe "8161848" y quien escribe "08161848" encuentran lo mismo.
 */

const error = (msg, status = 400) => Object.assign(new Error(msg), { status });

export function listar() {
  return db().prepare('SELECT * FROM personal ORDER BY nombre').all().map(aCamel);
}

export function total() {
  return db().prepare('SELECT COUNT(*) AS n FROM personal').get().n;
}

export function porDocumento(doc) {
  const d = normalizarDoc(doc);
  if (!d) return null;
  return aCamel(db().prepare('SELECT * FROM personal WHERE dni = ?').get(d));
}

/** Áreas distintas con al menos una persona: para sembrar credenciales de área y para validar altas. */
export function areas() {
  return db().prepare("SELECT DISTINCT area FROM personal WHERE area != '' ORDER BY area").all().map(r => r.area);
}

/** Evita crear una credencial para un área que no existe en el padrón, por un simple error de tipeo. */
export function existeArea(area) {
  const a = String(area || '').trim();
  return !!a && !!db().prepare('SELECT 1 FROM personal WHERE area = ? LIMIT 1').get(a);
}

/**
 * Busca por documento, nombre, apellido, cargo o área. Cada palabra escrita
 * debe aparecer en la ficha, sin importar el orden: 'lopez deyna' encuentra a
 * 'DEYNA LOPEZ ABARRANCA' igual que 'deyna lopez'.
 *
 * El filtrado por palabras se hace en JavaScript y no en SQL a propósito: son
 * ~200 filas y hay que ignorar tildes, algo que SQLite sin ICU no sabe hacer.
 */
export function buscar(texto) {
  const q = sinTildes(String(texto || '')).trim().toLowerCase();
  if (q.length < 2) return [];
  const palabras = q.split(/\s+/);
  return listar().filter(p => {
    const t = sinTildes([p.dni, normalizarDoc(p.dni), p.nombre, p.cargo, p.area].join(' ')).toLowerCase();
    return palabras.every(w => t.includes(w));
  });
}

const sinTildes = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

export function agregar({ dni, nombre, cargo, area }) {
  const doc = normalizarDoc(dni);
  if (!DOC_VALIDO.test(doc)) throw error('El documento debe tener 8 dígitos, o 9 si es carné de extranjería.');
  if (String(nombre || '').trim().length < 3) throw error('Escribe el nombre completo.');
  if (porDocumento(doc)) throw error('El documento ' + doc + ' ya figura en el padrón.', 409);

  return enTransaccion(base => {
    base.prepare(
      'INSERT INTO personal (dni, nombre, cargo, area, origen, creado_en) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(doc, String(nombre).trim(), String(cargo || '').trim() || 'Sin cargo',
          String(area || '').trim() || 'Sin área', 'manual', new Date().toISOString());

    // Dar de alta a alguien aprueba de paso su pedido de autorización.
    base.prepare("UPDATE autorizaciones SET estado = 'Aprobada' WHERE dni = ? AND estado = 'Pendiente'").run(doc);
    tocar();
    return porDocumento(doc);
  });
}

export function quitar(doc) {
  const d = normalizarDoc(doc);
  const r = db().prepare('DELETE FROM personal WHERE dni = ?').run(d);
  if (!r.changes) throw error('No hay nadie con el documento ' + d + ' en el padrón.', 404);
  tocar();
  return { dni: d };
}

/**
 * Carga el padrón oficial de RR.HH. Lo que logística agregó a mano (origen
 * 'manual') se conserva; el resto se reemplaza.
 */
export function cargarPadronOficial(personas) {
  return enTransaccion(base => {
    base.prepare("DELETE FROM personal WHERE origen = 'padron'").run();
    const insertar = base.prepare(
      'INSERT INTO personal (dni, nombre, cargo, area, origen, creado_en) VALUES (?, ?, ?, ?, ?, ?) ' +
      'ON CONFLICT (dni) DO NOTHING'
    );
    const ahora = new Date().toISOString();
    let n = 0;
    for (const p of personas) {
      const r = insertar.run(normalizarDoc(p.dni), p.nombre, p.cargo || '', p.area || '', 'padron', ahora);
      n += r.changes;
    }
    tocar();
    return n;
  });
}
