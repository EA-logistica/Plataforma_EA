import { esc } from '../utils/dom.js';
import { claveDestino } from '#shared/servicios.js';

/**
 * Buscador de direcciones propio, en lugar del <datalist> del navegador: el
 * datalist, una vez elegido un valor, solo muestra las opciones que empiezan
 * igual -no se podía volver a elegir otra- y no deja buscar por una palabra
 * del medio ("mastercol", "frutales").
 *
 * Al hacer clic en el campo muestra los lugares más usados; al escribir,
 * filtra por palabras clave: cada palabra tiene que coincidir con el inicio
 * de alguna palabra del lugar, sin importar tildes ni mayúsculas. "av
 * frutales" encuentra "MASTERCOL, AV. LOS FRUTALES 211, ATE".
 *
 * `fuente()` devuelve [{ direccion, usos }] y `alElegir(direccion)` recibe
 * la elegida. Se maneja con mouse, teclado (↑ ↓ Enter Esc) o táctil.
 */

const MAXIMO = 8;

/** Lugares que coinciden con `q`, los más usados primero. Sin `q`, los frecuentes. */
export function filtrarLugares(lista, q) {
  const palabras = claveDestino(q).split(' ').filter(Boolean);
  const ordenados = lista.slice().sort((a, b) => (b.usos || 0) - (a.usos || 0));
  if (!palabras.length) return ordenados.slice(0, MAXIMO);
  return ordenados.filter(d => {
    const propias = claveDestino(d.direccion).split(' ');
    return palabras.every(p => propias.some(w => w.startsWith(p)));
  }).slice(0, MAXIMO);
}

function resaltar(texto, palabras) {
  // Resalta cada palabra que empieza con algo de lo buscado (comparando sin tildes).
  return texto.split(/(\s+)/).map(w => {
    const k = claveDestino(w);
    return k && palabras.some(p => k.startsWith(p)) ? '<mark>' + esc(w) + '</mark>' : esc(w);
  }).join('');
}

export function autocompletar(input, caja, { fuente, alElegir, titulo = 'Lugares frecuentes' }) {
  let items = [];
  let activo = -1;

  function pintar() {
    const q = input.value.trim();
    items = filtrarLugares(fuente(), q);
    activo = -1;
    if (!items.length) {
      caja.innerHTML = q.length >= 3
        ? '<div class="sug-vacio">No está registrado. Escribe la dirección completa o márcala en el mapa.</div>'
        : '';
      caja.hidden = !caja.innerHTML;
      return;
    }
    const palabras = claveDestino(q).split(' ').filter(Boolean);
    caja.innerHTML = (q ? '' : '<div class="sug-titulo">' + esc(titulo) + '</div>')
      + items.map((d, i) => {
        const [nombre, ...resto] = d.direccion.split(',');
        return '<button type="button" class="sug-item" role="option" data-i="' + i + '">'
          + '<b>' + resaltar(nombre.trim(), palabras) + '</b>'
          + (resto.length ? '<small>' + resaltar(resto.join(',').trim(), palabras) + '</small>' : '')
          + '</button>';
      }).join('');
    caja.hidden = false;
  }

  function marcarActivo() {
    caja.querySelectorAll('.sug-item').forEach((b, i) => b.classList.toggle('on', i === activo));
    const b = caja.querySelector('.sug-item.on');
    if (b) b.scrollIntoView({ block: 'nearest' });
  }

  function elegir(i) {
    const d = items[i];
    if (!d) return;
    caja.hidden = true;
    alElegir(d.direccion);
  }

  input.setAttribute('autocomplete', 'off');
  input.setAttribute('role', 'combobox');
  input.addEventListener('focus', pintar);
  input.addEventListener('click', pintar);
  input.addEventListener('input', pintar);
  input.addEventListener('keydown', e => {
    if (caja.hidden) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); activo = Math.min(activo + 1, items.length - 1); marcarActivo(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); activo = Math.max(activo - 1, 0); marcarActivo(); }
    else if (e.key === 'Enter' && activo >= 0) { e.preventDefault(); elegir(activo); }
    else if (e.key === 'Escape') { caja.hidden = true; }
  });
  // mousedown y no click: con click, el blur del input cerraba la lista antes
  // de que llegara la elección.
  caja.addEventListener('mousedown', e => {
    const b = e.target.closest('.sug-item');
    if (b) { e.preventDefault(); elegir(Number(b.dataset.i)); }
  });
  input.addEventListener('blur', () => setTimeout(() => { caja.hidden = true; }, 120));
}
