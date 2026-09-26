// Definición de columnas de la tabla de evaluación. Cada columna declara cómo obtener su valor
// (para filtrar, ordenar y exportar) y cómo pintarlo. Tipos de filtro:
//   cat   -> lista de valores (como Excel)       num  -> rango mínimo / máximo
//   multi -> lista de valores, fila con varios   text -> "contiene"
import { BAND_BY_ID, BANDS } from '/assets/js/data/bands.js';
import { escapeHtml, fmtKm, fmtMin, fmtMoney, fmtNum } from '/assets/js/ui/format.js';

export const ESTADOS = {
  pendiente: { label: 'Pendiente', icon: '○' },
  en_evaluacion: { label: 'En evaluación', icon: '◐' },
  visitado: { label: 'Visitado', icon: '●' },
  preseleccionado: { label: 'Preseleccionado', icon: '★' },
  descartado: { label: 'Descartado', icon: '✕' },
};
const ESTADO_ORDER = Object.keys(ESTADOS);

export const MODALIDAD_COLOR = { Alquiler: '#3987e5', Venta: '#d95926', Referencia: '#199e70' };
export const MODALIDAD_SHAPE = { Alquiler: 'circle', Venta: 'ring', Referencia: 'diamond' };

const na = '<span class="na">—</span>';
const calc = (v) => (v?.calculado ? '<sup class="calc" title="Calculado: precio ÷ área principal del anuncio">calc</sup>' : '');
const priceM2 = (moneda) => (r) => (r.pricing.porM2?.moneda === moneda ? r.pricing.porM2.valor : null);

export const COLUMNS = [
  {
    id: 'estado', label: 'Estado', type: 'cat', sticky: true,
    get: (r) => ESTADOS[r.review.estado].label,
    sortValue: (r) => ESTADO_ORDER.indexOf(r.review.estado),
    order: ESTADO_ORDER.map((e) => ESTADOS[e].label),
    render: (r) => `<span class="st st-${r.review.estado}"><i aria-hidden="true">${ESTADOS[r.review.estado].icon}</i>${ESTADOS[r.review.estado].label}</span>`,
  },
  {
    id: 'nombre', label: 'Almacén', type: 'text', sticky: true,
    get: (r) => r.nombre,
    search: (r) => `${r.nombre} ${r.key} ${r.direccion}`,
    render: (r) => `<span class="nm"><b>${escapeHtml(r.nombre)}</b><small>${escapeHtml(r.key)}${r.review.comentario ? ' · <span class="has-note" title="Tiene comentario">💬</span>' : ''}</small></span>`,
  },
  { id: 'distrito', label: 'Distrito', type: 'cat', get: (r) => r.distrito },
  {
    id: 'modalidad', label: 'Modalidad', type: 'cat', get: (r) => r.modalidad,
    render: (r) => `<span class="mod"><i class="shape shape-${MODALIDAD_SHAPE[r.modalidad] || 'circle'}" style="--c:${MODALIDAD_COLOR[r.modalidad] || '#888'}"></i>${escapeHtml(r.modalidad || '—')}</span>`,
  },
  { id: 'tipologia', label: 'Tipo de inmueble', type: 'cat', get: (r) => r.tipologia },
  {
    id: 'area', label: 'Área m²', type: 'num', align: 'right',
    get: (r) => r.area?.principal ?? null,
    render: (r) => (r.area ? `${fmtNum(r.area.principal)}${r.area.max !== r.area.min ? `<small class="rng" title="${escapeHtml(r.areaTexto)}">${fmtNum(r.area.min)}–${fmtNum(r.area.max)}</small>` : ''}` : na),
  },
  { id: 'precio', label: 'Precio (anuncio)', type: 'text', get: (r) => r.precioTexto, render: (r) => (r.precioTexto ? escapeHtml(r.precioTexto) : na) },
  {
    id: 'penM2', label: 'S/ por m²', type: 'num', align: 'right', get: priceM2('PEN'),
    render: (r) => (priceM2('PEN')(r) != null ? `${fmtMoney(r.pricing.porM2.valor, 'PEN').replace('S/ ', '')}${calc(r.pricing.porM2)}` : na),
  },
  {
    id: 'usdM2', label: 'USD por m²', type: 'num', align: 'right', get: priceM2('USD'),
    render: (r) => (priceM2('USD')(r) != null ? `${fmtMoney(r.pricing.porM2.valor, 'USD').replace('USD ', '')}${calc(r.pricing.porM2)}` : na),
  },
  { id: 'km', label: 'Km a planta', type: 'num', align: 'right', get: (r) => r.rutaRadar?.distanciaKm ?? null, render: (r) => (r.rutaRadar ? fmtKm(r.rutaRadar.distanciaKm).replace(' km', '') : na) },
  {
    id: 'min', label: 'Min a planta', type: 'num', align: 'right',
    get: (r) => r.rutaRadar?.duracionAjustadaMin ?? null,
    render: (r) => (r.rutaRadar ? `<b>${fmtMin(r.rutaRadar.duracionAjustadaMin).replace(' min', '')}</b>` : na),
  },
  {
    id: 'band', label: 'Rango de tiempo', type: 'cat',
    get: (r) => BAND_BY_ID[r.band]?.label ?? null,
    sortValue: (r) => BANDS.findIndex((b) => b.id === r.band),
    order: BANDS.map((b) => b.label),
    render: (r) => (BAND_BY_ID[r.band] ? `<span class="band"><i style="background:${BAND_BY_ID[r.band].color}"></i>${BAND_BY_ID[r.band].label}</span>` : na),
  },
  {
    id: 'alertas', label: 'Alertas de dato', type: 'multi', empty: 'Sin alertas',
    get: (r) => r.alertas,
    sortValue: (r) => r.alertas.length,
    render: (r) => (r.alertas.length ? r.alertas.map((a) => `<span class="alert" title="${escapeHtml(a)}">⚠ ${escapeHtml(a)}</span>`).join('') : '<span class="ok-dato">✓ Completo</span>'),
  },
  { id: 'contacto', label: 'Contacto', type: 'text', get: (r) => r.contacto, render: (r) => (r.contacto ? escapeHtml(r.contacto) : na) },
  { id: 'fuente', label: 'Fuente', type: 'cat', get: (r) => r.fuenteAnuncio },
];

export const DEFAULT_HIDDEN = ['contacto', 'fuente'];
