import { uno, ejecutar, trasConfirmar } from '../conexion.js';
import { invalidar } from '../../middleware/cache.js';

/**
 * Ajustes clave/valor: la clave de logística, la versión del esquema y el
 * testigo de revisión.
 *
 * El testigo existe para que el navegador sepa si algo cambió sin descargarse
 * el estado completo. Cada escritura lo mueve; el sondeo pide solo ese valor
 * (unos bytes) y únicamente recarga todo cuando de verdad cambió.
 */

export async function leer(clave, porDefecto = null) {
  const f = await uno('SELECT valor FROM ajustes WHERE clave = ?', [clave]);
  return f ? f.valor : porDefecto;
}

async function guardar(clave, valor) {
  await ejecutar(
    'INSERT INTO ajustes (clave, valor) VALUES (?, ?) ' +
    'ON CONFLICT (clave) DO UPDATE SET valor = excluded.valor',
    [clave, String(valor)]
  );
}

export async function escribir(clave, valor) {
  await guardar(clave, valor);
  // Cualquier ajuste escrito deja vencidas las respuestas guardadas en
  // memoria (middleware/cache.js): /estado, por ejemplo, lleva version_datos.
  // Se vacía ya y otra vez tras el COMMIT (ver trasConfirmar en conexion.js).
  invalidar();
  trasConfirmar(() => invalidar());
}

/**
 * Marca que algo cambió. La llaman todos los repositorios que escriben.
 *
 * `ambito` acota qué respuestas en caché quedan vencidas: 'app' es para las
 * escrituras de la propia aplicación (tickets, padrón, adjuntos, compras
 * cargadas a mano), que no tocan los reportes del ERP; sin ámbito se vacía
 * todo, que es lo seguro para cualquier escritura que no se haya pensado.
 */
export async function tocar(ambito) {
  const nueva = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  await guardar('revision', nueva);
  const grupo = ambito === 'app' ? 'app' : undefined;
  invalidar(grupo);
  trasConfirmar(() => invalidar(grupo));
  return nueva;
}

export const revision = () => leer('revision', '0');
