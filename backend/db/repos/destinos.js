import { todos, uno, ejecutar, aCamel } from '../conexion.js';
import { DESTINOS } from '#data/destinos.js';
import { claveDestino, PLANTAS } from '#shared/servicios.js';

/**
 * Destinos que la plataforma ya conoce: el catálogo del histórico
 * (data/destinos.js) más cada dirección nueva que un solicitante clasificó
 * como Cliente o Proveedor al registrar un servicio. Una dirección que no está
 * en ninguno de los dos obliga a clasificarla (ver solicitudes.crear), y desde
 * ese momento ya es conocida: la siguiente vez no se vuelve a preguntar.
 */

export const TIPOS_DESTINO = ['Cliente', 'Proveedor'];

const CATALOGO = new Set([...PLANTAS, ...DESTINOS.map(d => d.nombre)].map(claveDestino));

/** Los registrados por solicitantes, para sumarlos a las sugerencias del formulario. */
export async function registrados() {
  // Los más usados primero: son los que más probablemente se repitan.
  return (await todos(
    'SELECT direccion, tipo, lat, lng, usos FROM destinos_registrados ORDER BY usos DESC, direccion'
  )).map(aCamel);
}

/** Otro viaje al mismo destino registrado: suma un uso (el catálogo del histórico no lleva cuenta). */
export async function usar(direccion) {
  await ejecutar('UPDATE destinos_registrados SET usos = usos + 1, ultimo_uso = ahora_txt() WHERE clave = ?', [claveDestino(direccion)]);
}

export async function esConocido(direccion) {
  const clave = claveDestino(direccion);
  if (!clave) return false;
  if (CATALOGO.has(clave)) return true;
  return !!(await uno('SELECT 1 AS si FROM destinos_registrados WHERE clave = ?', [clave]));
}

/** Guarda una dirección nueva con su tipo. Si ya estaba (otra persona la registró a la vez), no la pisa. */
export async function registrar({ direccion, tipo, lat, lng, area, creadoPor }) {
  await ejecutar(
    'INSERT INTO destinos_registrados (clave, direccion, tipo, lat, lng, area, creado_por) VALUES (?, ?, ?, ?, ?, ?, ?) '
    + 'ON CONFLICT (clave) DO NOTHING',
    [claveDestino(direccion), String(direccion).trim(), tipo, lat ?? null, lng ?? null, String(area || ''), String(creadoPor || '')]
  );
}
