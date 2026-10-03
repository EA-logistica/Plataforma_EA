import { $, esc } from '../../utils/dom.js';
import { soles } from '../../utils/format.js';
import { crear, obtener } from '../../api/cliente.js';
import { cargarLeaflet } from '../../ui/mapaPicker.js';
import { PLANTA, DIAS, DIA_JS, POLITICA, TIEMPOS } from '#data/payback/rutas.js';
import {
  seleccionInicial, paradasDelDia, enlacesGoogleMaps, destinosHistorico, buscarDestinos, direccionParaBuscar
} from '#shared/payback/plan.js';

/**
 * Plan de rutas semanal en el mapa: un día por pestaña, el recorrido por calles
 * (POST /api/payback/ruta, OSRM + tráfico de Lima por franja horaria) y la hora
 * estimada de llegada a cada parada. Cada cambio -sacar o meter una parada,
 * sumar un destino del histórico o una dirección buscada en el mapa, cambiar
 * la hora de salida- vuelve a pedir la ruta, como un GPS: el orden, los
 * minutos y el regreso se recalculan.
 *
 * El buscador mira primero el histórico de envíos completo -la misma data de
 * la pestaña Histórico, no solo los puntos del plan-. Un destino sin
 * coordenadas se ubica al elegirlo (GET /api/mapa/buscar con su dirección).
 *
 * Solo esta sección toca el mapa. Se repinta sola (pintar()) sin pasar por
 * renderPayback, para no rehacer el mapa en cada clic.
 */

let plan = null;      // analizarPlan() del último render
let cuota = 0;        // cuota del proveedor en pantalla, para el costo por encargo
let mapa = null, capaRuta = null;
let encargosMes = 0;
let busqueda = [];               // resultados del buscador: {hist} o {mapa}
let historico = [];              // destinosHistorico() del último render
const ubicados = new Map();      // destino -> {lat, lon} ya geocodificado en esta sesión
const resultados = new Map();   // clave de la ruta -> respuesta del servidor (o {error})
const enCurso = new Map();

const estado = {
  dia: 'lun',
  salida: POLITICA.salida,
  conChilca: false,
  ids: {},                       // dia -> ids de puntos en la ruta
  extra: Object.fromEntries(DIAS.map(d => [d.id, []]))
};

const minutos = hhmm => { const m = /^(\d{1,2}):(\d{2})/.exec(hhmm || ''); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
const horas = min => Math.floor(min / 60) + ' h ' + String(Math.round(min % 60)).padStart(2, '0') + ' min';

/** Próxima fecha de ese día de la semana: decide si el tráfico es de día laborable. */
function proximaFecha(diaId) {
  const d = new Date();
  while (d.getDay() !== DIA_JS[diaId]) d.setDate(d.getDate() + 1);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function idsDe(diaId) {
  if (!estado.ids[diaId]) {
    const d = plan.dias.find(x => x.id === diaId);
    estado.ids[diaId] = seleccionInicial(diaId, plan.puntos, {
      objetivo: d.paradasSemana, conQuincenales: diaId === 'jue' && estado.conChilca
    });
  }
  return estado.ids[diaId];
}

function pedidoDe(diaId) {
  const paradas = paradasDelDia(diaId, { ids: idsDe(diaId), extra: estado.extra[diaId] });
  const cuerpo = { paradas, salida: estado.salida, finJornada: POLITICA.finJornada, fecha: proximaFecha(diaId) };
  return { paradas, cuerpo, clave: JSON.stringify(cuerpo) };
}

/** Pide (o reusa) la ruta de un día. Nunca lanza: un fallo queda guardado como {error}. */
function calcular(diaId) {
  const { paradas, cuerpo, clave } = pedidoDe(diaId);
  if (resultados.has(clave)) return Promise.resolve({ paradas, r: resultados.get(clave) });
  if (!enCurso.has(clave)) {
    enCurso.set(clave, crear('/payback/ruta', cuerpo)
      .then(r => r, e => ({ error: e.message || 'No se pudo calcular la ruta.' }))
      .then(r => { resultados.set(clave, r); enCurso.delete(clave); return r; }));
  }
  return enCurso.get(clave).then(r => ({ paradas, r }));
}

const resultadoDe = diaId => resultados.get(pedidoDe(diaId).clave) || null;

// ------------------------------------------------------------------ HTML
export function planHTML(p, opciones = {}) {
  plan = p;
  historico = destinosHistorico(opciones.solicitudes || []);
  cuota = opciones.cuota || 0;
  encargosMes = p.encargosSemana * 52 / 12;
  const e = p.espera;
  const pct = n => (n * 100).toFixed(0) + '%';

  return '<div class="panel pb-plan" style="margin-top:22px">'
    + '<h3>Plan de rutas semanal: un motorizado del proveedor</h3>'
    + '<p class="sub">Lunes, miércoles y viernes salen las rutas fijas por el núcleo (Bohler, Unibell, Palacios, Plus'
    + ' Cosmética y LIFE). Martes y jueves, rutas alternas que repasan las zonas que no tocó la fija. Cada zona tiene'
    + ' al menos dos pasadas por semana, y todas las rutas vuelven a planta con la tarde libre para urgencias.</p>'
    + '<div class="kpis">'
    + kpi('primary', p.salidasHoySemana.toFixed(0) + ' → ' + p.salidasPlanSemana, 'Salidas por semana',
        'Hoy cada encargo es un courier aparte; con el plan, 5 rutas')
    + kpi('ok', pct(e.mismoDia + e.unDia), 'Salen el mismo día o al siguiente',
        pct(e.mismoDia) + ' el mismo día · ' + pct(e.unDia) + ' al día hábil siguiente')
    + kpi('', e.urgenciasSemana.toFixed(1) + ' por semana', 'Urgencias que quedarían',
        'Lo que tendría que esperar 2 días hábiles o más')
    + kpi('info', cuota ? soles(cuota / encargosMes) : pct(p.cobertura), cuota ? 'Costo por encargo con el proveedor' : 'Encargos en puntos recurrentes',
        cuota ? 'Cuota de ' + soles(cuota) + ' entre ' + encargosMes.toFixed(0) + ' encargos al mes' : '')
    + '</div>'
    + '<div class="pb-plan-dias seg" role="tablist" id="pbPlanDias"></div>'
    + '<div class="pb-plan-cuerpo">'
    + '<div class="pb-plan-mapa"><div id="pbMapa"></div><div class="pb-plan-leyenda">'
    + '<span><i class="pb-pin-mini planta"></i>Planta</span><span><i class="pb-pin-mini"></i>Parada</span>'
    + '<span><i class="pb-pin-mini aprox"></i>Ubicación aproximada</span><span><i class="pb-pin-mini extra"></i>Agregada a mano</span></div></div>'
    + '<div class="pb-plan-lado" id="pbPlanLado"></div>'
    + '</div>'
    + '<div id="pbPlanSemana"></div>'
    + '</div>'
    + urgenciasHTML(p);
}

const kpi = (clase, v, k, d) =>
  '<div class="kpi ' + clase + '"><div class="v">' + esc(v) + '</div><div class="k">' + esc(k)
  + '</div><div class="d">' + esc(d) + '</div></div>';

function urgenciasHTML(p) {
  const e = p.espera;
  const pct = n => (n * 100).toFixed(0) + '%';
  const reglas = [
    ['Hora de corte: ' + POLITICA.horaCorte,
      'Lo que se pide hasta las ' + POLITICA.horaCorte + ' sale en la próxima ruta que pasa por su zona. Cada área sabe de'
      + ' antemano qué día pasa el motorizado por su destino: el calendario de arriba se publica.'],
    ['Urgencia con lugar propio',
      'Desde las ' + POLITICA.inicioUrgencias + ' el motorizado ya volvió de su ruta y queda para urgencias aprobadas, hasta '
      + POLITICA.maxUrgenciasPorDia + ' por día. Así una urgencia no rompe la ruta de la mañana.'],
    ['Lo que excede, al día siguiente o al área',
      'Si en un día hay más de ' + POLITICA.maxUrgenciasPorDia + ' urgencias, la siguiente pasa a la ruta del día siguiente o sale'
      + ' por courier, cargado al centro de costo de quien lo pidió.'],
    ['Recojos y entregas en la misma pasada',
      'Lo que se recoge y lo que se entrega en un mismo sitio va en la misma parada: el plan cuenta paradas, no encargos.'],
    ['El proveedor cumple el plan',
      'El contrato fija las rutas por día y el indicador es uno solo: paradas planificadas contra paradas cumplidas.'
      + ' La planificación es de PLANSA; el motorizado, el vehículo y su gente son del proveedor.']
  ];
  return '<div class="panel" style="margin-top:22px">'
    + '<h3>Urgencias: con rutas fijas casi desaparecen</h3>'
    + '<p class="sub">Medido con los ' + p.viajes.toLocaleString('es-PE') + ' viajes de 2026: si cada encargo hubiera'
    + ' esperado la primera ruta que pasa por su destino, el ' + pct(e.mismoDia) + ' salía el mismo día que se necesitaba y el '
    + pct(e.unDia) + ' al día hábil siguiente. Solo el ' + pct(e.dosDias + e.tresOMas) + ' habría esperado 2 días hábiles o más:'
    + ' unas ' + e.urgenciasSemana.toFixed(1) + ' urgencias por semana. Caben en las tardes libres: ' + POLITICA.maxUrgenciasPorDia
    + ' por día son ' + POLITICA.maxUrgenciasPorDia * 5 + ' por semana.</p>'
    + '<div class="pb-medidas">' + reglas.map(([t, d], i) =>
      '<div class="pb-medida"><div class="pb-medida-n">' + (i + 1) + '</div><div><b>' + esc(t) + '</b><p>' + esc(d) + '</p></div></div>').join('')
    + '</div></div>';
}

// --------------------------------------------------------------- pintado
function pintarDias() {
  const caja = $('pbPlanDias');
  if (!caja) return;
  caja.innerHTML = plan.dias.map(d => '<button class="seg-op' + (d.id === estado.dia ? ' on' : '') + '" role="tab"'
    + ' aria-selected="' + (d.id === estado.dia) + '" onclick="pbPlanDia(\'' + d.id + '\')">' + esc(d.nombre)
    + ' <span class="seg-n">' + (d.tipo === 'fija' ? 'Fija' : 'Alterna') + '</span></button>').join('');
}

function pintarLado() {
  const caja = $('pbPlanLado');
  if (!caja) return;
  const d = plan.dias.find(x => x.id === estado.dia);
  const ids = new Set(idsDe(d.id));
  const res = resultadoDe(d.id);
  const { paradas } = pedidoDe(d.id);

  let cuerpo;
  if (!res) cuerpo = '<div class="hint">Calculando la ruta por calles…</div>';
  else if (res.error) cuerpo = '<div class="banner"><div><b>No se pudo calcular la ruta.</b> ' + esc(res.error)
    + ' Las paradas siguen en el mapa; se reintenta al cambiar algo.</div></div>';
  else cuerpo = resumenRuta(res, paradas) + cronograma(res, paradas);

  const candidatos = d.puntos.slice().sort((a, b) => b.porPasada - a.porPasada);
  caja.innerHTML = '<div class="pb-plan-cab"><b>' + esc(d.nombre) + ': ' + esc(d.ruta) + '</b><p>' + esc(d.detalle) + '</p>'
    + '<p class="pb-nota">Un ' + esc(d.nombre.toLowerCase()) + ' típico lleva ' + d.encargosSemana.toFixed(1) + ' encargos ('
    + d.paradasSemana.toFixed(1) + ' paradas).</p></div>'
    + '<div class="pb-plan-controles">'
    + '<label>Salida <select class="select" onchange="pbPlanSalida(this.value)">'
    + ['07:00', '07:30', '08:00', '08:30', '09:00'].map(h => '<option' + (h === estado.salida ? ' selected' : '') + '>' + h + '</option>').join('')
    + '</select></label>'
    + (d.id === 'jue' ? '<label class="pb-plan-check"><input type="checkbox"' + (estado.conChilca ? ' checked' : '')
      + ' onchange="pbPlanChilca(this.checked)"> Semana de Chilca (cada 15 días)</label>' : '')
    + '</div>'
    + cuerpo
    + '<details class="pb-plan-puntos"' + (res && !res.error ? '' : ' open') + '><summary>Paradas del día (' + ids.size
    + ' de ' + candidatos.length + ' posibles)</summary>'
    + '<p class="pb-nota">Las fijas tienen encargo casi cada vez que pasa la ruta; las "a pedido" entran la semana que'
    + ' tienen encargo. Marca o desmarca y la ruta se recalcula.</p>'
    + candidatos.map(p => '<label class="pb-plan-punto"><input type="checkbox"' + (ids.has(p.id) ? ' checked' : '')
      + ' onchange="pbPlanParada(\'' + p.id + '\', this.checked)"><span>' + esc(p.destino)
      + '<small>' + (p.fija ? 'Fija' : 'A pedido') + ' · ' + p.porSemana.toFixed(1) + ' encargos/sem'
      + (p.cadaSemanas > 1 ? ' · cada ' + p.cadaSemanas + ' semanas' : '')
      + (p.precision === 'distrito' ? ' · ubicación aproximada' : '') + '</small></span></label>').join('')
    + '</details>'
    + '<div class="pb-plan-urgencia"><b>Agregar una parada o una urgencia</b>'
    + '<p class="pb-nota">Busca en el histórico de envíos (' + historico.length + ' destinos, los mismos de la pestaña Histórico)'
    + ' o escribe una dirección nueva.</p>'
    + '<div class="row"><input class="input" id="pbPlanQ" placeholder="Empresa, dirección o distrito" onkeydown="if(event.key===\'Enter\')pbPlanBuscar()">'
    + '<button class="btn btn-sm" onclick="pbPlanBuscar()">Buscar</button></div>'
    + '<div class="pb-plan-busqueda" id="pbPlanBusqueda"></div>'
    + estado.extra[d.id].map((x, i) => '<div class="pb-plan-extra"><span>' + esc(x.nombre)
      + (x.aproximado ? '<small class="pb-nota"> · ubicado por su dirección</small>' : '') + '</span>'
      + '<button class="btn btn-sm btn-ghost" onclick="pbPlanQuitarExtra(' + i + ')">Quitar</button></div>').join('')
    + otrosDelDia(d)
    + '</div>';
}

/** Línea de un destino del histórico: viajes, último envío y días en que sale. */
function datoHistorico(h) {
  const nombres = { lun: 'lun', mar: 'mar', mie: 'mié', jue: 'jue', vie: 'vie' };
  return h.viajes + (h.viajes === 1 ? ' viaje' : ' viajes') + (h.ultima ? ' · último ' + h.ultima.split('-').reverse().join('/') : '')
    + ' · sale ' + h.dias.map(x => nombres[x]).join(', ');
}

/**
 * Destinos del histórico que no son puntos fijos del plan y que, por su zona,
 * salen este día: para sumarlos la semana que tengan encargo.
 */
function otrosDelDia(d) {
  const lista = historico.map((h, i) => ({ h, i })).filter(({ h }) => !h.punto && h.dias.includes(d.id));
  if (!lista.length) return '';
  return '<details class="pb-plan-puntos"><summary>Otros destinos del histórico que salen este día (' + lista.length + ')</summary>'
    + '<p class="pb-nota">Se visitaron pocas veces, por eso no son paradas fijas. Si esta semana tienen encargo, agrégalos.</p>'
    + lista.slice(0, 15).map(({ h, i }) => '<div class="pb-plan-extra"><span>' + esc(h.destino) + '<small>' + esc(datoHistorico(h)) + '</small></span>'
      + '<button class="btn btn-sm btn-ghost" onclick="pbPlanAgregarHist(' + i + ')">Agregar</button></div>').join('')
    + (lista.length > 15 ? '<p class="pb-nota">Y ' + (lista.length - 15) + ' más: búscalos por nombre o dirección.</p>' : '')
    + '</details>';
}

function resumenRuta(r, paradas) {
  const fin = minutos(r.fin);
  const finJornada = minutos(POLITICA.finJornada);
  const libre = finJornada - fin;
  const enlaces = enlacesGoogleMaps(r.cronograma.map(c => paradas[c.indice]));
  return '<div class="pb-sim-resultado ' + (r.excedeJornada ? 'mal' : 'bien') + '">'
    + '<div class="pb-sim-veredicto">' + (r.excedeJornada
      ? 'No entra en la jornada: vuelve a las ' + esc(r.fin) + '. Saca paradas "a pedido" o pásalas al día siguiente de su zona.'
      : 'Entra: vuelve a planta a las ' + esc(r.fin) + ' y quedan ' + horas(libre) + ' para urgencias.') + '</div>'
    + '<div class="pb-sim-cifras">'
    + '<div><b>' + (paradas.length - 1) + '</b> paradas</div>'
    + '<div><b>' + r.distanciaKm.toFixed(0) + ' km</b> recorrido</div>'
    + '<div><b>' + horas(r.duracionEstimadaMin) + '</b> manejando</div>'
    + '<div><b>' + horas(r.servicioMin) + '</b> en los puntos</div>'
    + '</div>'
    + (r.avisos || []).filter(a => !/hora punta/.test(a) || r.excedeJornada).map(a => '<p class="pb-nota">' + esc(a) + '</p>').join('')
    + '<div class="pb-plan-gmaps">' + enlaces.map((u, i) => '<a class="btn btn-sm" target="_blank" rel="noopener" href="' + esc(u) + '">'
      + (enlaces.length > 1 ? 'Google Maps, tramo ' + (i + 1) : 'Abrir en Google Maps') + '</a>').join('')
    + '</div></div>';
}

function cronograma(r, paradas) {
  return '<div class="pb-crono">' + r.cronograma.map((c, i) => {
    const p = paradas[c.indice];
    const tipo = i === 0 ? 'salida' : c.regreso ? 'fin' : '';
    const hora = i === 0 ? c.salida : c.llegada;
    return '<div class="pb-crono-hito"><span class="pb-crono-hora">' + esc(hora) + '</span><span class="pb-crono-punto ' + tipo + '"></span>'
      + '<span>' + (i === 0 ? 'Sale de planta' : c.regreso ? 'Vuelve a planta' : '<b>' + i + '.</b> ' + esc(p.nombre))
      + (c.tramo ? ' <span class="pb-nota">' + c.tramo.distanciaKm.toFixed(1) + ' km · ' + Math.round(c.tramo.duracionEstimadaMin) + ' min</span>' : '')
      + '</span></div>';
  }).join('') + '</div>';
}

/** Resumen de los cinco días, que se llena a medida que llegan las rutas. */
function pintarSemana() {
  const caja = $('pbPlanSemana');
  if (!caja) return;
  let libreTotal = 0, completos = 0;
  const filas = plan.dias.map(d => {
    const r = resultadoDe(d.id);
    const ok = r && !r.error;
    if (ok) { libreTotal += Math.max(0, minutos(POLITICA.finJornada) - minutos(r.fin)); completos++; }
    return '<tr' + (d.id === estado.dia ? ' class="pb-fila-on"' : '') + '><td>' + esc(d.nombre) + '<span class="pb-nota">'
      + (d.tipo === 'fija' ? 'Fija' : 'Alterna') + '</span></td><td>' + esc(d.ruta) + '</td>'
      + '<td class="mono">' + d.encargosSemana.toFixed(1) + '</td><td class="mono">' + idsDe(d.id).length + '</td>'
      + '<td class="mono">' + (ok ? r.distanciaKm.toFixed(0) + ' km' : r ? '—' : '…') + '</td>'
      + '<td class="mono">' + (ok ? esc(r.fin) : r ? 'sin ruta' : '…') + '</td></tr>';
  }).join('');
  caja.innerHTML = '<div class="table-wrap" style="margin-top:18px"><table style="min-width:640px"><thead><tr>'
    + '<th>Día</th><th>Ruta</th><th>Encargos típicos</th><th>Paradas</th><th>Recorrido</th><th>Vuelve a planta</th>'
    + '</tr></thead><tbody>' + filas + '</tbody></table></div>'
    + (completos === plan.dias.length
      ? '<div class="hint">Un solo motorizado cubre las cinco rutas saliendo a las ' + esc(estado.salida) + ', y quedan '
        + horas(libreTotal) + ' de tarde libre en la semana para urgencias (se estiman ' + plan.espera.urgenciasSemana.toFixed(1)
        + '). Tiempos con el tráfico típico de Lima por franja horaria, no en vivo, y ' + TIEMPOS.porParadaMin + ' min por parada.</div>'
      : '<div class="hint">Calculando las rutas de la semana…</div>');
}

async function pintarMapa() {
  const cont = $('pbMapa');
  if (!cont) return;
  let L;
  try { L = await cargarLeaflet(); } catch (_) { cont.innerHTML = '<div class="hint" style="padding:16px">Mapa no disponible.</div>'; return; }
  if (!document.body.contains(cont)) return;
  if (!mapa || mapa.getContainer() !== cont) {
    if (mapa) mapa.remove();
    mapa = L.map(cont, { zoomControl: true }).setView([PLANTA.lat, PLANTA.lon], 11);
    L.tileLayer('/api/mapa/tiles/esri-calles/{z}/{x}/{y}', { maxZoom: 19, attribution: 'Mapa © Esri · Rutas © OpenStreetMap (OSRM)' }).addTo(mapa);
    capaRuta = null;
  }
  if (capaRuta) capaRuta.remove();
  capaRuta = L.layerGroup().addTo(mapa);

  const { paradas } = pedidoDe(estado.dia);
  const r = resultadoDe(estado.dia);
  const ok = r && !r.error;
  const orden = new Map();
  if (ok) r.cronograma.forEach((c, i) => { if (i > 0 && !c.regreso) orden.set(c.indice, i); });
  if (ok && r.geometria?.coordinates) {
    L.polyline(r.geometria.coordinates.map(([lon, lat]) => [lat, lon]), { color: '#1B4E8E', weight: 5, opacity: 0.8 }).addTo(capaRuta);
  }
  const limites = [];
  paradas.forEach((p, i) => {
    const clase = i === 0 ? 'planta' : p.extra ? 'extra' : p.precision === 'distrito' ? 'aprox' : '';
    const n = i === 0 ? 'P' : (orden.get(i) || '·');
    L.marker([p.lat, p.lon], { icon: L.divIcon({ className: 'pb-pin ' + clase, html: '<span>' + n + '</span>', iconSize: [26, 26], iconAnchor: [13, 13] }) })
      .bindTooltip(esc(p.nombre)).addTo(capaRuta);
    limites.push([p.lat, p.lon]);
  });
  setTimeout(() => { mapa.invalidateSize(); if (limites.length > 1) mapa.fitBounds(limites, { padding: [24, 24] }); }, 50);
}

function pintar() {
  if (!plan) return;
  pintarDias();
  pintarLado();
  pintarSemana();
  pintarMapa();
}

/** Tras cada render de la pantalla: monta el mapa y pide las rutas (la del día primero). */
export function montarPlan() {
  if (!plan || !$('pbPlanLado')) return;
  pintar();
  const actual = estado.dia;
  calcular(actual).then(pintar).then(() =>
    plan.dias.filter(d => d.id !== actual).reduce((cadena, d) => cadena.then(() => calcular(d.id)).then(pintarSemana), Promise.resolve()));
}

function recalcular() {
  pintar();
  calcular(estado.dia).then(pintar);
}

// ------------------------------------------------------------ controles
export function pbPlanDia(id) { estado.dia = id; busqueda = []; recalcular(); }
// La hora de salida mueve las cinco rutas: se recalcula la semana entera.
export function pbPlanSalida(v) { estado.salida = v; montarPlan(); }
export function pbPlanChilca(v) { estado.conChilca = !!v; delete estado.ids.jue; recalcular(); }
export function pbPlanParada(id, dentro) {
  const ids = new Set(idsDe(estado.dia));
  dentro ? ids.add(id) : ids.delete(id);
  estado.ids[estado.dia] = [...ids];
  recalcular();
}
export function pbPlanQuitarExtra(i) { estado.extra[estado.dia].splice(i, 1); recalcular(); }

const enLima = p => p && p.lat > -13.2 && p.lat < -11.2 && p.lon > -77.9 && p.lon < -76.2;

/** Primero el histórico de envíos; la búsqueda de direcciones en el mapa queda a un clic. */
export function pbPlanBuscar() {
  const q = ($('pbPlanQ')?.value || '').trim();
  const caja = $('pbPlanBusqueda');
  if (!caja) return;
  if (q.length < 3) { caja.innerHTML = '<p class="pb-nota">Escribe al menos 3 caracteres.</p>'; return; }
  const hallados = buscarDestinos(historico, q);
  busqueda = hallados.map(h => ({ hist: h }));
  caja.innerHTML = (hallados.length
    ? '<p class="pb-nota">En el histórico de envíos:</p>' + hallados.map((h, i) => '<div class="pb-plan-extra"><span>' + esc(h.destino)
      + '<small>' + esc(datoHistorico(h)) + '</small></span><button class="btn btn-sm" onclick="pbPlanAgregar(' + i + ')">Agregar</button></div>').join('')
    : '<p class="pb-nota">No está en el histórico de envíos.</p>')
    + '<button class="btn btn-sm btn-ghost" onclick="pbPlanBuscarMapa()">Buscar «' + esc(q) + '» como dirección en el mapa</button>';
}

export async function pbPlanBuscarMapa() {
  const q = ($('pbPlanQ')?.value || '').trim();
  const caja = $('pbPlanBusqueda');
  if (!caja || q.length < 3) return;
  caja.innerHTML = '<p class="pb-nota">Buscando en el mapa…</p>';
  let lista;
  try { lista = (((await obtener('/mapa/buscar?q=' + encodeURIComponent(q + ', Lima'))) || {}).resultados || []).filter(enLima); }
  catch (e) { caja.innerHTML = '<p class="pb-nota">' + esc(e.message) + '</p>'; return; }
  busqueda = lista.map(p => ({ mapa: p }));
  caja.innerHTML = lista.length
    ? lista.map((p, i) => '<button class="btn btn-sm btn-ghost" onclick="pbPlanAgregar(' + i + ')">' + esc(p.nombre || p.etiqueta) + '</button>').join('')
    : '<p class="pb-nota">Sin resultados en el mapa. Prueba con la avenida y el distrito.</p>';
}

export function pbPlanAgregar(i) {
  const r = busqueda[i];
  if (!r) return;
  busqueda = [];
  if (r.hist) return agregarHistorico(r.hist);
  estado.extra[estado.dia].push({ nombre: r.mapa.nombre || r.mapa.etiqueta, lat: r.mapa.lat, lon: r.mapa.lon });
  recalcular();
}

export function pbPlanAgregarHist(i) { if (historico[i]) agregarHistorico(historico[i]); }

/**
 * Suma a la ruta del día un destino del histórico. Si es un punto del plan que
 * ya sale este día, solo se marca; si trae coordenadas, entra directo; si no,
 * se ubica por su dirección en el mapa.
 */
async function agregarHistorico(h) {
  const dia = estado.dia;
  if (h.punto && plan.puntos.some(p => p.id === h.punto && p.dias.includes(dia))) {
    estado.ids[dia] = [...new Set([...idsDe(dia), h.punto])];
    return recalcular();
  }
  let c = h.lat != null ? { lat: h.lat, lon: h.lon } : ubicados.get(h.destino);
  let aproximado = false;
  if (!c) {
    const caja = $('pbPlanBusqueda');
    if (caja) caja.innerHTML = '<p class="pb-nota">Ubicando «' + esc(h.destino) + '» en el mapa…</p>';
    try {
      const r = await obtener('/mapa/buscar?q=' + encodeURIComponent(direccionParaBuscar(h.destino)));
      c = ((r && r.resultados) || []).find(enLima) || null;
    } catch (_) { c = null; }
    if (!c) {
      if (caja) caja.innerHTML = '<p class="pb-nota">No se pudo ubicar «' + esc(h.destino) + '» por su dirección.'
        + ' Búscalo como dirección en el mapa con la avenida y el distrito.</p>';
      return;
    }
    c = { lat: c.lat, lon: c.lon };
    ubicados.set(h.destino, c);
    aproximado = true;
  }
  estado.extra[dia].push({ nombre: h.destino, lat: c.lat, lon: c.lon, aproximado: aproximado || ubicados.has(h.destino) });
  recalcular();
}
