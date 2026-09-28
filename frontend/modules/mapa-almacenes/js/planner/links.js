// Enlaces de navegación GPS para el conductor (se abren en el celular con la app instalada).
// Google Maps: una sola URL con todas las paradas (la app móvil admite hasta ~9 intermedias).
// Waze: solo admite UN destino por enlace, así que se genera uno por parada.
const ll = (p) => `${p.lat.toFixed(6)},${p.lon.toFixed(6)}`;
export const GMAPS_MAX_INTERMEDIAS = 9;

export function googleMapsUrl(puntos) {
  if (puntos.length < 2) return null;
  const [origen, ...resto] = puntos;
  const destino = resto[resto.length - 1];
  const intermedias = resto.slice(0, -1).slice(0, GMAPS_MAX_INTERMEDIAS);
  const params = new URLSearchParams({ api: '1', origin: ll(origen), destination: ll(destino), travelmode: 'driving' });
  if (intermedias.length) params.set('waypoints', intermedias.map(ll).join('|'));
  return `https://www.google.com/maps/dir/?${params}`;
}

export const wazeUrl = (p) => `https://waze.com/ul?ll=${encodeURIComponent(ll(p))}&navigate=yes&zoom=17`;

export const wazeEmbedUrl = ({ lat, lon, zoom = 12 }) =>
  `https://embed.waze.com/iframe?zoom=${Math.max(3, Math.min(17, Math.round(zoom)))}&lat=${lat.toFixed(5)}&lon=${lon.toFixed(5)}&ct=livemap`;

// Hoja de ruta en texto plano (para WhatsApp o para copiar).
export function hojaDeRutaTexto({ viaje, paradas, plan }) {
  const lineas = [];
  lineas.push(`*Hoja de ruta PLANSA*${viaje.nombre ? ' — ' + viaje.nombre : ''}`);
  const cab = [viaje.placa && `Camión ${viaje.placa}`, viaje.conductor && `Conductor: ${viaje.conductor}`, viaje.fecha, `Salida ${plan?.salida || viaje.salida}`].filter(Boolean);
  lineas.push(cab.join(' · '));
  if (plan) {
    lineas.push(`Total: ${plan.distanciaKm.toFixed(1)} km · fin estimado ${plan.fin} (tráfico estimado, no tiempo real)`);
    plan.cronograma.forEach((c, i) => {
      const p = c.regreso ? paradas[plan.orden[0]] : paradas[c.indice];
      const eta = c.llegada ? `ETA ${c.llegada}` : `Sale ${c.salida}`;
      lineas.push(`${i === 0 ? 'S' : c.regreso ? 'R' : i}. ${c.nombre} — ${eta}${c.servicioMin ? ` (${c.servicioMin} min)` : ''}${p ? ' — ' + wazeUrl(p) : ''}`);
    });
  } else {
    paradas.forEach((p, i) => lineas.push(`${i === 0 ? 'S' : i}. ${p.nombre} — ${wazeUrl(p)}`));
  }
  const g = googleMapsUrl(plan ? orderedPoints(paradas, plan) : paradas);
  if (g) lineas.push(`Ruta completa (Google Maps): ${g}`);
  return lineas.join('\n');
}

export function orderedPoints(paradas, plan) {
  const pts = plan.orden.map((i) => paradas[i]);
  return plan.regreso ? [...pts, pts[0]] : pts;
}
