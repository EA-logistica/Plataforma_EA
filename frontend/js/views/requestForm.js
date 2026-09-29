import { $, esc, marcar } from '../utils/dom.js';
import { pad, hoyISO, isoDia } from '../utils/format.js';
import { toast } from '../utils/toast.js';
import { MARGEN_HORAS, SLOT_INI, SLOT_FIN } from '../config.js';
import { crearSolicitud, DB } from '../api/estado.js';
import { sesion } from '../state/sessionState.js';
import { renderMis } from './tickets.js';
import {
  MODALIDADES, modalidad, contradiccionServicio, claveDestino, destinosParecidos, esEnlaceMapa, coordsDeEnlace, lugarDeEnlace, PLANTAS
} from '#shared/servicios.js';
import { obtener } from '../api/cliente.js';
import { abrirSelectorMapa } from '../ui/mapaPicker.js';
import { ILUSTRACIONES } from '../ui/ilustraciones.js';
import { autocompletar } from '../ui/autocompletar.js';

/**
 * Formulario de nueva solicitud del solicitante. La idea es que se llene con
 * clics: modalidad, acción, tipo de servicio, origen, destino frecuente,
 * fecha y hora son botones. Solo se escribe lo que no puede adivinarse:
 * un destino nuevo, quién recibe, su teléfono y el motivo.
 *
 * Los valores elegidos viven en campos ocultos (fServicio, fOrigen, fHora) o
 * en los mismos inputs de siempre (fDestino, fFecha): así la validación y el
 * envío no dependen de cómo se eligió cada cosa.
 */
let modalidadSel = 'Envíos';
let accionSel = '';

// Punto elegido en el mapa para el origen "Otros" y para el destino: se
// guarda aparte del texto, porque el texto se puede seguir editando. Si el
// usuario reescribe la dirección a mano, el punto se descarta (olvidarPunto).
const puntos = { origen: null, destino: null };
let destinoTipo = '';

const ORIGENES = [
  { valor: 'Plásticos Nacionales - Talleres', titulo: 'Talleres', detalle: 'Plásticos Nacionales' },
  { valor: 'Plásticos Nacionales - Fraguas', titulo: 'Fraguas', detalle: 'Plásticos Nacionales' },
  { valor: 'Otros', titulo: 'Otra dirección', detalle: 'Escríbela o márcala en el mapa' }
];

const chip = (activo, onclick, titulo, detalle = '', extra = '') =>
  '<button type="button" class="chip-op' + (activo ? ' on' : '') + '" onclick="' + onclick + '"' + extra + '>'
  + '<b>' + esc(titulo) + '</b>' + (detalle ? '<small>' + esc(detalle) + '</small>' : '') + '</button>';

const js = v => esc(JSON.stringify(v));

// --------------------------------------------------------- paradas extra
// Un servicio con dos o más rutas en la misma programación: el primer
// destino sigue siendo el campo de siempre (fDestino); esto es solo lo que se
// agrega de más.
let paradasExtra = [];

function renderParadas() {
  $('listaParadas').innerHTML = paradasExtra.map((p, i) => (
    '<div class="row" style="align-items:flex-end;margin-bottom:10px">'
    + '<div class="field" style="margin:0"><label>Destino ' + (i + 2) + '</label>'
    + '<input class="input" list="dlDestinos" autocomplete="off" placeholder="Dirección de la parada"'
    + ' value="' + esc(p.destino) + '" oninput="editarParada(' + i + ',\'destino\',this.value)"></div>'
    + '<div class="field" style="margin:0"><label>Contacto</label>'
    + '<input class="input" placeholder="Quién recibe (opcional)"'
    + ' value="' + esc(p.contacto) + '" oninput="editarParada(' + i + ',\'contacto\',this.value)"></div>'
    + '<div class="field" style="margin:0;max-width:140px"><label>Teléfono</label>'
    + '<input class="input" inputmode="numeric" maxlength="12" placeholder="Opcional"'
    + ' value="' + esc(p.telefono) + '" oninput="editarParada(' + i + ',\'telefono\',this.value.replace(/\\D/g,\'\'))"></div>'
    + '<button type="button" class="btn btn-sm btn-ghost" onclick="quitarParada(' + i + ')" title="Quitar esta parada">✕</button>'
    + '</div>'
  )).join('');
}

export function agregarParada() { paradasExtra.push({ destino: '', contacto: '', telefono: '' }); renderParadas(); }
export function editarParada(i, campo, valor) { if (paradasExtra[i]) paradasExtra[i][campo] = valor; }
export function quitarParada(i) { paradasExtra.splice(i, 1); renderParadas(); }
export function limpiarParadas() { paradasExtra = []; renderParadas(); }

// ------------------------------------------- 1. modalidad, acción, servicio
function renderModalidades() {
  $('fModalidad').innerHTML = MODALIDADES.map(m =>
    '<button type="button" class="modalidad' + (m.id === modalidadSel ? ' on' : '') + '" role="radio"'
    + ' aria-checked="' + (m.id === modalidadSel) + '" onclick="setModalidad(' + js(m.id) + ')">'
    + '<span class="modalidad-img">' + ILUSTRACIONES[m.id] + '</span>'
    + '<b>' + esc(m.titulo) + '</b><small>' + esc(m.detalle) + '</small></button>'
  ).join('');
  // La acción se llama distinto según la modalidad ("Llevar a" en Transporte).
  const m = modalidad(modalidadSel);
  document.querySelectorAll('#fAccion .tg').forEach(b => { b.textContent = m.acciones[b.dataset.val]; });
}

function renderServicios() {
  const cont = $('chipsServicio');
  if (!accionSel) { cont.innerHTML = '<div class="chips-vacio">Primero elige la acción.</div>'; return; }
  const actual = $('fServicio').value;
  cont.innerHTML = modalidad(modalidadSel).servicios[accionSel]
    .map(s => chip(s.nombre === actual, 'setServicio(' + js(s.nombre) + ')', s.nombre, s.detalle)).join('');
}

export function setModalidad(id) {
  if (!modalidad(id)) return;
  modalidadSel = id;
  // El tipo elegido era de otra modalidad: se limpia, no se arrastra.
  const lista = accionSel ? modalidad(id).servicios[accionSel].map(s => s.nombre) : [];
  if (!lista.includes($('fServicio').value)) $('fServicio').value = '';
  renderModalidades();
  renderServicios();
}

/**
 * Elegir la acción cambia los tipos de servicio que se ofrecen. Lo que ya
 * estaba elegido se conserva si también vale para la acción nueva (así una
 * pantalla o una prueba que lo fijó antes no lo pierde); si no, se borra.
 */
export function setAccion(v) {
  accionSel = v;
  document.querySelectorAll('#fAccion .tg').forEach(b => b.classList.toggle('on', b.dataset.val === v));
  $('fAccion').classList.remove('bad');
  $('eAccion').classList.remove('on');
  const actual = $('fServicio').value;
  if (actual && contradiccionServicio(v, actual)) $('fServicio').value = '';
  renderServicios();
  if ($('fServicio').value) $('eServicio').classList.remove('on');
}

export function setServicio(nombre) {
  $('fServicio').value = nombre;
  $('eServicio').classList.remove('on');
  renderServicios();
}

/** Limpia modalidad/acción/servicio (al entrar a la vista y tras registrar). */
export function resetAccion() {
  accionSel = '';
  modalidadSel = 'Envíos';
  document.querySelectorAll('#fAccion .tg').forEach(b => b.classList.remove('on'));
  $('fServicio').value = '';
  renderModalidades();
  renderServicios();
}

// Compatibilidad con la versión anterior del formulario (campo de texto).
export function validarServicioVivo() {}

// -------------------------------------------------------------- 2. origen
function renderOrigenes() {
  const actual = $('fOrigen').value;
  $('chipsOrigen').innerHTML = ORIGENES.map(o =>
    chip(o.valor === actual, 'setOrigen(' + js(o.valor) + ')', o.titulo, o.detalle)).join('');
}

export function setOrigen(valor) {
  $('fOrigen').value = valor;
  $('eOrigen').classList.remove('on');
  toggleOrigen();
  if (valor === 'Otros' && !$('fOrigenOtro').value) setTimeout(() => $('fOrigenOtro').focus(), 0);
}

export function toggleOrigen() {
  const otro = $('fOrigen').value === 'Otros';
  $('wrapOtro').style.display = otro ? 'block' : 'none';
  if (!otro) { $('fOrigenOtro').value = ''; olvidarPunto('origen'); }
  renderOrigenes();
}

// ------------------------------------------------------------- 3. destino
/** Catálogo del histórico + lo registrado por solicitantes, sin repetir. */
function todosLosDestinos() {
  const vistos = new Set();
  return [
    ...PLANTAS.map(p => ({ direccion: p, usos: 1e9, planta: true })),
    ...DB.destinosRegistrados.map(d => ({ direccion: d.direccion, lat: d.lat, lng: d.lng, usos: d.usos || 1, tipo: d.tipo })),
    ...DB.destinos.map(d => ({ direccion: d.nombre, usos: d.viajes || 0 }))
  ].filter(d => { const k = claveDestino(d.direccion); if (!k || vistos.has(k)) return false; vistos.add(k); return true; });
}

/**
 * Nombre corto de un destino para su pastilla: "LIFE" en vez de la dirección
 * completa. Si el mismo nombre aparece dos veces (LIFE de San Isidro y de
 * Chorrillos), se le suma el distrito para distinguirlos.
 */
function nombresCortos(lista) {
  const base = d => d.planta ? d.direccion.replace('Plásticos Nacionales - ', 'Plansa · ') : d.direccion.split(',')[0].trim();
  const cuenta = new Map();
  lista.forEach(d => cuenta.set(base(d), (cuenta.get(base(d)) || 0) + 1));
  return lista.map(d => {
    const b = base(d);
    const partes = d.direccion.split(',').map(x => x.trim());
    return { ...d, corto: cuenta.get(b) > 1 && partes.length > 1 ? b + ' · ' + partes[partes.length - 1] : b };
  });
}

const PINES_FRECUENTES = 10;

/** Sugerencias al escribir y pastillas de destinos frecuentes (las plantas + los más usados). */
export function pintarSugerenciasDestino() {
  const lista = todosLosDestinos();
  $('dlDestinos').innerHTML = lista.map(d => '<option value="' + esc(d.direccion) + '"></option>').join('');
  const actual = claveDestino($('fDestino').value);
  const frecuentes = nombresCortos(lista.slice().sort((a, b) => b.usos - a.usos).slice(0, PINES_FRECUENTES));
  $('chipsDestino').innerHTML = frecuentes.map(d =>
    '<button type="button" class="pin-destino' + (d.planta ? ' es-planta' : '') + (claveDestino(d.direccion) === actual ? ' on' : '') + '"'
    + ' title="' + esc(d.direccion) + '" onclick="elegirDestino(' + js(d.direccion) + ')">' + esc(d.corto) + '</button>'
  ).join('');
}

export function elegirDestino(direccion) {
  $('fDestino').value = direccion;
  $('fDestino').classList.remove('bad');
  $('eDestino').classList.remove('on');
  olvidarPunto('destino');
  revisarDestino();
}

function destinoConocido(texto) {
  const k = claveDestino(texto);
  return !!k && todosLosDestinos().some(d => claveDestino(d.direccion) === k);
}

/**
 * Un destino que no está registrado primero se compara con los que sí lo
 * están: si se parece a uno (misma calle y número, o a menos de 150 m en el
 * mapa) se ofrece con un clic, para no duplicar el mismo lugar con otra
 * redacción. Si de verdad es nuevo, se pide Cliente o Proveedor.
 */
export function revisarDestino() {
  const v = $('fDestino').value.trim();
  const nuevo = v.length >= 6 && !destinoConocido(v);
  const parecidos = nuevo ? destinosParecidos(v, puntos.destino, todosLosDestinos()) : [];
  $('wrapParecidos').hidden = !parecidos.length;
  $('listaParecidos').innerHTML = parecidos.map(d =>
    chip(false, 'elegirDestino(' + js(d.direccion) + ')', d.direccion,
      d.motivo === 'cercania' ? 'Está a pocos metros del punto marcado' : 'Se parece a lo que escribiste')
  ).join('');
  $('wrapDestinoTipo').hidden = !nuevo;
  if (!nuevo) setDestinoTipo('');
  pintarSugerenciasDestino();
}

export function setDestinoTipo(v) {
  destinoTipo = v;
  document.querySelectorAll('#fDestinoTipo .tg').forEach(b => b.classList.toggle('on', b.dataset.val === v));
  if (v) { $('fDestinoTipo').classList.remove('bad'); $('eDestinoTipo').classList.remove('on'); }
}

// ----------------------------------------------------------------- mapa
const CAMPO = { origen: 'fOrigenOtro', destino: 'fDestino' };
const AYUDA = { origen: 'hOrigenPunto', destino: 'hDestinoPunto' };
const AYUDA_BASE = {
  origen: 'Elige un lugar frecuente, escribe la dirección o márcala en el mapa.',
  destino: 'Si no está en la lista, escribe la dirección completa o márcala en el mapa.'
};

function pintarPunto(cual) {
  const p = puntos[cual];
  const h = $(AYUDA[cual]);
  h.textContent = p ? '📍 Ubicación marcada en el mapa (' + p.lat.toFixed(5) + ', ' + p.lng.toFixed(5) + ').' : AYUDA_BASE[cual];
  h.classList.toggle('con-punto', !!p);
}

export function abrirMapa(cual) {
  abrirSelectorMapa({
    titulo: cual === 'origen' ? 'Elige el punto de partida' : 'Elige el destino',
    inicial: puntos[cual],
    confirmar: ({ lat, lng, direccion }) => {
      $(CAMPO[cual]).value = direccion;
      $(CAMPO[cual]).classList.remove('bad');
      puntos[cual] = { lat, lng };
      pintarPunto(cual);
      if (cual === 'destino') revisarDestino();
    }
  });
}

/** Reescribir la dirección a mano descarta el punto del mapa: ya no se sabe si coinciden. */
export function olvidarPunto(cual) {
  if (!puntos[cual]) return;
  puntos[cual] = null;
  pintarPunto(cual);
}

// ------------------------------------------------------ 4. fecha y hora
function horaMinimaHoy() {
  const t = new Date(Date.now() + MARGEN_HORAS * 3600000);
  // se redondea al siguiente bloque de 30 minutos
  const m = t.getMinutes();
  if (m === 0 || m === 30) { t.setSeconds(0, 0); }
  else if (m < 30) t.setMinutes(30, 0, 0);
  else { t.setHours(t.getHours() + 1); t.setMinutes(0, 0, 0); }
  return t;
}

const DIAS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

/** Hoy (si todavía alcanza el margen) y los próximos días hábiles, como botones. */
function renderFechas() {
  const actual = $('fFecha').value;
  const opciones = [];
  const d = new Date();
  const hoyAlcanza = isoDia(horaMinimaHoy()) === hoyISO() && horaMinimaHoy().getHours() < SLOT_FIN;
  for (let i = 0; opciones.length < 5 && i < 10; i++, d.setDate(d.getDate() + 1)) {
    if (i === 0 && !hoyAlcanza) continue;
    if (d.getDay() === 0) continue; // domingo no hay mensajería
    const iso = isoDia(d);
    const titulo = i === 0 ? 'Hoy' : i === 1 ? 'Mañana' : DIAS[d.getDay()];
    opciones.push(chip(iso === actual, 'setFecha(' + js(iso) + ')', titulo, pad(d.getDate(), 2) + '/' + pad(d.getMonth() + 1, 2)));
  }
  $('chipsFecha').innerHTML = opciones.join('');
}

/** Bloques de 30 min dentro de la ventana operativa; los que ya no alcanzan hoy, deshabilitados. */
function renderHoras() {
  const fecha = $('fFecha').value;
  const actual = $('fHora').value;
  const bloques = [];
  for (let h = SLOT_INI; h < SLOT_FIN; h++) for (const m of [0, 30]) bloques.push(pad(h, 2) + ':' + pad(m, 2));
  $('chipsHora').innerHTML = bloques.map(hh => {
    const vale = !!fecha && !errorHora(fecha, hh);
    return '<button type="button" class="chip-hora' + (hh === actual ? ' on' : '') + '"'
      + (vale ? ' onclick="setHora(' + js(hh) + ')"' : ' disabled') + '>' + hh + '</button>';
  }).join('');
}

export function setFecha(iso) {
  $('fFecha').value = iso;
  $('eFecha').classList.remove('on');
  refrescarHoras();
}

export function setHora(hh) {
  $('fHora').value = hh;
  validarHoraViva();
  renderHoras();
}

export function refrescarHoras() {
  const fecha = $('fFecha').value;
  const esHoy = fecha === hoyISO();
  const limite = horaMinimaHoy();
  const nota = $('minHoraNota');
  $('margenHorasTexto').textContent = MARGEN_HORAS;
  const hh = pad(limite.getHours(), 2) + ':' + pad(limite.getMinutes(), 2);

  if (!fecha) {
    nota.textContent = 'Elige primero la fecha del servicio.';
  } else if (esHoy && isoDia(limite) !== fecha) {
    nota.innerHTML = 'Con el margen de ' + MARGEN_HORAS + ' horas la salida ya cae en el día siguiente. Programa el servicio para mañana.';
  } else if (esHoy) {
    nota.innerHTML = 'Son las ' + pad(new Date().getHours(), 2) + ':' + pad(new Date().getMinutes(), 2) + '. Para hoy la primera hora que puedes pedir es las <b style="color:var(--primary)">' + hh + '</b>.';
  } else {
    nota.textContent = 'Ventana operativa de mensajería: ' + pad(SLOT_INI, 2) + ':00 a ' + pad(SLOT_FIN, 2) + ':00.';
  }
  // Una hora elegida que dejó de valer (cambió la fecha, pasó el tiempo) se suelta.
  if ($('fHora').value && errorHora(fecha, $('fHora').value)) $('fHora').value = '';
  renderFechas();
  renderHoras();
  validarHoraViva();
}

// Devuelve '' si la hora es válida, o el texto del error.
function errorHora(fecha, hora) {
  if (!hora) return 'Elige la hora del servicio.';
  if (!fecha) return '';
  if (fecha === hoyISO()) {
    const prog = new Date(fecha + 'T' + hora + ':00');
    if ((prog - new Date()) / 3600000 < MARGEN_HORAS)
      return 'Para el mismo día, pide el servicio con al menos ' + MARGEN_HORAS + ' horas de anticipación.';
  }
  const h = parseInt(hora.slice(0, 2), 10);
  if (h < SLOT_INI || h >= SLOT_FIN)
    return 'La mensajería opera de ' + pad(SLOT_INI, 2) + ':00 a ' + pad(SLOT_FIN, 2) + ':00.';
  return '';
}

export function validarHoraViva() {
  const hora = $('fHora').value;
  if (!hora) { $('eHora').classList.remove('on'); return; }
  const e = errorHora($('fFecha').value, hora);
  marcar('fHora', 'eHora', !!e, e || undefined);
}

// ------------------------------------------------------ 6. resumen vivo
/**
 * Lo que se va a registrar, en una línea por tema, que se completa a medida
 * que se elige: el solicitante revisa todo junto al botón, sin volver a subir.
 * Lo que falta queda marcado y un clic lleva a ese paso.
 */
export function pintarResumen() {
  const caja = $('resumenSolicitud');
  if (!caja) return;
  const m = modalidad(modalidadSel);
  const origen = $('fOrigen').value === 'Otros' ? $('fOrigenOtro').value.trim() : $('fOrigen').value.replace('Plásticos Nacionales - ', 'Plansa ');
  const fecha = $('fFecha').value;
  const dia = !fecha ? '' : fecha === hoyISO() ? 'Hoy' : fecha.slice(8, 10) + '/' + fecha.slice(5, 7) + '/' + fecha.slice(0, 4);
  const filas = [
    ['Qué', accionSel && $('fServicio').value ? m.titulo + ' · ' + m.acciones[accionSel] + ' · ' + $('fServicio').value : '', 'fModalidad'],
    ['Desde', origen, 'chipsOrigen'],
    ['Hacia', $('fDestino').value.trim() + (!$('wrapDestinoTipo').hidden && destinoTipo ? ' (' + destinoTipo + ' nuevo)' : ''), 'fDestino'],
    ['Recibe', $('fContacto').value.trim() ? $('fContacto').value.trim() + ($('fTel').value ? ' · ' + $('fTel').value : '') : '', 'fContacto'],
    ['Motivo', $('fMotivo').value.trim(), 'fMotivo'],
    ['Cuándo', dia && $('fHora').value ? dia + ' · ' + $('fHora').value : '', 'chipsFecha']
  ];
  const faltan = filas.filter(f => !f[1]).length;
  caja.innerHTML = filas.map(([k, v, destino]) => '<div class="res-fila' + (v ? ' ok' : '') + '">'
    + '<span class="res-marca">' + (v ? '✓' : '•') + '</span><span class="res-k">' + k + '</span>'
    + (v ? '<span class="res-v">' + esc(v) + '</span>'
      : '<button type="button" class="res-falta" onclick="irAPasoSolicitud(\'' + destino + '\')">Falta completar</button>')
    + '</div>').join('')
    + '<p class="res-pie">' + (faltan ? 'Faltan ' + faltan + ' dato' + (faltan === 1 ? '' : 's') + ' para registrar.' : 'Todo listo: revisa y registra.') + '</p>';
}

export function irAPasoSolicitud(id) {
  const el = $(id);
  if (!el) return;
  el.closest('.field')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  if (el.focus && /INPUT|TEXTAREA/.test(el.tagName)) setTimeout(() => el.focus(), 300);
}

// ------------------------------------------------------------- arranque
let buscadoresListos = false;

/**
 * Los lugares frecuentes sirven tanto de destino como de punto de partida:
 * un recojo en MASTERCOL sale de MASTERCOL. Los dos campos buscan en la
 * misma base (catálogo del histórico + destinos registrados).
 */
/**
 * Un enlace de Google Maps pegado en la dirección (el que llega por WhatsApp)
 * se convierte en punto GPS + dirección legible: la bandeja ya no recibe una
 * URL como destino. Si el enlace no trae coordenadas (un link corto), queda
 * el nombre del lugar que traiga y se pide marcarlo en el mapa.
 */
async function convertirEnlace(cual) {
  const inp = $(CAMPO[cual]);
  const texto = inp.value.trim();
  if (!esEnlaceMapa(texto) && !coordsDeEnlace(texto)) return;
  const punto = coordsDeEnlace(texto);
  const lugar = lugarDeEnlace(texto);
  if (!punto) {
    if (lugar) inp.value = lugar;
    toast('Enlace sin ubicación exacta', 'Ese enlace no trae coordenadas. Marca el punto en el mapa para que el mensajero llegue.', 'warn');
    if (cual === 'destino') revisarDestino();
    return;
  }
  puntos[cual] = punto;
  inp.value = lugar || 'Buscando la dirección…';
  pintarPunto(cual);
  try {
    const r = await obtener('/mapa/inverso?lat=' + punto.lat + '&lng=' + punto.lng);
    const direccion = r && (r.nombre || r.etiqueta);
    inp.value = lugar && direccion ? lugar + ', ' + direccion : (lugar || direccion || 'Punto GPS ' + punto.lat + ', ' + punto.lng);
  } catch (_) {
    if (!lugar) inp.value = 'Punto GPS ' + punto.lat + ', ' + punto.lng;
  }
  if (cual === 'destino') revisarDestino();
  toast('Ubicación de Google Maps', 'Se tomó el punto del enlace. Revisa que la dirección sea la correcta.');
}

function activarBuscadores() {
  if (buscadoresListos) return;
  buscadoresListos = true;
  // El resumen del paso 6 sigue a todo lo que se elige o escribe. setTimeout:
  // que corra después del onclick/oninput propio de cada control.
  $('uNueva').addEventListener('click', () => setTimeout(pintarResumen, 0));
  $('uNueva').addEventListener('input', () => setTimeout(pintarResumen, 0));
  // 'paste' + 'change': el enlace casi siempre se pega; si se escribe, al salir del campo.
  for (const cual of ['origen', 'destino']) {
    $(CAMPO[cual]).addEventListener('paste', () => setTimeout(() => convertirEnlace(cual), 0));
    $(CAMPO[cual]).addEventListener('change', () => convertirEnlace(cual));
  }
  autocompletar($('fOrigenOtro'), $('sugOrigen'), {
    fuente: todosLosDestinos,
    titulo: 'Lugares frecuentes',
    alElegir: direccion => {
      $('fOrigenOtro').value = direccion;
      $('fOrigenOtro').classList.remove('bad');
      $('eOrigenOtro').classList.remove('on');
      olvidarPunto('origen');
    }
  });
  autocompletar($('fDestino'), $('sugDestino'), {
    fuente: todosLosDestinos,
    titulo: 'Destinos frecuentes',
    alElegir: elegirDestino
  });
}

/** Deja el formulario limpio y con todos sus botones pintados (al entrar a la vista). */
export function prepararFormulario() {
  activarBuscadores();
  resetAccion();
  $('fOrigen').value = '';
  toggleOrigen();
  limpiarParadas();
  puntos.origen = null; puntos.destino = null; pintarPunto('origen'); pintarPunto('destino');
  setDestinoTipo(''); $('wrapDestinoTipo').hidden = true; $('wrapParecidos').hidden = true;
  $('fFecha').min = hoyISO();
  if (!$('fFecha').value || $('fFecha').value < hoyISO()) $('fFecha').value = '';
  pintarSugerenciasDestino();
  refrescarHoras();
  pintarResumen();
}

// --------------------------------------------------------------- envío
export async function enviarSolicitud() {
  $('okBox').classList.remove('on');
  const servicio = $('fServicio').value.trim();
  const origen = $('fOrigen').value;
  const otro = $('fOrigenOtro').value.trim();
  const motivo = $('fMotivo').value.trim();
  const dest = $('fDestino').value.trim();
  const cont = $('fContacto').value.trim();
  const tel = $('fTel').value.replace(/\D/g, '');
  const fecha = $('fFecha').value;
  const hora = $('fHora').value;

  let ok = true;
  if (!accionSel) { $('fAccion').classList.add('bad'); $('eAccion').classList.add('on'); ok = false; }
  const contradiccion = accionSel ? contradiccionServicio(accionSel, servicio) : '';
  ok = marcar('fServicio', 'eServicio', servicio.length < 3 || !!contradiccion, contradiccion || 'Elige el tipo de servicio.') && ok;
  ok = marcar('fOrigen', 'eOrigen', !origen) && ok;
  if (origen === 'Otros') ok = marcar('fOrigenOtro', 'eOrigenOtro', !otro) && ok;
  ok = marcar('fMotivo', 'eMotivo', motivo.length < 5, 'Describe el motivo con al menos 5 caracteres.') && ok;
  ok = marcar('fDestino', 'eDestino', dest.length < 6, 'Escribe la dirección exacta de destino.') && ok;
  revisarDestino();
  if (!$('wrapDestinoTipo').hidden && !destinoTipo) {
    $('fDestinoTipo').classList.add('bad'); $('eDestinoTipo').classList.add('on'); ok = false;
  }
  ok = marcar('fContacto', 'eContacto', cont.length < 3) && ok;
  ok = marcar('fTel', 'eTel', tel.length < 9 || tel.length > 11, 'Ingresa un teléfono válido de 9 dígitos.') && ok;
  ok = marcar('fFecha', 'eFecha', !fecha || fecha < hoyISO(), 'Elige una fecha desde hoy en adelante.') && ok;

  // el margen se vuelve a verificar al enviar, por si el formulario quedó abierto
  const msgHora = errorHora(fecha, hora);
  ok = marcar('fHora', 'eHora', !!msgHora, msgHora || undefined) && ok;

  // Las paradas vacías se descartan solas; las que tienen algo escrito deben
  // cumplir la misma regla que el destino principal.
  const paradas = paradasExtra
    .filter(p => p.destino.trim())
    .map(p => ({ destino: p.destino.trim(), contacto: p.contacto.trim(), telefono: p.telefono.replace(/\D/g, '') }));
  const paradaCorta = paradas.find(p => p.destino.length < 6);

  if (!ok || paradaCorta) {
    refrescarHoras();
    toast('Revisa el formulario', paradaCorta
      ? 'Cada parada adicional necesita una dirección de al menos 6 caracteres.'
      : 'Hay campos pendientes o fuera de rango.', 'bad');
    const primero = document.querySelector('#uNueva .err.on');
    if (primero) primero.closest('.field')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  // El correlativo lo asigna el servidor dentro de la misma transacción que
  // inserta: con dos personas registrando a la vez, proponerlo desde aquí
  // garantizaría números repetidos.
  let s;
  try {
    s = await crearSolicitud({
      dni: sesion.dni, nombre: sesion.nombre, cargo: sesion.cargo, area: sesion.area,
      modalidad: modalidadSel, tipo: accionSel, servicio, motivo, origen, origenDetalle: origen === 'Otros' ? otro : '',
      destino: dest, contacto: cont, telefono: tel,
      destinoTipo: $('wrapDestinoTipo').hidden ? '' : destinoTipo,
      origenLat: origen === 'Otros' && puntos.origen ? puntos.origen.lat : null,
      origenLng: origen === 'Otros' && puntos.origen ? puntos.origen.lng : null,
      destinoLat: puntos.destino ? puntos.destino.lat : null,
      destinoLng: puntos.destino ? puntos.destino.lng : null,
      fechaProg: fecha, horaProg: hora, paradas
    });
  } catch (e) {
    toast('No se pudo registrar', e.message, 'bad');
    return;
  }

  $('okTitle').textContent = 'Ticket ' + s.id + ' registrado';
  $('okMsg').textContent = 'Logística lo verá en su bandeja y asignará transporte y tarifa. Sigue su avance en "Mis servicios".';
  $('okBox').classList.add('on');
  toast('Solicitud registrada', s.id + ' quedó en espera de asignación.');

  // La dirección nueva ya quedó registrada en el servidor: se suma a los
  // destinos conocidos sin esperar a la próxima recarga del estado.
  if (s.destinoTipo && !destinoConocido(s.destino)) {
    DB.destinosRegistrados.push({ direccion: s.destino, tipo: s.destinoTipo, lat: s.destinoLat, lng: s.destinoLng, usos: 1 });
  }
  ['fMotivo', 'fDestino', 'fContacto', 'fTel', 'fOrigenOtro', 'fHora'].forEach(id => { $(id).value = ''; $(id).classList.remove('bad'); });
  $('fAccion').classList.remove('bad');
  document.querySelectorAll('#uNueva .err').forEach(e => e.classList.remove('on'));
  prepararFormulario();
  renderMis();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
