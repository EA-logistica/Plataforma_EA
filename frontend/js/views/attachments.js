import { $, esc } from '../utils/dom.js';
import { fechaHora } from '../utils/format.js';
import { toast } from '../utils/toast.js';
import { sesion } from '../state/sessionState.js';
import * as archivos from '../api/adjuntos.js';
// Import circular intencional, igual que el de render.js en dispatch.js: es
// seguro porque confirmarEliminacion solo se invoca desde un manejador de
// clic (eliminarAdjunto), nunca durante la carga inicial de los módulos.
import { confirmarEliminacion } from './dispatch.js';

/**
 * Guía / documento de entrega de cada viaje.
 *
 * Logística puede adjuntar una foto o PDF por ticket desde el modal de
 * gestión; el solicitante los ve (sin poder modificarlos) en su tarjeta.
 */

/** Bloque de adjuntos para el modal de gestión. `editable` habilita subir y borrar. */
export function adjuntosHTML(ticketId, editable) {
  const lista = archivos.adjuntosDe(ticketId);
  const aviso = archivos.esPersistente() ? '' :
    '<p class="attach-warn">Este navegador no permite guardar archivos de forma permanente: '
    + 'los adjuntos se perderán al recargar la página.</p>';

  const items = lista.length
    ? '<ul class="attach-list">' + lista.map(a => filaHTML(a, editable)).join('') + '</ul>'
    : '<p class="attach-empty">Todavía no hay guía de entrega cargada para este servicio.</p>';

  const alta = editable
    ? '<label class="attach-drop">'
      + '<input type="file" accept="' + archivos.TIPOS_ACEPTADOS + '" '
      + 'onchange="subirGuia(\'' + ticketId + '\', this)">'
      + '<span class="attach-drop-title">Adjuntar guía de entrega</span>'
      + '<span class="attach-drop-note">Imagen o PDF, hasta '
      + archivos.tamanoLegible(archivos.TAMANO_MAXIMO) + '</span>'
      + '</label>'
    : '';

  return '<section class="attach" id="attach-' + ticketId + '">'
    + '<h4 class="attach-title">Guía / documento de entrega'
    + (lista.length ? ' <span class="attach-count">' + lista.length + '</span>' : '')
    + '</h4>'
    + aviso + items + alta
    + '</section>';
}

function filaHTML(a, editable) {
  const esImagen = String(a.tipo).startsWith('image/');
  return '<li class="attach-item">'
    + '<span class="attach-icon' + (esImagen ? ' img' : ' pdf') + '">' + (esImagen ? 'IMG' : 'PDF') + '</span>'
    + '<span class="attach-data">'
    + '<b>' + esc(a.nombre) + '</b>'
    + '<span>' + archivos.tamanoLegible(a.tamano) + ' · ' + esc(a.subidoPor) + ' · ' + fechaHora(a.subidoEn) + '</span>'
    + '</span>'
    + '<span class="attach-actions">'
    + '<button class="btn btn-sm btn-ghost" onclick="abrirAdjunto(\'' + a.id + '\')">Ver</button>'
    + (editable
        ? '<button class="btn btn-sm btn-ghost" onclick="eliminarAdjunto(\'' + a.id + '\',\'' + a.ticketId + '\')">Quitar</button>'
        : '')
    + '</span>'
    + '</li>';
}

/** Resumen compacto para la tarjeta del solicitante (solo lectura). */
export function adjuntosResumenHTML(ticketId) {
  const lista = archivos.adjuntosDe(ticketId);
  if (!lista.length) return '';
  return '<div class="ticket-attach">'
    + '<span class="ticket-attach-lbl">Guía de entrega</span>'
    + lista.map(a =>
        '<button class="link-btn" onclick="abrirAdjunto(\'' + a.id + '\')">' + esc(a.nombre) + '</button>'
      ).join('')
    + '</div>';
}

/** Indicador de adjuntos para la fila de la bandeja. */
export function indicadorAdjuntos(ticketId) {
  const n = archivos.adjuntosDe(ticketId).length;
  return n ? '<span class="clip" title="' + n + ' documento(s) adjunto(s)">' + n + ' adj.</span>' : '';
}

/** Vuelve a pintar el bloque de adjuntos de un ticket ya presente en pantalla. */
export async function refrescarAdjuntos(ticketId, editable) {
  await archivos.refrescarDe(ticketId);
  const cont = $('attach-' + ticketId);
  if (!cont) return;
  cont.outerHTML = adjuntosHTML(ticketId, editable);
}

/** Handler del input de archivo (expuesto como window.subirGuia). */
export async function subirGuia(ticketId, input) {
  const archivo = input && input.files && input.files[0];
  if (!archivo) return;
  input.value = '';
  try {
    await archivos.subir(ticketId, archivo, sesion ? sesion.nombre : 'Logística');
    toast('Guía adjuntada', archivo.name + ' quedó asociada a ' + ticketId + '.');
  } catch (e) {
    toast('No se pudo adjuntar', e.message, 'bad');
  }
  await refrescarAdjuntos(ticketId, true);
}

/** Abre un adjunto en una pestaña nueva (expuesto como window.abrirAdjunto). */
export async function abrirAdjunto(id) {
  const destino = await archivos.urlDe(id);
  if (!destino) { toast('Adjunto no disponible', 'No se encontró el archivo.', 'bad'); return; }
  window.open(destino.url, '_blank', 'noopener');
  if (destino.temporal) setTimeout(() => URL.revokeObjectURL(destino.url), 60000);
}

/** Elimina un adjunto (expuesto como window.eliminarAdjunto). */
export function eliminarAdjunto(id, ticketId) {
  confirmarEliminacion({
    titulo: 'Eliminar adjunto',
    mensaje: 'Se va a quitar este documento de ' + ticketId + '. No se puede deshacer.',
    onConfirmar: async motivo => {
      await archivos.eliminar(id, motivo);
      toast('Adjunto eliminado', 'Se quitó el documento de ' + ticketId + '.', 'warn');
      await refrescarAdjuntos(ticketId, true);
    }
  });
}
