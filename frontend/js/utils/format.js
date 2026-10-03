/**
 * Formateo de números, moneda y fechas usado en toda la aplicación.
 */
export const pad = (n, l = 3) => String(n).padStart(l, '0');

/** Solo el número de un correlativo: 'REQ-007' -> '007'. */
export const numeroTicket = id => String(id || '').replace(/^REQ-/i, '');

export const soles = n => 'S/ ' + (Number(n) || 0).toLocaleString('es-PE', {
  minimumFractionDigits: 2, maximumFractionDigits: 2
});
export const solesK = n => 'S/ ' + Math.round(Number(n) || 0).toLocaleString('es-PE');

export const isoDia = d => {
  const x = new Date(d);
  return x.getFullYear() + '-' + pad(x.getMonth() + 1, 2) + '-' + pad(x.getDate(), 2);
};
export const hoyISO = () => isoDia(new Date());

/**
 * Formato único de fecha de la plataforma: "02-oct-26". Corto, sin
 * ambigüedad día/mes (el mes va en letras) y del mismo ancho en las tablas.
 */
export const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'set', 'oct', 'nov', 'dic'];
export function fechaCorta(iso) {
  if (!iso) return '—';
  // "2025-01-02" (solo fecha) se lee tal cual: new Date() la toma como
  // medianoche UTC y en Lima (UTC-5) se pintaba el día anterior.
  if (typeof iso === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso.slice(8, 10) + '-' + MESES[Number(iso.slice(5, 7)) - 1] + '-' + iso.slice(2, 4);
  const d = new Date(iso);
  if (isNaN(d)) return '—';
  return pad(d.getDate(), 2) + '-' + MESES[d.getMonth()] + '-' + String(d.getFullYear()).slice(2);
}

/** "2026-10" → "oct 26" (ejes de gráficos por mes). */
export const mesCorto = ym => (ym ? MESES[Number(ym.slice(5, 7)) - 1] + ' ' + ym.slice(2, 4) : '—');

// ---------------------------------------------------------------- montos
// Un solo formato de moneda en toda la plataforma: "US$ 1,234" / "S/ 1,234.50".
export const usd = (n, decimales = 0) => (n == null || !Number.isFinite(Number(n)) ? '—'
  : 'US$ ' + Number(n).toLocaleString('es-PE', { minimumFractionDigits: decimales, maximumFractionDigits: decimales }));
/** Para tarjetas y ejes: "US$ 1.4 M", "US$ 351 mil". */
export function usdCorto(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  const a = Math.abs(n);
  if (a >= 1e6) return 'US$ ' + (n / 1e6).toLocaleString('es-PE', { maximumFractionDigits: 1 }) + ' M';
  if (a >= 1e4) return 'US$ ' + Math.round(n / 1e3).toLocaleString('es-PE') + ' mil';
  return usd(n);
}
export const entero = n => (n == null || !Number.isFinite(Number(n)) ? '—' : Math.round(Number(n)).toLocaleString('es-PE'));
export const decimal = (n, d = 1) => (n == null || !Number.isFinite(Number(n)) ? '—' : Number(n).toLocaleString('es-PE', { minimumFractionDigits: d, maximumFractionDigits: d }));
/** 0.8056 → "80.6%". */
export const pct = (fraccion, d = 0) => (fraccion == null || !Number.isFinite(Number(fraccion)) ? '—' : decimal(fraccion * 100, d) + '%');

/** "hace 5 min", "hace 2 h", "hace 3 días": cuánto tiene un dato. */
export function haceCuanto(iso, ahora = Date.now()) {
  const t = iso ? new Date(iso).getTime() : NaN;
  if (!Number.isFinite(t)) return '';
  const min = Math.max(0, Math.round((ahora - t) / 60000));
  if (min < 1) return 'hace un momento';
  if (min < 60) return 'hace ' + min + ' min';
  const h = Math.round(min / 60);
  if (h < 24) return 'hace ' + h + ' h';
  const d = Math.round(h / 24);
  return 'hace ' + d + (d === 1 ? ' día' : ' días');
}

export function fechaHora(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return '—';
  return fechaCorta(iso) + ' ' + pad(d.getHours(), 2) + ':' + pad(d.getMinutes(), 2);
}

export function horasEntre(a, b) {
  if (!a || !b) return null;
  return (new Date(b) - new Date(a)) / 3600000;
}

export function corta(t, n) {
  t = String(t || '');
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}
