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
import { sesion } from './state/sessionState.js';
import { iniciarSincronizacion } from './render.js';
import { aplicarTema, actualizarBoton } from './ui/theme.js';
import { iniciarEstadoMongo } from './ui/mongoEstado.js';
import { iniciarAvisoActualizacion, reiniciarServidor } from './ui/actualizacion.js';
import { alternarAccesoLogistica, cerrarAccesoLogistica } from './ui/logisticaPopover.js';
import { alternarMenuCuenta, cerrarMenuCuenta } from './ui/cuentaPopover.js';
import { toggleNavGroup, restaurarNavGroups, alternarMenu, cerrarMenu } from './ui/sidebar.js';

import {
  entrarSolicitante, pedirAutorizacion, entrarAdmin, salir, abrirCambioClave, guardarCambioClave,
  entrarSolicitanteArea, volverAlDni, restaurarSesion
} from './auth.js';
import { tabUser, tabAdmin, subtabHistorico } from './views/tabs.js';
import {
  setAccion, toggleOrigen, refrescarHoras, validarHoraViva, enviarSolicitud,
  agregarParada, editarParada, quitarParada,
  validarServicioVivo, revisarDestino, setDestinoTipo, abrirMapa, olvidarPunto,
  pintarSugerenciasDestino,
  setModalidad, setServicio, setOrigen, elegirDestino, setFecha, setHora, irAPasoSolicitud
} from './views/requestForm.js';
import { cerrarSelectorMapa, confirmarSelectorMapa, buscarEnMapa, miUbicacion } from './ui/mapaPicker.js';
import { renderMis, cancelarMiSolicitud, pedirHistoricoCompleto, buscarMisServicios, limpiarBusquedaMis } from './views/tickets.js';
import {
  renderBandeja, setFiltroBandeja, setFiltroModalidadBandeja, setFiltroAccionBandeja, buscarEnBandeja, refrescarEditorServicio, guardarServicioTicket, setVehiculo, setCosto, avanzar, verDetalle, cerrarModal,
  abrirCancelarSolicitud, mostrarDetalleCancelacion, confirmarCancelarSolicitud, confirmarEliminacionSubmit
} from './views/dispatch.js';
import {
  renderHistorico, abrirExportarExcel, confirmarExportarExcel,
  filtrarHistorico, irPaginaHistorico, limpiarFiltrosHistorico
} from './views/history.js';
import { setFiltroKpi, setQKpi, limpiarFiltroKpi } from './views/kpi.js';
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
import { verModuloAlmacen } from './views/almacen.js';
import {
  renderExportaciones, abrirNuevaExportacion, editarExportacion, guardarExportacion, borrarExportacionVista
} from './views/exportaciones.js';
import {
  renderRequerimientos, abrirNuevoRequerimiento, editarRequerimiento, guardarRequerimiento, borrarRequerimientoVista,
  renderRequerimientosHistorico, setFiltroRequerimientosHistorico, limpiarFiltroRequerimientosHistorico,
  irPaginaRequerimientosHistorico, verFacturasProveedorRqc, setEstadoRequerimientosHistorico
} from './views/requerimientosCompra.js';
import {
  renderOrdenesCompra, setFiltroOrdenesCompra, limpiarFiltroOrdenesCompra, irPaginaOrdenesCompra,
  renderEvolucionProveedorCompra, filtrarOrdenesCompraPorMes, elegirProveedorOrdenesCompra,
  renderOC, subtabCompras, setFiltroOC, limpiarFiltroOC, irPaginaOC, verItemsOC, filtrarOCPorMes, elegirProveedorOC
} from './views/ordenesCompra.js';
import {
  renderProveedores, elegirProveedorSeccion, elegirProveedorIndice, buscarProveedorSeccion, teclaProveedorSeccion,
  cerrarSugerenciasProveedor, irARegistroDeProveedor, irAOCDeProveedor
} from './views/proveedores.js';
import {
  renderProductos, setFiltroProductos, limpiarFiltroProductos, irPaginaProductos, verRequerimientosProducto,
  ordenarProductosPorStock, setClaseRotacionProductos, filtrarFamiliaClaseC
} from './views/productos.js';
import { renderDashboard } from './views/dashboard.js';
import {
  renderMateriaPrima, irACategoriasMateriaPrima, abrirCategoriaMateriaPrima, abrirLineaMateriaPrima,
  verAlmacenesProductoMateriaPrima, buscarProductosMateriaPrima, cambiarTipoMateriaPrima, verProductosDeAlmacenMateriaPrima,
  ordenarMateriaPrima, paginaMateriaPrima, filaMateriaPrima, volverACategoriaMateriaPrima, limpiarBusquedaMateriaPrima, pintarCodigosNuevosMateriaPrima
} from './views/materiaPrima.js';
import {
  subtabMateriaPrima, renderMuestras, irAMesMuestras, filtrarMuestras, abrirNuevaMuestra, editarMuestra, subtotalMuestra,
  buscarProveedorMuestra, guardarMuestra, cambiarEstadoMuestra, borrarMuestraVista, abrirPegarMuestras, previsualizarPegado, importarPegado, detectarCodigoMuestra, elegirCodigoMuestra
} from './views/muestras.js';
import {
  filtrarHomologados, filtrarCategoriaHomologados, limpiarFiltrosHomologados, ordenarHomologados, paginaHomologados
} from './views/homologados.js';
// Radar de Importaciones (SUNAT): apartado propio con 5 pestañas, ver views/radar/.
import {
  renderRadar, subtabRadar, filtrarRadar, limpiarFiltrosRadar, granoHistoricoRadar, buscarExplorarRadar, irPaginaExplorarRadar,
  exportarExplorarRadar, verSerieRadar, guardarRevisionRadar, buscarProductosRadar, ordenarProductosRadar, irPaginaProductosRadar,
  filtrarEmpresasRadar, verEmpresaRadar, verEmpresaRadarPorNombre, cerrarEmpresaRadar, abrirActualizarRadar, tipoCargaRadar,
  confirmarActualizarRadar, reanudarEjecucionRadar
} from './views/radar/index.js';
import {
  renderServiciosLogistica, abrirNuevoServicioLogistica, editarServicioLogistica,
  guardarServicioLogistica, borrarServicioLogisticaVista
} from './views/serviciosLogistica.js';
// Importaciones (bot de logística) y ABC de materia prima.
import {
  renderImportaciones, filtrarImportaciones, impPagina, impOrdenar, impFiltrarEstado, impFiltrarFamilia, impFiltrarMes,
  impBuscar, impFiltroRapido, impLimpiar, impVerPorConfirmar, exportarImportaciones, impDetalle
} from './views/importaciones.js';
import { renderAbc, filtrarAbc, abcFiltrarMatriz, limpiarAbc, abcOrdenar, abcPagina, exportarAbc } from './views/abc.js';
import { setPerfilDashboard, dashIr, dashImpEtapa, dashImpMes, verReporteSemanal } from './views/dashboard.js';
// Herramientas transversales: buscador (Ctrl+K), período global, tablas, gráficos y frescura de datos.
import { abrirBuscador, cerrarBuscador, escribirBuscador, marcarBuscador, elegirBuscador, iniciarBuscador } from './ui/buscador.js';
import { alternarPeriodo, cerrarPeriodo, setPeriodo, setCompararPeriodo, perMes, perDia } from './state/periodo.js';
import { menuColumnas, exportarExcel, exportarPdf, iniciarTablas } from './ui/tablas.js';
import { iniciarTooltips } from './ui/graficos.js';
import { iniciarFrescura } from './ui/frescura.js';

// Módulo payback: análisis de contratar motorizado propio frente al courier.
// Vive fuera de js/ a propósito, con su propia data, backend y frontend.
import {
  renderPayback, setBonoPayback, setAsignacionPayback, setCreditoFiscalPayback, setPlazoPagoPayback, setBasicoPayback, setCuotaPayback, setInicioPayback,
  pbAgregarParada, pbQuitarParada, pbZonaParada, pbCuantasParadas, pbHoraSalida,
  pbDiaSimulado, pbMinutosParada, pbTiempoZona, pbOrdenarMejor, pbReiniciarSimulador,
  pbPlanDia, pbPlanSalida, pbPlanChilca, pbPlanParada, pbPlanQuitarExtra, pbPlanBuscar, pbPlanAgregar, pbPlanBuscarMapa, pbPlanAgregarHist
} from './views/payback/vista.js';

// ---- Puente hacia los atributos inline del HTML (estático y generado) ----
Object.assign(window, {
  aplicarTema, alternarAccesoLogistica, alternarMenuCuenta, toggleNavGroup, alternarMenu, cerrarMenu,
  pedirAutorizacion, entrarSolicitante, entrarAdmin, salir, abrirCambioClave, guardarCambioClave,
  entrarSolicitanteArea, volverAlDni,
  setAccion, toggleOrigen, refrescarHoras, validarHoraViva, enviarSolicitud,
  agregarParada, editarParada, quitarParada,
  validarServicioVivo, revisarDestino, setDestinoTipo, abrirMapa, olvidarPunto,
  setModalidad, setServicio, setOrigen, elegirDestino, setFecha, setHora, irAPasoSolicitud,
  reiniciarServidor,
  cerrarMapa: cerrarSelectorMapa, confirmarMapa: confirmarSelectorMapa, buscarEnMapa, miUbicacion,
  tabUser, tabAdmin, subtabHistorico,
  renderMis, cancelarMiSolicitud, pedirHistoricoCompleto, buscarMisServicios, limpiarBusquedaMis,
  renderBandeja, setFiltroBandeja, setFiltroModalidadBandeja, setFiltroAccionBandeja, buscarEnBandeja, refrescarEditorServicio, guardarServicioTicket, setVehiculo, setCosto, avanzar, verDetalle, cerrarModal,
  abrirCancelarSolicitud, mostrarDetalleCancelacion, confirmarCancelarSolicitud, confirmarEliminacionSubmit,
  renderHistorico, abrirExportarExcel, confirmarExportarExcel,
  filtrarHistorico, irPaginaHistorico, limpiarFiltrosHistorico,
  setFiltroKpi, setQKpi, limpiarFiltroKpi,
  renderPadron, agregarPersona, quitarPersona, formAlta, rechazarAut,
  atenderPedidoHistorico, rechazarPedidoHistorico,
  renderUsuarios, crearUsuarioLogistica, restablecerClaveUsuarioVista, cambiarEstadoUsuarioVista,
  crearCredencialAreaVista, restablecerClaveAreaVista, cambiarEstadoAreaVista,
  subirGuia, abrirAdjunto, eliminarAdjunto,
  renderPayback, setBonoPayback, setAsignacionPayback, setCreditoFiscalPayback, setPlazoPagoPayback, setBasicoPayback, setCuotaPayback, setInicioPayback,
  pbAgregarParada, pbQuitarParada, pbZonaParada, pbCuantasParadas, pbHoraSalida,
  pbDiaSimulado, pbMinutosParada, pbTiempoZona, pbOrdenarMejor, pbReiniciarSimulador,
  pbPlanDia, pbPlanSalida, pbPlanChilca, pbPlanParada, pbPlanQuitarExtra, pbPlanBuscar, pbPlanAgregar, pbPlanBuscarMapa, pbPlanAgregarHist,
  verModuloAlmacen,
  renderExportaciones, abrirNuevaExportacion, editarExportacion, guardarExportacion, borrarExportacionVista,
  renderRequerimientos, abrirNuevoRequerimiento, editarRequerimiento, guardarRequerimiento, borrarRequerimientoVista,
  renderRequerimientosHistorico, setFiltroRequerimientosHistorico, limpiarFiltroRequerimientosHistorico,
  irPaginaRequerimientosHistorico, verFacturasProveedorRqc, setEstadoRequerimientosHistorico,
  renderOrdenesCompra, setFiltroOrdenesCompra, limpiarFiltroOrdenesCompra, irPaginaOrdenesCompra, renderEvolucionProveedorCompra,
  filtrarOrdenesCompraPorMes, elegirProveedorOrdenesCompra,
  renderOC, subtabCompras, setFiltroOC, limpiarFiltroOC, irPaginaOC, verItemsOC, filtrarOCPorMes, elegirProveedorOC,
  renderProveedores, elegirProveedorSeccion, elegirProveedorIndice, buscarProveedorSeccion, teclaProveedorSeccion,
  cerrarSugerenciasProveedor, irARegistroDeProveedor, irAOCDeProveedor,
  renderProductos, setFiltroProductos, limpiarFiltroProductos, irPaginaProductos, verRequerimientosProducto, ordenarProductosPorStock,
  setClaseRotacionProductos, filtrarFamiliaClaseC, renderDashboard,
  renderMateriaPrima, irACategoriasMateriaPrima, abrirCategoriaMateriaPrima, abrirLineaMateriaPrima,
  verAlmacenesProductoMateriaPrima, buscarProductosMateriaPrima, cambiarTipoMateriaPrima, verProductosDeAlmacenMateriaPrima,
  ordenarMateriaPrima, paginaMateriaPrima, filaMateriaPrima, volverACategoriaMateriaPrima, limpiarBusquedaMateriaPrima, pintarCodigosNuevosMateriaPrima,
  renderServiciosLogistica, abrirNuevoServicioLogistica, editarServicioLogistica,
  guardarServicioLogistica, borrarServicioLogisticaVista,
  subtabMateriaPrima, renderMuestras, irAMesMuestras, filtrarMuestras, abrirNuevaMuestra, editarMuestra, subtotalMuestra,
  buscarProveedorMuestra, guardarMuestra, cambiarEstadoMuestra, borrarMuestraVista, abrirPegarMuestras, previsualizarPegado, importarPegado, detectarCodigoMuestra, elegirCodigoMuestra,
  filtrarHomologados, filtrarCategoriaHomologados, limpiarFiltrosHomologados, ordenarHomologados, paginaHomologados,
  renderRadar, subtabRadar, filtrarRadar, limpiarFiltrosRadar, granoHistoricoRadar, buscarExplorarRadar, irPaginaExplorarRadar,
  exportarExplorarRadar, verSerieRadar, guardarRevisionRadar, buscarProductosRadar, ordenarProductosRadar, irPaginaProductosRadar,
  filtrarEmpresasRadar, verEmpresaRadar, verEmpresaRadarPorNombre, cerrarEmpresaRadar, abrirActualizarRadar, tipoCargaRadar,
  confirmarActualizarRadar, reanudarEjecucionRadar,
  renderImportaciones, filtrarImportaciones, impPagina, impOrdenar, impFiltrarEstado, impFiltrarFamilia, impFiltrarMes,
  impBuscar, impFiltroRapido, impLimpiar, impVerPorConfirmar, exportarImportaciones, impDetalle,
  renderAbc, filtrarAbc, abcFiltrarMatriz, limpiarAbc, abcOrdenar, abcPagina, exportarAbc,
  setPerfilDashboard, dashIr, dashImpEtapa, dashImpMes, verReporteSemanal,
  abrirBuscador, cerrarBuscador, escribirBuscador, marcarBuscador, elegirBuscador,
  alternarPeriodo, setPeriodo, setCompararPeriodo, perMes, perDia,
  menuColumnasTabla: menuColumnas, exportarExcelTabla: exportarExcel, exportarPdfTabla: exportarPdf
});

// ---- Listeners que no van como atributos inline ----
document.addEventListener('keydown', e => { if (e.key === 'Escape') { cerrarSelectorMapa(); cerrarModal(); cerrarAccesoLogistica(); cerrarMenuCuenta(); cerrarMenu(); cerrarPeriodo(); } });
// Clic fuera del icono o del panel: se cierra solo, como cualquier menú.
document.addEventListener('click', e => {
  if (!$('logisticaAnchor').contains(e.target)) cerrarAccesoLogistica();
  if (!$('cuentaAnchor').contains(e.target)) cerrarMenuCuenta();
  // isConnected: elegir una opción repinta el menú y el botón clicado ya no está en la página.
  if (e.target.isConnected && !$('periodoAnchor').contains(e.target)) cerrarPeriodo();
});
$('dniInput').addEventListener('keydown', e => { if (e.key === 'Enter') entrarSolicitante(); });
$('dniInput').addEventListener('input', e => { e.target.value = e.target.value.replace(/\D/g, ''); });
$('areaUsuarioInput').addEventListener('keydown', e => { if (e.key === 'Enter') entrarSolicitanteArea(); });
$('areaClaveInput').addEventListener('keydown', e => { if (e.key === 'Enter') entrarSolicitanteArea(); });
$('userInput').addEventListener('keydown', e => { if (e.key === 'Enter') entrarAdmin(); });
$('pinInput').addEventListener('keydown', e => { if (e.key === 'Enter') entrarAdmin(); });
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

// Si había una sesión de una recarga anterior (F5) y el token del servidor
// todavía vale, se entra directo a su vista en vez de mostrar el login.
await restaurarSesion();

actualizarBoton();
restaurarNavGroups();

// Destinos frecuentes del histórico real: se ofrecen como sugerencia, el
// campo sigue aceptando cualquier dirección escrita a mano.
pintarSugerenciasDestino();

$('fFecha').min = hoyISO();
refrescarHoras();

iniciarSincronizacion(2500);
iniciarEstadoMongo();
iniciarTooltips();
iniciarTablas();
iniciarFrescura();
iniciarBuscador();
iniciarAvisoActualizacion();
setInterval(() => { if (sesion && sesion.tipo === 'user' && $('uNueva').classList.contains('on')) refrescarHoras(); }, 60000);
