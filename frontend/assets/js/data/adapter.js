// Adaptador: registro original del Radar -> modelo de vista del mapa (ubicación, marcador, ficha, filtros, ruta).
// El registro original se conserva sin cambios en `original` (congelado); todo lo demás es derivado.
// `ubicacion` puede completarse después (geocodificación diferida) sin tocar `original`.
import { buildLogistics } from './logistics-schema.js';
import { derivePricing, extractPhone, normalize, parseArea, parsePrice, provinciaFromDistrito, safeUrl, tipologiaFromTitle } from './parsers.js';

const TIPO_LABEL = { almacen: 'Almacén candidato', venta: 'Inmueble en venta', referencia: 'Punto de referencia' };

export function adaptWarehouse({ key, original, ubicacion, logistica }) {
  const o = original;
  const area = parseArea(o.m2);
  const price = parsePrice(o.precio);
  const provincia = provinciaFromDistrito(o.distrito);

  return {
    key,
    original: Object.freeze(o),

    // Ficha
    nombre: o.name ?? null,
    direccion: o.addr ?? null,
    distrito: o.distrito ?? null,
    provincia: provincia ? { valor: provincia, nota: 'según distrito' } : null,
    areaTexto: o.m2 ?? null,
    precioTexto: o.precio ?? null,
    modalidad: o.categoria ?? null,
    tipoRegistro: TIPO_LABEL[o.tipo] ?? o.tipo ?? null,
    tipologia: tipologiaFromTitle(o.name),
    contacto: o.contacto ?? null,
    telefono: extractPhone(o.contacto),
    url: safeUrl(o.url),
    fuenteAnuncio: o.fuente ?? null,
    band: o.band ?? null,

    // Ubicación (la dirección original nunca se reemplaza)
    ubicacion: ubicacion ? { ...ubicacion } : null,

    // Filtros / cálculos
    area,
    precio: price,
    pricing: derivePricing(price, area),
    textoBusqueda: normalize([key, o.name, o.addr, o.distrito, o.fuente, o.categoria, provincia].filter(Boolean).join(' ')),

    // Ruta existente en el Radar (referencia) y estructura logística
    rutaRadar: Number.isFinite(o.distance_km)
      ? { distanciaKm: o.distance_km, duracionLibreMin: o.duration_min, duracionAjustadaMin: o.duration_adj_min }
      : null,
    logistica: buildLogistics(o, logistica),
  };
}

export function adaptPayload(payload) {
  return {
    fuente: payload.fuente,
    trafficFactor: payload.parametros?.trafficFactor ?? null,
    origen: payload.origen,
    almacenes: payload.almacenes.map(adaptWarehouse),
  };
}
