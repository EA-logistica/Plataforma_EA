// Programación de camiones: viajes guardados (camión/placa, conductor, salida y paradas).
// Persistencia en storage/programacion-camiones.json (mismo patrón JsonStore que el resto del módulo).
// Solo se guarda la planificación; el horario estimado se recalcula al abrir el viaje
// (depende del perfil de tráfico y del caché de rutas vigentes).
import crypto from 'node:crypto';
import path from 'node:path';
import { STORAGE_DIR } from '../config/env.js';
import { JsonStore } from '../lib/json-store.js';
import { HttpError } from '../lib/http.js';
import { isInPeru } from './locations.js';
import { MAX_PARADAS } from './routing.js';

const store = new JsonStore(path.join(STORAGE_DIR, 'programacion-camiones.json'), { defaults: { viajes: [] } });
const MAX_VIAJES = 500;

const texto = (v, max) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);
const hhmm = (v, d) => (/^([01]\d|2[0-3]):[0-5]\d$/.test(String(v || '')) ? String(v) : d);

export function validarParadas(list) {
  if (!Array.isArray(list) || list.length < 2) throw new HttpError(400, 'Se requieren al menos 2 paradas (salida + 1 destino)');
  if (list.length > MAX_PARADAS) throw new HttpError(400, `Máximo ${MAX_PARADAS} paradas por viaje`);
  return list.map((p, i) => {
    const lat = Number(p?.lat);
    const lon = Number(p?.lon);
    if (!isInPeru(lat, lon)) throw new HttpError(400, `Parada ${i + 1}: coordenadas fuera de Perú o inválidas`);
    return {
      lat,
      lon,
      nombre: texto(p.nombre, 120) || `Parada ${i + 1}`,
      direccion: texto(p.direccion, 300) || null,
      servicioMin: Math.max(0, Math.min(600, Math.round(Number(p.servicioMin) || 0))),
      almacen: texto(p.almacen, 80) || null,
    };
  });
}

function validarViaje(body) {
  const placa = texto(body?.placa, 12).toUpperCase();
  if (!placa) throw new HttpError(400, 'La placa del camión es obligatoria');
  const fecha = /^\d{4}-\d{2}-\d{2}$/.test(body?.fecha || '') ? body.fecha : null;
  return {
    nombre: texto(body.nombre, 80) || null,
    placa,
    conductor: texto(body.conductor, 80) || null,
    fecha,
    salida: hhmm(body.salida, '08:00'),
    finJornada: hhmm(body.finJornada, '18:00'),
    perfil: body.perfil === 'camion' ? 'camion' : 'auto',
    regreso: !!body.regreso,
    paradas: validarParadas(body.paradas),
    resumen: body.resumen && typeof body.resumen === 'object'
      ? {
          distanciaKm: Number(body.resumen.distanciaKm) || null,
          fin: texto(body.resumen.fin, 16) || null,
          duracionEstimadaMin: Number(body.resumen.duracionEstimadaMin) || null,
        }
      : null,
  };
}

export function listarViajes() {
  const viajes = [...(store.load().viajes || [])];
  viajes.sort((a, b) => `${b.fecha || ''} ${b.salida}`.localeCompare(`${a.fecha || ''} ${a.salida}`) || b.creadoEn.localeCompare(a.creadoEn));
  return { viajes };
}

export function crearViaje(body) {
  const data = store.load();
  data.viajes = data.viajes || [];
  if (data.viajes.length >= MAX_VIAJES) throw new HttpError(409, `Se alcanzó el máximo de ${MAX_VIAJES} viajes guardados; elimine los antiguos`);
  const viaje = { id: crypto.randomUUID(), ...validarViaje(body), creadoEn: new Date().toISOString() };
  data.viajes.push(viaje);
  store.scheduleWrite();
  return viaje;
}

export function actualizarViaje(id, body) {
  const data = store.load();
  const i = (data.viajes || []).findIndex((v) => v.id === id);
  if (i < 0) throw new HttpError(404, 'Viaje no encontrado');
  data.viajes[i] = { ...data.viajes[i], ...validarViaje(body), actualizadoEn: new Date().toISOString() };
  store.scheduleWrite();
  return data.viajes[i];
}

export function eliminarViaje(id) {
  const data = store.load();
  const antes = (data.viajes || []).length;
  data.viajes = (data.viajes || []).filter((v) => v.id !== id);
  if (data.viajes.length === antes) throw new HttpError(404, 'Viaje no encontrado');
  store.scheduleWrite();
  return { ok: true, id };
}
