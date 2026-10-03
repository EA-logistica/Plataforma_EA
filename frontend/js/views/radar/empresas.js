import { $, esc } from '../../utils/dom.js';
import { corta } from '../../utils/format.js';
import * as api from '../../api/radar.js';
import { usd, usdCorto, porKg, toneladas, entero, fecha, tarjeta, tabla, ranking, barras, vacio } from './comun.js';

/** Empresas: importadores por RUC y, al elegir uno, su ficha (qué, de dónde, cada cuánto). */
let lista = [];
let elegida = null;

const normal = v => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();

export function elegirEmpresaRadar(ruc) { elegida = ruc; }
export function buscarEmpresaPorNombre(nombre) { elegida = null; if ($('riEmpresaQ')) $('riEmpresaQ').value = nombre; return nombre; }

export async function pintarEmpresas(cont, filtros, buscar = '') {
  if (!$('riEmpresaQ')) {
    cont.innerHTML = '<div class="filters mp-filtros ri-subfiltros">'
      + '<label class="mp-campo mp-campo-q"><span>Empresa</span><input class="input" id="riEmpresaQ" type="search" placeholder="Razón social o RUC" oninput="filtrarEmpresasRadar()"></label>'
      + '</div><div id="riEmpresaFicha"></div><div id="riEmpresas"></div>';
  }
  if (buscar) $('riEmpresaQ').value = buscar;
  lista = await api.empresasRadar(filtros);
  filtrarEmpresas();
  if (elegida) await pintarFicha(elegida, filtros);
  else $('riEmpresaFicha').innerHTML = '';
}

export function filtrarEmpresas() {
  const q = normal($('riEmpresaQ').value).trim();
  const filas = q ? lista.filter(e => normal(e.name + ' ' + e.ruc).includes(q)) : lista;
  $('riEmpresas').innerHTML = '<div class="panel"><h3>Importadores</h3><p class="sub">' + entero(filas.length) + ' de ' + entero(lista.length)
    + ' con estos filtros, por FOB. Clic en una para ver su ficha.</p>'
    + tabla(filas.slice(0, 200), [
      { t: 'Empresa', h: e => '<div class="cell-2">' + esc(corta(e.name || '—', 46)) + '<span>RUC ' + esc(e.ruc) + '</span></div>' },
      { t: 'FOB', num: true, h: e => usd(e.fob_usd) },
      { t: 'Volumen', num: true, h: e => toneladas(e.tonnes) },
      { t: 'Declaraciones', num: true, h: e => entero(e.operations) },
      { t: 'Primera · última', h: e => '<span class="nowrap">' + fecha(e.first) + ' · ' + fecha(e.last) + '</span>' }
    ], { clic: i => 'verEmpresaRadar(\'' + filas[i].ruc + '\')', vacia: 'Ninguna empresa coincide' })
    + '</div>';
}

async function pintarFicha(ruc, filtros) {
  const e = await api.empresaRadar(ruc, filtros);
  const s = e.summary;
  $('riEmpresaFicha').innerHTML = '<div class="panel ri-ficha-empresa"><div class="mp-cabecera"><div><h3>' + esc(e.name || 'RUC ' + ruc) + '</h3>'
    + '<p class="sub">RUC ' + esc(ruc) + ' · ' + fecha(s.start) + ' – ' + fecha(s.end) + '</p></div>'
    + '<button class="btn btn-sm btn-ghost" onclick="cerrarEmpresaRadar()">Cerrar ficha</button></div>'
    + (!s.series ? vacio('Sin series con estos filtros') : '<div class="kpis">'
      + tarjeta('primary', usdCorto(s.fob_usd), 'FOB', toneladas(s.tonnes))
      + tarjeta('', porKg(s.usd_kg), 'FOB por kg', 'Ponderado')
      + tarjeta('', entero(s.operations), 'Declaraciones', entero(s.series) + ' series')
      + tarjeta('info', e.mean_days_between_active_dates == null ? '—' : entero(Math.round(e.mean_days_between_active_dates)) + ' días', 'Frecuencia', 'Promedio entre fechas con importación')
      + '</div>'
      + barras(e.trend, {
        etiqueta: p => p.period.slice(8, 10) + '/' + p.period.slice(5, 7), valor: p => p.fob_usd, alto: 150,
        titulo: p => 'Semana del ' + fecha(p.period) + ': ' + usd(p.fob_usd) + ' · ' + toneladas(p.tonnes) + ' · ' + porKg(p.usd_kg)
      })
      + '<div class="grid2"><div><h4>Materiales</h4>' + ranking(e.materials) + '</div><div><h4>Países de origen</h4>' + ranking(e.countries, { nombre: f => f.name || 'Sin país' }) + '</div></div>')
    + '</div>';
  $('riEmpresaFicha').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
