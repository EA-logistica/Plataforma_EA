import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/**
 * Hash de claves con scrypt: viene incorporado en Node, así que no hace falta
 * bcrypt ni Argon2 -que exigen un módulo nativo que compilar, algo que el
 * proyecto evita a propósito (por eso usa `pg` puro JavaScript)-. scrypt es
 * el mismo tipo de función (memory-hard, pensada para que probar contraseñas
 * en masa sea caro) y está igual de aceptado por OWASP para este uso.
 *
 * Formato guardado: "N:r:p:sal:hash", todo en hexadecimal salvo los tres
 * números de costo. Guardarlos junto con el hash -en vez de fijarlos en el
 * código- permite subir el costo el día de mañana sin invalidar las claves ya
 * guardadas: cada una se verifica con los parámetros que tenía al crearse.
 *
 * Las cuentas creadas por una versión anterior de este archivo quedaron en el
 * formato viejo, "sal:hash" a secas, con el costo por defecto de Node
 * (N=16384). `verificarHash` lo sigue reconociendo -si no, todos los usuarios
 * ya creados se quedarían afuera-, pero cualquier clave nueva o cambiada usa
 * el formato con costo explícito.
 */
const LONGITUD_HASH = 64;

// N más alto que el valor por defecto de Node (16384): más caro de probar en
// masa si algún día se lleva la base de datos. maxmem por defecto de scrypt es
// 32 MB y con N=32768 se usan ~32 MB justos; se pide el doble para no rozar el
// límite.
const COSTO = { N: 32768, r: 8, p: 1 };
const SCRYPT_OPCIONES = { maxmem: 64 * 1024 * 1024 };

export function hashClave(clave) {
  const sal = randomBytes(16);
  const hash = scryptSync(String(clave), sal, LONGITUD_HASH, { ...COSTO, ...SCRYPT_OPCIONES });
  return [COSTO.N, COSTO.r, COSTO.p, sal.toString('hex'), hash.toString('hex')].join(':');
}

export function verificarHash(clave, guardado) {
  const partes = String(guardado || '').split(':');

  let N, r, p, salHex, hashHex;
  if (partes.length === 5) {
    [N, r, p, salHex, hashHex] = partes;
    N = Number(N); r = Number(r); p = Number(p);
  } else if (partes.length === 2) {
    // Formato viejo: sin costo explícito, con el valor por defecto de scryptSync.
    [salHex, hashHex] = partes;
    N = 16384; r = 8; p = 1;
  } else {
    return false;
  }
  if (!salHex || !hashHex || !N || !r || !p) return false;

  const sal = Buffer.from(salHex, 'hex');
  const esperado = Buffer.from(hashHex, 'hex');
  const calculado = scryptSync(String(clave || ''), sal, LONGITUD_HASH, { N, r, p, ...SCRYPT_OPCIONES });
  // Mismo tamaño siempre (LONGITUD_HASH), pero timingSafeEqual exige
  // comprobarlo: con un hash guardado corrupto, comparar tamaños distintos
  // lanzaría en vez de simplemente decir que no coincide.
  return calculado.length === esperado.length && timingSafeEqual(calculado, esperado);
}

/**
 * Clave temporal para dictar por teléfono o anexo: sin 0/O ni 1/I/l, que se
 * confunden al dictarlos o al leerlos en una fuente chica.
 */
const ALFABETO_TEMPORAL = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function generarClaveTemporal(longitud = 8) {
  let clave = '';
  for (const byte of randomBytes(longitud)) clave += ALFABETO_TEMPORAL[byte % ALFABETO_TEMPORAL.length];
  return clave;
}
