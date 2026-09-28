// Planificador de rutas con paradas + programación de camiones.
// Flujo: buscar dirección / marcar en el mapa / elegir almacén -> lista de paradas -> ruta (OSRM/ORS)
// -> horario estimado por parada (perfil horario de tráfico de Lima) -> guardar viaje -> enviar al
// conductor (Google Maps / Waze / WhatsApp).
import { escapeHtml } from '/assets/js/ui/format.js';
import { plannerApi } from './api.js';
import { GMAPS_MAX_INTERMEDIAS, googleMapsUrl, hojaDeRutaTexto, orderedPoints, wazeUrl } from './links.js';

const PLAN_COLOR = '#7A3FD1';
const MAX_DEFAULT = 25;

const fmtDur = (min) => {
  const m = Math.max(0, Math.round(min));
  return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min` : `${m} min`;
};
const fmtKm = (km) => `${km.toLocaleString('es-PE', { maximumFractionDigits: km < 10 ? 1 : 0 })} km`;
const hoyLima = () => new Date(Date.now() - 5 * 3600000).toISOString().slice(0, 10);
let uid = 0;
const nextId = () => `p${Date.now().toString(36)}${(uid++).toString(36)}`;

export function initPlanner({ map, root, getOrigin, getWarehouses, padding, onStatus, config = {} }) {
  const $ = (sel) => root.querySelector(sel);
  const maxParadas = config.planificador?.maxParadas || MAX_DEFAULT;

  const P = {
    stops: [],
    plan: null,
    planError: null,
    loading: false,
    pick: false,
    seq: 0,
    viaje: { nombre: '', placa: '', conductor: '', fecha: hoyLima(), salida: '08:00', finJornada: '18:00', perfil: 'auto', regreso: true },
    editingId: null,
    viajes: [],
  };
  let recalcTimer = null;

  // ---------- paradas ----------
  function addStop(s, { silent = false } = {}) {
    if (P.stops.length >= maxParadas) {
      onStatus(`Máximo ${maxParadas} paradas por viaje.`, 'error');
      return null;
    }
    const stop = {
      id: nextId(),
      lat: +s.lat,
      lon: +s.lon,
      nombre: (s.nombre || '').trim() || `Parada ${P.stops.length}`,
      direccion: s.direccion || null,
      servicioMin: s.servicioMin ?? (P.stops.length === 0 ? 0 : 20),
      almacen: s.almacen || null,
    };
    P.stops.push(stop);
    if (!silent) changed();
    return stop;
  }

  function ensureStart() {
    if (P.stops.length) return;
    const o = getOrigin();
    if (o?.ubicacion) addStop({ lat: o.ubicacion.lat, lon: o.ubicacion.lon, nombre: 'Planta · Plásticos Nacionales', direccion: o.direccion, servicioMin: 30, almacen: '__origen__' }, { silent: true });
  }

  function move(i, j) {
    if (j < 0 || j >= P.stops.length || i === j) return;
    const [s] = P.stops.splice(i, 1);
    P.stops.splice(j, 0, s);
    changed();
  }

  // Cualquier cambio en paradas u opciones: repinta y recalcula (con pausa) de forma automática.
  function changed({ recalc = true } = {}) {
    P.plan = null;
    P.planError = null;
    renderStops();
    drawStops();
    renderResult();
    map.clearPlan();
    clearTimeout(recalcTimer);
    if (recalc && P.stops.length >= 2) recalcTimer = setTimeout(() => compute(), 700);
  }

  // ---------- cálculo ----------
  function payload(optimizar = false) {
    return {
      paradas: P.stops.map(({ lat, lon, nombre, servicioMin }) => ({ lat, lon, nombre, servicioMin })),
      perfil: P.viaje.perfil,
      regreso: P.viaje.regreso,
      salida: P.viaje.salida,
      fecha: P.viaje.fecha,
      finJornada: P.viaje.finJornada,
      optimizar,
    };
  }

  async function compute({ optimizar = false, fit = true } = {}) {
    clearTimeout(recalcTimer);
    if (P.stops.length < 2) return;
    const seq = ++P.seq;
    P.loading = true;
    P.planError = null;
    renderResult();
    try {
      const plan = await plannerApi.rutaParadas(payload(optimizar));
      if (seq !== P.seq) return;
      if (optimizar && plan.optimizado) {
        // Reordena la lista según el orden óptimo y recalcula (la ruta ya queda en caché del servidor).
        P.stops = plan.orden.map((i) => P.stops[i]);
        P.loading = false;
        renderStops();
        onStatus('Orden optimizado (menor tiempo total, salida fija).', 'info', 3500);
        return compute({ fit });
      }
      P.plan = plan;
      map.showPlan(plan.geometria, { color: PLAN_COLOR, padding: padding(), fit });
    } catch (err) {
      if (seq !== P.seq) return;
      P.plan = null;
      P.planError = err.message;
    } finally {
      if (seq === P.seq) P.loading = false;
    }
    renderStops();
    drawStops();
    renderResult();
  }

  // ---------- mapa ----------
  function etaOf(i) {
    if (!P.plan) return null;
    const c = P.plan.cronograma.find((x) => x.indice === i && !x.regreso);
    return c ? (c.llegada ? `llega ${c.llegada}` : `sale ${c.salida}`) : null;
  }

  function drawStops() {
    map.setStops(
      P.stops.map((s, i) => ({ ...s, eta: etaOf(i) })),
      {
        onDragEnd: (i, p) => {
          const s = P.stops[i];
          s.lat = p.lat;
          s.lon = p.lon;
          s.direccion = null;
          changed();
          plannerApi.lugarInverso(p).then((r) => {
            if (r.etiqueta && P.stops.includes(s)) {
              s.direccion = r.etiqueta;
              renderStops();
            }
          }).catch(() => {});
        },
        onClick: (i) => root.querySelector(`.pl-stop[data-i="${i}"] .pl-name`)?.focus(),
      }
    );
  }

  map.onMapClick(async (p) => {
    if (!P.pick) return;
    const stop = addStop({ lat: p.lat, lon: p.lon, nombre: 'Punto marcado' });
    if (!stop) return;
    try {
      const r = await plannerApi.lugarInverso(p);
      if (!P.stops.includes(stop)) return;
      if (r.nombre) stop.nombre = r.nombre;
      stop.direccion = r.etiqueta || null;
      renderStops();
      drawStops();
    } catch (err) {
      onStatus(`No se pudo obtener la dirección del punto (${err.message}); la parada se agregó igual.`, 'error', 4000);
    }
  });

  function setPick(on) {
    P.pick = on;
    map.setPickMode(on);
    const b = $('[data-pl="pick"]');
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
    b.textContent = on ? '✓ Marcando en el mapa (clic para terminar)' : '📍 Marcar paradas en el mapa';
  }

  // ---------- buscador de direcciones ----------
  const qInput = $('#plQ');
  const qList = $('#plSuggest');
  let qTimer = null;
  let qAbort = null;
  let qResults = [];

  function closeSuggest() {
    qList.hidden = true;
    qInput.setAttribute('aria-expanded', 'false');
  }

  async function runSearch() {
    const q = qInput.value.trim();
    if (q.length < 4) return closeSuggest();
    qAbort?.abort();
    qAbort = new AbortController();
    qList.innerHTML = '<li class="sg-empty">Buscando…</li>';
    qList.hidden = false;
    try {
      const r = await plannerApi.buscarLugares(q, qAbort.signal);
      qResults = r.resultados || [];
      qList.innerHTML = qResults.length
        ? qResults.map((x, i) => `<li role="option" data-idx="${i}" class="pl-sg">
            <div><b>${escapeHtml(x.nombre || x.etiqueta)}</b><span>${escapeHtml(x.etiqueta || '')}</span></div>
            <button type="button" class="pl-sg-add" data-add="${i}" title="Agregar como parada" aria-label="Agregar como parada">＋</button>
          </li>`).join('')
        : '<li class="sg-empty">Sin resultados en Perú. Pruebe con calle + número + distrito, o marque el punto en el mapa.</li>';
      qInput.setAttribute('aria-expanded', 'true');
    } catch (err) {
      if (err.name === 'AbortError') return;
      qList.innerHTML = `<li class="sg-empty">Error al buscar: ${escapeHtml(err.message)}</li>`;
    }
  }

  function placeToStop(x) {
    return { lat: x.lat, lon: x.lon, nombre: x.nombre || x.etiqueta?.split(',')[0], direccion: x.etiqueta };
  }

  function showPlace(x) {
    const el = document.createElement('div');
    el.className = 'pl-pop';
    el.innerHTML = `<b>${escapeHtml(x.nombre || '')}</b><small>${escapeHtml(x.etiqueta || '')}</small>
      <span class="pl-pop-prec">Precisión: ${escapeHtml(x.precision || 'aproximada')}</span>
      <button type="button" class="btn btn-primary">＋ Agregar como parada</button>`;
    el.querySelector('button').addEventListener('click', () => {
      addStop(placeToStop(x));
      map.clearSearchPin();
    });
    map.showSearchPin(x, el);
  }

  qInput.addEventListener('input', () => {
    clearTimeout(qTimer);
    qTimer = setTimeout(runSearch, 550);
  });
  qInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      clearTimeout(qTimer);
      runSearch();
    } else if (e.key === 'Escape') closeSuggest();
  });
  qList.addEventListener('click', (e) => {
    const add = e.target.closest('[data-add]');
    if (add) {
      addStop(placeToStop(qResults[+add.dataset.add]));
      closeSuggest();
      return;
    }
    const li = e.target.closest('li[data-idx]');
    if (li) {
      showPlace(qResults[+li.dataset.idx]);
      closeSuggest();
    }
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#plSearch')) closeSuggest();
  });

  // ---------- render: paradas ----------
  function renderStops() {
    const list = $('#plStops');
    $('#plStopCount').textContent = `${P.stops.length}/${maxParadas}`;
    if (!P.stops.length) {
      list.innerHTML = '<li class="pl-empty">Sin paradas. Busque una dirección, marque en el mapa o elija un almacén.</li>';
      return;
    }
    list.innerHTML = P.stops.map((s, i) => {
      const eta = etaOf(i);
      return `<li class="pl-stop${i === 0 ? ' is-start' : ''}" data-i="${i}" draggable="true">
        <span class="pl-num" title="Arrastre para reordenar">${i === 0 ? 'S' : i}</span>
        <div class="pl-stop-main">
          <input class="pl-name" value="${escapeHtml(s.nombre)}" aria-label="Nombre de la parada ${i}" maxlength="120">
          <small>${escapeHtml(s.direccion || `${s.lat.toFixed(5)}, ${s.lon.toFixed(5)}`)}</small>
          ${eta ? `<em class="pl-eta">${escapeHtml(eta)}</em>` : ''}
        </div>
        <label class="pl-svc" title="${i === 0 ? 'Tiempo de carga antes de salir' : 'Tiempo de descarga / atención en la parada'}">
          <input type="number" class="pl-svc-in" min="0" max="600" step="5" value="${s.servicioMin}" aria-label="Minutos de ${i === 0 ? 'carga' : 'servicio'}"><span>${i === 0 ? 'carga' : 'min'}</span>
        </label>
        <div class="pl-acts">
          <button type="button" data-mv="-1" ${i === 0 ? 'disabled' : ''} title="Subir" aria-label="Subir">↑</button>
          <button type="button" data-mv="1" ${i === P.stops.length - 1 ? 'disabled' : ''} title="Bajar" aria-label="Bajar">↓</button>
          <button type="button" data-rm title="Quitar" aria-label="Quitar parada">✕</button>
        </div>
      </li>`;
    }).join('');
  }

  const stopsEl = $('#plStops');
  stopsEl.addEventListener('click', (e) => {
    const li = e.target.closest('.pl-stop');
    if (!li) return;
    const i = +li.dataset.i;
    const mv = e.target.closest('[data-mv]');
    if (mv) return move(i, i + Number(mv.dataset.mv));
    if (e.target.closest('[data-rm]')) {
      P.stops.splice(i, 1);
      changed();
    }
  });
  stopsEl.addEventListener('change', (e) => {
    const li = e.target.closest('.pl-stop');
    if (!li) return;
    const s = P.stops[+li.dataset.i];
    if (e.target.classList.contains('pl-name')) {
      s.nombre = e.target.value.trim() || s.nombre;
      if (P.plan) compute({ fit: false });
      drawStops();
    } else if (e.target.classList.contains('pl-svc-in')) {
      s.servicioMin = Math.max(0, Math.min(600, Math.round(+e.target.value || 0)));
      if (P.stops.length >= 2) compute({ fit: false });
    }
  });
  let dragFrom = null;
  stopsEl.addEventListener('dragstart', (e) => {
    const li = e.target.closest('.pl-stop');
    if (!li || e.target.matches('input')) return;
    dragFrom = +li.dataset.i;
    e.dataTransfer.effectAllowed = 'move';
    li.classList.add('dragging');
  });
  stopsEl.addEventListener('dragover', (e) => {
    if (dragFrom != null) e.preventDefault();
  });
  stopsEl.addEventListener('drop', (e) => {
    const li = e.target.closest('.pl-stop');
    if (li && dragFrom != null) {
      e.preventDefault();
      move(dragFrom, +li.dataset.i);
    }
    dragFrom = null;
  });
  stopsEl.addEventListener('dragend', () => {
    dragFrom = null;
    stopsEl.querySelectorAll('.dragging').forEach((x) => x.classList.remove('dragging'));
  });

  // ---------- render: resultado / cronograma ----------
  function renderResult() {
    const box = $('#plResult');
    if (P.stops.length < 2) {
      box.innerHTML = '<p class="pl-hint">Agregue al menos una parada además de la salida para calcular la ruta y el horario.</p>';
      return;
    }
    if (P.loading) {
      box.innerHTML = '<p class="pl-hint pl-loading">Calculando ruta y horario…</p>';
      return;
    }
    if (P.planError) {
      box.innerHTML = `<p class="pl-error">No se pudo calcular la ruta: ${escapeHtml(P.planError)}</p>
        <button type="button" class="btn" data-pl="compute">Reintentar</button>`;
      return;
    }
    const plan = P.plan;
    if (!plan) {
      box.innerHTML = '<p class="pl-hint">La ruta se recalcula automáticamente al cambiar paradas u horario.</p>';
      return;
    }
    const puntos = orderedPoints(P.stops, plan);
    const gmaps = googleMapsUrl(puntos);
    const muchas = puntos.length - 2 > GMAPS_MAX_INTERMEDIAS;
    const filas = plan.cronograma.map((c, k) => {
      const p = c.regreso ? P.stops[plan.orden[0]] : P.stops[c.indice];
      const t = c.tramo;
      const detalle = t
        ? `${fmtKm(t.distanciaKm)} · ${fmtDur(t.duracionEstimadaMin)} <span class="pl-tf ${t.factor >= 1.7 ? 'hi' : t.factor >= 1.35 ? 'md' : 'lo'}" title="${escapeHtml(t.franja)}: sin tráfico ${fmtDur(t.duracionLibreMin)} × ${t.factor}">×${t.factor}</span>`
        : c.servicioMin ? `carga ${c.servicioMin} min` : '';
      return `<tr class="${c.regreso ? 'is-return' : ''}">
        <td><span class="pl-num sm">${k === 0 ? 'S' : c.regreso ? 'R' : k}</span></td>
        <td class="pl-td-name"><b title="${escapeHtml(c.nombre)}">${escapeHtml(c.regreso ? `Regreso · ${c.nombre}` : c.nombre)}</b><small>${detalle}${c.servicioMin && t ? ` · ${c.servicioMin} min parada` : ''}</small></td>
        <td class="mono">${c.llegada ? escapeHtml(c.llegada) : '—'}</td>
        <td class="mono">${c.salida ? escapeHtml(c.salida) : '—'}</td>
        <td>${p ? `<a class="pl-waze" href="${escapeHtml(wazeUrl(p))}" target="_blank" rel="noopener" title="Navegar con Waze a esta parada">Waze</a>` : ''}</td>
      </tr>`;
    }).join('');
    box.innerHTML = `
      <div class="pl-kpis">
        <div><b>${fmtKm(plan.distanciaKm)}</b><span>Distancia</span></div>
        <div><b>${fmtDur(plan.duracionEstimadaMin)}</b><span>Manejo estimado</span></div>
        <div><b>${fmtDur(plan.servicioMin)}</b><span>Carga + paradas</span></div>
        <div class="${plan.excedeJornada ? 'bad' : 'good'}"><b>${escapeHtml(plan.fin)}</b><span>${plan.regreso ? 'Regreso' : 'Fin'} estimado</span></div>
      </div>
      ${plan.avisos.length ? `<ul class="pl-avisos">${plan.avisos.map((a) => `<li>${escapeHtml(a)}</li>`).join('')}</ul>` : ''}
      <div class="pl-table-wrap"><table class="pl-table">
        <thead><tr><th></th><th>Parada · tramo (tráfico)</th><th>Llega</th><th>Sale</th><th></th></tr></thead>
        <tbody>${filas}</tbody>
      </table></div>
      <p class="pl-foot">Ruta: ${escapeHtml(plan.proveedorNombre)} · perfil ${escapeHtml(plan.perfilAplicado === 'camion' ? 'camión' : 'automóvil')}${plan.optimizado ? ' · orden optimizado' : ''}.
        Tiempo sin tráfico ${fmtDur(plan.duracionLibreMin)}; <b>tráfico estimado por franja horaria de Lima (${escapeHtml(plan.trafico.tipoDia)}), no es tiempo real</b>.</p>
      <div class="pl-gps">
        ${gmaps ? `<a class="btn btn-primary" href="${escapeHtml(gmaps)}" target="_blank" rel="noopener">Abrir ruta en Google Maps</a>` : ''}
        <a class="btn" href="https://wa.me/?text=${encodeURIComponent(hojaDeRutaTexto({ viaje: P.viaje, paradas: P.stops, plan }))}" target="_blank" rel="noopener">Enviar por WhatsApp</a>
        <button type="button" class="btn" data-pl="copy">Copiar hoja de ruta</button>
      </div>
      ${muchas ? `<p class="pl-hint">Google Maps en celular admite hasta ${GMAPS_MAX_INTERMEDIAS} paradas intermedias: el enlace incluye las primeras; use los enlaces Waze por parada para el resto.</p>` : ''}`;
  }

  // ---------- programación de camión (opciones + guardado) ----------
  const form = $('#plForm');
  function fillForm() {
    for (const [k, v] of Object.entries(P.viaje)) {
      const el = form.elements[k];
      if (!el) continue;
      if (el.type === 'checkbox') el.checked = !!v;
      else el.value = v ?? '';
    }
    $('[data-pl="save"]').textContent = P.editingId ? 'Actualizar viaje' : 'Guardar viaje';
    $('[data-pl="new"]').hidden = !P.editingId;
  }
  form.addEventListener('change', (e) => {
    const el = e.target;
    if (!el.name || !(el.name in P.viaje)) return;
    P.viaje[el.name] = el.type === 'checkbox' ? el.checked : el.value;
    if (['salida', 'fecha', 'finJornada', 'perfil', 'regreso'].includes(el.name) && P.stops.length >= 2) {
      compute({ fit: el.name === 'perfil' || el.name === 'regreso' });
    }
  });
  form.addEventListener('submit', (e) => e.preventDefault());

  async function saveTrip() {
    if (!P.viaje.placa.trim()) {
      form.elements.placa.focus();
      return onStatus('Ingrese la placa del camión para guardar el viaje.', 'error', 3500);
    }
    if (P.stops.length < 2) return onStatus('El viaje necesita al menos 2 paradas.', 'error', 3500);
    const body = {
      ...P.viaje,
      paradas: P.stops.map(({ lat, lon, nombre, direccion, servicioMin, almacen }) => ({ lat, lon, nombre, direccion, servicioMin, almacen })),
      resumen: P.plan ? { distanciaKm: P.plan.distanciaKm, fin: P.plan.fin, duracionEstimadaMin: P.plan.duracionEstimadaMin } : null,
    };
    try {
      const v = P.editingId ? await plannerApi.actualizarViaje(P.editingId, body) : await plannerApi.crearViaje(body);
      P.editingId = v.id;
      fillForm();
      onStatus(`Viaje ${v.placa} guardado.`, 'info', 3000);
      loadTrips();
    } catch (err) {
      onStatus(`No se pudo guardar el viaje: ${err.message}`, 'error', 5000);
    }
  }

  function openTrip(v) {
    P.editingId = v.id;
    P.viaje = {
      nombre: v.nombre || '', placa: v.placa, conductor: v.conductor || '', fecha: v.fecha || hoyLima(),
      salida: v.salida, finJornada: v.finJornada, perfil: v.perfil, regreso: !!v.regreso,
    };
    P.stops = [];
    v.paradas.forEach((p) => addStop(p, { silent: true }));
    fillForm();
    changed({ recalc: false });
    map.fitStops(P.stops, padding());
    compute();
  }

  function newTrip() {
    P.editingId = null;
    P.viaje = { ...P.viaje, nombre: '', placa: '', conductor: '' };
    P.stops = [];
    ensureStart();
    fillForm();
    changed();
  }

  async function loadTrips() {
    const box = $('#plViajes');
    try {
      P.viajes = (await plannerApi.viajes()).viajes;
    } catch (err) {
      box.innerHTML = `<li class="pl-empty">No se pudieron cargar los viajes: ${escapeHtml(err.message)}</li>`;
      return;
    }
    box.innerHTML = P.viajes.length
      ? P.viajes.map((v) => `<li class="pl-trip${v.id === P.editingId ? ' active' : ''}" data-id="${escapeHtml(v.id)}">
          <div>
            <b>${escapeHtml(v.placa)}${v.nombre ? ' · ' + escapeHtml(v.nombre) : ''}</b>
            <span>${escapeHtml([v.fecha, `sale ${v.salida}`, v.resumen?.fin && `fin ${v.resumen.fin}`, v.conductor, `${v.paradas.length - 1} parada(s)`].filter(Boolean).join(' · '))}</span>
          </div>
          <button type="button" class="btn sm" data-trip="open">Abrir</button>
          <button type="button" class="icon-btn" data-trip="del" title="Eliminar viaje" aria-label="Eliminar viaje">✕</button>
        </li>`).join('')
      : '<li class="pl-empty">Aún no hay viajes programados.</li>';
  }

  $('#plViajes').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-trip]');
    if (!b) return;
    const id = b.closest('.pl-trip').dataset.id;
    const v = P.viajes.find((x) => x.id === id);
    if (!v) return;
    if (b.dataset.trip === 'open') return openTrip(v);
    if (!confirm(`¿Eliminar el viaje ${v.placa}${v.fecha ? ' del ' + v.fecha : ''}?`)) return;
    try {
      await plannerApi.eliminarViaje(id);
      if (P.editingId === id) {
        P.editingId = null;
        fillForm();
      }
      loadTrips();
    } catch (err) {
      onStatus(`No se pudo eliminar: ${err.message}`, 'error', 4000);
    }
  });

  // ---------- botones generales ----------
  root.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-pl]')?.dataset.pl;
    if (!act) return;
    if (act === 'pick') setPick(!P.pick);
    else if (act === 'start') {
      const o = getOrigin();
      if (o?.ubicacion) {
        P.stops.unshift({ id: nextId(), lat: o.ubicacion.lat, lon: o.ubicacion.lon, nombre: 'Planta · Plásticos Nacionales', direccion: o.direccion, servicioMin: 30, almacen: '__origen__' });
        changed();
      }
    } else if (act === 'compute') compute();
    else if (act === 'optimize') {
      if (P.stops.length < 3) return onStatus('Se necesitan al menos 2 paradas además de la salida para optimizar.', 'info', 3000);
      compute({ optimizar: true });
    } else if (act === 'clear') {
      if (P.stops.length > 1 && !confirm('¿Quitar todas las paradas?')) return;
      P.stops = [];
      ensureStart();
      changed();
    } else if (act === 'fit') map.fitStops(P.stops, padding());
    else if (act === 'save') saveTrip();
    else if (act === 'new') newTrip();
    else if (act === 'copy') {
      const txt = hojaDeRutaTexto({ viaje: P.viaje, paradas: P.stops, plan: P.plan });
      try {
        await navigator.clipboard.writeText(txt);
        onStatus('Hoja de ruta copiada al portapapeles.', 'info', 2500);
      } catch {
        prompt('Copie la hoja de ruta:', txt);
      }
    }
  });

  const whSelect = $('#plWarehouse');
  function fillWarehouses() {
    const items = getWarehouses().filter((i) => i.ubicacion).sort((a, b) => String(a.nombre || a.key).localeCompare(String(b.nombre || b.key), 'es'));
    whSelect.innerHTML = '<option value="">＋ Agregar un almacén como parada…</option>' +
      items.map((i) => `<option value="${escapeHtml(i.key)}">${escapeHtml(i.nombre || i.key)}${i.distrito ? ' — ' + escapeHtml(i.distrito) : ''}</option>`).join('');
  }
  whSelect.addEventListener('change', () => {
    const item = getWarehouses().find((i) => i.key === whSelect.value);
    whSelect.value = '';
    if (item?.ubicacion) addStopFromWarehouse(item);
  });

  function addStopFromWarehouse(item) {
    ensureStart();
    return addStop({ lat: item.ubicacion.lat, lon: item.ubicacion.lon, nombre: item.nombre || item.key, direccion: item.direccion, almacen: item.key });
  }

  // ---------- inicio ----------
  fillForm();
  renderStops();
  renderResult();

  return {
    activate() {
      ensureStart();
      fillWarehouses();
      renderStops();
      drawStops();
      if (!P.viajes.length) loadTrips();
    },
    deactivate() {
      setPick(false);
    },
    addStopFromWarehouse,
    get pickMode() {
      return P.pick;
    },
  };
}
