/**
 * Punto de entrada de la aplicación.
 *
 * 1) Carga el estado inicial desde el servidor (una sola llamada a la API).
 * 2) Expone en `window` las funciones que el HTML invoca mediante atributos
 *    inline (onclick/onchange/oninput), ya que los módulos ES no son
 *    globales por defecto. Es un puente deliberado y acotado a esta lista;
 *    ver README para el detalle de por qué se mantiene y cómo migrar a
 *    delegación de eventos en el futuro.
 * 3) Registra los listeners que sí viven en JS (no en atributos inline).
 * 4) Arranca el reloj de la app: sincronización entre pestañas y refresco
 *    periódico de la ventana horaria del formulario.
 */
import { $, esc } from './utils/dom.js';
import { hoyISO } from './utils/format.js';
import { cargar } from './api/estado.js';
import { DESTINOS_FRECUENTES } from '#data/destinos.js';
import { sesion } from './state/sessionState.js';
import { iniciarSincronizacion } from './render.js';
import { aplicarTema, actualizarBoton } from './ui/theme.js';
import { alternarAccesoLogistica, cerrarAccesoLogistica } from './ui/logisticaPopover.js';

import {
  entrarSolicitante, pedirAutorizacion, entrarAdmin, salir, abrirCambioClave, guardarCambioClave,
  entrarSolicitanteArea, volverAlDni
} from './auth.js';
import { tabUser, tabAdmin } from './views/tabs.js';
import {
  setAccion, toggleOrigen, refrescarHoras, validarHoraViva, enviarSolicitud,
  agregarParada, editarParada, quitarParada
} from './views/requestForm.js';
import { consultarTicket, renderMis, cancelarMiSolicitud, pedirHistoricoCompleto } from './views/tickets.js';
import {
  renderBandeja, setFiltroBandeja, setVehiculo, setCosto, avanzar, verDetalle, cerrarModal,
  abrirCancelarSolicitud, mostrarDetalleCancelacion, confirmarCancelarSolicitud
} from './views/dispatch.js';
import {
  renderHistorico, exportarCSV, abrirExportarExcel, confirmarExportarExcel,
  filtrarHistorico, irPaginaHistorico, limpiarFiltrosHistorico
} from './views/history.js';
import { setFiltroKpi } from './views/kpi.js';
import {
  renderPadron, agregarPersona, quitarPersona, formAlta, rechazarAut,
  atenderPedidoHistorico, rechazarPedidoHistorico
} from './views/roster.js';
import {
  renderUsuarios, crearUsuarioLogistica, restablecerClaveUsuarioVista, cambiarEstadoUsuarioVista
} from './views/usuarios.js';
import {
  crearCredencialAreaVista, restablecerClaveAreaVista, cambiarEstadoAreaVista
} from './views/credencialesArea.js';
import { subirGuia, abrirAdjunto, eliminarAdjunto } from './views/attachments.js';

// Módulo payback: análisis de contratar motorizado propio frente al courier.
// Vive fuera de js/ a propósito, con su propia data, backend y frontend.
import {
  renderPayback, setBonoPayback, setCreditoFiscalPayback, setInicioPayback,
  pbAgregarParada, pbQuitarParada, pbZonaParada, pbCuantasParadas, pbHoraSalida,
  pbDiaSimulado, pbMinutosParada, pbTiempoZona, pbOrdenarMejor, pbReiniciarSimulador
} from './views/payback/vista.js';

// ---- Puente hacia los atributos inline del HTML (estático y generado) ----
Object.assign(window, {
  aplicarTema, alternarAccesoLogistica,
  pedirAutorizacion, entrarSolicitante, entrarAdmin, salir, abrirCambioClave, guardarCambioClave,
  entrarSolicitanteArea, volverAlDni,
  setAccion, toggleOrigen, refrescarHoras, validarHoraViva, enviarSolicitud,
  agregarParada, editarParada, quitarParada,
  tabUser, tabAdmin,
  consultarTicket, renderMis, cancelarMiSolicitud, pedirHistoricoCompleto,
  renderBandeja, setFiltroBandeja, setVehiculo, setCosto, avanzar, verDetalle, cerrarModal,
  abrirCancelarSolicitud, mostrarDetalleCancelacion, confirmarCancelarSolicitud,
  renderHistorico, exportarCSV, abrirExportarExcel, confirmarExportarExcel,
  filtrarHistorico, irPaginaHistorico, limpiarFiltrosHistorico,
  setFiltroKpi,
  renderPadron, agregarPersona, quitarPersona, formAlta, rechazarAut,
  atenderPedidoHistorico, rechazarPedidoHistorico,
  renderUsuarios, crearUsuarioLogistica, restablecerClaveUsuarioVista, cambiarEstadoUsuarioVista,
  crearCredencialAreaVista, restablecerClaveAreaVista, cambiarEstadoAreaVista,
  subirGuia, abrirAdjunto, eliminarAdjunto,
  renderPayback, setBonoPayback, setCreditoFiscalPayback, setInicioPayback,
  pbAgregarParada, pbQuitarParada, pbZonaParada, pbCuantasParadas, pbHoraSalida,
  pbDiaSimulado, pbMinutosParada, pbTiempoZona, pbOrdenarMejor, pbReiniciarSimulador
});

// ---- Listeners que no van como atributos inline ----
document.addEventListener('keydown', e => { if (e.key === 'Escape') { cerrarModal(); cerrarAccesoLogistica(); } });
// Clic fuera del icono o del panel: se cierra solo, como cualquier menú.
document.addEventListener('click', e => {
  if (!$('logisticaAnchor').contains(e.target)) cerrarAccesoLogistica();
});
$('dniInput').addEventListener('keydown', e => { if (e.key === 'Enter') entrarSolicitante(); });
$('dniInput').addEventListener('input', e => { e.target.value = e.target.value.replace(/\D/g, ''); });
$('areaUsuarioInput').addEventListener('keydown', e => { if (e.key === 'Enter') entrarSolicitanteArea(); });
$('areaClaveInput').addEventListener('keydown', e => { if (e.key === 'Enter') entrarSolicitanteArea(); });
$('userInput').addEventListener('keydown', e => { if (e.key === 'Enter') entrarAdmin(); });
$('pinInput').addEventListener('keydown', e => { if (e.key === 'Enter') entrarAdmin(); });
$('qTicket').addEventListener('keydown', e => { if (e.key === 'Enter') consultarTicket(); });
$('qTicket').addEventListener('input', e => { e.target.value = e.target.value.replace(/[^0-9]/g, ''); });
$('pDni').addEventListener('input', e => { e.target.value = e.target.value.replace(/[^0-9]/g, ''); });
$('fTel').addEventListener('input', e => { e.target.value = e.target.value.replace(/\D/g, ''); });

// ---- Arranque ----
// El estado completo viene del servidor en una sola llamada: padrón,
// solicitudes, autorizaciones, adjuntos y destinos. Si el servidor no responde,
// no hay nada que pintar y hay que decirlo, no fallar en silencio.
try {
  await cargar();
} catch (e) {
  document.body.innerHTML = '<div class="empty" style="padding:80px 20px">'
    + '<strong>No se puede conectar con el servidor</strong>'
    + esc(e.message) + '<br><br>Arráncalo con <code>npm start</code> y recarga la página.</div>';
  throw e;
}

actualizarBoton();

// Destinos frecuentes del histórico real: se ofrecen como sugerencia, el
// campo sigue aceptando cualquier dirección escrita a mano.
$('dlDestinos').innerHTML = DESTINOS_FRECUENTES
  .map(d => '<option value="' + d.replace(/"/g, '&quot;') + '"></option>').join('');

$('fFecha').min = hoyISO();
$('fFecha').value = hoyISO();
refrescarHoras();

iniciarSincronizacion(2500);
setInterval(() => { if (sesion && sesion.tipo === 'user' && $('uNueva').classList.contains('on')) refrescarHoras(); }, 60000);
