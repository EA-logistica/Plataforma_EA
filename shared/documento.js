/**
 * Reglas del documento de identidad. Las usan el servidor y el navegador.
 *
 * Vive en `shared/` y no junto al padrón a propósito: el navegador necesita
 * validar y normalizar un DNI en cada ingreso, pero no tiene por qué recibir
 * la lista de personal para hacerlo. Mientras estas dos funciones estuvieron
 * en `data/padron.js`, importarlas arrastraba al navegador los 114 nombres y
 * documentos del padrón completo.
 */

/** Documento aceptado: DNI de 8 dígitos o carné de extranjería de 9. */
export const DOC_VALIDO = /^[0-9]{8,9}$/;

/**
 * Deja un documento en su forma canónica: solo dígitos y, si viene corto
 * (7 dígitos porque se perdió el cero inicial en el sistema de RR.HH.),
 * completado a 8. Los carnés de extranjería, de 9 dígitos, no se tocan.
 *
 * Así quien escribe "8161848" y quien escribe "08161848" encuentran lo mismo.
 */
export function normalizarDoc(valor) {
  const d = String(valor || '').replace(/[^0-9]/g, '');
  return d.length && d.length < 8 ? d.padStart(8, '0') : d;
}
