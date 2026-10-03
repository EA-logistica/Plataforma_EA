import { $, esc } from '../utils/dom.js';
import { corta, fechaCorta } from '../utils/format.js';
import * as api from '../api/estado.js';

/**
 * Pestaña "Homologados" de Materia Prima: las resinas del Excel de
 * homologación (Data_export/), con la categoría que el servidor asigna a
 * cada código (shared/homologados.js: línea del ERP, si no la descripción, si
 * no el grupo del Excel) y lo que el ERP dice de ese código -familia, stock-. Todo llega en una sola respuesta (son ~200 filas):
 * los filtros y el orden se resuelven aquí, sin volver al servidor.
 *
 * Además del Excel trae las resinas del ERP que el Excel no tiene (códigos
 * nuevos de Mongo) y refleja el resultado de las muestras: si en la pestaña
 * Muestras se aprueba, aprueba con restricción o rechaza una muestra con
 * código, ese es el estado que se ve aquí.
 */

const POR_PAGINA = 25;
const CLASE_ESTADO = {
  'Aprobado': 'st-concluido', 'Aprobado c/restricción': 'st-restriccion', 'Rechazado': 'st-cancelado',
  'Sin documentación': 'st-espera', 'En evaluación': 'st-transito'
};
const ORDEN_PREFERENCIA = ['Principal', 'Alternativa', 'Ocasional', 'No usar'];
const COHERENCIA = {
  ok: ['Coincide', 'El grupo del Excel coincide con la categoría detectada'],
  generico: ['Precisada', 'El Excel solo dice "PP COPO"; la descripción precisa el tipo'],
  sin_grupo: ['Sin grupo', 'El Excel no trae grupo equivalente: la categoría sale de la descripción'],
  revisar: ['Revisar', 'Alguna fuente contradice a la categoría elegida']
};
const FUENTE = { erp: 'Por la línea del ERP', descripcion: 'Por la descripción', grupo: 'Por el grupo del Excel' };

let datos = null;
let orden = { k: 'categoria', dir: 'asc' };
let pagina = 1;

const entero = n => (Number(n) || 0).toLocaleString('es-PE');
const cantidad = n => (Number(n) || 0).toLocaleString('es-PE', { maximumFractionDigits: 2 });
const dolares = n => 'US$ ' + (Number(n) || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const normal = v => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
const tarjeta = (clase, v, k, d) => '<div class="kpi ' + clase + '"><div class="v">' + v + '</div><div class="k">' + esc(k) + '</div><div class="d">' + d + '</div></div>';
const aprobado = f => f.estado === 'Aprobado' || f.estado === 'Aprobado c/restricción';

export async function renderHomologados() {
  $('hoTabla').innerHTML = '<div class="empty cargando mp-empty"><strong>Cargando…</strong></div>';
  try {
    datos = await api.listarHomologados();
  } catch (e) {
    $('hoMetrics').innerHTML = '';
    $('hoCategorias').innerHTML = '';
    $('hoTabla').innerHTML = '<div class="empty"><strong>No se pudo cargar</strong>' + esc(e.message) + '</div>';
    return;
  }
  if (!datos.filas.length) {
    $('hoMetrics').innerHTML = '';
    $('hoCategorias').innerHTML = '';
    $('hoTabla').innerHTML = '<div class="empty"><strong>Sin Excel de homologados</strong>Copia «' + esc(datos.archivo) + '» en la carpeta Data_export del servidor.</div>';
    return;
  }
  llenarSelects();
  pintarMetricas();
  pintarCategorias();
  filtrarHomologados();
}

function opciones(id, todos, valores) {
  const el = $(id);
  const actual = el.value;
  el.innerHTML = '<option value="">' + esc(todos) + '</option>' + valores.map(v => '<option>' + esc(v) + '</option>').join('');
  if (valores.includes(actual)) el.value = actual;
}

function llenarSelects() {
  const unicos = k => [...new Set(datos.filas.map(f => f[k]).filter(Boolean))];
  opciones('hoCategoria', 'Todas las categorías', unicos('categoria').sort((a, b) => a.localeCompare(b, 'es')));
  opciones('hoEstado', 'Todos los estados', unicos('estado').sort((a, b) => a.localeCompare(b, 'es')));
  opciones('hoPreferencia', 'Toda preferencia', ORDEN_PREFERENCIA.filter(p => unicos('preferencia').includes(p)).concat('Sin preferencia'));
}

function pintarMetricas() {
  const f = datos.filas;
  const ap = f.filter(aprobado).length;
  const revisar = f.filter(x => x.coherencia === 'revisar').length;
  const conStock = f.filter(x => x.stock > 0);
  const fuera = f.filter(x => !x.enErp).length;
  const nuevos = f.filter(x => x.nuevo).length;
  const fueraExcel = f.filter(x => x.origen !== 'excel').length;
  const porMuestra = f.filter(x => x.fuenteEstado === 'muestra').length;
  $('hoMetrics').innerHTML = [
    tarjeta('primary', entero(f.length), 'Códigos', entero(new Set(f.map(x => x.categoria)).size) + ' categorías · '
      + (datos.disponible ? 'Excel del ' + esc(fechaCorta(datos.actualizado)) : 'sin Excel en Data_export')),
    tarjeta(nuevos ? 'info' : '', entero(nuevos), 'Códigos nuevos', 'Alta en el ERP en los últimos ' + entero(datos.diasNuevo) + ' días · '
      + entero(fueraExcel) + ' fuera del Excel'),
    tarjeta('ok', entero(ap), 'Aprobados', entero(f.filter(x => x.estado === 'Aprobado c/restricción').length) + ' con restricción · '
      + entero(porMuestra) + ' según muestras'),
    tarjeta('', entero(f.filter(x => x.estado === 'Sin registro').length), 'Sin registro', entero(f.filter(x => x.estado === 'Sin documentación').length) + ' sin documentación'),
    tarjeta('info', entero(conStock.length), 'Con stock hoy', dolares(conStock.reduce((a, x) => a + x.valorizadoUsd, 0)) + ' valorizado'),
    tarjeta(revisar ? 'bad' : 'ok', entero(revisar), 'Por revisar', revisar ? 'Grupo del Excel ≠ categoría detectada' : 'Todo coincide'
      + (fuera ? ' · ' + entero(fuera) + ' no están en el ERP' : ''))
  ].join('');
}

function pintarCategorias() {
  const grupos = new Map();
  for (const f of datos.filas) {
    const g = grupos.get(f.categoria) || { categoria: f.categoria, total: 0, aprobados: 0, principal: 0, stock: 0, valorizado: 0, revisar: 0 };
    g.total++;
    if (aprobado(f)) g.aprobados++;
    if (f.preferencia === 'Principal') g.principal++;
    if (f.coherencia === 'revisar') g.revisar++;
    g.valorizado += f.valorizadoUsd;
    if (f.stock > 0) g.stock++;
    grupos.set(f.categoria, g);
  }
  const filas = [...grupos.values()].sort((a, b) => b.total - a.total);
  const max = Math.max(...filas.map(g => g.total));
  $('hoCategorias').innerHTML = '<div class="table-wrap mp-tabla"><table><thead><tr><th>Categoría</th><th class="num">Códigos</th><th class="num">Aprobados</th>'
    + '<th class="num">Principal</th><th class="num">Con stock</th><th class="num">Valorizado</th><th>Peso</th></tr></thead><tbody>'
    + filas.map(g => '<tr class="mp-fila" onclick="filtrarCategoriaHomologados(' + esc(JSON.stringify(g.categoria)) + ')" title="Filtrar la tabla por esta categoría">'
      + '<td><b>' + esc(g.categoria) + '</b>' + (g.revisar ? ' <span class="chip st-cancelado ho-mini">' + g.revisar + ' por revisar</span>' : '') + '</td>'
      + '<td class="num">' + entero(g.total) + '</td><td class="num">' + entero(g.aprobados) + '</td><td class="num">' + entero(g.principal) + '</td>'
      + '<td class="num">' + entero(g.stock) + '</td><td class="num">' + dolares(g.valorizado) + '</td>'
      + '<td><div class="mp-share"><b class="mp-track"><i style="width:' + (g.total / max * 100).toFixed(1) + '%"></i></b></div></td></tr>').join('')
    + '</tbody></table></div>';
}

export function filtrarCategoriaHomologados(categoria) {
  $('hoCategoria').value = $('hoCategoria').value === categoria ? '' : categoria;
  filtrarHomologados();
  $('hoQ').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

export function limpiarFiltrosHomologados() {
  ['hoQ', 'hoCategoria', 'hoEstado', 'hoPreferencia', 'hoOrigen'].forEach(id => { $(id).value = ''; });
  $('hoRevisar').checked = false;
  $('hoConStock').checked = false;
  filtrarHomologados();
}

function filtradas() {
  // Cada palabra debe aparecer (en cualquier orden): "soplado braskem 0.35".
  const palabras = normal($('hoQ').value).split(/\s+/).filter(Boolean);
  const cat = $('hoCategoria').value, est = $('hoEstado').value, pref = $('hoPreferencia').value;
  const revisar = $('hoRevisar').checked, conStock = $('hoConStock').checked, origen = $('hoOrigen').value;
  return datos.filas.filter(f => {
    if (cat && f.categoria !== cat) return false;
    if (est && f.estado !== est) return false;
    if (pref && (pref === 'Sin preferencia' ? f.preferencia : f.preferencia !== pref)) return false;
    if (revisar && f.coherencia !== 'revisar') return false;
    if (origen === 'nuevo' ? !f.nuevo : origen === 'muestra' ? f.fuenteEstado !== 'muestra' : origen && f.origen !== origen) return false;
    if (conStock && !(f.stock > 0)) return false;
    if (palabras.length) {
      const texto = normal(f.nombre + ' ' + f.codigo + ' ' + f.grupoExcel + ' ' + f.lineaErp);
      if (!palabras.every(p => texto.includes(p))) return false;
    }
    return true;
  });
}

const COLUMNAS = [
  { k: 'codigo', t: 'Código', v: f => f.codigo },
  { k: 'nombre', t: 'Descripción', v: f => f.nombre },
  { k: 'categoria', t: 'Categoría detectada', v: f => f.categoria + ' ' + f.nombre },
  { k: 'grupo', t: 'Grupo equiv. (Excel)', v: f => f.grupoExcel },
  { k: 'estado', t: 'Estado', v: f => f.estado },
  { k: 'preferencia', t: 'Preferencia', v: f => { const i = ORDEN_PREFERENCIA.indexOf(f.preferencia); return i === -1 ? 9 : i; } },
  { k: 'stock', t: 'Stock (ERP)', num: true, v: f => f.stock },
  { k: 'coherencia', t: 'Control', v: f => ['revisar', 'sin_grupo', 'generico', 'ok'].indexOf(f.coherencia) }
];

export function ordenarHomologados(k) {
  orden = orden.k === k ? { k, dir: orden.dir === 'asc' ? 'desc' : 'asc' } : { k, dir: k === 'stock' ? 'desc' : 'asc' };
  pintarTabla();
}

export function paginaHomologados(n) { pagina = n; pintarTabla(); }

export function filtrarHomologados() {
  if (!datos) return;
  pagina = 1;
  pintarTabla();
}

function celdaDescripcion(f) {
  const marcas = [
    f.indiceFluidez != null ? 'M.I. ' + cantidad(f.indiceFluidez) : '',
    f.muestra ? 'Muestra' : '', f.agrupacion ? 'Código de agrupación' : '',
    f.enErp ? '' : 'No figura en el ERP'
  ].filter(Boolean);
  return '<div class="cell-2">' + esc(corta(f.nombre, 56)) + '<span>' + esc(marcas.join(' · ')) + '</span></div>';
}

function pintarTabla() {
  const filas = filtradas();
  const col = COLUMNAS.find(c => c.k === orden.k) || COLUMNAS[0];
  const s = orden.dir === 'asc' ? 1 : -1;
  filas.sort((a, b) => {
    const va = col.v(a), vb = col.v(b);
    return (typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), 'es')) * s;
  });
  if (!filas.length) {
    $('hoTabla').innerHTML = '<div class="empty mp-empty"><strong>Sin coincidencias</strong>Prueba con otra palabra o limpia los filtros.</div>';
    return;
  }
  const paginas = Math.ceil(filas.length / POR_PAGINA);
  pagina = Math.min(Math.max(1, pagina), paginas);
  const desde = (pagina - 1) * POR_PAGINA;
  const visibles = filas.slice(desde, desde + POR_PAGINA);

  const thead = COLUMNAS.map(c => {
    const on = c.k === orden.k;
    return '<th class="' + (c.num ? 'num ' : '') + 'mp-th' + (on ? ' on' : '') + '" aria-sort="' + (on ? (orden.dir === 'asc' ? 'ascending' : 'descending') : 'none') + '">'
      + '<button type="button" onclick="ordenarHomologados(\'' + c.k + '\')">' + esc(c.t)
      + '<span class="mp-flecha">' + (on ? (orden.dir === 'asc' ? '▲' : '▼') : '↕') + '</span></button></th>';
  }).join('');
  const tbody = visibles.map(f => {
    const [txtCoh, ayudaCoh] = COHERENCIA[f.coherencia];
    return '<tr' + (f.coherencia === 'revisar' ? ' class="ho-revisar"' : '') + '>'
      + '<td class="tk">' + esc(f.codigo) + (f.conAlerta ? ' <span title="Con observación en el Excel">⚠️</span>' : f.conNota ? ' <span title="Con nota en el Excel">📝</span>' : '')
        + (f.nuevo ? '<div><span class="chip st-transito ho-mini" title="Alta en el ERP el ' + esc(fechaCorta(f.fechaAlta)) + '">Nuevo</span></div>' : '')
        + (f.origen === 'erp' ? '<div class="muted small">No está en el Excel</div>' : f.origen === 'muestra' ? '<div class="muted small">Desde muestras</div>' : '') + '</td>'
      + '<td>' + celdaDescripcion(f) + '</td>'
      + '<td class="cell-2"><b>' + esc(f.categoria) + '</b><span>' + esc(FUENTE[f.fuente] || 'Sin datos para clasificar') + '</span></td>'
      + '<td>' + (f.grupoExcel ? esc(f.grupoExcel) : '<span class="muted">—</span>') + '</td>'
      + '<td><span class="chip ' + (CLASE_ESTADO[f.estado] || '') + '"><i class="dot"></i>' + esc(f.estado) + '</span>'
        + (f.fuenteEstado === 'muestra'
          ? '<div class="muted small" title="Muestra #' + f.muestraRef.id + (f.muestraRef.proveedor ? ' de ' + esc(f.muestraRef.proveedor) : '') + '">Por muestra del ' + esc(fechaCorta(f.muestraRef.fecha))
            + (f.estadoExcel && f.estadoExcel !== f.estado ? ' · Excel: ' + esc(f.estadoExcel) : '') + '</div>'
          : (f.fecha ? '<div class="muted small">' + esc(fechaCorta(f.fecha)) + '</div>' : '')
            + (f.muestraRef ? '<div class="muted small">Muestra: ' + esc(f.muestraRef.estado) + '</div>' : '')) + '</td>'
      + '<td>' + (f.preferencia ? esc(f.preferencia) : '<span class="muted">—</span>') + '</td>'
      + '<td class="num">' + (f.stock > 0 ? cantidad(f.stock) + ' ' + esc(f.unidadMedida || 'KG') + '<div class="muted small">' + dolares(f.valorizadoUsd) + '</div>' : '<span class="muted">Sin stock</span>') + '</td>'
      + '<td><span class="chip ' + (f.coherencia === 'revisar' ? 'st-cancelado' : f.coherencia === 'ok' ? 'st-concluido' : '') + '" title="' + esc(ayudaCoh) + '">' + esc(txtCoh) + '</span>'
        + (f.motivo ? '<div class="muted small ho-motivo">' + esc(f.motivo.charAt(0).toUpperCase() + f.motivo.slice(1)) + '</div>' : '') + '</td>'
      + '</tr>';
  }).join('');
  const pie = '<div class="mp-pie"><span class="muted small">' + (filas.length > POR_PAGINA
    ? 'Mostrando ' + (desde + 1) + '–' + (desde + visibles.length) + ' de ' + entero(filas.length)
    : entero(filas.length) + (filas.length === 1 ? ' código' : ' códigos')) + ' de ' + entero(datos.filas.length) + '</span>'
    + (paginas > 1
      ? '<span class="tools"><button type="button" class="btn btn-sm btn-ghost"' + (pagina <= 1 ? ' disabled' : '') + ' onclick="paginaHomologados(' + (pagina - 1) + ')">‹ Anterior</button>'
        + '<span class="small">Página ' + pagina + ' de ' + paginas + '</span>'
        + '<button type="button" class="btn btn-sm btn-ghost"' + (pagina >= paginas ? ' disabled' : '') + ' onclick="paginaHomologados(' + (pagina + 1) + ')">Siguiente ›</button></span>'
      : '') + '</div>';
  $('hoTabla').innerHTML = '<div class="table-wrap mp-tabla"><table><thead><tr>' + thead + '</tr></thead><tbody>' + tbody + '</tbody></table></div>' + pie;
}
