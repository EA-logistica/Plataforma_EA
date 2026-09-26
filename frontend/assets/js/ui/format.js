// Formato y escape de datos para la interfaz.
export const NA = 'No disponible';

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

// Valor o "No disponible" (ya escapado).
export const orNA = (v) => (v == null || v === '' ? `<span class="na">${NA}</span>` : escapeHtml(v));

const nf = (d) => new Intl.NumberFormat('es-PE', { minimumFractionDigits: d, maximumFractionDigits: d });
export const fmtNum = (n, d = 0) => nf(d).format(n);
export const fmtKm = (km) => `${fmtNum(km, km < 10 ? 1 : 0)} km`;
export const fmtMin = (min) => `${fmtNum(Math.max(1, Math.round(min)))} min`;
export const fmtArea = (a) => `${fmtNum(a)} m²`;
export const fmtMoney = (v, moneda) => `${moneda === 'USD' ? 'USD' : 'S/'} ${fmtNum(v, v < 100 ? 2 : 0)}`;

export const FUENTE_UBICACION = {
  manual: 'Coordenadas verificadas (manual)',
  'datos-existentes': 'Coordenadas de la data existente (Radar)',
  geocodificacion: 'Geocodificación de la dirección',
};
