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

export function fechaCorta(iso) {
  if (!iso) return '—';
  // "2025-01-02" (solo fecha) se lee tal cual: new Date() la toma como
  // medianoche UTC y en Lima (UTC-5) se pintaba el día anterior.
  if (typeof iso === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4);
  const d = new Date(iso);
  if (isNaN(d)) return '—';
  return pad(d.getDate(), 2) + '/' + pad(d.getMonth() + 1, 2) + '/' + d.getFullYear();
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
