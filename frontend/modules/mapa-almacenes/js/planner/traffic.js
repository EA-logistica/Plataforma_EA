// Tráfico: tres fuentes, de la más simple a la más completa.
//  1. Estimado (siempre): perfil horario de Lima que usa el backend para los ETA. NO es tiempo real.
//  2. Waze Live Map (sin key): iframe oficial embed.waze.com centrado en la vista actual del mapa.
//  3. TomTom Traffic Flow + incidentes (plan gratuito, requiere TOMTOM_API_KEY en el servidor):
//     capa superpuesta sobre el mapa, servida por el proxy /almacen/api/tiles/tomtom-*.
import { escapeHtml } from '/assets/js/ui/format.js';
import { wazeEmbedUrl } from './links.js';

const TILES = '/almacen/api/tiles';
const REFRESH_MS = 3 * 60 * 1000;
const DIA = { laborable: 'Lunes a viernes', sabado: 'Sábado', domingo: 'Domingo' };

const tipoHoy = () => {
  const d = new Date(Date.now() - 5 * 3600000).getUTCDay();
  return d === 0 ? 'domingo' : d === 6 ? 'sabado' : 'laborable';
};

export function initTraffic({ map, panel, toggleBtn, badge, wazePanel, config }) {
  const tomtom = !!config?.trafico?.tomtom?.disponible;
  const estimado = config?.trafico?.estimado;
  const on = { flow: false, incid: false, waze: false };
  let timer = null;

  function sourceLabel() {
    const live = [on.flow && 'TomTom flujo', on.incid && 'TomTom incidentes', on.waze && 'Waze'].filter(Boolean);
    return live.length ? `En vivo: ${live.join(' + ')}` : 'Estimado por hora (no tiempo real)';
  }

  function paintBadge() {
    const live = on.flow || on.incid || on.waze;
    badge.textContent = live ? '● Tráfico en vivo' : 'Tráfico: estimado';
    badge.classList.toggle('live', live);
    badge.title = sourceLabel();
    panel.querySelector('.tf-active').textContent = sourceLabel();
    toggleBtn.classList.toggle('on', live || !panel.hidden);
  }

  function perfilHoy() {
    if (!estimado?.perfil) return '';
    if (estimado.factorFijo) return `<p class="tf-note">Factor fijo ×${escapeHtml(estimado.factorFijo)} (TRAFFIC_FACTOR del servidor).</p>`;
    const dia = tipoHoy();
    const now = new Date(Date.now() - 5 * 3600000);
    const h = now.getUTCHours() + now.getUTCMinutes() / 60;
    const filas = (estimado.perfil[dia] || []).map(([a, b, f, et]) => `<tr class="${h >= a && h < b ? 'now' : ''}">
        <td class="mono">${String(a).padStart(2, '0')}–${String(b).padStart(2, '0')} h</td><td>${escapeHtml(et)}</td>
        <td><span class="pl-tf ${f >= 1.7 ? 'hi' : f >= 1.35 ? 'md' : 'lo'}">×${f}</span></td></tr>`).join('');
    return `<table class="tf-table"><caption>${DIA[dia]} · factor sobre el tiempo sin tráfico</caption>${filas}</table>`;
  }

  panel.innerHTML = `
    <header><b>Tráfico</b><button type="button" class="icon-btn" data-tf="close" aria-label="Cerrar">✕</button></header>
    <p class="tf-src">Fuente activa: <b class="tf-active"></b></p>
    <section>
      <h4>En vivo</h4>
      <label class="tf-opt ${tomtom ? '' : 'off'}"><input type="checkbox" data-tf="flow" ${tomtom ? '' : 'disabled'}> Flujo vehicular · TomTom</label>
      <label class="tf-opt ${tomtom ? '' : 'off'}"><input type="checkbox" data-tf="incid" ${tomtom ? '' : 'disabled'}> Incidentes y cierres · TomTom</label>
      ${tomtom
        ? '<p class="tf-note">Verde = fluido · naranja/rojo = lento/congestionado. Se actualiza cada 3 min.</p>'
        : '<p class="tf-note">Para activar la capa TomTom sobre este mapa, registre una API key gratuita en developer.tomtom.com y defina <code>TOMTOM_API_KEY</code> en el <code>.env</code> del servidor.</p>'}
      <button type="button" class="btn" data-tf="waze">Ver tráfico en vivo (Waze)</button>
      <p class="tf-note">Waze Live Map: gratuito y sin key, con reportes de la comunidad (atascos, accidentes, policía) en todo el Perú.</p>
    </section>
    <section>
      <h4>Estimado para horarios (ETA)</h4>
      <p class="tf-note">Los tiempos de llegada del planificador usan este perfil horario de Lima: cada tramo se multiplica según la hora en que empieza. <b>Es un estimado, no tráfico en tiempo real.</b></p>
      ${perfilHoy()}
    </section>`;

  const overlayDef = (id) => ({ urls: [`${TILES}/${id}/{z}/{x}/{y}`], opciones: { minZoom: 6, maxZoom: 19, maxNativeZoom: 18, opacity: 0.9, attribution: 'Tráfico © TomTom' } });

  function setLayer(kind, value) {
    on[kind] = value;
    map.setOverlay(kind === 'flow' ? 'tomtom-flow' : 'tomtom-incidentes', value ? overlayDef(kind === 'flow' ? 'tomtom-flow' : 'tomtom-incidentes') : null);
    clearInterval(timer);
    if (on.flow || on.incid) timer = setInterval(() => map.refreshOverlays(), REFRESH_MS);
    paintBadge();
  }

  // ---------- Waze ----------
  const iframe = wazePanel.querySelector('iframe');
  function openWaze() {
    const v = map.getView();
    iframe.src = wazeEmbedUrl({ lat: v.lat, lon: v.lon, zoom: Math.min(v.zoom, 15) });
    wazePanel.hidden = false;
    on.waze = true;
    paintBadge();
  }
  function closeWaze() {
    wazePanel.hidden = true;
    iframe.src = 'about:blank';
    on.waze = false;
    paintBadge();
  }
  wazePanel.addEventListener('click', (e) => {
    const a = e.target.closest('[data-wz]')?.dataset.wz;
    if (a === 'close') closeWaze();
    else if (a === 'recenter') openWaze();
    else if (a === 'size') wazePanel.classList.toggle('big');
  });

  panel.addEventListener('change', (e) => {
    const k = e.target.dataset.tf;
    if (k === 'flow' || k === 'incid') setLayer(k, e.target.checked);
  });
  panel.addEventListener('click', (e) => {
    const k = e.target.closest('[data-tf]')?.dataset.tf;
    if (k === 'close') {
      panel.hidden = true;
      paintBadge();
    } else if (k === 'waze') openWaze();
  });
  toggleBtn.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    paintBadge();
  });
  badge.addEventListener('click', () => {
    panel.hidden = false;
    paintBadge();
  });
  paintBadge();
}
