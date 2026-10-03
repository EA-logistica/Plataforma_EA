import { esc } from '../utils/dom.js';
import { fechaHora, haceCuanto } from '../utils/format.js';
import { obtener } from '../api/cliente.js';

/**
 * "Actualizado hace 12 min": de cuándo es el dato que se está viendo. Va en
 * la cabecera de cada panel que muestra datos del ERP / bot, para que nadie
 * tome una foto de ayer como si fuera de ahora.
 *
 * sello(iso, fuente) devuelve el HTML; un solo reloj (iniciarFrescura)
 * refresca el texto de todos los sellos cada 30 s. Si el dato tiene más de
 * `viejoMin` minutos, el sello se marca en ámbar.
 */
export function sello(iso, fuente = '', { viejoMin = 90 } = {}) {
  if (!iso) return '<span class="sello sello-viejo" title="Sin fecha de actualización">Sin datos de actualización</span>';
  const viejo = Date.now() - new Date(iso).getTime() > viejoMin * 60000;
  return '<span class="sello' + (viejo ? ' sello-viejo' : '') + '" data-ts="' + esc(iso) + '" data-viejo="' + viejoMin + '" title="'
    + esc((fuente ? fuente + ' · ' : '') + fechaHora(iso)) + '"><i></i>Actualizado ' + esc(haceCuanto(iso)) + '</span>';
}

function refrescar() {
  document.querySelectorAll('.sello[data-ts]').forEach(s => {
    const iso = s.getAttribute('data-ts');
    s.lastChild.textContent = 'Actualizado ' + haceCuanto(iso);
    s.classList.toggle('sello-viejo', Date.now() - new Date(iso).getTime() > Number(s.getAttribute('data-viejo') || 90) * 60000);
  });
}

export function iniciarFrescura() {
  setInterval(refrescar, 30000);
}

/** Cuándo se copió por última vez el ERP / bot (indicador público de Mongo). */
let ultima = null;
export async function fechaSincronizacion() {
  try {
    const e = await obtener('/mongo/estado');
    ultima = e.sincronizado || e.fechaDatos || ultima;
  } catch (_) { /* sin servidor: se queda la que había */ }
  return ultima;
}
