import { obtener, crear, modificar, reemplazar, borrar } from './cliente.js';
import { sesion } from '../state/sessionState.js';

/**
 * Estado de la aplicación en el navegador.
 *
 * Sustituye a la antigua capa de localStorage: ahora la verdad vive en SQLite,
 * en el servidor. Aquí solo se guarda una COPIA para poder pintar la pantalla
 * de forma síncrona, que es como está escrito todo el render.
 *
 * El trato es simple:
 *   - `cargar()` trae el estado completo una vez, al arrancar.
 *   - Cada escritura va al servidor y, si el servidor la acepta, se actualiza
 *     la copia local. Nunca al revés: la pantalla no inventa datos que el
 *     servidor no haya confirmado.
 *   - `sincronizar()` pregunta por el testigo de revisión (unos bytes) y solo
 *     recarga todo cuando de verdad cambió algo en otra pestaña o en otra PC.
 */

/**
 * Copia local del estado. La leen las vistas; nadie la escribe a mano.
 *
 * El padrón NO está aquí, a propósito: son datos personales de 114 personas y
 * la pantalla nunca necesita más de una ficha a la vez. Se piden al servidor
 * cuando hacen falta (`buscarPersonal`, `buscarEnPadron`) y de él solo se
 * guarda el total, que es lo único que se muestra.
 */
export let DB = {
  totalPersonal: 0,
  solicitudes: [],
  autorizaciones: [],
  adjuntos: [],
  destinos: []
};

let revisionActual = null;

/**
 * Trae el estado según quién pregunta: `cliente.js` adjunta el token si hay
 * uno en la sesión, y el servidor decide con eso -no el navegador- si manda
 * el historial completo o lo deja vacío (ver GET /api/estado). Eso incluye al
 * solicitante con sesión de área: para él también queda en `[]`, porque sus
 * servicios los trae `cargarMiArea`, acotados a los últimos 5 de su área.
 */
export async function cargar() {
  const estado = await obtener('/estado');
  DB = {
    totalPersonal: estado.totalPersonal,
    solicitudes: estado.solicitudes,
    autorizaciones: estado.autorizaciones,
    adjuntos: estado.adjuntos,
    destinos: estado.destinos
  };
  revisionActual = estado.revision;
  return DB;
}

/**
 * Los últimos 5 servicios (y sus adjuntos) del área de la sesión: lo único a
 * lo que tiene acceso un solicitante autenticado con DNI + credencial de
 * área. Se llama al entrar y de nuevo en cada sondeo, para que "Mis
 * servicios" vea los cambios que haga logística sin tener que recargar.
 */
export async function cargarMiArea() {
  const r = await obtener('/solicitudes/mias');
  DB.solicitudes = r.solicitudes;
  DB.adjuntos = r.adjuntos;
  return DB;
}

/**
 * Confirma que el token de una sesión de logística (admin o seguimiento)
 * todavía vale. `GET /estado` no sirve para esto: con sesión opcional,
 * responde 200 igual aunque el token ya no exista (solo que vacío), la
 * misma forma que sin sesión. Se usa para restaurar la sesión tras un F5
 * -ver restaurarSesion() en auth.js- sin dar por buena una copia local de
 * un token que el servidor ya olvidó.
 */
export const confirmarSesionLogistica = () => obtener('/solicitudes');

/** Al salir, o si el DNI no correspondía a nada: no dejar en pantalla datos de quien ya se fue. */
export function limpiarDatosPrivados() {
  DB.solicitudes = [];
  DB.adjuntos = [];
  DB.autorizaciones = [];
}

/**
 * Revisa si alguien más cambió algo. Con el histórico cargado el estado pesa
 * cientos de KB, así que primero se pregunta el testigo y solo se recarga
 * cuando cambió: sin eso, sondear cada pocos segundos sería descargarlo todo
 * una y otra vez.
 */
export async function sincronizar(onCambio) {
  try {
    const { revision } = await obtener('/revision');
    if (revision === revisionActual) return false;
    await cargar();
    // Para logística, /estado con el token ya trae todo. Para el solicitante,
    // /estado sin sesión vuelve a dejar `solicitudes`/`adjuntos` en blanco -es
    // lo correcto para cualquiera que pregunte sin identificarse-, así que hay
    // que volver a pedir lo suyo aparte.
    if (sesion && sesion.tipo === 'user') await cargarMiArea();
    if (onCambio) onCambio();
    return true;
  } catch (e) {
    // Sin conexión no se rompe la pantalla: se reintenta en el próximo sondeo.
    return false;
  }
}

// ------------------------------------------------------------------- auth
export const ingresarLogistica = (usuario, clave) => crear('/auth/ingresar', { usuario, clave });
export const salirLogistica = () => crear('/auth/salir');
export const cambiarMiClave = (actual, nueva) => reemplazar('/auth/clave', { actual, nueva });
export const buscarEnPadron = doc => obtener('/auth/solicitante/' + encodeURIComponent(doc));

// El segundo factor del ingreso del solicitante: DNI + credencial de área.
export const ingresarPorArea = (dni, usuario, clave) => crear('/auth/area', { dni, usuario, clave });
export const salirArea = () => crear('/auth/area/salir');
export const cambiarMiClaveArea = (actual, nueva) => reemplazar('/auth/area/clave', { actual, nueva });

// --------------------------------------------------------------- personal
export async function agregarPersona(datos) {
  const p = await crear('/personal', datos);
  DB.totalPersonal++;
  DB.autorizaciones
    .filter(a => a.dni === p.dni && a.estado === 'Pendiente')
    .forEach(a => { a.estado = 'Aprobada'; });
  return p;
}

export async function quitarPersona(dni) {
  await borrar('/personal/' + encodeURIComponent(dni));
  DB.totalPersonal--;
}

export const buscarPersonal = q => obtener('/personal?q=' + encodeURIComponent(q));

// ------------------------------------------------------------ solicitudes
export async function crearSolicitud(datos) {
  const s = await crear('/solicitudes', datos);
  DB.solicitudes.push(s);
  return s;
}

export async function actualizarSolicitud(id, cambios) {
  const s = await modificar('/solicitudes/' + encodeURIComponent(id), cambios);
  reemplazarSolicitud(s);
  return s;
}

export async function avanzarSolicitud(id) {
  const s = await crear('/solicitudes/' + encodeURIComponent(id) + '/avanzar');
  reemplazarSolicitud(s);
  return s;
}

/**
 * Cancela un ticket. Sin `motivo` (el caso del solicitante cancelando lo
 * suyo) el servidor pone "Usuario solicitó baja" solo; con sesión de
 * logística hay que mandar uno de los tres de `#shared/cancelacion.js`.
 */
export async function cancelarSolicitud(id, motivo, detalle) {
  const s = await crear('/solicitudes/' + encodeURIComponent(id) + '/cancelar', motivo ? { motivo, detalle } : undefined);
  reemplazarSolicitud(s);
  return s;
}

function reemplazarSolicitud(s) {
  const i = DB.solicitudes.findIndex(x => x.id === s.id);
  if (i >= 0) DB.solicitudes[i] = s; else DB.solicitudes.push(s);
}

/**
 * Reporte de viajes en Excel. Es un binario, no JSON, así que no pasa por
 * `crear`/`obtener`: se pide la respuesta cruda para leer el archivo y el
 * nombre que el servidor le puso en Content-Disposition.
 */
export async function exportarExcel(desde, hasta) {
  const qs = [];
  if (desde) qs.push('desde=' + encodeURIComponent(desde));
  if (hasta) qs.push('hasta=' + encodeURIComponent(hasta));
  const res = await obtener('/solicitudes/exportar' + (qs.length ? '?' + qs.join('&') : ''), { crudo: true });
  if (!res.ok) {
    let mensaje = 'Error ' + res.status + ' al exportar.';
    try { const d = await res.json(); if (d && d.error) mensaje = d.error; } catch (e) { /* sin cuerpo JSON */ }
    throw Object.assign(new Error(mensaje), { status: res.status });
  }
  const nombre = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') || '');
  return { blob: await res.blob(), nombre: nombre ? nombre[1] : 'viajes.xlsx' };
}

// --------------------------------------------------------- autorizaciones
export async function pedirAutorizacion(dni, datos) {
  const r = await crear('/autorizaciones', { dni, ...datos });
  if (!r.repetido) {
    DB.autorizaciones.unshift({
      dni: r.dni, solicitado: new Date().toISOString(), estado: 'Pendiente',
      apellidos: datos.apellidos, nombres: datos.nombres, celular: datos.celular,
      email: datos.email || '', area: datos.area || ''
    });
  }
  return r;
}

export async function resolverAutorizacion(dni, estado) {
  await modificar('/autorizaciones/' + encodeURIComponent(dni), { estado });
  DB.autorizaciones
    .filter(a => a.dni === dni && a.estado === 'Pendiente')
    .forEach(a => { a.estado = estado; });
}

// ---------------------------------------------------------------- usuarios
// Cuentas de logística (admin/seguimiento). No confundir con `personal`
// (padrón), que es quién puede PEDIR un servicio.
export const listarUsuarios = () => obtener('/usuarios');
export const crearUsuarioLogistica = (usuario, rol) => crear('/usuarios', { usuario, rol });
export const restablecerClaveUsuario = id => crear('/usuarios/' + id + '/restablecer');
export const cambiarEstadoUsuario = (id, activo) => modificar('/usuarios/' + id, { activo });

// --------------------------------------------------- credenciales de área
// La credencial compartida de cada área (segundo factor del ingreso del
// solicitante). No confundir con `usuarios` de arriba: son cuentas
// personales de logística, esto es una sola clave por área.
export const listarCredencialesArea = () => obtener('/credenciales-area');
export const crearCredencialArea = (area, usuario) => crear('/credenciales-area', { area, usuario });
export const restablecerClaveCredencialArea = area => crear('/credenciales-area/' + encodeURIComponent(area) + '/restablecer');
export const cambiarEstadoCredencialArea = (area, activo) => modificar('/credenciales-area/' + encodeURIComponent(area), { activo });

// ------------------------------------------------- pedidos de histórico
export const pedirHistoricoArea = () => crear('/pedidos-historico');
export const listarPedidosHistorico = () => obtener('/pedidos-historico');
export const resolverPedidoHistorico = (id, estado) => modificar('/pedidos-historico/' + id, { estado });

// ------------------------------------------------- compras y logística
// Exportaciones (muestras al exterior), requerimientos de compra y
// servicios que gestiona el coordinador de logística. Todo admin-only.
export const listarExportaciones = () => obtener('/exportaciones');
export const crearExportacion = datos => crear('/exportaciones', datos);
export const actualizarExportacion = (id, datos) => modificar('/exportaciones/' + id, datos);
export const borrarExportacion = id => borrar('/exportaciones/' + id);

export const listarRequerimientos = () => obtener('/requerimientos-compra');
export const crearRequerimiento = datos => crear('/requerimientos-compra', datos);
export const actualizarRequerimiento = (id, datos) => modificar('/requerimientos-compra/' + id, datos);
export const borrarRequerimiento = id => borrar('/requerimientos-compra/' + id);

export const listarServiciosLogistica = () => obtener('/servicios-logistica');
export const crearServicioLogistica = datos => crear('/servicios-logistica', datos);
export const actualizarServicioLogistica = (id, datos) => modificar('/servicios-logistica/' + id, datos);
export const borrarServicioLogistica = id => borrar('/servicios-logistica/' + id);

// Ticket de un solo uso para entrar al módulo de Almacén (otro repositorio,
// embebido en un iframe propio; ver backend/almacen/acceso.js).
export const emitirTicketAlmacen = () => crear('/almacen/ticket');
