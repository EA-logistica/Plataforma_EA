// Cálculo de rutas con caché persistente. Las rutas entre dos puntos fijos casi no cambian, por lo que
// una misma consulta solo llega al proveedor externo una vez cada ROUTE_CACHE_TTL_DAYS días.
import path from 'node:path';
import { CACHE_DIR, config } from '../config/env.js';
import { JsonStore } from '../lib/json-store.js';
import { HttpError } from '../lib/http.js';
import { PERFILES, optimizerProvider, providerFor } from '../providers/routing/index.js';
import { createFixedFactorTraffic, createLimaTimeOfDayTraffic, tipoDeDia } from '../providers/traffic/index.js';
import { readRadarData } from '../data/radar-source.js';

const routeCache = new JsonStore(path.join(CACHE_DIR, 'rutas.json'));
const round = (n) => Math.round(n * 1e5) / 1e5;

function trafficModel() {
  const factor = config.traffic.factorOverride ?? readRadarData().data.trafficFactor ?? 1;
  return createFixedFactorTraffic(factor);
}

export async function computeRoute(from, to, perfilSolicitado = 'auto') {
  if (!PERFILES[perfilSolicitado]) throw new HttpError(400, `Perfil desconocido: ${perfilSolicitado}`);

  let provider = providerFor(perfilSolicitado);
  let advertencia = null;
  if (!provider) {
    provider = providerFor('auto');
    advertencia = 'El perfil camión requiere configurar ORS_API_KEY (OpenRouteService) en el servidor. Se muestra la ruta para automóvil.';
  }
  const perfil = provider.perfiles.includes(perfilSolicitado) ? perfilSolicitado : 'auto';

  const key = [provider.id, perfil, round(from.lat), round(from.lon), round(to.lat), round(to.lon)].join('|');
  const ttlMs = config.routing.cacheTtlDays * 86400000;
  let hit = routeCache.get(key);
  const fromCache = !!(hit && Date.now() - Date.parse(hit.calculadoEn) < ttlMs);

  if (!fromCache) {
    try {
      const r = await provider.route(from, to, perfil);
      hit = { ...r, proveedor: provider.id, proveedorNombre: provider.nombre, calculadoEn: new Date().toISOString() };
      routeCache.set(key, hit);
    } catch (err) {
      throw new HttpError(502, `No se pudo calcular la ruta con ${provider.nombre}: ${err.message}`);
    }
  }

  const duracionLibreMin = hit.duracionS / 60;
  return {
    proveedor: hit.proveedor,
    proveedorNombre: hit.proveedorNombre,
    perfilSolicitado,
    perfilAplicado: hit.perfil,
    advertencia,
    distanciaKm: hit.distanciaM / 1000,
    duracionLibreMin,
    trafico: trafficModel().estimate(duracionLibreMin),
    geometria: hit.geometria,
    calculadoEn: hit.calculadoEn,
    desdeCache: fromCache,
  };
}

// ---------------------------------------------------------------------------------------------
// Planificador de paradas / programación de camiones.
// Ruta por N puntos (en orden o con orden optimizado) + horario estimado de llegada a cada parada.
// ---------------------------------------------------------------------------------------------

export const MAX_PARADAS = 25;
const multiCache = new JsonStore(path.join(CACHE_DIR, 'rutas-multiples.json'));

function scheduleTraffic() {
  return createLimaTimeOfDayTraffic({ factorFijo: config.traffic.factorOverride });
}

const hhmmToMin = (s) => {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(s || '').trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
const minToHhmm = (min) => {
  const total = Math.round(min);
  const dias = Math.floor(total / 1440);
  const t = ((total % 1440) + 1440) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}${dias > 0 ? ` (+${dias}d)` : ''}`;
};

async function cachedMulti(provider, perfil, points) {
  const key = [provider.id, perfil, ...points.map((p) => `${round(p.lat)},${round(p.lon)}`)].join('|');
  const ttlMs = config.routing.cacheTtlDays * 86400000;
  const hit = multiCache.get(key);
  if (hit && Date.now() - Date.parse(hit.calculadoEn) < ttlMs) return { ...hit, desdeCache: true };
  const r = await provider.routeMulti(points, perfil);
  if (!r.legs || r.legs.length !== points.length - 1) {
    throw new Error('El proveedor no devolvió el detalle por tramo');
  }
  const entry = { ...r, proveedor: provider.id, proveedorNombre: provider.nombre, calculadoEn: new Date().toISOString() };
  multiCache.set(key, entry);
  return { ...entry, desdeCache: false };
}

// paradas: [{lat, lon, nombre?, servicioMin?}], la primera es el punto de salida.
// opciones: { perfil, optimizar, regreso, salida:'HH:MM', fecha:'YYYY-MM-DD', finJornada:'HH:MM' }
export async function computeStopsRoute(paradas, opciones = {}) {
  const perfilSolicitado = opciones.perfil || 'auto';
  if (!PERFILES[perfilSolicitado]) throw new HttpError(400, `Perfil desconocido: ${perfilSolicitado}`);
  let provider = providerFor(perfilSolicitado);
  let advertencia = null;
  if (!provider) {
    provider = providerFor('auto');
    advertencia = 'El perfil camión requiere configurar ORS_API_KEY (OpenRouteService) en el servidor. Se muestra la ruta para automóvil.';
  }
  const perfil = provider.perfiles.includes(perfilSolicitado) ? perfilSolicitado : 'auto';
  const regreso = !!opciones.regreso;

  // 1) Orden de visita.
  let orden = paradas.map((_, i) => i);
  let optimizado = false;
  if (opciones.optimizar && paradas.length > 2) {
    const opt = optimizerProvider();
    if (!opt) throw new HttpError(501, 'No hay un proveedor configurado para optimizar el orden');
    try {
      orden = (await opt.optimize(paradas, { regreso })).orden;
      optimizado = true;
    } catch (err) {
      throw new HttpError(502, `No se pudo optimizar el orden con ${opt.nombre}: ${err.message}`);
    }
  }
  const ordenadas = orden.map((i) => paradas[i]);
  const puntos = regreso ? [...ordenadas, ordenadas[0]] : ordenadas;

  // 2) Geometría y tramos.
  let r;
  try {
    r = await cachedMulti(provider, perfil, puntos);
  } catch (err) {
    throw new HttpError(502, `No se pudo calcular la ruta con ${provider.nombre}: ${err.message}`);
  }

  // 3) Horario: cada tramo se multiplica por el factor de la franja horaria en que empieza.
  const trafico = scheduleTraffic();
  const dia = tipoDeDia(opciones.fecha);
  const salidaMin = hhmmToMin(opciones.salida) ?? 8 * 60;
  const finJornadaMin = hhmmToMin(opciones.finJornada) ?? 18 * 60;
  let t = salidaMin;
  const cronograma = [];
  const servicio = (p) => Math.max(0, Math.min(600, Number(p?.servicioMin) || 0));

  // Parada 0: salida (su tiempo de servicio = carga en planta, antes de partir).
  const s0 = servicio(ordenadas[0]);
  cronograma.push({ indice: orden[0], nombre: ordenadas[0].nombre || 'Salida', llegada: null, salida: minToHhmm(t + s0), servicioMin: s0, tramo: null });
  t += s0;

  let totalLibre = 0;
  let totalEstimado = 0;
  r.legs.forEach((leg, i) => {
    const libreMin = leg.duracionS / 60;
    const { factor, franja } = trafico.factorAt(t, dia);
    const estimadoMin = libreMin * factor;
    totalLibre += libreMin;
    totalEstimado += estimadoMin;
    t += estimadoMin;
    const esRegreso = regreso && i === r.legs.length - 1;
    const destino = esRegreso ? ordenadas[0] : ordenadas[i + 1];
    const sv = esRegreso ? 0 : servicio(destino);
    const llegadaMin = t;
    t += sv;
    cronograma.push({
      indice: esRegreso ? orden[0] : orden[i + 1],
      nombre: destino.nombre || `Parada ${i + 1}`,
      regreso: esRegreso,
      llegada: minToHhmm(llegadaMin),
      llegadaMin: Math.round(llegadaMin),
      salida: esRegreso ? null : minToHhmm(t),
      servicioMin: sv,
      tramo: { distanciaKm: leg.distanciaM / 1000, duracionLibreMin: libreMin, factor, franja, duracionEstimadaMin: estimadoMin },
    });
  });

  const totalServicio = cronograma.reduce((a, c) => a + c.servicioMin, 0);
  const finMin = t;
  const avisos = [];
  if (advertencia) avisos.push(advertencia);
  if (finMin > finJornadaMin) {
    avisos.push(`${regreso ? 'El regreso a la salida' : 'La última parada'} termina a las ${minToHhmm(finMin)}, después del fin de jornada (${minToHhmm(finJornadaMin)}): ${Math.round(finMin - finJornadaMin)} min de exceso.`);
  }
  const enPunta = cronograma.filter((c) => c.tramo && c.tramo.factor >= 1.7).length;
  if (enPunta) avisos.push(`${enPunta} tramo(s) caen en hora punta: considere adelantar la salida o reordenar.`);

  return {
    proveedor: r.proveedor,
    proveedorNombre: r.proveedorNombre,
    perfilSolicitado,
    perfilAplicado: perfil,
    optimizado,
    orden,
    regreso,
    geometria: r.geometria,
    distanciaKm: r.distanciaM / 1000,
    duracionLibreMin: totalLibre,
    duracionEstimadaMin: totalEstimado,
    servicioMin: totalServicio,
    salida: minToHhmm(salidaMin),
    fin: minToHhmm(finMin),
    finJornada: minToHhmm(finJornadaMin),
    excedeJornada: finMin > finJornadaMin,
    cronograma,
    avisos,
    trafico: { id: trafico.id, tiempoReal: false, tipoDia: dia, descripcion: trafico.descripcion },
    calculadoEn: r.calculadoEn,
    desdeCache: r.desdeCache,
  };
}
