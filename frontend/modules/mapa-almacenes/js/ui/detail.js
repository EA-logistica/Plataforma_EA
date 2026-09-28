// Panel de detalle del almacén seleccionado: datos, acciones y ruta desde Plásticos Nacionales.
import { BAND_LABEL, COLORES } from '../config.js';
import { haversineKm } from '/assets/js/data/parsers.js';
import { escapeHtml, FUENTE_UBICACION, fmtKm, fmtMin, fmtMoney, fmtNum, NA, orNA } from '/assets/js/ui/format.js';

export const gmapsDir = (o, d) =>
  `https://www.google.com/maps/dir/?api=1&origin=${o.lat},${o.lon}&destination=${d.lat},${d.lon}&travelmode=driving`;
export const gmapsPin = (p) => `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lon}`;
export const streetView = (p) => `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${p.lat},${p.lon}`;

const row = (k, v) => `<dt>${escapeHtml(k)}</dt><dd>${v}</dd>`;
const note = (t) => ` <small class="derived">${escapeHtml(t)}</small>`;

export function pricingRows(item) {
  const { mensual, porM2 } = item.pricing;
  const m = mensual ? fmtMoney(mensual.valor, mensual.moneda) + '/mes' + (mensual.calculado ? note('calculado') : '') : `<span class="na">${NA}</span>`;
  const p = porM2 ? fmtMoney(porM2.valor, porM2.moneda) + '/m²' + (porM2.calculado ? note('calculado: precio ÷ área principal') : '') : `<span class="na">${NA}</span>`;
  return row('Precio mensual', m) + row('Precio por m²', p);
}

function routeBlock(item, origin, ctx) {
  const o = origin.ubicacion;
  const d = item.ubicacion;
  const rs = ctx.route;
  const perfilBtns = ctx.perfiles
    .map(
      (p) =>
        `<button type="button" data-perfil="${p.id}" class="${ctx.perfil === p.id ? 'on' : ''}" ${p.disponible ? '' : `title="Requiere configurar OpenRouteService (ORS_API_KEY) en el servidor"`}>${escapeHtml(p.etiqueta)}${p.disponible ? '' : ' *'}</button>`
    )
    .join('');

  let stats;
  let foot = '';
  if (rs.status === 'ok') {
    const r = rs.data;
    stats = `
      <div><b>${fmtKm(r.distanciaKm)}</b><span>Distancia vial</span></div>
      <div class="hl"><b>${fmtMin(r.trafico.duracionEstimadaMin)}</b><span>Tiempo estimado</span></div>
      <div><b>${fmtMin(r.duracionLibreMin)}</b><span>Vía libre</span></div>`;
    foot = `
      ${r.advertencia ? `<p class="rt-warn">${escapeHtml(r.advertencia)}</p>` : ''}
      <p class="rt-note"><b>Tiempo ESTIMADO, no es tráfico en tiempo real.</b> ${escapeHtml(r.trafico.metodo)}.
      Perfil aplicado: ${escapeHtml(ctx.perfiles.find((p) => p.id === r.perfilAplicado)?.etiqueta || r.perfilAplicado)} · Proveedor: ${escapeHtml(r.proveedorNombre)}${r.desdeCache ? ' · desde caché' : ''}.</p>`;
  } else {
    const ref = item.rutaRadar;
    stats = `
      <div><b>${ref ? fmtKm(ref.distanciaKm) : '—'}</b><span>Distancia (Radar)</span></div>
      <div class="hl"><b>${ref ? fmtMin(ref.duracionAjustadaMin) : '—'}</b><span>Estimado (Radar)</span></div>
      <div><b>${d && o ? fmtKm(haversineKm(o, d)) : '—'}</b><span>Línea recta</span></div>`;
    foot =
      rs.status === 'loading'
        ? '<p class="rt-note"><span class="spinner"></span> Calculando ruta…</p>'
        : rs.status === 'error'
          ? `<p class="rt-warn">${escapeHtml(rs.error)}</p><p class="rt-note">Se muestran los datos de referencia existentes del Radar.</p>`
          : '<p class="rt-note">Referencia existente del Radar (ruta almacén → planta, tráfico moderado estimado). Presiona <b>Ver ruta</b> para trazar el recorrido desde la planta.</p>';
  }

  return `
    <section class="route-card">
      <div class="rt-head"><span>Ruta desde planta</span><div class="seg seg-sm" role="group" aria-label="Tipo de vehículo">${perfilBtns}</div></div>
      <div class="rt-flow">
        <div class="rt-node rt-origin"><i style="background:${COLORES.origen}"></i><div><b>${escapeHtml(origin.nombre)}</b><span>${escapeHtml(origin.direccion)} · ${escapeHtml(origin.distrito)}</span></div></div>
        <div class="rt-link"></div>
        <div class="rt-node rt-dest"><i></i><div><b>${escapeHtml(item.nombre || item.key)}</b><span>${escapeHtml(item.distrito || NA)}</span></div></div>
      </div>
      <div class="rt-stats">${stats}</div>
      ${foot}
      ${o && d ? `<a class="rt-ext" href="${gmapsDir(o, d)}" target="_blank" rel="noopener">Comparar en Google Maps (tráfico actual) ↗</a>` : ''}
    </section>`;
}

export function renderWarehouseDetail(container, item, origin, ctx) {
  const d = item.ubicacion;
  const bandColor = item.band ? COLORES.band[item.band] : null;
  const phone = item.telefono;

  container.innerHTML = `
    <header class="dt-head">
      <div class="badges">
        ${item.modalidad ? `<span class="tag tag-${escapeHtml(item.modalidad.toLowerCase())}">${escapeHtml(item.modalidad)}</span>` : ''}
        ${item.band ? `<span class="tag tag-band"><i style="background:${bandColor}"></i>${escapeHtml(BAND_LABEL[item.band])}</span>` : ''}
      </div>
      <button type="button" class="icon-btn" data-act="close" aria-label="Cerrar">✕</button>
    </header>
    <h2 class="dt-title">${escapeHtml(item.nombre || item.key)}</h2>
    <p class="dt-addr">${orNA(item.direccion)}</p>

    <div class="dt-actions">
      <button type="button" class="btn btn-primary" data-act="route" ${d && origin.ubicacion ? '' : 'disabled'}>Ver ruta</button>
      <button type="button" class="btn" data-act="locate" ${d ? '' : 'disabled'}>Ver ubicación</button>
      <button type="button" class="btn" data-act="ficha">Abrir ficha</button>
      <button type="button" class="btn" data-act="add-stop" ${d ? '' : 'disabled'} title="Agregar este almacén a las paradas del planificador de rutas">＋ Parada</button>
    </div>

    ${routeBlock(item, origin, ctx)}

    <section class="dt-section">
      <h3>Información del inmueble</h3>
      <dl class="kv">
        ${row('Nombre', orNA(item.nombre))}
        ${row('Dirección', orNA(item.direccion))}
        ${row('Distrito', orNA(item.distrito))}
        ${row('Provincia', item.provincia ? escapeHtml(item.provincia.valor) + note(item.provincia.nota) : orNA(null))}
        ${row('Área', orNA(item.areaTexto))}
        ${row('Precio', orNA(item.precioTexto))}
        ${pricingRows(item)}
        ${row('Modalidad', orNA(item.modalidad))}
        ${row('Tipo de inmueble', item.tipologia === 'No especificado' ? orNA(null) : escapeHtml(item.tipologia) + note('según título'))}
        ${row('Tipo de registro', orNA(item.tipoRegistro))}
        ${row('Características', orNA(null))}
        ${row('Contacto', orNA(item.contacto) + (phone ? ` <a class="inline-link" href="https://wa.me/51${phone}" target="_blank" rel="noopener">WhatsApp ↗</a>` : ''))}
        ${row('Link', item.url ? `<a class="inline-link" href="${escapeHtml(item.url)}" target="_blank" rel="noopener">Ver anuncio original ↗</a>` : orNA(null))}
        ${row('Fuente', orNA(item.fuenteAnuncio))}
        ${row('Código', `<code>${escapeHtml(item.key)}</code>`)}
        ${row('Coordenadas', d ? `${fmtNum(d.lat, 5)}, ${fmtNum(d.lon, 5)}${note(FUENTE_UBICACION[d.fuente] || d.fuente)}` : orNA(null))}
      </dl>
    </section>

    ${d ? `<div class="dt-links">
      <a href="${gmapsPin(d)}" target="_blank" rel="noopener">Google Maps ↗</a>
      <a href="${streetView(d)}" target="_blank" rel="noopener">Street View ↗</a>
    </div>` : ''}
  `;
}

export function renderOriginDetail(container, origin, total) {
  const u = origin.ubicacion;
  container.innerHTML = `
    <header class="dt-head">
      <div class="badges"><span class="tag" style="color:${COLORES.origen};border-color:${COLORES.origen}">${escapeHtml(origin.rol)}</span></div>
      <button type="button" class="icon-btn" data-act="close" aria-label="Cerrar">✕</button>
    </header>
    <h2 class="dt-title">${escapeHtml(origin.nombre)}</h2>
    <p class="dt-addr">${escapeHtml(origin.direccion)} — ${escapeHtml(origin.distrito)}, ${escapeHtml(origin.provincia)}, ${escapeHtml(origin.pais)}</p>
    <section class="dt-section">
      <dl class="kv">
        ${row('Rol', escapeHtml(origin.rol))}
        ${row('Coordenadas', u ? `${fmtNum(u.lat, 5)}, ${fmtNum(u.lon, 5)}` : orNA(null))}
        ${row('Fuente', u ? escapeHtml(FUENTE_UBICACION[u.fuente] || u.fuente) : 'Pendiente de geocodificación')}
        ${row('Precisión', orNA(u?.precision))}
        ${row('Almacenes evaluados', String(total))}
      </dl>
      <p class="rt-note">Punto de partida para todas las rutas. Para fijar coordenadas exactas verificadas, completar <code>"origen"</code> en <code>backend/storage/coordenadas-manuales.json</code>.</p>
    </section>
    ${u ? `<div class="dt-links"><a href="${gmapsPin(u)}" target="_blank" rel="noopener">Google Maps ↗</a><a href="${streetView(u)}" target="_blank" rel="noopener">Street View ↗</a></div>` : ''}
  `;
}
