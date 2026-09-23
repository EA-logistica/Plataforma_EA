import { $, esc } from '../utils/dom.js';
import { fechaCorta, soles, solesK, horasEntre, corta } from '../utils/format.js';
import { DB } from '../api/estado.js';
import { origenCorto } from './presenters.js';

/**
 * Panel de indicadores: tarjetas KPI y gráficos (barras horizontales y
 * columnas SVG) sobre el rango de fechas seleccionado.
 */
let filtroKpi = 0;

export function setFiltroKpi(d) { filtroKpi = d; renderKpi(); }
export function renderKpiSiVisible() { if ($('aKpi').classList.contains('on')) renderKpi(); }

function barras(items, total, clase) {
  if (!items.length) return '<div class="empty" style="padding:26px 0"><strong>Sin datos todavía</strong>Los gráficos se llenan cuando haya servicios registrados.</div>';
  const max = Math.max.apply(null, items.map(i => i.v)) || 1;
  return '<div class="bars">' + items.map(i =>
    '<div class="bar-row ' + (clase || '') + '">'
    + '<div class="bar-lbl">' + esc(i.k) + '</div>'
    + '<div class="bar-val">' + esc(i.t) + '</div>'
    + '<div class="bar-track"><div class="bar-fill" style="width:' + Math.max(2, (i.v / max) * 100).toFixed(1) + '%"></div></div>'
    + '</div>').join('') + '</div>';
}

function columnas(dias) {
  if (!dias.length) return '<div class="empty" style="padding:26px 0"><strong>Sin movimiento en el rango</strong>Amplía el filtro de fechas.</div>';
  const W = 520, H = 180, pb = 26, pl = 4;
  const max = Math.max.apply(null, dias.map(d => d.v)) || 1;
  const ancho = (W - pl * 2) / dias.length;
  const barra = Math.min(ancho - 4, 22);
  let g = '';
  // guías horizontales (los colores salen de las variables CSS del tema activo)
  for (let i = 0; i <= 2; i++) {
    const y = (H - pb) - ((H - pb) * i / 2);
    g += '<line x1="0" y1="' + y.toFixed(1) + '" x2="' + W + '" y2="' + y.toFixed(1) + '" stroke="var(--chart-grid)" stroke-width="1"/>';
  }
  dias.forEach((d, i) => {
    const h = Math.max(2, (d.v / max) * (H - pb - 14));
    const x = pl + i * ancho + (ancho - barra) / 2;
    const y = (H - pb) - h;
    g += '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + barra.toFixed(1) + '" height="' + h.toFixed(1) + '" rx="3" fill="var(--chart-1)" opacity="' + (d.v ? 1 : .3) + '"><title>' + d.k + ': ' + d.v + ' servicios</title></rect>';
    if (d.v) g += '<text x="' + (x + barra / 2).toFixed(1) + '" y="' + (y - 5).toFixed(1) + '" fill="var(--chart-value)" font-size="10" font-family="ui-monospace,monospace" text-anchor="middle">' + d.v + '</text>';
    if (i % 3 === 0 || i === dias.length - 1)
      g += '<text x="' + (x + barra / 2).toFixed(1) + '" y="' + (H - 8) + '" fill="var(--chart-label)" font-size="10" font-family="ui-monospace,monospace" text-anchor="middle">' + d.k.slice(0, 5) + '</text>';
  });
  return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" height="' + H + '" role="img" aria-label="Servicios por día">' + g + '</svg>';
}

export function renderKpi() {
  const corte = new Date(); corte.setHours(0, 0, 0, 0); corte.setDate(corte.getDate() - (filtroKpi - 1));
  const todo = filtroKpi === 0;
  const enRango = DB.solicitudes.filter(s => todo || new Date(s.creado) >= corte);
  // Un servicio cancelado no se ejecutó: no debe inflar "viajes totales" ni
  // el valorizado, ni aparecer entre los rankings. Se cuenta aparte, en su
  // propia tarjeta, porque igual es información operativa útil.
  const cancelados = enRango.filter(s => s.estado === 'Cancelado').length;
  const lista = enRango.filter(s => s.estado !== 'Cancelado');

  $('fKpi').innerHTML = [[7, '7 días'], [30, '30 días'], [90, '90 días'], [0, 'Todo']]
    .map(([d, l]) => '<button class="fchip' + (filtroKpi === d ? ' on' : '') + '" onclick="setFiltroKpi(' + d + ')">' + l + '</button>').join('');

  const conCosto = lista.filter(s => s.costo != null);
  const costoTotal = conCosto.reduce((a, s) => a + s.costo, 0);
  const concluidos = lista.filter(s => s.estado === 'Concluido');
  const enCurso = lista.filter(s => s.estado !== 'Concluido');

  const diasSet = new Set(lista.map(s => s.creado.slice(0, 10)));
  const diasHabiles = Math.max(1, diasSet.size);
  const promDia = lista.length / diasHabiles;

  const tiempos = concluidos.map(s => horasEntre(s.tsEspera, s.tsConcluido)).filter(h => h != null);
  const promAtencion = tiempos.length ? tiempos.reduce((a, b) => a + b, 0) / tiempos.length : null;

  $('kpiRango').textContent = todo
    ? 'Todo el histórico · ' + lista.length + ' servicios'
    : 'Últimos ' + filtroKpi + ' días · ' + fechaCorta(corte) + ' al ' + fechaCorta(new Date());

  $('kpiCards').innerHTML = [
    { c: 'primary', v: lista.length, k: 'Viajes totales', d: diasSet.size + ' días con movimiento' },
    { c: 'ok', v: solesK(costoTotal), k: 'Costo valorizado', d: conCosto.length + ' de ' + lista.length + ' con tarifa cargada' },
    { c: '', v: promDia.toFixed(1), k: 'Promedio de viajes al día', d: 'Sobre días con actividad' },
    { c: '', v: conCosto.length ? soles(costoTotal / conCosto.length) : 'N/D', k: 'Costo promedio por viaje', d: 'Solo servicios tarifados' },
    { c: 'info', v: enCurso.length, k: 'En curso', d: lista.filter(s => s.estado === 'En espera').length + ' en espera · ' + lista.filter(s => s.estado === 'En tránsito').length + ' en tránsito' },
    { c: '', v: promAtencion != null ? promAtencion.toFixed(1) + ' h' : 'N/D', k: 'Atención de punta a punta', d: 'Del registro al cierre' },
    { c: cancelados ? 'bad' : '', v: cancelados, k: 'Cancelados', d: 'No se ejecutaron; fuera del valorizado' }
  ].map(x => '<div class="kpi ' + x.c + '"><div class="v">' + x.v + '</div><div class="k">' + x.k + '</div><div class="d">' + x.d + '</div></div>').join('');

  // servicios por día: los últimos 21 días CON movimiento, no los 21 últimos
  // del calendario, que con un histórico cerrado saldrían todos en cero.
  const porDia = new Map();
  lista.forEach(s => {
    const iso = s.creado.slice(0, 10);
    porDia.set(iso, (porDia.get(iso) || 0) + 1);
  });
  const dias = [...porDia.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-21)
    .map(([iso, v]) => ({ k: iso.slice(8) + '/' + iso.slice(5, 7), v }));
  $('chDias').innerHTML = columnas(dias);

  // gasto por mes
  const porMes = new Map();
  lista.forEach(s => {
    const mes = s.creado.slice(0, 7);
    const o = porMes.get(mes) || { n: 0, c: 0 };
    o.n++; o.c += (s.costo || 0);
    porMes.set(mes, o);
  });
  const MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'set', 'oct', 'nov', 'dic'];
  $('chMeses').innerHTML = barras(
    [...porMes.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([mes, o]) => ({
      k: MES[+mes.slice(5) - 1] + ' ' + mes.slice(0, 4),
      v: o.c,
      t: soles(o.c) + ' · ' + o.n + ' viajes · ' + soles(o.n ? o.c / o.n : 0) + '/viaje'
    })), null, 'c3');

  // costo por sede de origen
  const sedes = {};
  lista.forEach(s => { const k = origenCorto(s); sedes[k] = sedes[k] || { n: 0, c: 0 }; sedes[k].n++; sedes[k].c += (s.costo || 0); });
  $('chSedes').innerHTML = barras(
    Object.entries(sedes).sort((a, b) => b[1].c - a[1].c)
      .map(([k, o]) => ({ k, v: o.c, t: soles(o.c) + ' · ' + o.n + ' viajes' })), null, 'c3');

  // ranking de solicitantes
  const users = {};
  lista.forEach(s => {
    const k = s.dni || s.nombre;
    users[k] = users[k] || { n: 0, c: 0, nombre: s.nombre, dni: s.dni };
    users[k].n++; users[k].c += (s.costo || 0);
  });
  $('chUsuarios').innerHTML = barras(
    Object.values(users).sort((a, b) => b.n - a.n).slice(0, 8)
      .map(o => ({ k: corta(o.nombre, 34) + (o.dni ? ' · DNI ' + o.dni : ''), v: o.n, t: o.n + ' viajes · ' + soles(o.c) })));

  // ranking de destinos
  const dest = {};
  lista.forEach(s => { const k = s.destino.split(',')[0].trim(); dest[k] = dest[k] || { n: 0, c: 0 }; dest[k].n++; dest[k].c += (s.costo || 0); });
  $('chDestinos').innerHTML = barras(
    Object.entries(dest).sort((a, b) => b[1].n - a[1].n).slice(0, 8)
      .map(([k, o]) => ({ k: corta(k, 40), v: o.n, t: o.n + ' visitas · ' + soles(o.c) })), null, 'c2');

  // ranking de distritos: la dirección viene "Lugar, calle, DISTRITO" -el
  // distrito es siempre el último tramo separado por coma-, así que agrupar
  // por ahí responde una pregunta distinta de "destinos más frecuentes"
  // (que agrupa por el lugar puntual, el primer tramo): a qué zona de Lima se
  // dirige más la mensajería, no a qué empresa.
  const distr = {};
  lista.forEach(s => {
    const partes = s.destino.split(',');
    const k = partes[partes.length - 1].trim();
    if (!k) return;
    distr[k] = distr[k] || { n: 0, c: 0 };
    distr[k].n++; distr[k].c += (s.costo || 0);
  });
  $('chDistritos').innerHTML = barras(
    Object.entries(distr).sort((a, b) => b[1].n - a[1].n).slice(0, 10)
      .map(([k, o]) => ({ k: corta(k, 40), v: o.n, t: o.n + ' visitas · ' + soles(o.c) })), null, 'c2');

  // vehículos
  const veh = {};
  lista.filter(s => s.vehiculo).forEach(s => { veh[s.vehiculo] = veh[s.vehiculo] || { n: 0, c: 0 }; veh[s.vehiculo].n++; veh[s.vehiculo].c += (s.costo || 0); });
  $('chVehiculo').innerHTML = barras(
    Object.entries(veh).sort((a, b) => b[1].n - a[1].n)
      .map(([k, o]) => ({ k, v: o.n, t: o.n + ' viajes · ' + soles(o.c) + ' · ' + soles(o.n ? o.c / o.n : 0) + '/viaje' })), null, 'c4');

  // tiempos del flujo
  const prom = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
  const tEspera = prom(lista.map(s => horasEntre(s.tsEspera, s.tsTransito)).filter(h => h != null));
  const tRuta = prom(lista.map(s => horasEntre(s.tsTransito, s.tsConcluido)).filter(h => h != null));
  const filasT = [];
  if (tEspera != null) filasT.push({ k: 'Registro → salida', v: tEspera, t: tEspera.toFixed(1) + ' h' });
  if (tRuta != null) filasT.push({ k: 'Salida → cierre', v: tRuta, t: tRuta.toFixed(1) + ' h' });
  if (promAtencion != null) filasT.push({ k: 'Ciclo completo', v: promAtencion, t: promAtencion.toFixed(1) + ' h' });
  $('chTiempos').innerHTML = barras(filasT, null, 'c2');
}
