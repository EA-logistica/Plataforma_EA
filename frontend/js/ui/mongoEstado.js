import { obtener } from '../api/cliente.js';
import { $ } from '../utils/dom.js';

/**
 * Indicador discreto del topbar: "Conectado a MongoDB · Última carga: …".
 * La fecha es la de la foto del ERP en Mongo (no la de la copia), que es la
 * que importa para saber qué tan al día están stock y valorizado. Se revisa
 * cada 5 minutos: la copia corre cada 30 (backend/mongo/sincronizar.js).
 */

const fecha = iso => new Date(iso).toLocaleDateString('es-PE', { day: 'numeric', month: 'short', year: 'numeric' });
const hora = iso => new Date(iso).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });

async function refrescar() {
  const el = $('mongoEstado');
  if (!el) return;
  let e;
  try { e = await obtener('/mongo/estado'); } catch (_) { return; }
  if (!e.configurado) { el.hidden = true; return; }

  el.hidden = false;
  el.classList.toggle('off', !e.conectado);
  $('mongoEstadoTexto').textContent = e.conectado ? 'Conectado a MongoDB' : 'MongoDB sin conexión';
  $('mongoEstadoFecha').textContent = e.fechaDatos ? ' · Última carga: ' + fecha(e.fechaDatos) : '';
  el.title = e.conectado
    ? 'Datos de productos, materia prima y stock desde MongoDB.'
      + (e.fechaDatos ? '\nFoto del ERP: ' + fecha(e.fechaDatos) + ' ' + hora(e.fechaDatos) : '')
      + (e.sincronizado ? '\nCopiado a la plataforma: ' + fecha(e.sincronizado) + ' ' + hora(e.sincronizado) : '')
    : 'No se pudo copiar desde MongoDB (¿Tailscale conectado?). Se muestra la última foto disponible.';
}

export function iniciarEstadoMongo() {
  refrescar();
  setInterval(refrescar, 5 * 60 * 1000);
}
