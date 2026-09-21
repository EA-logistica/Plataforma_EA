import { sesion } from './state/sessionState.js';
import { renderBandeja } from './views/dispatch.js';
import { renderHistoricoSiVisible } from './views/history.js';
import { renderPadronSiVisible } from './views/roster.js';
import { renderKpiSiVisible } from './views/kpi.js';
import { renderUsuariosSiVisible } from './views/usuarios.js';
import { renderCredencialesAreaSiVisible } from './views/credencialesArea.js';
import { renderMis } from './views/tickets.js';
import { sincronizar as sincronizarStore } from './api/estado.js';

/**
 * Orquestador de render: vuelve a pintar lo que corresponde a la sesión
 * activa (admin o solicitante).
 *
 * Solo la bandeja se repinta siempre: es la pestaña de trabajo y además lleva
 * el contador que avisa de lo que entró. Las demás se repintan únicamente si
 * están a la vista. Pintarlas todas costaba, en cada cambio que llegara de
 * otra PC, una tabla de mil quinientas filas y una consulta al padrón que
 * nadie estaba mirando.
 */
export function renderTodo() {
  if (!sesion) return;
  if (sesion.tipo === 'admin') {
    renderBandeja();
    renderHistoricoSiVisible();
    renderPadronSiVisible();
    renderKpiSiVisible();
    renderUsuariosSiVisible();
    renderCredencialesAreaSiVisible();
  } else {
    renderMis();
  }
}

/**
 * Sondeo periódico que detecta cambios hechos desde otra pestaña u otra PC.
 *
 * Con el servidor de por medio ya no basta con mirar el almacenamiento local:
 * hay que preguntar. La llamada es barata (solo el testigo de revisión) y el
 * estado completo se recarga únicamente cuando algo cambió de verdad.
 */
export function iniciarSincronizacion(intervaloMs) {
  setInterval(() => { sincronizarStore(renderTodo); }, intervaloMs);
}
