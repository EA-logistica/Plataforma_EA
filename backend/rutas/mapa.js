import { Router } from 'express';
import { obtenerTesela } from '../almacen/src/services/tiles.js';
import { searchPlaces, reversePlace } from '../almacen/src/services/places.js';
import { limitarPeticiones } from '../middleware/limites.js';
import { asinc } from '../middleware/errores.js';

/**
 * Mapa del formulario de solicitud: el solicitante marca en el mapa el punto
 * de origen ("Otros") o el destino, como en una app de taxi.
 *
 * Reutiliza lo del módulo de Almacén -proxy de teselas con caché en disco y
 * búsqueda en Nominatim con throttle de 1/s y caché- pero expuesto en /api,
 * porque quien pide un servicio no tiene la sesión de Almacén (esa es solo de
 * admin). Por eso va acotado:
 *   - teselas: solo el mapa de calles, nada de satélite ni tráfico en vivo
 *     (este último consume una cuota paga);
 *   - búsqueda e inverso: con freno por IP. Nominatim es gratuito a cambio de
 *     no abusar, y el throttle del proveedor es compartido con Almacén.
 */
export const mapa = Router();

const CAPAS = new Set(['osm', 'esri-calles']);
const error = (msg, status) => Object.assign(new Error(msg), { status });

const frenoBusqueda = limitarPeticiones({
  maximo: 60, ventanaMs: 5 * 60 * 1000, nombre: 'mapa',
  mensaje: 'Demasiadas búsquedas en el mapa en poco tiempo. Espera unos minutos.'
});

mapa.get('/mapa/tiles/:capa/:z/:x/:y', asinc(async (req, res) => {
  const { capa, z, x, y } = req.params;
  if (!CAPAS.has(capa)) throw error('Capa de mapa no disponible.', 404);
  if (Number(z) > 19) throw error('Zoom fuera de rango.', 400);
  const buffer = await obtenerTesela(capa, z, x, y);
  res.set({ 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=604800' });
  res.end(buffer);
}));

mapa.get('/mapa/buscar', frenoBusqueda, asinc(async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 3 || q.length > 200) throw error('Escribe al menos 3 caracteres para buscar.', 400);
  res.json(await searchPlaces(q));
}));

mapa.get('/mapa/inverso', frenoBusqueda, asinc(async (req, res) => {
  const lat = Number(req.query.lat), lon = Number(req.query.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    throw error('Punto inválido.', 400);
  }
  res.json(await reversePlace(lat, lon));
}));
