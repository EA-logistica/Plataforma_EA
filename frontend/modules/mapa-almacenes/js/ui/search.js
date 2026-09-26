// Búsqueda por nombre, dirección, distrito, zona, fuente o código (clave del registro).
// Filtra en vivo y ofrece sugerencias; al elegir un resultado el mapa se desplaza a su ubicación.
import { normalize } from '/assets/js/data/parsers.js';
import { escapeHtml } from '/assets/js/ui/format.js';

export function initSearch({ input, list, items, onQuery, onPick }) {
  let active = -1;
  let current = [];
  let timer;

  const close = () => {
    list.hidden = true;
    active = -1;
    input.setAttribute('aria-expanded', 'false');
  };

  function suggest() {
    const tokens = normalize(input.value).split(/\s+/).filter(Boolean);
    current = tokens.length ? items.filter((i) => tokens.every((t) => i.textoBusqueda.includes(t))).slice(0, 7) : [];
    if (!current.length) {
      list.innerHTML = tokens.length ? '<li class="sg-empty">Sin coincidencias</li>' : '';
      list.hidden = !tokens.length;
      return;
    }
    list.innerHTML = current
      .map(
        (i, idx) => `<li role="option" id="sg-${idx}" data-idx="${idx}">
          <b>${escapeHtml(i.nombre || i.key)}</b>
          <span>${escapeHtml([i.distrito, i.modalidad, i.key].filter(Boolean).join(' · '))}</span>
        </li>`
      )
      .join('');
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  }

  function paint() {
    list.querySelectorAll('li[data-idx]').forEach((li) => li.classList.toggle('active', +li.dataset.idx === active));
    if (active >= 0) input.setAttribute('aria-activedescendant', `sg-${active}`);
  }

  function pick(item) {
    close();
    onPick(item);
  }

  input.addEventListener('input', () => {
    suggest();
    clearTimeout(timer);
    timer = setTimeout(() => onQuery(input.value.trim()), 250);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!current.length) return;
      e.preventDefault();
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + current.length) % current.length;
      paint();
    } else if (e.key === 'Enter') {
      const item = current[active >= 0 ? active : 0];
      if (item) {
        e.preventDefault();
        pick(item);
      }
    } else if (e.key === 'Escape') {
      close();
    }
  });
  input.addEventListener('focus', () => input.value && suggest());
  list.addEventListener('mousedown', (e) => {
    const li = e.target.closest('li[data-idx]');
    if (li) {
      e.preventDefault();
      pick(current[+li.dataset.idx]);
    }
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search')) close();
  });
}
