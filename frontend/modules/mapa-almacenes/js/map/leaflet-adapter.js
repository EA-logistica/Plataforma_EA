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
  };
  return api;
}
