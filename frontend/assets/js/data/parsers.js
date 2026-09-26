// Interpretación de campos de texto libre de la data original (área, precio) para poder filtrar.
// Los valores originales se siguen mostrando tal cual; lo interpretado solo se usa para filtros/cálculos.

// Números con separador de miles "1,844" o simples "898" / "7.00".
const NUMBER = /\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g;
const toNumber = (s) => parseFloat(s.replace(/,/g, ''));

// "898 / 912 / 1,844 (naves divisibles)" -> { principal: 898, min: 898, max: 1844 }
export function parseArea(raw) {
  if (raw == null || raw === '') return null;
  const nums = (String(raw).match(NUMBER) || []).map(toNumber).filter((n) => n >= 10);
  if (!nums.length) return null;
  return { principal: nums[0], min: Math.min(...nums), max: Math.max(...nums) };
}

// "S/ 18,500/mes" -> { moneda:'PEN', monto:18500, unidad:'mes' }
// "USD 7.00/m² + IGV" -> { moneda:'USD', monto:7, unidad:'m2' }
// "Consultar precio" / null -> null
export function parsePrice(raw) {
  if (raw == null || raw === '') return null;
  const s = String(raw);
  const moneda = /\bUSD\b|US\$|\$/i.test(s) ? 'USD' : /S\/|\bPEN\b|\bsoles?\b/i.test(s) ? 'PEN' : null;
  const m = s.match(NUMBER);
  if (!moneda || !m) return null;
  const unidad = /\/\s*m(²|2)/i.test(s) ? 'm2' : /\/\s*mes|mensual/i.test(s) ? 'mes' : 'total';
  return { moneda, monto: toNumber(m[0]), unidad };
}

// Precio mensual total y precio por m², indicando si son dato directo del anuncio o cálculo derivado.
// Cálculo: precio/m² = precio mensual ÷ área principal (primer valor del anuncio), y viceversa.
export function derivePricing(price, area) {
  if (!price) return { mensual: null, porM2: null };
  const out = { mensual: null, porM2: null };
  if (price.unidad === 'mes') {
    out.mensual = { valor: price.monto, moneda: price.moneda, calculado: false };
    if (area?.principal) out.porM2 = { valor: price.monto / area.principal, moneda: price.moneda, calculado: true };
  } else if (price.unidad === 'm2') {
    out.porM2 = { valor: price.monto, moneda: price.moneda, calculado: false };
    if (area?.principal) out.mensual = { valor: price.monto * area.principal, moneda: price.moneda, calculado: true };
  }
  return out;
}

// Tipología a partir del título del anuncio (la data no trae un campo específico para esto).
const TIPOLOGIAS = [
  [/\bnaves?\b/i, 'Nave industrial'],
  [/\bterreno|\blotes?\b/i, 'Terreno / lotes'],
  [/almac[eé]n|almacenes/i, 'Almacén'],
  [/\blocal\b/i, 'Local industrial'],
];
export function tipologiaFromTitle(title) {
  for (const [re, label] of TIPOLOGIAS) if (re.test(title || '')) return label;
  return 'No especificado';
}

// Provincia según el distrito (Lima Metropolitana / Provincia Constitucional del Callao).
const CALLAO = ['callao', 'bellavista', 'carmen de la legua', 'carmen de la legua reynoso', 'la perla', 'la punta', 'ventanilla', 'mi peru'];
const LIMA = ['ancon', 'ate', 'barranco', 'brena', 'carabayllo', 'chaclacayo', 'chorrillos', 'cieneguilla', 'comas', 'el agustino', 'independencia', 'jesus maria', 'la molina', 'la victoria', 'lima', 'cercado de lima', 'lince', 'los olivos', 'lurigancho', 'chosica', 'lurin', 'magdalena del mar', 'miraflores', 'pachacamac', 'pucusana', 'pueblo libre', 'puente piedra', 'punta hermosa', 'punta negra', 'rimac', 'san bartolo', 'san borja', 'san isidro', 'san juan de lurigancho', 'san juan de miraflores', 'san luis', 'san martin de porres', 'san miguel', 'santa anita', 'santa maria del mar', 'santa rosa', 'santiago de surco', 'surco', 'surquillo', 'villa el salvador', 'villa maria del triunfo'];
export const normalize = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
export function provinciaFromDistrito(distrito) {
  const d = normalize(distrito);
  if (!d) return null;
  if (CALLAO.includes(d)) return 'Callao';
  if (LIMA.includes(d)) return 'Lima';
  return null;
}

// Primer celular peruano (9 dígitos que empiezan con 9), mismo criterio que el Radar.
export function extractPhone(s) {
  const m = String(s ?? '').match(/9\d{8}/);
  return m ? m[0] : null;
}

export function safeUrl(u) {
  try {
    const url = new URL(u);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

// Distancia en línea recta (km) — referencia geométrica, no es distancia vial.
export function haversineKm(a, b) {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
