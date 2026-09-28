import { randomBytes } from 'node:crypto';

/**
 * Sesiones de logística, en memoria y sin tabla en la base a propósito, igual
 * que el freno de intentos de middleware/limites.js: si el servidor se
 * reinicia, todos vuelven a entrar con su usuario y clave. Es una molestia
 * menor en una app que corre en una PC que se queda prendida, y evita atar un
 * token a una fila que hay que revisar cada vez que cambia la clave o se
 * desactiva a alguien.
 */
const DURACION_MS = 12 * 60 * 60 * 1000; // 12 horas de jornada, de sobra para un turno

// El campo `tipo` distingue una sesión de logística ('logistica') de una de
// área ('area', ver crearArea). Comparten mapa y mecanismo -expiración,
// límite de tamaño, revocación- porque son la misma clase de objeto; lo que
// NO deben compartir es qué rutas abren, así que `tipo` es lo primero que
// miran requiereSesion/requiereSesionArea antes de confiar en el token.
const sesiones = new Map(); // token -> { tipo, ..., expira }

// Tope duro: purgar() solo quita las vencidas, así que alguien con una clave
// válida ingresando en bucle podía hacer crecer el mapa sin límite durante
// 12 horas. 50 personas con varias pestañas y dispositivos no llegan ni cerca;
// si se cruza, se descartan las más viejas (el Map guarda orden de alta).
const MAX_SESIONES = 5000;

function purgar(ahora) {
  for (const [token, s] of sesiones) if (s.expira <= ahora) sesiones.delete(token);
  for (const token of sesiones.keys()) {
    if (sesiones.size < MAX_SESIONES) break;
    sesiones.delete(token);
  }
}

export function crear(usuarioRow) {
  if (sesiones.size > 500) purgar(Date.now());
  const token = randomBytes(24).toString('hex');
  sesiones.set(token, {
    tipo: 'logistica',
    usuarioId: usuarioRow.id,
    usuario: usuarioRow.usuario,
    rol: usuarioRow.rol,
    expira: Date.now() + DURACION_MS
  });
  return token;
}

/**
 * Sesión del solicitante que entró con DNI + credencial de área. `dni`,
 * `nombre` y `cargo` son de la persona que la usó -para que el ticket que
 * registre siga saliendo a su nombre-, pero `area` es lo único que decide qué
 * puede ver: cualquiera del área con esta misma credencial ve los mismos 5
 * últimos servicios, no solo quien entró.
 */
export function crearArea(credArea, persona) {
  if (sesiones.size > 500) purgar(Date.now());
  const token = randomBytes(24).toString('hex');
  sesiones.set(token, {
    tipo: 'area',
    area: credArea.area,
    usuario: credArea.usuario,
    dni: persona.dni,
    nombre: persona.nombre,
    cargo: persona.cargo,
    expira: Date.now() + DURACION_MS
  });
  return token;
}

export function verificar(token) {
  if (!token) return null;
  const s = sesiones.get(token);
  if (!s) return null;
  if (s.expira <= Date.now()) { sesiones.delete(token); return null; }
  return s;
}

export function revocar(token) {
  if (token) sesiones.delete(token);
}

/** Cierra de golpe todas las sesiones de un usuario: al desactivarlo o resetear su clave. */
export function revocarDeUsuario(usuarioId) {
  for (const [token, s] of sesiones) if (s.usuarioId === usuarioId) sesiones.delete(token);
}

/** Igual que `revocarDeUsuario`, pero para la credencial compartida de un área. */
export function revocarDeArea(area) {
  for (const [token, s] of sesiones) if (s.tipo === 'area' && s.area === area) sesiones.delete(token);
}

/** Para las pruebas: deja el mapa como recién arrancado. */
export const olvidarSesiones = () => sesiones.clear();
