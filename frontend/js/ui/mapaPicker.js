import { $, esc } from '../utils/dom.js';
import { obtener } from '../api/cliente.js';
import { toast } from '../utils/toast.js';

/**
 * Selector de ubicación en el mapa, al estilo de las apps de taxi: el pin
 * queda fijo al centro y se mueve el mapa debajo. Al soltarlo se pide la
 * dirección de ese punto (GET /api/mapa/inverso) y "Usar esta ubicación"
 * devuelve { lat, lng, direccion } a quien lo abrió.
 *
 * Leaflet (frontend/vendor/leaflet) se carga recién la primera vez que se
 * abre: quien no usa el mapa no paga su peso. Las teselas pasan por el propio
 * servidor (rutas/mapa.js), con caché, así el navegador no habla con nadie
 * de afuera y la CSP no se abre.
 */

const LIMA = [-12.0464, -77.0428];
let mapa = null;
let alConfirmar = null;
let elegido = null;
let temporizador = null;
let pedidoActual = 0;

function cargarLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  return new Promise((resolve, reject) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = '/vendor/leaflet/leaflet.css';
    document.head.appendChild(css);
    const js = document.createElement('script');
    js.src = '/vendor/leaflet/leaflet.js';
    js.onload = () => resolve(window.L);
    js.onerror = () => reject(new Error('No se pudo cargar el mapa.'));
    document.head.appendChild(js);
  });
}

function pintarDireccion(texto, listo) {
  $('mapaDireccion').textContent = texto;
  $('mapaConfirmar').disabled = !listo;
}

/** Tras mover el mapa: espera a que se quede quieto y pregunta la dirección del centro. */
function alMover() {
  const c = mapa.getCenter();
  elegido = { lat: c.lat, lng: c.lng, direccion: '' };
  pintarDireccion('Buscando la dirección…', false);
  clearTimeout(temporizador);
  temporizador = setTimeout(async () => {
    const n = ++pedidoActual;
    let r = null;
    try { r = await obtener('/mapa/inverso?lat=' + c.lat.toFixed(6) + '&lng=' + c.lng.toFixed(6)); } catch (_) { /* sin dirección: queda el GPS */ }
    if (n !== pedidoActual) return; // el mapa ya se movió otra vez
    const gps = c.lat.toFixed(6) + ', ' + c.lng.toFixed(6);
    elegido.direccion = (r && (r.nombre || r.etiqueta)) || 'Punto GPS ' + gps;
    pintarDireccion(elegido.direccion, true);
  }, 650);
}

/**
 * Abre el mapa. `inicial` es el punto ya elegido antes (si lo hay) y
 * `confirmar` recibe { lat, lng, direccion } al aceptar.
 */
export async function abrirSelectorMapa({ titulo, inicial, confirmar }) {
  alConfirmar = confirmar;
  $('mapaTitulo').textContent = titulo;
  $('mapaResultados').innerHTML = '';
  $('mapaBuscar').value = '';
  $('overlayMapa').classList.add('on');

  let L;
  try { L = await cargarLeaflet(); } catch (e) { toast('Mapa no disponible', e.message, 'bad'); cerrarSelectorMapa(); return; }

  const centro = inicial ? [inicial.lat, inicial.lng] : LIMA;
  if (!mapa) {
    mapa = L.map('mapaLienzo', { zoomControl: true, attributionControl: true }).setView(centro, inicial ? 17 : 12);
    // Calles de Esri: las teselas de OpenStreetMap bloquean a los servidores
    // sin acuerdo de uso (ver almacen/src/services/tiles.js), Esri no.
    const capa = L.tileLayer('/api/mapa/tiles/esri-calles/{z}/{x}/{y}', {
      maxZoom: 19, attribution: 'Mapa © Esri · Direcciones © OpenStreetMap'
    }).addTo(mapa);
    // Sin esto, un servidor que no sirve teselas (sin internet, o sin
    // reiniciar tras una actualización) dejaba el mapa gris sin explicación.
    let fallos = 0;
    capa.on('tileerror', () => { if (++fallos >= 4) $('mapaAviso').hidden = false; });
    capa.on('tileload', () => { fallos = 0; $('mapaAviso').hidden = true; });
    mapa.on('moveend', alMover);
  } else {
    mapa.setView(centro, inicial ? 17 : 12);
  }
  // El contenedor estaba oculto (display:none) al crearse: sin esto Leaflet
  // calcula mal su tamaño y pinta el mapa a medias.
  setTimeout(() => { mapa.invalidateSize(); alMover(); }, 60);
  setTimeout(() => $('mapaBuscar').focus(), 80);
}

export function cerrarSelectorMapa() {
  $('overlayMapa').classList.remove('on');
  clearTimeout(temporizador);
}

export function confirmarSelectorMapa() {
  if (!elegido || !elegido.direccion) return;
  const r = { lat: Math.round(elegido.lat * 1e6) / 1e6, lng: Math.round(elegido.lng * 1e6) / 1e6, direccion: elegido.direccion };
  cerrarSelectorMapa();
  if (alConfirmar) alConfirmar(r);
}

export async function buscarEnMapa() {
  const q = $('mapaBuscar').value.trim();
  const caja = $('mapaResultados');
  if (q.length < 3) { caja.innerHTML = '<div class="vacio">Escribe al menos 3 caracteres.</div>'; return; }
  caja.innerHTML = '<div class="vacio">Buscando…</div>';
  let r;
  try { r = await obtener('/mapa/buscar?q=' + encodeURIComponent(q)); } catch (e) {
    caja.innerHTML = '<div class="vacio">' + esc(e.message) + '</div>';
    return;
  }
  const lista = (r && r.resultados) || [];
  if (!lista.length) { caja.innerHTML = '<div class="vacio">Sin resultados. Prueba con la avenida y el distrito, o mueve el mapa a mano.</div>'; return; }
  caja.innerHTML = lista.map((p, i) => '<button type="button" data-i="' + i + '">' + esc(p.nombre || p.etiqueta)
    + '<small>' + esc(p.etiqueta || '') + '</small></button>').join('');
  caja.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
    const p = lista[Number(b.dataset.i)];
    caja.innerHTML = '';
    mapa.setView([p.lat, p.lon], 17);
  }));
}

export function miUbicacion() {
  // El navegador solo da el GPS en un origen seguro: HTTPS (el link de
  // Tailscale Serve) o esta misma PC. Por http://192.168… lo niega siempre.
  if (!window.isSecureContext || !navigator.geolocation) {
    toast('Ubicación no disponible', 'El navegador solo comparte tu GPS por HTTPS. Busca la dirección o mueve el mapa hasta el punto.', 'warn');
    return;
  }
  navigator.geolocation.getCurrentPosition(
    p => mapa && mapa.setView([p.coords.latitude, p.coords.longitude], 17),
    () => toast('Sin permiso de ubicación', 'Activa el permiso de ubicación del navegador o busca la dirección.', 'warn'),
    { enableHighAccuracy: true, timeout: 10000 }
  );
}
