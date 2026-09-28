// Implementación del contrato de mapa con Leaflet + Leaflet.markercluster (OpenStreetMap, sin costo).
// Leaflet se carga como script global (window.L) desde /vendor.
import { escapeHtml } from '/assets/js/ui/format.js';

const L = window.L;

const SHAPES = {
  circle: (c) => `<span class="mk-shape mk-circle" style="--c:${c}"></span>`,
  ring: (c) => `<span class="mk-shape mk-ring" style="--c:${c}"><i></i></span>`,
  diamond: (c) => `<span class="mk-shape mk-diamond" style="--c:${c}"></span>`,
};

function warehouseIcon({ shape = 'circle', color, active }) {
  return L.divIcon({
    className: 'mk' + (active ? ' mk-active' : ''),
    html: (SHAPES[shape] || SHAPES.circle)(color),
    iconSize: [26, 26],
    iconAnchor: [13, 13],
    tooltipAnchor: [12, 0],
  });
}

function originIcon(color) {
  return L.divIcon({
    className: 'mk-origin',
    html: `<span class="mk-origin-pin" style="--c:${color}">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 20V10l5 3V10l5 3V6h3v14H3z M17 20V4h3v16z" fill="currentColor"/></svg>
    </span><span class="mk-origin-tag">PLANTA</span>`,
    iconSize: [40, 40],
    iconAnchor: [20, 20],
    tooltipAnchor: [20, 0],
  });
}

function clusterIcon(cluster) {
  const n = cluster.getChildCount();
  const size = n < 5 ? 'sm' : n < 15 ? 'md' : 'lg';
  return L.divIcon({
    className: `mk-cluster mk-cluster-${size}`,
    html: `<span><b>${n}</b> ${n === 1 ? 'almacén' : 'almacenes'}</span>`,
    iconSize: null,
  });
}

export function createLeafletMap(container, opts) {
  const map = L.map(container, {
    center: opts.center,
    zoom: opts.zoom,
    minZoom: opts.minZoom,
    maxZoom: opts.maxZoom,
    maxBounds: opts.maxBounds,
    maxBoundsViscosity: 0.8,
    zoomControl: false,
    preferCanvas: false,
    worldCopyJump: false,
  });
  L.control.zoom({ position: 'topright', zoomInTitle: 'Acercar', zoomOutTitle: 'Alejar' }).addTo(map);
  L.control.scale({ position: 'bottomleft', metric: true, imperial: false }).addTo(map);
  map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>');

  map.createPane('routePane').style.zIndex = 450;
  map.createPane('originPane').style.zIndex = 660;
  map.createPane('trafficPane').style.zIndex = 350; // sobre las capas base, bajo rutas y marcadores
  map.getPane('trafficPane').style.pointerEvents = 'none';
  map.createPane('stopsPane').style.zIndex = 670;
  const stopsLayer = L.layerGroup().addTo(map);
  const overlays = new Map();
  let planLayer = null;
  let searchPin = null;

  const cluster = L.markerClusterGroup({
    maxClusterRadius: 48,
    showCoverageOnHover: false,
    spiderfyOnMaxZoom: true,
    disableClusteringAtZoom: 17,
    chunkedLoading: true,
    iconCreateFunction: clusterIcon,
  }).addTo(map);

  const markers = new Map(); // key -> { marker, item }
  let iconOf = () => ({ color: '#888' });
  let routeLayer = null;
  let originMarker = null;

  const api = {
    raw: map,

    setBaseLayers(defs) {
      const layers = {};
      const initial = defs.find((d) => d.predeterminada) || defs[0];
      defs.forEach((d) => {
        const tiles = d.urls.map((url, i) => L.tileLayer(url, { ...d.opciones, ...(i ? { attribution: '' } : {}) }));
        const layer = tiles.length === 1 ? tiles[0] : L.layerGroup(tiles);
        layers[escapeHtml(d.nombre)] = layer;
        if (d === initial) layer.addTo(map);
      });
      L.control.layers(layers, null, { position: 'topright', collapsed: true }).addTo(map);
    },

    setOrigin(origin, { onClick, label }) {
      if (originMarker) originMarker.remove();
      if (!origin?.ubicacion) return;
      originMarker = L.marker([origin.ubicacion.lat, origin.ubicacion.lon], {
        icon: originIcon(opts.originColor),
        pane: 'originPane',
        keyboard: true,
        title: origin.nombre,
        alt: origin.nombre,
      })
        .bindTooltip(label, { direction: 'right', className: 'mk-tip' })
        .on('click', onClick)
        .addTo(map);
    },

    setWarehouses(items, { iconOf: fnIcon, labelOf, onClick }) {
      iconOf = fnIcon;
      cluster.clearLayers();
      markers.clear();
      items.forEach((item) => {
        if (!item.ubicacion) return;
        const marker = L.marker([item.ubicacion.lat, item.ubicacion.lon], {
          icon: warehouseIcon(iconOf(item)),
          keyboard: true,
          title: item.nombre || item.key,
          alt: item.nombre || item.key,
        })
          .bindTooltip(labelOf(item), { direction: 'right', className: 'mk-tip' })
          .on('click', () => onClick(item.key));
        markers.set(item.key, { marker, item });
      });
      cluster.addLayers([...markers.values()].map((m) => m.marker));
    },

    addWarehouse(item, handlers) {
      // Para registros cuya ubicación se obtiene luego (geocodificación diferida).
      const existing = markers.get(item.key);
      if (existing) cluster.removeLayer(existing.marker);
      const marker = L.marker([item.ubicacion.lat, item.ubicacion.lon], { icon: warehouseIcon(iconOf(item)), title: item.nombre })
        .bindTooltip(handlers.labelOf(item), { direction: 'right', className: 'mk-tip' })
        .on('click', () => handlers.onClick(item.key));
      markers.set(item.key, { marker, item });
      cluster.addLayer(marker);
    },

    showOnly(keySet) {
      const visible = [];
      markers.forEach(({ marker }, key) => keySet.has(key) && visible.push(marker));
      cluster.clearLayers();
      cluster.addLayers(visible);
    },

    refreshIcons() {
      markers.forEach(({ marker, item }) => marker.setIcon(warehouseIcon(iconOf(item))));
      cluster.refreshClusters();
    },

    focusWarehouse(key, { zoom = 16 } = {}) {
      const entry = markers.get(key);
      if (!entry) return Promise.resolve(false);
      return new Promise((resolve) => {
        if (!cluster.hasLayer(entry.marker)) {
          map.flyTo(entry.marker.getLatLng(), zoom, { duration: 0.6 });
          return resolve(true);
        }
        cluster.zoomToShowLayer(entry.marker, () => {
          if (map.getZoom() < zoom) map.flyTo(entry.marker.getLatLng(), zoom, { duration: 0.6 });
          else map.panTo(entry.marker.getLatLng());
          resolve(true);
        });
      });
    },

    showRoute(geometry, { color, padding }) {
      api.clearRoute();
      const latlngs = geometry.coordinates.map(([lon, lat]) => [lat, lon]);
      routeLayer = L.layerGroup([
        L.polyline(latlngs, { pane: 'routePane', color: '#0b1a2e', weight: 9, opacity: 0.45, lineCap: 'round', lineJoin: 'round', interactive: false }),
        L.polyline(latlngs, { pane: 'routePane', color, weight: 5, opacity: 0.95, lineCap: 'round', lineJoin: 'round', interactive: false }),
      ]).addTo(map);
      map.fitBounds(L.latLngBounds(latlngs), { ...padding, maxZoom: 16, animate: true });
    },

    clearRoute() {
      if (routeLayer) routeLayer.remove();
      routeLayer = null;
    },

    fitBounds(bounds, padding = {}) {
      map.flyToBounds(bounds, { ...padding, duration: 0.7, maxZoom: 16 });
    },

    fitToKeys(keySet, padding = {}) {
      const pts = [];
      markers.forEach(({ marker }, key) => keySet.has(key) && pts.push(marker.getLatLng()));
      if (!pts.length) return;
      if (pts.length === 1) return map.flyTo(pts[0], 16, { duration: 0.6 });
      map.flyToBounds(L.latLngBounds(pts), { ...padding, duration: 0.7, maxZoom: 16 });
    },

    flyTo(latlng, zoom) {
      map.flyTo(latlng, zoom, { duration: 0.6 });
    },

    invalidateSize() {
      map.invalidateSize({ pan: false });
    },

    // ---------- planificador de paradas ----------
    setStops(stops, { onDragEnd, onClick } = {}) {
      stopsLayer.clearLayers();
      stops.forEach((s, i) => {
        const tipo = i === 0 ? 'mk-stop-start' : '';
        const marker = L.marker([s.lat, s.lon], {
          icon: L.divIcon({
            className: `mk-stop ${tipo}`,
            html: `<span>${i === 0 ? 'S' : i}</span>`,
            iconSize: [28, 28],
            iconAnchor: [14, 14],
            tooltipAnchor: [0, -14],
          }),
          pane: 'stopsPane',
          draggable: !!onDragEnd,
          title: s.nombre,
          alt: s.nombre,
        }).bindTooltip(`<b>${i === 0 ? 'Salida' : 'Parada ' + i}</b><br>${escapeHtml(s.nombre || '')}${s.eta ? '<br>ETA ' + escapeHtml(s.eta) : ''}`, { direction: 'top', className: 'mk-tip' });
        if (onDragEnd) marker.on('dragend', () => { const p = marker.getLatLng(); onDragEnd(i, { lat: p.lat, lon: p.lng }); });
        if (onClick) marker.on('click', () => onClick(i));
        stopsLayer.addLayer(marker);
      });
    },

    showPlan(geometry, { color = '#7A3FD1', padding = {}, fit = true } = {}) {
      api.clearPlan();
      const latlngs = geometry.coordinates.map(([lon, lat]) => [lat, lon]);
      planLayer = L.layerGroup([
        L.polyline(latlngs, { pane: 'routePane', color: '#0b1a2e', weight: 9, opacity: 0.4, lineCap: 'round', lineJoin: 'round', interactive: false }),
        L.polyline(latlngs, { pane: 'routePane', color, weight: 5, opacity: 0.95, lineCap: 'round', lineJoin: 'round', interactive: false }),
      ]).addTo(map);
      if (fit) map.fitBounds(L.latLngBounds(latlngs), { ...padding, maxZoom: 16, animate: true });
    },

    clearPlan() {
      if (planLayer) planLayer.remove();
      planLayer = null;
    },

    fitStops(stops, padding = {}) {
      if (!stops.length) return;
      if (stops.length === 1) return map.flyTo([stops[0].lat, stops[0].lon], 15, { duration: 0.6 });
      map.flyToBounds(L.latLngBounds(stops.map((s) => [s.lat, s.lon])), { ...padding, duration: 0.7, maxZoom: 16 });
    },

    // Pin temporal de un resultado de búsqueda; `popupEl` es un nodo DOM (con sus propios listeners).
    showSearchPin({ lat, lon }, popupEl) {
      api.clearSearchPin();
      searchPin = L.marker([lat, lon], {
        icon: L.divIcon({ className: 'mk-search', html: '<span></span>', iconSize: [22, 22], iconAnchor: [11, 22], popupAnchor: [0, -20] }),
        pane: 'stopsPane',
      }).addTo(map);
      if (popupEl) searchPin.bindPopup(popupEl, { className: 'pl-popup', closeButton: true, autoPan: true }).openPopup();
      map.flyTo([lat, lon], Math.max(map.getZoom(), 16), { duration: 0.6 });
    },

    clearSearchPin() {
      if (searchPin) searchPin.remove();
      searchPin = null;
    },

    onMapClick(fn) {
      map.on('click', (e) => fn({ lat: e.latlng.lat, lon: e.latlng.lng }));
    },

    setPickMode(on) {
      container.classList.toggle('pick-mode', !!on);
    },

    // Capas superpuestas (tráfico en vivo). def = { urls, opciones } | null para quitarla.
    setOverlay(id, def) {
      if (overlays.has(id)) {
        overlays.get(id).remove();
        overlays.delete(id);
      }
      if (!def) return;
      const tiles = def.urls.map((url) => L.tileLayer(url, { pane: 'trafficPane', ...def.opciones, baseUrl: url }));
      const layer = tiles.length === 1 ? tiles[0] : L.layerGroup(tiles);
      layer.addTo(map);
      overlays.set(id, layer);
    },

    // Fuerza a pedir de nuevo las teselas superpuestas (tráfico que cambia cada pocos minutos).
    refreshOverlays() {
      const bust = Date.now();
      overlays.forEach((layer) => {
        const list = [];
        if (layer instanceof L.TileLayer) list.push(layer);
        else layer.eachLayer((l) => list.push(l));
        list.forEach((l) => l.setUrl(`${l.options.baseUrl}${l.options.baseUrl.includes('?') ? '&' : '?'}t=${bust}`));
      });
    },

    getView() {
      const c = map.getCenter();
      return { lat: c.lat, lon: c.lng, zoom: map.getZoom() };
    },
  };
  return api;
}
