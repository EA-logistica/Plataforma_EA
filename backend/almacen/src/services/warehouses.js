// Ensambla la respuesta de almacenes para el mapa a partir de la data ORIGINAL del Radar.
// Cada elemento conserva el registro original intacto en `original` y agrega, por separado:
//   - `ubicacion`: coordenadas resueltas + fuente/precisión (ver services/locations.js)
//   - `logistica`: datos logísticos cargados por el equipo (storage/logistica.json), vacío por defecto
import path from 'node:path';
import { STORAGE_DIR } from '../config/env.js';
import { ORIGIN } from '../config/origin.js';
import { JsonStore } from '../lib/json-store.js';
import { readRadarData } from '../data/radar-source.js';
import { manualFor, manualOrigin, resolveLocation } from './locations.js';

const logisticsStore = new JsonStore(path.join(STORAGE_DIR, 'logistica.json'), { defaults: { almacenes: {} } });

export function getOrigin() {
  const { data } = readRadarData();
  return {
    ...ORIGIN,
    ubicacion: resolveLocation({
      manual: manualOrigin(),
      lat: data.plant?.lat,
      lon: data.plant?.lon,
      address: ORIGIN.direccionGeocodificable,
    }),
    // Referencia a cómo figura la planta en la data original (sin modificarla).
    registroOriginal: data.plant ? { name: data.plant.name, addr: data.plant.addr } : null,
  };
}

export function getWarehouses() {
  const { data, meta } = readRadarData();
  const logistics = logisticsStore.load().almacenes || {};
  const almacenes = Object.entries(data.warehouses || {}).map(([key, record]) => ({
    key,
    original: record,
    ubicacion: resolveLocation({ manual: manualFor(key), lat: record.lat, lon: record.lon, address: record.addr }),
    logistica: logistics[key] || {},
  }));
  return {
    fuente: meta,
    parametros: { trafficFactor: data.trafficFactor ?? null },
    origen: getOrigin(),
    almacenes,
  };
}
