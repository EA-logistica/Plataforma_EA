// Configuración del módulo "Mapa de Almacenes". Solo datos públicos: ninguna credencial vive en el frontend.
import { BANDS } from '/assets/js/data/bands.js';

// Proveedor de mapa activo (ver js/map/map-adapter.js). Cambiar aquí para usar otro motor.
export const MAP_ENGINE = 'leaflet';

export const MAP_DEFAULTS = {
  center: [-11.98, -77.06], // Lima Metropolitana (encuadre que incluye Lima Norte, donde se concentran los registros)
  zoom: 11,
  minZoom: 5, // permite alejarse hasta ver todo el Perú
  maxZoom: 19,
  // Límite de desplazamiento: Perú con margen (la app no prioriza otros países).
  maxBounds: [[-19.5, -83.5], [1.5, -67.0]],
};

// Capas base sin API key ni costo por consulta. Una capa puede combinar varias teselas (`urls`), p. ej. base + etiquetas.
// Para un proveedor con key (Mapbox, Google, CARTO…), la key debe restringirse por dominio en el panel del
// proveedor o servirse las teselas a través del backend.
//
// Las URL ya NO apuntan a tile.openstreetmap.org / server.arcgisonline.com
// directo: pasan por el proxy con caché del propio servidor
// (backend/almacen/src/services/tiles.js). El navegador de cada PC pedía las
// mismas teselas una y otra vez sin guardarlas, y la política de uso de OSM
// -operations.osmfoundation.org/policies/tiles- es explícita en que eso
// termina bloqueado ("Access blocked" en cada tesela, que es justo lo que
// pasó). El id de cada URL (osm, esri-calles, ...) es la clave que el proxy
// reconoce; ver PROVEEDORES en ese archivo.
const OSM_ATTR = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
const TILES = '/almacen/api/tiles';
export const BASE_LAYERS = [
  {
    id: 'esri-calles',
    nombre: 'Calles · Esri',
    urls: [`${TILES}/esri-calles/{z}/{x}/{y}`],
    opciones: { maxZoom: 19, attribution: 'Tiles © Esri' },
    predeterminada: true,
  },
  {
    id: 'osm',
    nombre: 'Calles · OpenStreetMap',
    urls: [`${TILES}/osm/{z}/{x}/{y}`],
    opciones: { maxZoom: 19, attribution: OSM_ATTR },
  },
  {
    id: 'esri-gris',
    nombre: 'Análisis · gris claro',
    urls: [`${TILES}/esri-gris-base/{z}/{x}/{y}`, `${TILES}/esri-gris-ref/{z}/{x}/{y}`],
    opciones: { maxNativeZoom: 16, maxZoom: 19, attribution: 'Tiles © Esri — Esri, HERE, Garmin, © OpenStreetMap contributors' },
  },
  {
    id: 'esri-oscuro',
    nombre: 'Análisis · oscuro',
    urls: [`${TILES}/esri-oscuro-base/{z}/{x}/{y}`, `${TILES}/esri-oscuro-ref/{z}/{x}/{y}`],
    opciones: { maxNativeZoom: 16, maxZoom: 19, attribution: 'Tiles © Esri — Esri, HERE, Garmin, © OpenStreetMap contributors' },
  },
  {
    id: 'satelite',
    nombre: 'Satélite · Esri',
    urls: [`${TILES}/esri-satelite-img/{z}/{x}/{y}`, `${TILES}/esri-satelite-ref/{z}/{x}/{y}`],
    opciones: { maxZoom: 19, attribution: 'Imágenes © Esri, Maxar, Earthstar Geographics' },
  },
];

// Vistas rápidas de navegación (encuadres de pantalla, no son datos de ubicación de ningún inmueble).
// Para expandir a otras regiones del Perú basta agregar entradas aquí.
export const ZONAS = [
  { id: 'lima', nombre: 'Lima Metropolitana', bounds: [[-12.32, -77.2], [-11.72, -76.82]] },
  { id: 'lima-norte', nombre: 'Lima Norte', bounds: [[-12.04, -77.16], [-11.8, -76.98]] },
  { id: 'naranjal', nombre: 'Independencia · Los Olivos · SMP', bounds: [[-12.03, -77.11], [-11.93, -77.03]] },
  { id: 'norte-lejano', nombre: 'Puente Piedra · Carabayllo · Ancón', bounds: [[-11.9, -77.2], [-11.7, -77.0]] },
  { id: 'callao', nombre: 'Callao · Ventanilla', bounds: [[-12.08, -77.2], [-11.84, -77.06]] },
  { id: 'lima-este', nombre: 'Lima Este', bounds: [[-12.1, -77.0], [-11.9, -76.8]] },
  { id: 'lima-sur', nombre: 'Lima Sur', bounds: [[-12.32, -77.05], [-12.1, -76.84]] },
  { id: 'peru', nombre: 'Todo el Perú', bounds: [[-18.4, -81.4], [-0.03, -68.65]] },
];

// Paleta de marcadores.
export const COLORES = {
  origen: '#E85D2B',
  // Paleta categórica validada (fondo oscuro, todas las parejas); la forma del marcador es la codificación secundaria.
  modalidad: { Alquiler: '#3987e5', Venta: '#d95926', Referencia: '#199e70' },
  band: Object.fromEntries(BANDS.map((b) => [b.id, b.color])),
  ruta: '#2F7DE1',
};

export const BAND_LABEL = Object.fromEntries(BANDS.map((b) => [b.id, `${b.label} · ${b.rango}`]));
