import { esc } from '../utils/dom.js';
import { fechaHora, fechaCorta, soles } from '../utils/format.js';
import { adjuntosResumenHTML } from './attachments.js';
import { ILUSTRACIONES } from '../ui/ilustraciones.js';
import { modalidad, modalidadDe } from '#shared/servicios.js';

/**
 * Helpers de presentación (generación de HTML) compartidos por las vistas
 * de seguimiento, bandeja, histórico e indicadores.
 */

/**
 * Texto de un campo que puede venir vacío. El histórico de 2026 no registraba
 * hora, contacto ni teléfono: se muestra un guion en vez de un hueco.
 */
export const oGuion = v => String(v == null ? '' : v).trim() || '—';

export function chipEstado(e, paraUsuario) {
  const map = { 'En espera': 'st-espera', 'En tránsito': 'st-transito', 'Concluido': 'st-concluido', 'Cancelado': 'st-cancelado' };
  const txt = (paraUsuario && e === 'Concluido') ? 'Terminado' : e;
  return '<span class="chip ' + map[e] + '"><i class="dot"></i>' + txt + '</span>';
}

/** Motivo, quién y cuándo de una cancelación. Vacío si el ticket no está cancelado. */
export function cancelacionHTML(s) {
  if (s.estado !== 'Cancelado') return '';
  const razon = s.motivoCancelacion + (s.motivoCancelacionDetalle ? ': ' + s.motivoCancelacionDetalle : '');
  return '<div class="alert on" style="margin:0 0 16px">'
    + '<div class="alert-icon">×</div>'
    + '<div><strong>Servicio cancelado</strong>'
    + '<p>' + esc(razon) + '</p>'
    + '<p class="muted small" style="margin-top:4px">' + esc(s.canceladoPor || '—') + ' · ' + fechaHora(s.tsCancelado) + '</p>'
    + '</div></div>';
}

// Iconos de línea, mismo lenguaje visual que el resto de la app (stroke,
// sin relleno, trazo de 2px, puntas redondeadas): una moto de dos ruedas para
// "Motorizado" y un auto para "Carro", para que la bandeja y el seguimiento
// del ticket se lean de un vistazo sin tener que leer la palabra.
const ICONO_MOTO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
  + '<circle cx="5.5" cy="17.5" r="2.5"/><circle cx="18" cy="17.5" r="2.5"/>'
  + '<path d="M5.5 17.5h3.3l2.4-5h3.8l1.8 3.2"/><path d="M11.2 12.5 13 8.3h2.8"/>'
  + '<path d="M15.5 15.5h2.9"/><path d="M3.3 14.2h2.6l1.3-1.9"/></svg>';

const ICONO_CARRO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
  + '<circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/>'
  + '<path d="M3 17v-4.3L5.6 8h8.8l3.6 4.7H20V17"/><path d="M5.6 8 7 12.2h9.6"/><path d="M9 17h6"/></svg>';

// Furgón (caja cerrada alta) y camión (caja larga, tres ejes) para Cargo / Flete.
const ICONO_FURGON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
  + '<circle cx="7" cy="17.5" r="2"/><circle cx="17" cy="17.5" r="2"/>'
  + '<path d="M3 17.5V6h11v11.5"/><path d="M14 9.5h3.5l3.5 4v4h-2"/><path d="M9 17.5h6"/></svg>';

const ICONO_CAMION = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
  + '<circle cx="5" cy="17.5" r="1.8"/><circle cx="10" cy="17.5" r="1.8"/><circle cx="19" cy="17.5" r="1.8"/>'
  + '<path d="M1.5 15V5h14v10"/><path d="M15.5 9h3.2l3.3 3.8v4.7h-1.2"/><path d="M1.5 15h20"/></svg>';

const ICONOS_VEHICULO = { Motorizado: ICONO_MOTO, Carro: ICONO_CARRO, 'Furgón': ICONO_FURGON, 'Camión': ICONO_CAMION };

/** Icono del vehículo, o nada si todavía no se asigna ninguno. */
export function iconoVehiculo(v) {
  return ICONOS_VEHICULO[v] ? '<span class="icon-veh">' + ICONOS_VEHICULO[v] + '</span>' : '';
}

/**
 * Etiqueta de la modalidad (Envíos / Transporte / Cargo) con la misma
 * ilustración del formulario en miniatura: lo primero que logística necesita
 * ver para saber qué tipo de unidad mandar.
 */
export function modalidadHTML(s, conTexto = true) {
  const id = modalidadDe(s);
  const m = modalidad(id);
  return '<span class="mod-tag mod-' + (id === 'Envíos' ? 'envios' : id.toLowerCase()) + '" title="' + esc(m ? m.titulo + ' · ' + m.detalle : id) + '">'
    + '<span class="mod-mini">' + (ILUSTRACIONES[id] || '') + '</span>'
    + (conTexto ? '<b>' + esc(m ? m.titulo : id) + '</b>' : '') + '</span>';
}

/** Icono + etiqueta del vehículo, para donde se muestra como texto de solo lectura. */
export function vehiculoHTML(v, vacio) {
  if (!v) return vacio != null ? vacio : '<span class="muted">Sin asignar</span>';
  return '<span class="veh-tag">' + iconoVehiculo(v) + v + '</span>';
}

export function origenTexto(s) { return s.origen === 'Otros' ? (s.origenDetalle || 'Otros') : s.origen; }

export function origenCorto(s) {
  if (s.origen === 'Otros') return 'Otros';
  return s.origen.replace('Plásticos Nacionales - ', '');
}

export function railHTML(s, paraUsuario) {
  const pasos = [
    { k: 'En espera', lbl: 'En espera', ts: s.tsEspera },
    { k: 'En tránsito', lbl: 'En tránsito', ts: s.tsTransito },
    { k: 'Concluido', lbl: (paraUsuario ? 'Terminado' : 'Concluido'), ts: s.tsConcluido }
  ];
  // 'Cancelado' no tiene paso propio en el riel: se muestra aparte con
  // cancelacionHTML(). Si de todos modos se llama a esto para uno cancelado,
  // -1 deja los tres pasos neutros en vez de romper con `undefined`.
  const idx = { 'En espera': 0, 'En tránsito': 1, 'Concluido': 2 }[s.estado] ?? -1;
  return '<div class="rail">' + pasos.map((p, i) => {
    let cls = 'rail-step';
    if (i < idx) cls += ' done';
    if (i === idx) cls += ' now' + (i === 1 ? ' transit' : '');
    if (i === 2 && idx === 2) cls = 'rail-step done';
    return '<div class="' + cls + '"><div class="bead"></div><div class="lbl">' + p.lbl + '</div><div class="tm">' + (p.ts ? fechaHora(p.ts).slice(-5) : '·') + '</div></div>';
  }).join('') + '</div>';
}

/** Lista de paradas de más, cuando el servicio tiene dos o más rutas. Vacío si no hay ninguna. */
export function paradasExtraHTML(s) {
  if (!s.paradas || !s.paradas.length) return '';
  return '<div class="paradas-extra">'
    + '<span class="muted small">Paradas adicionales</span>'
    + '<ol>' + s.paradas.map(p =>
      '<li>' + esc(p.destino) + (p.contacto || p.telefono
        ? ' <span class="muted small">· ' + esc([p.contacto, p.telefono].filter(Boolean).join(', ')) + '</span>'
        : '') + '</li>'
    ).join('') + '</ol>'
    + '</div>';
}

export function ticketHTML(s) {
  const cancelado = s.estado === 'Cancelado';
  return '<article class="ticket">'
    + '<div class="ticket-top"><div><div class="ticket-titulo"><div class="ticket-code">' + s.id + '</div>'
    + (s.motivo ? '<div class="ticket-motivo" title="Motivo del servicio">' + esc(s.motivo) + '</div>' : '') + '</div>'
    + '<div class="ticket-meta">' + (s.modalidad ? esc(s.modalidad) + ' · ' : '') + s.tipo + ' · ' + esc(s.servicio || 'Servicio') + ' · registrado el ' + fechaHora(s.creado) + '</div></div>'
    + chipEstado(s.estado, true) + '</div>'
    + (cancelado ? cancelacionHTML(s) : railHTML(s, true))
    + '<div class="route"><div class="route-rail"><div class="pt"></div><div class="ln"></div><div class="pt end"></div></div>'
    + '<div class="route-body"><div><span>Origen</span><b>' + esc(origenTexto(s)) + '</b></div>'
    + '<div><span>Destino</span><b>' + esc(s.destino)
    + (s.destinoTipo ? '<span class="chip-destino">' + esc(s.destinoTipo) + '</span>' : '') + '</b></div></div></div>'
    + paradasExtraHTML(s)
    + '<div class="ticket-facts">'
    + '<div class="fact">Programado <b>' + fechaCorta(s.fechaProg) + ' · ' + esc(oGuion(s.horaProg)) + '</b></div>'
    + '<div class="fact">Recibe <b>' + esc(oGuion(s.contacto)) + '</b></div>'
    + '<div class="fact mono">Contacto <b>' + esc(oGuion(s.telefono)) + '</b></div>'
    + '<div class="fact">Transporte <b>' + vehiculoHTML(s.vehiculo, 'por asignar') + '</b></div>'
    + '<div class="fact mono">Costo <b>' + (s.costo != null ? soles(s.costo) : 'por asignar') + '</b></div>'
    + '</div>'
    + adjuntosResumenHTML(s.id)
    + (s.estado === 'En espera'
      ? '<div style="margin-top:14px"><button class="btn btn-sm btn-ghost" onclick="cancelarMiSolicitud(\'' + s.id + '\')">Cancelar servicio</button></div>'
      : '')
    + '</article>';
}
