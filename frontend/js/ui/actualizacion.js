import { obtener, crear } from '../api/cliente.js';
import { sesion } from '../state/sessionState.js';
import { $, esc } from '../utils/dom.js';
import { toast } from '../utils/toast.js';

/**
 * Aviso de "actualización instalada sin aplicar". El navegador carga la
 * pantalla nueva desde el disco, pero el servidor sigue con el código con el
 * que arrancó hasta que se reinicia: sin este aviso, las funciones nuevas
 * parecían rotas ("no se ve la data") cuando solo faltaba reiniciar.
 *
 * Solo lo ve el admin de logística, que es quien puede reiniciar. Si el
 * servidor corre dentro de "Iniciar Plataforma EA", el botón lo reinicia y
 * esta página se recarga sola cuando vuelve.
 */

let ultimo = null;
let reiniciando = false; // mientras tanto, el repintado periódico no pisa el mensaje

const esAdmin = () => sesion && sesion.tipo === 'admin' && sesion.rol === 'admin';

function pintar() {
  const caja = $('avisoActualizacion');
  if (!caja || reiniciando) return;
  if (!ultimo || !ultimo.pendiente || !esAdmin()) { caja.hidden = true; return; }
  caja.hidden = false;
  caja.innerHTML = '<span class="aviso-ico" aria-hidden="true">⟳</span>'
    + '<div><b>Hay una actualización instalada que todavía no se aplica.</b> '
    + 'Algunas pantallas nuevas no mostrarán datos hasta reiniciar el servidor.'
    + (ultimo.reinicioDisponible ? '' : ' <span class="muted">Cierra la ventana "Iniciar Plataforma EA" y ábrela otra vez.</span>')
    + '</div>'
    + (ultimo.reinicioDisponible ? '<button class="btn btn-sm" onclick="reiniciarServidor()">Reiniciar ahora</button>' : '');
}

async function consultar() {
  try { ultimo = await obtener('/version'); } catch (_) { return; }
  pintar();
}

export function iniciarAvisoActualizacion() {
  consultar();
  setInterval(consultar, 60 * 1000);
  // Sin red: solo repinta, para que aparezca o se vaya al entrar o salir de la sesión.
  setInterval(pintar, 3000);
}

/** Tras entrar o salir de la sesión: el aviso depende de quién mira. */
export const refrescarAvisoActualizacion = () => pintar();

export async function reiniciarServidor() {
  if (!confirm('¿Reiniciar el servidor ahora? La plataforma deja de responder unos segundos para todos.')) return;
  let r;
  try { r = await crear('/servidor/reiniciar'); } catch (e) { toast('No se pudo reiniciar', e.message, 'bad'); return; }
  reiniciando = true;
  const caja = $('avisoActualizacion');
  caja.innerHTML = '<span class="aviso-ico girando" aria-hidden="true">⟳</span><div><b>' + esc(r.mensaje) + '</b> Esta página se recargará sola.</div>';
  // Espera a que el servidor viejo se vaya y vuelva el nuevo (máx. ~2 min).
  const inicio = Date.now();
  await new Promise(ok => setTimeout(ok, 2500));
  while (Date.now() - inicio < 120000) {
    try {
      const v = await obtener('/version');
      if (!v.pendiente) { location.reload(); return; }
    } catch (_) { /* todavía arrancando */ }
    await new Promise(ok => setTimeout(ok, 1500));
  }
  caja.innerHTML = '<div><b>El servidor tarda más de lo normal en volver.</b> Revisa la ventana "Iniciar Plataforma EA".</div>';
}
