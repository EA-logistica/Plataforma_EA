import { todos, uno, ejecutar, insertarLote, aCamel, enTransaccion } from '../conexion.js';
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

export async function listar() {
  return (await todos('SELECT * FROM personal ORDER BY nombre')).map(aCamel);
}

export async function total() {
  return (await uno('SELECT COUNT(*) AS n FROM personal')).n;
}

export async function porDocumento(doc) {
  const d = normalizarDoc(doc);
  if (!d) return null;
  return aCamel(await uno('SELECT * FROM personal WHERE dni = ?', [d]));
}

/** Áreas distintas con al menos una persona: para sembrar credenciales de área y para validar altas. */
export async function areas() {
  return (await todos("SELECT DISTINCT area FROM personal WHERE area != '' ORDER BY area")).map(r => r.area);
}

/** Evita crear una credencial para un área que no existe en el padrón, por un simple error de tipeo. */
export async function existeArea(area) {
  const a = String(area || '').trim();
  return !!a && !!(await uno('SELECT 1 FROM personal WHERE area = ? LIMIT 1', [a]));
}

/**
 * Busca por documento, nombre, apellido, cargo o área. Cada palabra escrita
 * debe aparecer en la ficha, sin importar el orden: 'lopez deyna' encuentra a
 * 'DEYNA LOPEZ ABARRANCA' igual que 'deyna lopez'.
 *
 * El filtrado por palabras se hace en JavaScript y no en SQL a propósito: son
 * ~200 filas y hay que ignorar tildes, algo que la base no hace sin la
 * extensión unaccent.
 */
export async function buscar(texto) {
  const q = sinTildes(String(texto || '')).trim().toLowerCase();
  if (q.length < 2) return [];
  const palabras = q.split(/\s+/);
  return (await listar()).filter(p => {
    const t = sinTildes([p.dni, normalizarDoc(p.dni), p.nombre, p.cargo, p.area].join(' ')).toLowerCase();
    return palabras.every(w => t.includes(w));
  });
}

const sinTildes = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

export async function agregar({ dni, nombre, cargo, area }) {
  const doc = normalizarDoc(dni);
  if (!DOC_VALIDO.test(doc)) throw error('El documento debe tener 8 dígitos, o 9 si es carné de extranjería.');
  if (String(nombre || '').trim().length < 3) throw error('Escribe el nombre completo.');
  if (await porDocumento(doc)) throw error('El documento ' + doc + ' ya figura en el padrón.', 409);

  return enTransaccion(async () => {
    await ejecutar(
      'INSERT INTO personal (dni, nombre, cargo, area, origen, creado_en) VALUES (?, ?, ?, ?, ?, ?)',
      [doc, String(nombre).trim(), String(cargo || '').trim() || 'Sin cargo',
       String(area || '').trim() || 'Sin área', 'manual', new Date().toISOString()]
    );

    // Dar de alta a alguien aprueba de paso su pedido de autorización.
    await ejecutar("UPDATE autorizaciones SET estado = 'Aprobada' WHERE dni = ? AND estado = 'Pendiente'", [doc]);
    await tocar('app');
    return porDocumento(doc);
  });
}

export async function quitar(doc) {
  const d = normalizarDoc(doc);
  const r = await ejecutar('DELETE FROM personal WHERE dni = ?', [d]);
  if (!r.changes) throw error('No hay nadie con el documento ' + d + ' en el padrón.', 404);
  await tocar('app');
  return { dni: d };
}

/**
 * Carga el padrón oficial de RR.HH. Lo que logística agregó a mano (origen
 * 'manual') se conserva; el resto se reemplaza.
 */
export async function cargarPadronOficial(personas) {
  return enTransaccion(async () => {
    await ejecutar("DELETE FROM personal WHERE origen = 'padron'");
    const ahora = new Date().toISOString();
    const filas = personas.map(p => ({
      dni: normalizarDoc(p.dni), nombre: p.nombre, cargo: p.cargo || '', area: p.area || '',
      origen: 'padron', creado_en: ahora
    }));
    // DO NOTHING (no DO UPDATE): un DNI repetido en el listado o uno que ya
    // está como 'manual' se salta igual que antes, sin chocar en el lote.
    const n = await insertarLote('personal', ['dni', 'nombre', 'cargo', 'area', 'origen', 'creado_en'], filas,
      'ON CONFLICT (dni) DO NOTHING');
    await tocar('app');
    return n;
  });
}
