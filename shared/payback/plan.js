import { PUNTOS, DIAS, DIA_JS, ZONA_DIAS, PLANTA, TIEMPOS, POLITICA } from '#data/payback/rutas.js';
import { zonaDe } from '#data/payback/zonas.js';

/**
 * Plan de rutas semanal contra el histórico real.
 *
 * Responde tres preguntas con los viajes ya hechos:
 *   1. ¿Qué parte de los encargos cae en puntos que se repiten? (cobertura)
 *   2. ¿Cuánto carga cada día de ruta? (encargos y paradas por semana)
 *   3. Si todo se hubiera planificado, ¿cuánto habría esperado cada encargo
 *      hasta su ruta? Eso dice cuántas "urgencias" quedan de verdad.
 *
 * La fecha programada del histórico se toma como el día en que se pidió: la
 * planilla no guarda la hora de pedido, y para este cálculo es lo más cercano.
 *
 * Cálculo puro, sin DOM ni red. Las rutas por calles las calcula el servidor
 * (POST /api/payback/ruta); aquí solo se arman sus paradas.
 */

const norm = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
const PUNTO_POR_DESTINO = new Map(PUNTOS.map(p => [norm(p.destino), p]));
const JS_A_DIA = Object.fromEntries(Object.entries(DIA_JS).map(([id, n]) => [n, id]));

const fecha = f => new Date(f + 'T12:00:00');
const lunesDe = d => { const t = new Date(d); t.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return t; };
/** Semana del año contada desde el primer lunes de 2026: decide los puntos que van cada 2 semanas. */
const semanaN = d => Math.round((lunesDe(d) - new Date(2026, 0, 5, 12)) / (7 * 86400000));

/** Punto del plan de un destino, o null si es un destino suelto. */
export const puntoDe = destino => PUNTO_POR_DESTINO.get(norm(destino)) || null;

/** Días del plan en que sale un destino: los de su punto, o los de su zona si es suelto. */
export function diasDe(destino) {
  const p = puntoDe(destino);
  return p ? p.dias : (ZONA_DIAS[zonaDe(destino)] || ZONA_DIAS.otros);
}

/**
 * Días HÁBILES que habría esperado un encargo pedido para `f` hasta la
 * primera ruta que pasa por su destino (0 = sale ese mismo día). El motorizado
 * trabaja de lunes a viernes: lo del sábado se adelanta al viernes y lo del
 * domingo pasa al lunes.
 */
export function espera(f, destino) {
  const p = puntoDe(destino);
  const dias = new Set(diasDe(destino).map(id => DIA_JS[id]));
  const d = fecha(f);
  if (d.getDay() === 6) d.setDate(d.getDate() - 1);
  if (d.getDay() === 0) d.setDate(d.getDate() + 1);
  for (let k = 0; k < 15; ) {
    if (dias.has(d.getDay()) && !(p && p.cadaSemanas > 1 && semanaN(d) % p.cadaSemanas !== 0)) {
      return { dias: k, dia: JS_A_DIA[d.getDay()] };
    }
    d.setDate(d.getDate() + (d.getDay() === 5 ? 3 : 1));
    k++;
  }
  return { dias: 5, dia: diasDe(destino)[0] };
}

/**
 * Visitas que justifican dejar un punto fijo en su ruta: si en promedio hay un
 * encargo cada tres pasadas o más, va siempre; si no, entra solo la semana que
 * tiene encargo ("a pedido").
 */
export const UMBRAL_FIJA = 0.3;

export function analizarPlan(solicitudes) {
  const viajes = solicitudes.filter(s => s.fechaProg && s.destino && s.estado !== 'Cancelado');
  const semanas = new Set(viajes.map(s => lunesDe(fecha(s.fechaProg)).toISOString().slice(0, 10))).size || 1;

  const porPunto = new Map();
  const porDia = Object.fromEntries(DIAS.map(d => [d.id, { encargos: 0, destinos: new Map() }]));
  const esperas = [0, 0, 0, 0]; // 0, 1, 2, 3+ días
  let enPuntos = 0, sumaEspera = 0;

  for (const s of viajes) {
    const p = puntoDe(s.destino);
    if (p) {
      enPuntos++;
      const e = porPunto.get(p.id) || { viajes: 0, entregas: 0, recojos: 0 };
      e.viajes++; s.tipo === 'Entregar' ? e.entregas++ : e.recojos++;
      porPunto.set(p.id, e);
    }
    const w = espera(s.fechaProg, s.destino);
    esperas[Math.min(w.dias, 3)]++;
    sumaEspera += w.dias;
    const dia = porDia[w.dia];
    dia.encargos++;
    const clave = p ? p.id : norm(s.destino);
    dia.destinos.set(clave, (dia.destinos.get(clave) || 0) + 1);
  }

  const n = viajes.length || 1;
  const puntos = PUNTOS.map(p => {
    const e = porPunto.get(p.id) || { viajes: 0, entregas: 0, recojos: 0 };
    const porSemana = e.viajes / semanas;
    const porPasada = porSemana / (p.dias.length / (p.cadaSemanas || 1));
    return { ...p, ...e, porSemana, porPasada, fija: porPasada >= UMBRAL_FIJA };
  });

  const dias = DIAS.map(d => {
    const x = porDia[d.id];
    // Paradas por semana: cada destino cuenta como una parada por visita, no
    // por encargo -varios encargos al mismo sitio se llevan juntos-, con el
    // tope de las veces que la ruta pasa por ahí en la semana.
    const paradas = [...x.destinos.values()].reduce((a, v) => a + Math.min(v / semanas, 1), 0);
    return { ...d, encargosSemana: x.encargos / semanas, paradasSemana: paradas, puntos: puntos.filter(p => p.dias.includes(d.id)) };
  });

  return {
    viajes: viajes.length,
    semanas,
    encargosSemana: viajes.length / semanas,
    cobertura: enPuntos / n,
    puntos,
    dias,
    espera: {
      mismoDia: esperas[0] / n,
      unDia: esperas[1] / n,
      dosDias: esperas[2] / n,
      tresOMas: esperas[3] / n,
      promedio: sumaEspera / n,
      // Lo que tendría que esperar 2 días hábiles o más es lo que hoy se
      // pediría como urgencia: el volumen que absorben las tardes libres.
      urgenciasSemana: (esperas[2] + esperas[3]) / semanas
    },
    // Hoy cada encargo es una salida del courier; con el plan son cinco por semana.
    salidasHoySemana: viajes.length / semanas,
    salidasPlanSemana: DIAS.length,
    politica: POLITICA
  };
}

/**
 * Ids de los puntos que van por defecto en la ruta de un día típico: los
 * fijos (UMBRAL_FIJA) y, si el día suele tener más paradas (`objetivo`, de
 * analizarPlan().dias[].paradasSemana), los "a pedido" más frecuentes hasta
 * llegar a ese número. Los de cada 2 semanas entran solo si `conQuincenales`.
 * `puntos` es analizarPlan().puntos.
 */
export function seleccionInicial(diaId, puntos, { objetivo = 0, conQuincenales = false } = {}) {
  const delDia = puntos.filter(p => p.dias.includes(diaId) && !(p.cadaSemanas > 1))
    .sort((a, b) => b.porPasada - a.porPasada);
  // La semana que toca un punto lejano (Chilca) el día no da para más: van
  // solo los fijos y lo "a pedido" pasa a la ruta siguiente de su zona.
  const fijos = delDia.filter(p => p.fija).length;
  const n = conQuincenales ? fijos : Math.max(fijos, Math.round(objetivo));
  const ids = delDia.slice(0, n).map(p => p.id);
  if (conQuincenales) ids.push(...puntos.filter(p => p.dias.includes(diaId) && p.cadaSemanas > 1).map(p => p.id));
  return ids;
}

/**
 * Paradas de la ruta de un día, listas para POST /api/payback/ruta. La planta
 * va primero (salida y regreso). `ids` son los puntos que van en la ruta;
 * `extra` son paradas sueltas (una urgencia buscada en el mapa).
 */
export function paradasDelDia(diaId, { ids = [], extra = [] } = {}) {
  const dentro = new Set(ids);
  const puntos = PUNTOS.filter(p => p.dias.includes(diaId) && dentro.has(p.id));
  return [
    { id: 'planta', nombre: PLANTA.nombre, lat: PLANTA.lat, lon: PLANTA.lon, servicioMin: TIEMPOS.cargaEnPlantaMin },
    ...puntos.map(p => ({ id: p.id, nombre: p.destino, lat: p.lat, lon: p.lon, precision: p.precision, servicioMin: TIEMPOS.porParadaMin })),
    ...extra.map((e, i) => ({ id: 'extra-' + i, nombre: e.nombre, lat: e.lat, lon: e.lon, extra: true, servicioMin: TIEMPOS.porParadaMin }))
  ];
}

/**
 * Coordenadas escritas dentro del destino: un enlace de Google Maps
 * ("maps.google.com/maps?q=-12.01,-76.96", ".../@-12.04,-77.06,17z") o un
 * "lat, lng" pegado a mano. null si el texto no trae ninguna.
 */
export function coordsEnTexto(texto) {
  const t = decodeURIComponent(String(texto || '').replace(/\+/g, ' '));
  const m = /(?:[?&]q=|@|^|\s)(-1[1-3]\.\d{3,})\s*,\s*(-7[67]\.\d{3,})/.exec(t);
  return m ? { lat: Number(m[1]), lon: Number(m[2]) } : null;
}

/**
 * Texto para geocodificar un destino del histórico: sin el nombre de la
 * empresa delante ("BOHLER, CASTRO RONCEROS 777, CERCADO DE LIMA") y, si es un
 * enlace de Google Maps de "cómo llegar", con la dirección que trae adentro.
 */
export function direccionParaBuscar(destino) {
  let t = String(destino || '').trim();
  const dir = /\/maps\/dir\/\/([^/]+)/.exec(t) || /\/maps\/place\/([^/]+)/.exec(t);
  if (dir) t = decodeURIComponent(dir[1].replace(/\+/g, ' '));
  const partes = t.split(',').map(x => x.trim()).filter(Boolean);
  if (partes.length > 2 && !/\d/.test(partes[0])) partes.shift();
  return partes.join(', ').replace(/\bAV\.\s*/gi, 'Avenida ').replace(/\bJR\.\s*/gi, 'Jirón ')
    .replace(/\b(CL|CAL)\.\s*/gi, 'Calle ') + ', Lima, Perú';
}

/**
 * Todos los destinos del histórico de envíos -la misma data de la pestaña
 * Histórico-, agrupados por cómo se escriben, con sus viajes, el último, la
 * zona, los días en que sale la ruta y las coordenadas si se conocen (punto
 * del plan o enlace de Google Maps en el texto). Del más al menos visitado.
 */
export function destinosHistorico(solicitudes) {
  const grupos = new Map();
  for (const s of solicitudes) {
    if (!s.destino || s.estado === 'Cancelado') continue;
    const clave = norm(s.destino);
    const g = grupos.get(clave) || { destino: s.destino, viajes: 0, ultima: '' };
    g.viajes++;
    if ((s.fechaProg || '') >= g.ultima) { g.ultima = s.fechaProg || ''; g.destino = s.destino; }
    grupos.set(clave, g);
  }
  return [...grupos.values()].map(g => {
    const p = puntoDe(g.destino);
    const c = p ? { lat: p.lat, lon: p.lon } : coordsEnTexto(g.destino);
    return { ...g, zona: zonaDe(g.destino), dias: diasDe(g.destino), punto: p ? p.id : null, ...(c || {}) };
  }).sort((a, b) => b.viajes - a.viajes || a.destino.localeCompare(b.destino));
}

/** Destinos del histórico que contienen todas las palabras buscadas (sin tildes ni mayúsculas). */
export function buscarDestinos(lista, q, max = 8) {
  const palabras = norm(q).split(' ').filter(w => w.length > 1);
  if (!palabras.length) return [];
  return lista.filter(d => { const t = norm(d.destino); return palabras.every(w => t.includes(w)); }).slice(0, max);
}

/**
 * Enlaces de Google Maps para navegar la ruta paso a paso, en el orden ya
 * optimizado. Google acepta pocas paradas intermedias por enlace, así que la
 * ruta se parte en tramos de hasta 9 paradas, cada uno empezando donde
 * terminó el anterior.
 */
export function enlacesGoogleMaps(puntosEnOrden, porTramo = 9) {
  const ll = p => p.lat.toFixed(6) + ',' + p.lon.toFixed(6);
  const enlaces = [];
  for (let i = 0; i < puntosEnOrden.length - 1; i += porTramo + 1) {
    const tramo = puntosEnOrden.slice(i, i + porTramo + 2);
    if (tramo.length < 2) break;
    const q = new URLSearchParams({ api: '1', origin: ll(tramo[0]), destination: ll(tramo.at(-1)), travelmode: 'driving' });
    const medio = tramo.slice(1, -1);
    if (medio.length) q.set('waypoints', medio.map(ll).join('|'));
    enlaces.push('https://www.google.com/maps/dir/?' + q.toString());
  }
  return enlaces;
}
