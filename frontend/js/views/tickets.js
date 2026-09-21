import { $, esc } from '../utils/dom.js';
import { pad, numeroTicket } from '../utils/format.js';
import { DB, cancelarSolicitud, pedirHistoricoArea } from '../api/estado.js';
import { sesion } from '../state/sessionState.js';
import { toast } from '../utils/toast.js';
import { ticketHTML } from './presenters.js';

/**
 * Vista del solicitante: consulta de un ticket puntual y listado de los
 * últimos 5 servicios de su área.
 */
export function consultarTicket() {
  // El campo solo recibe números: el prefijo REQ- lo pone la interfaz.
  const n = ($('qTicket').value || '').replace(/[^0-9]/g, '');
  if (!n) {
    $('eTicket').textContent = 'Escribe el número de tu ticket.';
    $('eTicket').classList.add('on');
    $('resTicket').innerHTML = '';
    return;
  }
  const id = 'REQ-' + pad(parseInt(n, 10));
  // DB.solicitudes ya viene acotada por el servidor a los últimos 5 del área
  // (ver cargarMiArea en api/estado.js): no hace falta filtrar por DNI acá, y
  // filtrar lo dejaría sin poder consultar el de un compañero de la misma área.
  const s = DB.solicitudes.find(x => x.id === id);
  if (!s) {
    $('eTicket').textContent = 'No encontramos el ticket ' + esc(id) + ' entre los últimos servicios de tu área.';
    $('eTicket').classList.add('on');
    $('resTicket').innerHTML = '';
    return;
  }
  $('eTicket').classList.remove('on');
  $('qTicket').value = numeroTicket(s.id);
  $('resTicket').innerHTML = ticketHTML(s);
}

export function renderMis() {
  if (!sesion || sesion.tipo !== 'user') return;
  $('misArea').textContent = sesion.area;
  const mias = DB.solicitudes.slice().sort((a, b) => b.creado.localeCompare(a.creado));
  $('cntMis').textContent = mias.length;
  const cont = $('misTickets');
  if (!mias.length) {
    cont.innerHTML = '<div class="card empty"><strong>Todavía no hay servicios de tu área</strong>Registra el primero en la pestaña anterior.</div>';
  } else {
    cont.innerHTML = mias.map(ticketHTML).join('');
  }
  if ($('uSeguimiento').classList.contains('on') && $('qTicket').value) consultarTicket();
}

/** Pide a logística el histórico completo del área, cuando los últimos 5 no alcanzan. */
export async function pedirHistoricoCompleto() {
  let r;
  try {
    r = await pedirHistoricoArea();
  } catch (e) {
    toast('No se pudo enviar el pedido', e.message, 'bad');
    return;
  }
  if (r.repetido) {
    toast('Ya hay un pedido en curso', 'Logística ya está revisando el histórico de tu área.', 'warn');
    return;
  }
  toast('Pedido enviado', 'Logística te hará llegar el histórico completo de tu área.');
}

/**
 * El propio solicitante cancela lo suyo, sin elegir motivo: el servidor lo
 * pone solo ("Usuario solicitó baja") y solo lo deja mientras el ticket sigue
 * "En espera" -una vez que salió un mensajero, ya no es autoservicio-.
 */
export async function cancelarMiSolicitud(id) {
  if (!confirm('¿Cancelar el servicio ' + id + '? No se puede deshacer.')) return;
  try {
    await cancelarSolicitud(id);
  } catch (e) {
    toast('No se pudo cancelar', e.message, 'bad');
    return;
  }
  renderMis();
  if ($('qTicket').value) consultarTicket();
  toast('Servicio cancelado', id + ' ya no se va a ejecutar.', 'warn');
}
