import { $, esc } from '../utils/dom.js';
import { DB, cancelarSolicitud, pedirHistoricoArea, buscarMiArea } from '../api/estado.js';
import { sesion } from '../state/sessionState.js';
import { toast } from '../utils/toast.js';
import { ticketHTML } from './presenters.js';

/**
 * "Mis servicios" del solicitante: los últimos 10 de su área y un buscador
 * sobre TODOS los del área -por número de ticket, solicitante o destino-.
 * Reemplaza a la antigua pestaña "Seguimiento", que solo encontraba un
 * ticket si estaba entre los últimos.
 */
let busqueda = null; // { q, solicitudes } mientras se muestra un resultado de búsqueda

function pintar(lista, vacio) {
  $('misTickets').innerHTML = lista.length
    ? lista.map(ticketHTML).join('')
    : '<div class="card empty"><strong>' + vacio + '</strong></div>';
}

export function renderMis() {
  if (!sesion || sesion.tipo !== 'user') return;
  $('misArea').textContent = sesion.area;
  const mias = DB.solicitudes.slice().sort((a, b) => b.creado.localeCompare(a.creado));
  $('cntMis').textContent = mias.length;
  if (busqueda) return; // no pisar un resultado de búsqueda con el sondeo
  $('misResumen').textContent = mias.length ? 'Últimos ' + mias.length + ' servicios del área.' : '';
  pintar(mias, 'Todavía no hay servicios de tu área. Registra el primero en "Nueva solicitud".');
}

export async function buscarMisServicios() {
  const q = $('qMis').value.trim();
  $('eMis').classList.remove('on');
  if (q.length < 2) {
    $('eMis').textContent = 'Escribe al menos 2 caracteres: número de ticket, nombre o destino.';
    $('eMis').classList.add('on');
    return;
  }
  let r;
  try { r = await buscarMiArea(q); } catch (e) {
    $('eMis').textContent = e.message; $('eMis').classList.add('on'); return;
  }
  // Los adjuntos de lo encontrado se suman a los conocidos, para que las
  // tarjetas muestren sus guías igual que las de los últimos 10.
  const ids = new Set(DB.adjuntos.map(a => a.id));
  DB.adjuntos.push(...(r.adjuntos || []).filter(a => !ids.has(a.id)));
  busqueda = { q, solicitudes: r.solicitudes };
  $('btnLimpiarMis').hidden = false;
  $('misResumen').innerHTML = r.solicitudes.length
    ? r.solicitudes.length + (r.solicitudes.length === 20 ? ' o más' : '') + ' resultado' + (r.solicitudes.length === 1 ? '' : 's')
      + ' para <b>' + esc(q) + '</b>' + (r.solicitudes.length === 20 ? ' (se muestran los 20 más recientes; afina la búsqueda).' : '.')
    : '';
  pintar(r.solicitudes, 'Ningún servicio del área coincide con "' + esc(q) + '".');
}

export function limpiarBusquedaMis() {
  busqueda = null;
  $('qMis').value = '';
  $('eMis').classList.remove('on');
  $('btnLimpiarMis').hidden = true;
  renderMis();
}

/** Pide a logística el histórico completo del área. */
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
  if (busqueda) await buscarMisServicios(); else renderMis();
  toast('Servicio cancelado', id + ' ya no se va a ejecutar.', 'warn');
}
