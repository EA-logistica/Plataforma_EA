/**
 * Menú de logística: un cajón que se abre desde #btnMenu (arriba a la
 * izquierda) y se cierra al elegir una sección, con Escape o tocando fuera.
 * Cerrado queda `inert`: fuera de pantalla no debe recibir foco con Tab.
 */
function ponerMenu(abierto) {
  const nav = document.getElementById('adminNav');
  if (!nav) return;
  nav.classList.toggle('abierto', abierto);
  nav.inert = !abierto;
  const velo = document.getElementById('navScrim');
  if (velo) velo.classList.toggle('on', abierto);
  const boton = document.getElementById('btnMenu');
  if (boton) {
    boton.classList.toggle('on', abierto);
    boton.setAttribute('aria-expanded', String(abierto));
  }
  if (abierto) {
    const actual = nav.querySelector('.nav-item.on') || nav.querySelector('.nav-item');
    if (actual) actual.focus();
  }
}

export function alternarMenu() {
  const nav = document.getElementById('adminNav');
  ponerMenu(!(nav && nav.classList.contains('abierto')));
}

export function cerrarMenu() {
  const nav = document.getElementById('adminNav');
  if (!nav || !nav.classList.contains('abierto')) return;
  ponerMenu(false);
  const boton = document.getElementById('btnMenu');
  if (boton) boton.focus();
}

/**
 * Grupo colapsable del menú (por ahora solo "Compras y Logística"). Se
 * recuerda abierto/cerrado en localStorage: es una preferencia de pantalla
 * de este navegador, no un dato de negocio.
 */
const CLAVE = 'plansa_nav_colapsado';

function leer() {
  try { return JSON.parse(localStorage.getItem(CLAVE) || '{}'); } catch (e) { return {}; }
}

export function toggleNavGroup(id) {
  const el = document.getElementById(id);
  if (!el) return;
  const cerrado = el.classList.toggle('colapsado');
  const estado = leer();
  estado[id] = cerrado;
  try { localStorage.setItem(CLAVE, JSON.stringify(estado)); } catch (e) { /* modo privado: se ignora */ }
}

export function restaurarNavGroups() {
  const estado = leer();
  Object.keys(estado).forEach(id => {
    const el = document.getElementById(id);
    if (el && estado[id]) el.classList.add('colapsado');
  });
}
