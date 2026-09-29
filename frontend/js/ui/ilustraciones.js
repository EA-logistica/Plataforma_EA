/**
 * Ilustraciones de las modalidades del formulario (Envíos / Transporte /
 * Cargo), en el estilo de las apps de reparto: un vehículo reconocible en
 * miniatura, a color. Son SVG propios, en línea: no dependen de imágenes
 * externas ni de la CSP. Los colores son fijos a propósito -es un dibujo, no
 * interfaz- y se leen igual en tema claro y oscuro sobre su fondo propio.
 */

const RUEDA = (cx, cy, r) =>
  `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#23262B"/><circle cx="${cx}" cy="${cy}" r="${r * 0.45}" fill="#D9DCE1"/>`;

export const ILUSTRACIONES = {
  // Moto roja con caja de cartón: envíos y recojos.
  'Envíos': `<svg viewBox="0 0 120 72" aria-hidden="true">
    <ellipse cx="62" cy="66" rx="50" ry="3.5" fill="#000" opacity=".12"/>
    <rect x="8" y="26" width="34" height="30" rx="2.5" fill="#D9A45B"/>
    <rect x="8" y="26" width="34" height="7" fill="#C38E47"/>
    <path d="M22 36v10M19 39l3-3 3 3M28 36v10M25 39l3-3 3 3" stroke="#3A2A14" stroke-width="1.6" fill="none" stroke-linecap="round"/>
    <path d="M44 50h30l10-14h10" stroke="#23262B" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M48 36h24c6 0 9 4 9 9v5H46z" fill="#E03A2F"/>
    <path d="M52 30h16c3 0 4 2 4 6H50c0-4 0-6 2-6z" fill="#2B2E33"/>
    <path d="M86 26l6-4M92 22h8" stroke="#23262B" stroke-width="3.2" stroke-linecap="round"/>
    <rect x="94" y="30" width="7" height="9" rx="2" fill="#E03A2F"/>
    ${RUEDA(52, 56, 10)}${RUEDA(98, 56, 10)}
  </svg>`,

  // Auto particular blanco con franja roja: transporte de personas.
  'Transporte': `<svg viewBox="0 0 120 72" aria-hidden="true">
    <ellipse cx="60" cy="66" rx="52" ry="3.5" fill="#000" opacity=".12"/>
    <path d="M10 50v-9c0-4 3-6 7-7l14-3 14-11c3-2 6-3 10-3h22c5 0 8 2 11 5l10 11 7 2c4 1 6 4 6 8v7z" fill="#F4F5F7" stroke="#C9CDD3" stroke-width="1.2"/>
    <path d="M48 23c2-2 5-3 8-3h9v14H38z" fill="#2E3238"/>
    <path d="M69 20h9c3 0 5 1 7 3l8 11H69z" fill="#2E3238"/>
    <path d="M60 34l10 16H56L46 34z" fill="#E03A2F"/>
    <rect x="104" y="40" width="6" height="4" rx="1.5" fill="#F2C94C"/>
    <rect x="11" y="40" width="5" height="4" rx="1.5" fill="#E03A2F"/>
    ${RUEDA(30, 52, 10)}${RUEDA(90, 52, 10)}
  </svg>`,

  // Camión de carga con furgón rojo: cargo y fletes.
  'Cargo': `<svg viewBox="0 0 120 72" aria-hidden="true">
    <ellipse cx="60" cy="66" rx="54" ry="3.5" fill="#000" opacity=".12"/>
    <rect x="6" y="10" width="72" height="42" rx="3" fill="#E54B3C"/>
    <path d="M30 22v16M26 26l4-4 4 4M40 22v16M36 26l4-4 4 4" stroke="#fff" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M30 42c3 3 7 3 10 0" stroke="#fff" stroke-width="2.4" fill="none" stroke-linecap="round"/>
    <path d="M80 24h18c3 0 5 1 7 4l7 11c1 2 2 4 2 6v7H80z" fill="#F4F5F7" stroke="#C9CDD3" stroke-width="1.2"/>
    <path d="M86 28h11c2 0 3 1 4 2l5 8H86z" fill="#2E3238"/>
    <rect x="4" y="50" width="112" height="5" rx="2" fill="#2B2E33"/>
    ${RUEDA(24, 56, 9)}${RUEDA(44, 56, 9)}${RUEDA(98, 56, 9)}
  </svg>`
};
