import { obtener, crear } from './cliente.js';

/**
 * Radar de Importaciones: /api/radar/* (backend/radar/rutas.js). Los filtros
 * viajan como query string; los vacíos no se mandan.
 */
const qs = filtros => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(filtros || {})) if (v !== '' && v != null && v !== false) p.set(k, v);
  const s = p.toString();
  return s ? '?' + s : '';
};

export const estadoRadar = () => obtener('/radar/estado');
export const panelRadar = f => obtener('/radar/panel' + qs(f));
export const historicoRadar = f => obtener('/radar/historico' + qs(f));
export const operacionesRadar = f => obtener('/radar/operaciones' + qs(f));
export const operacionRadar = id => obtener('/radar/operaciones/' + encodeURIComponent(id));
export const revisarOperacionRadar = (id, datos) => crear('/radar/operaciones/' + encodeURIComponent(id) + '/revision', datos);
export const productosRadar = f => obtener('/radar/productos' + qs(f));
export const empresasRadar = f => obtener('/radar/empresas' + qs(f));
export const empresaRadar = (ruc, f) => obtener('/radar/empresas/' + encodeURIComponent(ruc) + qs(f));
export const opcionesRadar = () => obtener('/radar/opciones');
export const calidadRadar = () => obtener('/radar/calidad');
export const encolarRadar = datos => crear('/radar/ejecuciones', datos);
export const reanudarRadar = id => crear('/radar/ejecuciones/' + encodeURIComponent(id) + '/reanudar');

/** CSV de Explorar: binario, se pide crudo para leer el archivo. */
export async function exportarRadar(f) {
  const res = await obtener('/radar/operaciones/exportar' + qs(f), { crudo: true });
  if (!res.ok) {
    let mensaje = 'Error ' + res.status + ' al exportar.';
    try { const d = await res.json(); if (d && d.error) mensaje = d.error; } catch (_) { /* sin JSON */ }
    throw new Error(mensaje);
  }
  return res.blob();
}
