import { $ } from '../utils/dom.js';
import * as api from '../api/estado.js';

/**
 * Control de Almacenes: mapa, radar y plano (otro repositorio,
 * ALMACEN-LOS-OLIVOS, integrado acá dentro) como pestañas nativas de PLANSA,
 * no como una página aparte con su propio logo y su propia barra de
 * navegación -eso es justo lo que había antes y se sentía "pegado", no
 * parte de la plataforma-. Cada módulo sigue viviendo en su propio iframe
 * (siguen siendo documentos HTML aparte, con su propio JS), pero quien elige
 * cuál se ve es esta pestaña, con el mismo look que el resto de PLANSA.
 *
 * Dos maneras de encajar cada iframe (ver .modo-fill/.modo-auto en
 * styles.css), porque "mapa" y "radar" son apps de una sola pantalla y
 * "plano" es una página larga común:
 *   fill  el iframe ocupa el resto del alto visible; el módulo scrollea su
 *         propio contenido (su sidebar), la página de PLANSA no scrollea acá.
 *   auto  el iframe mide su propio contenido (mismo origen, se puede) y toma
 *         esa altura exacta -nada de scrollbar propia-; scrollea la página.
 */
const MODULOS = [
  { id: 'mapa', nombre: 'Mapa de Almacenes', src: '/modules/mapa-almacenes/', modo: 'fill' },
  // Radar, a diferencia de Mapa, no es una app de una sola pantalla -su
  // propio body es overflow-y:auto, una página larga como Plano-, así que va
  // en modo 'auto' (se mide y toma su altura real) y no 'fill'.
  { id: 'radar', nombre: 'Radar Naranjal', src: '/modules/radar-naranjal/', modo: 'auto' },
  { id: 'plano', nombre: 'Almacén Los Olivos', src: '/modules/almacen-los-olivos/layout%20almacen%20los%20olivos.html', modo: 'auto' },
];

const iframes = new Map();
let sesionLista = false;
let moduloActual = 'mapa';

/**
 * Canjea el ticket con un fetch, sin mostrar el shell ajeno (ver
 * backend/almacen/acceso.js): la cookie httpOnly queda puesta igual por el
 * Set-Cookie de la respuesta -el navegador la guarda aunque nunca se pinte
 * esa página-, y de ahí en más /modules/* la acepta directo.
 */
async function asegurarSesion() {
  if (sesionLista) return true;
  try {
    const { ticket } = await api.emitirTicketAlmacen();
    await fetch('/almacen/?ticket=' + encodeURIComponent(ticket));
    sesionLista = true;
    return true;
  } catch (e) {
    $('almacenError').textContent = 'No se pudo abrir el módulo de Almacén: ' + e.message;
    $('almacenError').classList.add('on');
    return false;
  }
}

/** "plano" es una página común y corriente: se le mide el contenido -mismo
 * origen, se puede- y el iframe toma esa altura exacta, sin su propia
 * scrollbar. Con ResizeObserver porque el formulario cambia de alto solo
 * (agregar un vehículo, cambiar de sub-pestaña interna). */
function ajustarAlContenido(f) {
  const medir = () => {
    try {
      const alto = f.contentDocument.documentElement.scrollHeight;
      if (alto > 0) f.style.height = alto + 'px';
    } catch (e) { /* por si alguna vez deja de ser same-origin */ }
  };
  f.addEventListener('load', () => {
    medir();
    try {
      new ResizeObserver(medir).observe(f.contentDocument.documentElement);
    } catch (e) { /* ResizeObserver no disponible: se queda con la primera medida */ }
  });
}

function mostrar(id) {
  moduloActual = id;
  const mod = MODULOS.find(m => m.id === id);
  $('almacenFrames').classList.toggle('modo-fill', mod.modo === 'fill');
  $('almacenFrames').classList.toggle('modo-auto', mod.modo === 'auto');
  iframes.forEach((f, key) => { f.style.display = key === id ? 'block' : 'none'; });
  document.querySelectorAll('[data-almacen-tab]').forEach(b => b.classList.toggle('on', b.dataset.almacenTab === id));
}

export async function abrirAlmacen() {
  if (!(await asegurarSesion())) return;
  $('almacenError').classList.remove('on');
  if (!iframes.has(moduloActual)) crearFrame(moduloActual);
  mostrar(moduloActual);
}

export async function verModuloAlmacen(id) {
  if (!(await asegurarSesion())) return;
  $('almacenError').classList.remove('on');
  if (!iframes.has(id)) crearFrame(id);
  mostrar(id);
}

function crearFrame(id) {
  const mod = MODULOS.find(m => m.id === id);
  const f = document.createElement('iframe');
  f.title = mod.nombre;
  f.src = mod.src;
  f.style.display = 'none';
  if (mod.modo === 'auto') ajustarAlContenido(f);
  $('almacenFrames').appendChild(f);
  iframes.set(id, f);
}
