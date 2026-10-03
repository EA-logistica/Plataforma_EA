import { $, esc } from '../utils/dom.js';
import { fechaCorta, corta, hoyISO } from '../utils/format.js';
import { toast } from '../utils/toast.js';
import * as api from '../api/estado.js';
import { abrirModal, cerrarModal, confirmarEliminacion } from './dispatch.js';
import { renderMateriaPrima } from './materiaPrima.js';
import { renderHomologados } from './homologados.js';
import { renderAbc } from './abc.js';

/**
 * Pestaña "Muestras" de Materia Prima: registro de las muestras que llegan al
 * almacén y sus indicadores para gerencia -cuántas llegan por mes, cuánto se
 * invierte, de qué proveedores, cómo terminan en la evaluación y si salen más
 * baratas que lo que hoy hay en stock-. Los cálculos los hace el servidor
 * (backend/db/repos/muestrasMp.js, resumen()); aquí solo se pintan.
 */

// "Aprobada", "Aprobada c/restricción" y "Rechazada" pasan a la pestaña Homologados (ver backend/db/repos/homologadosMp.js).
const ESTADOS = ['Recibida', 'En evaluación', 'Aprobada', 'Aprobada c/restricción', 'Rechazada'];
const CLASE_ESTADO = {
  'Recibida': 'st-espera', 'En evaluación': 'st-transito', 'Aprobada': 'st-concluido', 'Aprobada c/restricción': 'st-restriccion', 'Rechazada': 'st-cancelado'
};
const FAMILIAS_BASE = ['HDPE SOPLADO', 'HDPE INYECCION', 'PP COPO', 'PP HOMO', 'PP RANDOM', 'LLDPE', 'PETG', 'PVC', 'MASTERBATCH', 'PIGMENTOS', 'ADITIVOS'];

let muestras = [];
let subtab = 'stock';

const dolares = n => 'US$ ' + (Number(n) || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const soles = n => 'S/ ' + (Number(n) || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dinero = (n, moneda) => (moneda === 'PEN' ? soles(n) : dolares(n));
const kg = n => (Number(n) || 0).toLocaleString('es-PE', { maximumFractionDigits: 2 }) + ' kg';
const entero = n => (Number(n) || 0).toLocaleString('es-PE');
const pct = n => (n == null ? '—' : (Math.round(n * 10) / 10).toLocaleString('es-PE') + '%');
const inversion = a => [a.usd ? dolares(a.usd) : '', a.pen ? soles(a.pen) : ''].filter(Boolean).join(' + ') || dolares(0);
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'set', 'oct', 'nov', 'dic'];
const nombreMes = m => MESES[+m.slice(5, 7) - 1] + ' ' + m.slice(2, 4);
const mesHoy = () => hoyISO().slice(0, 7);

const chipEstado = e => '<span class="chip ' + (CLASE_ESTADO[e] || '') + '"><i class="dot"></i>' + esc(e) + '</span>';
const tarjeta = (clase, v, k, d) => '<div class="kpi ' + clase + '"><div class="v">' + v + '</div><div class="k">' + esc(k) + '</div><div class="d">' + d + '</div></div>';

// ------------------------------------------------------------ sub-pestañas
export function subtabMateriaPrima(k = subtab) {
  subtab = k;
  $('mpSubStock').classList.toggle('on', k === 'stock');
  $('mpSubMuestras').classList.toggle('on', k === 'muestras');
  $('mpSubHomologados').classList.toggle('on', k === 'homologados');
  $('mpSubAbc').classList.toggle('on', k === 'abc');
  $('mpPanelStock').style.display = k === 'stock' ? '' : 'none';
  $('mpPanelMuestras').style.display = k === 'muestras' ? '' : 'none';
  $('mpPanelHomologados').style.display = k === 'homologados' ? '' : 'none';
  $('mpPanelAbc').style.display = k === 'abc' ? '' : 'none';
  if (k === 'homologados') return renderHomologados();
  if (k === 'abc') return renderAbc();
  return k === 'stock' ? renderMateriaPrima() : renderMuestras();
}

// ------------------------------------------------------------------ pintar
export async function renderMuestras() {
  if (!$('muMes').value) $('muMes').value = mesHoy();
  let r;
  try {
    [r, muestras] = await Promise.all([api.resumenMuestras($('muMes').value), api.listarMuestras()]);
  } catch (e) {
    $('muMetrics').innerHTML = '<div class="empty"><strong>No se pudo cargar</strong>' + esc(e.message) + '</div>';
    return;
  }
  pintarMetricas(r);
  pintarMeses(r.porMes);
  pintarEmbudo(r);
  pintarFamilias(r.porFamilia);
  pintarProveedores(r.porProveedor);
  filtrarMuestras();
}

function variacion(actual, anterior) {
  if (!anterior) return actual ? 'primer mes con muestras' : 'sin muestras el mes anterior';
  const d = (actual - anterior) / anterior * 100;
  return (d >= 0 ? '▲ ' : '▼ ') + pct(Math.abs(d)) + ' vs. mes anterior (' + entero(anterior) + ')';
}

function pintarMetricas(r) {
  const m = r.mesActual, a = r.anioActual;
  const mesTxt = nombreMes(r.mes);
  const pendiente = r.pendientes[0];
  $('muMetrics').innerHTML = [
    tarjeta('primary', entero(m.muestras), 'Muestras en ' + mesTxt, variacion(m.muestras, r.mesAnterior.muestras)),
    tarjeta('info', kg(m.kg), 'Kg recibidos en ' + mesTxt, 'Año ' + r.anio + ': ' + kg(a.kg)),
    tarjeta('ok', inversion(m), 'Inversión en ' + mesTxt, 'Año ' + r.anio + ': ' + inversion(a)),
    tarjeta('', entero(m.gratuitas), 'Sin costo en ' + mesTxt,
      m.muestras ? pct(m.gratuitas / m.muestras * 100) + ' de las muestras del mes' : 'Muestras de cortesía del proveedor'),
    tarjeta('', entero(m.proveedores), 'Proveedores en ' + mesTxt, entero(r.proveedoresNuevos) + ' nuevo' + (r.proveedoresNuevos === 1 ? '' : 's') + ' (primera muestra)'),
    tarjeta(r.totalPendientes ? 'bad' : 'ok', pct(r.tasaAprobacion), 'Tasa de aprobación ' + r.anio,
      r.totalPendientes ? entero(r.totalPendientes) + ' por evaluar · la más antigua hace ' + pendiente.dias + ' días' : 'Nada pendiente de evaluar')
  ].join('');
}

function pintarMeses(porMes) {
  if (!porMes.some(x => x.muestras)) { $('muMeses').innerHTML = '<div class="empty" style="padding:24px 0"><strong>Sin muestras en estos meses</strong>Registra la primera con "+ Registrar muestra".</div>'; return; }
  const W = 560, H = 200, pb = 34;
  const max = Math.max(...porMes.map(x => x.muestras)) || 1;
  const ancho = W / porMes.length, barra = Math.min(ancho - 8, 26);
  let g = '';
  porMes.forEach((x, i) => {
    const h = Math.max(x.muestras ? 3 : 1, x.muestras / max * (H - pb - 22));
    const cx = i * ancho + ancho / 2, y = H - pb - h;
    const elegido = x.mes === $('muMes').value;
    g += '<g style="cursor:pointer" onclick="irAMesMuestras(\'' + x.mes + '\')">'
      + '<rect x="' + (cx - barra / 2).toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + barra + '" height="' + h.toFixed(1) + '" rx="3"'
      + ' fill="var(--chart-1)" opacity="' + (elegido ? 1 : x.muestras ? .55 : .2) + '"><title>' + nombreMes(x.mes) + ': ' + x.muestras
      + ' muestras · ' + kg(x.kg) + ' · ' + inversion(x) + '</title></rect>'
      + (x.muestras ? '<text x="' + cx.toFixed(1) + '" y="' + (y - 5).toFixed(1) + '" text-anchor="middle" font-size="11" font-weight="700" fill="var(--chart-value)">' + x.muestras + '</text>' : '')
      + '<text x="' + cx.toFixed(1) + '" y="' + (H - 18) + '" text-anchor="middle" font-size="10" fill="var(--chart-label)"' + (elegido ? ' font-weight="800"' : '') + '>' + nombreMes(x.mes) + '</text>'
      + (x.usd ? '<text x="' + cx.toFixed(1) + '" y="' + (H - 5) + '" text-anchor="middle" font-size="9" fill="var(--chart-label)">$' + Math.round(x.usd).toLocaleString('es-PE') + '</text>' : '')
      + '</g>';
  });
  $('muMeses').innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" height="' + H + '" role="img" aria-label="Muestras por mes">' + g + '</svg>';
}

export function irAMesMuestras(mes) { $('muMes').value = mes; renderMuestras(); }

function pintarEmbudo(r) {
  const total = ESTADOS.reduce((a, e) => a + r.estados[e], 0) || 1;
  const barras = ESTADOS.map(e => '<div class="mu-estado"><div class="mu-estado-k">' + chipEstado(e) + '</div>'
    + '<div class="bar-track"><div class="bar-fill mu-' + CLASE_ESTADO[e] + '" style="width:' + (r.estados[e] / total * 100).toFixed(1) + '%"></div></div>'
    + '<b>' + entero(r.estados[e]) + '</b></div>').join('');
  const pendientes = r.pendientes.length
    ? '<div class="paso-sub" style="margin-top:14px">Esperando resultado</div>'
      + r.pendientes.map(p => '<div class="mu-pendiente"><span>' + esc(corta(p.descripcion, 46)) + '<small>' + esc(p.proveedor || '—') + ' · llegó ' + fechaCorta(p.fechaLlegada) + '</small></span>'
        + '<b class="' + (p.dias > 30 ? 'txt-bad' : '') + '">' + p.dias + ' d</b></div>').join('')
      + (r.totalPendientes > r.pendientes.length ? '<p class="muted small">y ' + (r.totalPendientes - r.pendientes.length) + ' más.</p>' : '')
    : '<p class="muted small" style="margin-top:12px">No hay muestras esperando evaluación.</p>';
  $('muEmbudo').innerHTML = barras + pendientes;
}

function pintarFamilias(lista) {
  if (!lista.length) { $('muFamilias').innerHTML = '<div class="empty" style="padding:20px 0"><strong>Sin muestras en el año</strong></div>'; return; }
  const filas = lista.map(f => {
    const d = f.diferenciaPct;
    const dif = d == null ? '<span class="muted">—</span>'
      : '<b class="' + (d < 0 ? 'txt-ok' : 'txt-bad') + '">' + (d < 0 ? '▼ ' : '▲ ') + pct(Math.abs(d)) + '</b>'
        + '<span class="muted small"> ' + (d < 0 ? 'más barata' : 'más cara') + '</span>';
    return '<tr><td><b>' + esc(f.familia) + '</b></td><td class="num">' + entero(f.muestras) + '</td><td class="num">' + kg(f.kg) + '</td>'
      + '<td class="num">' + inversion(f) + '</td>'
      + '<td class="num">' + (f.precioPromedioUsd != null ? dolares(f.precioPromedioUsd) : '<span class="muted">Sin costo</span>') + '</td>'
      + '<td class="num">' + (f.costoStockUsd != null ? dolares(f.costoStockUsd) : '<span class="muted">No hay en stock</span>') + '</td>'
      + '<td>' + dif + '</td><td class="num">' + entero(f.aprobadas) + '</td></tr>';
  }).join('');
  $('muFamilias').innerHTML = '<table><thead><tr><th>Familia</th><th class="num">Muestras</th><th class="num">Kg</th><th class="num">Inversión</th>'
    + '<th class="num">Precio muestra /kg</th><th class="num">Costo en stock /kg</th><th>Muestra vs stock</th><th class="num">Aprobadas</th></tr></thead><tbody>'
    + filas + '</tbody></table>';
}

function pintarProveedores(lista) {
  if (!lista.length) { $('muProveedores').innerHTML = '<div class="empty" style="padding:20px 0"><strong>Sin proveedores en el año</strong></div>'; return; }
  const max = Math.max(...lista.map(p => p.muestras)) || 1;
  $('muProveedores').innerHTML = '<div class="bars">' + lista.map(p => '<div class="bar-row">'
    + '<div class="bar-lbl">' + esc(corta(p.proveedor, 42)) + (p.ruc ? ' <span class="muted small">' + esc(p.ruc) + '</span>' : '') + '</div>'
    + '<div class="bar-val">' + p.muestras + ' muestra' + (p.muestras === 1 ? '' : 's') + ' · ' + kg(p.kg) + ' · ' + inversion(p)
    + ' · ' + p.aprobadas + ' aprobada' + (p.aprobadas === 1 ? '' : 's') + '</div>'
    + '<div class="bar-track"><div class="bar-fill" style="width:' + Math.max(3, p.muestras / max * 100).toFixed(1) + '%"></div></div></div>').join('') + '</div>';
}

export function filtrarMuestras() {
  const q = $('muQ').value.trim().toLowerCase();
  const estado = $('muEstado').value;
  const soloMes = $('muSoloMes').checked;
  const lista = muestras.filter(m =>
    (!estado || m.estado === estado)
    && (!soloMes || m.fechaLlegada.startsWith($('muMes').value))
    && (!q || [m.descripcion, m.familia, m.proveedor, m.rucProveedor, m.codigoProducto].join(' ').toLowerCase().includes(q)));
  if (!lista.length) {
    $('muTabla').innerHTML = '<div class="empty"><strong>' + (muestras.length ? 'Nada coincide con el filtro' : 'Todavía no hay muestras registradas') + '</strong>'
      + (muestras.length ? '' : 'Usa "+ Registrar muestra" o "Pegar desde Excel" para cargar las que ya tienes.') + '</div>';
    return;
  }
  const total = lista.reduce((a, m) => { a[m.moneda] = (a[m.moneda] || 0) + m.subtotal; a.kg += m.cantidadKg; return a; }, { kg: 0 });
  $('muTabla').innerHTML = '<table><thead><tr><th>Llegada</th><th>Proveedor</th><th>Descripción</th><th>Familia</th>'
    + '<th class="num">Cantidad</th><th class="num">Precio /kg</th><th class="num">Subtotal</th><th>Estado</th><th></th></tr></thead><tbody>'
    + lista.map(m => '<tr>'
      + '<td class="nowrap">' + fechaCorta(m.fechaLlegada) + '</td>'
      + '<td class="cell-2">' + esc(corta(m.proveedor || '—', 34)) + '<span>' + (m.rucProveedor ? 'RUC ' + esc(m.rucProveedor) : 'Sin RUC') + '</span></td>'
      + '<td class="cell-2">' + esc(m.descripcion)
      + '<span>' + (m.codigoProducto
        ? 'Cód. <b class="mu-codigo">' + esc(m.codigoProducto) + '</b>' + (m.codigoAuto ? ' · detectado por la descripción' : '')
        : '<span class="txt-bad">Sin código interno</span> · Editar para elegirlo')
      + (m.observaciones ? ' · ' + esc(corta(m.observaciones, 60)) : '') + '</span></td>'
      + '<td>' + esc(m.familia || '—') + '</td>'
      + '<td class="num">' + kg(m.cantidadKg) + '</td>'
      + '<td class="num">' + (m.precioKg ? dinero(m.precioKg, m.moneda) : '<span class="muted">Sin costo</span>') + '</td>'
      + '<td class="num"><b>' + dinero(m.subtotal, m.moneda) + '</b></td>'
      + '<td><select class="mini-select" aria-label="Estado de la muestra" onchange="cambiarEstadoMuestra(' + m.id + ',this.value)">'
      + ESTADOS.map(e => '<option' + (e === m.estado ? ' selected' : '') + '>' + e + '</option>').join('') + '</select></td>'
      + '<td class="nowrap"><button class="btn btn-sm btn-ghost" onclick="editarMuestra(' + m.id + ')">Editar</button> '
      + '<button class="btn btn-sm btn-ghost" onclick="borrarMuestraVista(' + m.id + ')" title="Eliminar">✕</button></td>'
      + '</tr>').join('')
    + '</tbody><tfoot><tr><td colspan="4"><b>' + lista.length + ' muestra' + (lista.length === 1 ? '' : 's') + '</b></td>'
    + '<td class="num"><b>' + kg(total.kg) + '</b></td><td></td><td class="num"><b>'
    + [total.USD ? dolares(total.USD) : '', total.PEN ? soles(total.PEN) : ''].filter(Boolean).join(' + ') + '</b></td><td colspan="2"></td></tr></tfoot></table>';
}

// --------------------------------------------------------------- formulario
function familiasSugeridas() {
  return [...new Set([...FAMILIAS_BASE, ...muestras.map(m => m.familia).filter(Boolean)])].sort();
}

function formularioHTML(m) {
  const v = campo => esc(m && m[campo] != null ? m[campo] : '');
  return '<div class="row">'
    + '<div class="field"><label for="muFecha">Fecha de llegada <span class="req">*</span></label>'
    + '<input class="input" id="muFecha" type="date" value="' + (m ? v('fechaLlegada') : hoyISO()) + '" max="' + hoyISO() + '">'
    + '<div class="hint">Viene con la fecha de hoy; cámbiala si registras una que llegó antes.</div></div>'
    + '<div class="field"><label for="muRuc">RUC del proveedor</label>'
    + '<input class="input" id="muRuc" inputmode="numeric" maxlength="11" placeholder="20601119111" value="' + v('rucProveedor') + '" oninput="buscarProveedorMuestra()">'
    + '<div class="hint" id="muRucAyuda">Al completar los 11 dígitos se busca la razón social.</div></div></div>'
    + '<div class="field"><label for="muProveedor">Razón social</label>'
    + '<input class="input" id="muProveedor" placeholder="Se completa sola con el RUC" value="' + v('proveedor') + '"></div>'
    + '<div class="field"><label for="muDescripcion">Descripción del material <span class="req">*</span></label>'
    + '<input class="input" id="muDescripcion" placeholder="Ej.: HDPE SOPLADO SNETOR HD-5502 (MUESTRA)" value="' + v('descripcion') + '" oninput="detectarCodigoMuestra()"></div>'
    + '<div class="field"><label for="muCodigo">Código interno (ERP)</label>'
    + '<input class="input" id="muCodigo" inputmode="numeric" maxlength="30" placeholder="Se detecta solo por la descripción" value="' + v('codigoProducto') + '" oninput="this.dataset.manual=1">'
    + '<div class="hint" id="muCodigoAyuda">Al escribir la descripción se busca en el catálogo de materia prima del ERP.</div>'
    + '<div id="muCandidatos" class="mu-candidatos"></div></div>'
    + '<div class="row">'
    + '<div class="field"><label for="muFamilia">Familia</label>'
    + '<input class="input" id="muFamilia" list="muFamilias" placeholder="HDPE SOPLADO" value="' + v('familia') + '">'
    + '<datalist id="muFamilias">' + familiasSugeridas().map(f => '<option value="' + esc(f) + '"></option>').join('') + '</datalist></div>'
    + '<div class="field"><label for="muEstadoF">Estado</label><select class="select" id="muEstadoF">'
    + ESTADOS.map(e => '<option' + ((m ? m.estado : 'Recibida') === e ? ' selected' : '') + '>' + e + '</option>').join('') + '</select></div></div>'
    + '<div class="row3">'
    + '<div class="field"><label for="muCantidad">Cantidad (kg) <span class="req">*</span></label>'
    + '<input class="input" id="muCantidad" type="number" min="0" step="0.01" value="' + v('cantidadKg') + '" oninput="subtotalMuestra()"></div>'
    + '<div class="field"><label for="muPrecio">Precio por kg</label>'
    + '<input class="input" id="muPrecio" type="number" min="0" step="0.001" placeholder="0 si es sin costo" value="' + v('precioKg') + '" oninput="subtotalMuestra()"></div>'
    + '<div class="field"><label for="muMoneda">Moneda</label><select class="select" id="muMoneda" onchange="subtotalMuestra()">'
    + '<option value="USD"' + (!m || m.moneda === 'USD' ? ' selected' : '') + '>US$</option><option value="PEN"' + (m && m.moneda === 'PEN' ? ' selected' : '') + '>S/</option></select></div></div>'
    + '<p class="mu-subtotal">Subtotal: <b id="muSubtotal">—</b></p>'
    + '<div class="field"><label for="muObs">Observaciones</label>'
    + '<textarea class="textarea" id="muObs" placeholder="Resultado de la prueba, máquina donde se probó, contacto del proveedor…">' + v('observaciones') + '</textarea></div>'
    + '<div class="err" id="eMuestra"></div>'
    + '<div style="display:flex;gap:8px;flex-wrap:wrap">'
    + '<button class="btn" onclick="guardarMuestra(' + (m ? m.id : 'null') + ')">' + (m ? 'Guardar cambios' : 'Registrar') + '</button>'
    + (m ? '' : '<button class="btn btn-ghost" onclick="guardarMuestra(null,true)" title="Deja la fecha y el proveedor para cargar la siguiente">Registrar y agregar otra</button>')
    + '<button class="btn btn-ghost" onclick="cerrarModal()">Cancelar</button></div>';
}

export function abrirNuevaMuestra(base) {
  abrirModal('Registrar muestra', formularioHTML(null));
  if (base && $('muFecha')) { // "Registrar y agregar otra": se conservan fecha y proveedor
    $('muFecha').value = base.fechaLlegada; $('muRuc').value = base.rucProveedor || ''; $('muProveedor').value = base.proveedor || '';
  }
  subtotalMuestra();
  setTimeout(() => $(base ? 'muDescripcion' : 'muRuc')?.focus(), 50);
}

export function editarMuestra(id) {
  const m = muestras.find(x => x.id === id); if (!m) return;
  abrirModal('Editar muestra', formularioHTML(m));
  subtotalMuestra();
  if (!m.codigoProducto) detectarCodigoMuestra(true);
}

// ------------------------------------------------ código interno por descripción
let codigoPedido = 0;
let codigoTimer = null;

/**
 * Busca en el catálogo de materia prima del ERP el código que corresponde a
 * la descripción. Si la coincidencia es clara y nadie escribió el código a
 * mano, lo completa; si hay duda, deja los candidatos para elegir con un clic.
 */
export function detectarCodigoMuestra(ya = false) {
  clearTimeout(codigoTimer);
  codigoTimer = setTimeout(async () => {
    const desc = $('muDescripcion')?.value.trim() || '';
    if (desc.length < 4) { $('muCandidatos').innerHTML = ''; return; }
    const n = ++codigoPedido;
    let r;
    try { r = await api.sugerirCodigosMuestra(desc); } catch (_) { return; }
    if (n !== codigoPedido || !$('muCodigo')) return;
    const inp = $('muCodigo');
    const manual = inp.dataset.manual === '1';
    if (r.seguro && !manual) inp.value = r.candidatos[0].codigo;
    $('muCodigoAyuda').textContent = !r.candidatos.length ? 'No se encontró en el catálogo del ERP: escribe el código si ya lo tiene.'
      : r.seguro && !manual ? '✓ Detectado en el catálogo del ERP. Puedes cambiarlo eligiendo otro.'
        : 'Hay más de un candidato: elige el que corresponde.';
    $('muCandidatos').innerHTML = r.candidatos.map(c => '<button type="button" class="mu-candidato' + (c.codigo === inp.value ? ' on' : '') + '" onclick="elegirCodigoMuestra(\'' + esc(c.codigo) + '\')">'
      + '<span>' + esc(c.descripcion) + '<small>' + esc(c.linea || 'Sin línea') + ' · stock ' + (Number(c.stock) || 0).toLocaleString('es-PE') + ' ' + esc(c.unidadMedida || '') + ' · coincidencia ' + Math.round(c.puntaje * 100) + '%</small></span>'
      + '<b>' + esc(c.codigo) + '</b></button>').join('');
  }, ya ? 0 : 350);
}

export function elegirCodigoMuestra(codigo) {
  $('muCodigo').value = codigo;
  $('muCodigo').dataset.manual = '1';
  document.querySelectorAll('.mu-candidato').forEach(b => b.classList.toggle('on', b.querySelector('b').textContent === codigo));
  $('muCodigoAyuda').textContent = '✓ Código elegido.';
}

export function subtotalMuestra() {
  if (!$('muCantidad')) return;
  const n = (Number($('muCantidad').value) || 0) * (Number($('muPrecio').value) || 0);
  $('muSubtotal').textContent = n ? dinero(n, $('muMoneda').value) : 'Sin costo';
}

let rucPedido = 0;
/** RUC completo → razón social desde el historial de OC (y de muestras anteriores). */
export async function buscarProveedorMuestra() {
  const inp = $('muRuc');
  inp.value = inp.value.replace(/\D/g, '');
  const ruc = inp.value;
  if (ruc.length !== 11) { $('muRucAyuda').textContent = 'Al completar los 11 dígitos se busca la razón social.'; $('muRucAyuda').className = 'hint'; return; }
  const n = ++rucPedido;
  $('muRucAyuda').textContent = 'Buscando…';
  let r;
  try { r = await api.proveedorPorRuc(ruc); } catch (_) { r = null; }
  if (n !== rucPedido) return;
  if (r && r.proveedor) {
    $('muProveedor').value = r.proveedor;
    $('muRucAyuda').textContent = '✓ Encontrado en el historial de compras.';
    $('muRucAyuda').className = 'hint con-punto';
  } else {
    $('muRucAyuda').textContent = 'No figura en el historial de compras: escribe la razón social.';
    $('muRucAyuda').className = 'hint';
    $('muProveedor').focus();
  }
}

export async function guardarMuestra(id, otra = false) {
  const datos = {
    fechaLlegada: $('muFecha').value, rucProveedor: $('muRuc').value, proveedor: $('muProveedor').value,
    descripcion: $('muDescripcion').value, codigoProducto: $('muCodigo').value.trim(), familia: $('muFamilia').value, estado: $('muEstadoF').value,
    cantidadKg: $('muCantidad').value, precioKg: $('muPrecio').value || 0, moneda: $('muMoneda').value,
    observaciones: $('muObs').value
  };
  let m;
  try {
    m = id ? await api.actualizarMuestra(id, datos) : await api.crearMuestra(datos);
  } catch (e) {
    $('eMuestra').textContent = e.message; $('eMuestra').classList.add('on');
    return;
  }
  toast(id ? 'Muestra actualizada' : 'Muestra registrada', m.descripcion + ' · ' + kg(m.cantidadKg));
  if (otra) abrirNuevaMuestra(m); else cerrarModal();
  renderMuestras();
}

export async function cambiarEstadoMuestra(id, estado) {
  try {
    await api.actualizarMuestra(id, { estado });
    toast('Estado actualizado', 'La muestra quedó como "' + estado + '".');
  } catch (e) { toast('No se pudo actualizar', e.message, 'bad'); }
  renderMuestras();
}

export function borrarMuestraVista(id) {
  const m = muestras.find(x => x.id === id); if (!m) return;
  confirmarEliminacion({
    titulo: 'Eliminar muestra',
    mensaje: 'Se eliminará "' + m.descripcion + '" (' + fechaCorta(m.fechaLlegada) + '). Esta acción no se puede deshacer.',
    onConfirmar: async motivo => { await api.borrarMuestra(id, motivo); toast('Muestra eliminada', m.descripcion, 'warn'); renderMuestras(); }
  });
}

// ------------------------------------------------------- pegar desde Excel
/**
 * Copiar las filas del Excel de muestras y pegarlas acá: mismo orden de
 * columnas que la planilla (RUC · DESCRIPCIÓN · FAMILIA · CANTIDAD ·
 * PRECIO/KG · SUBTOTAL · FECHA DE LLEGADA). El subtotal se ignora -se
 * recalcula- y la fila de títulos, si se copió, se salta sola.
 */
export function abrirPegarMuestras() {
  abrirModal('Pegar muestras desde Excel',
    '<p class="card-note">Copia las filas en Excel (con o sin la fila de títulos) y pégalas aquí. Orden de columnas: '
    + '<b>RUC · Descripción · Familia · Cantidad · Precio/kg · Subtotal · Fecha de llegada</b>.</p>'
    + '<textarea class="textarea mu-pegar" id="muPegado" placeholder="20601119111	PP COPO SINOPEC K8009 M.I 9 (MUESTRA)	PP COPO	200	1.75	350	30/09/2026" oninput="previsualizarPegado()"></textarea>'
    + '<div id="muPrevia"></div><div class="err" id="ePegado"></div>'
    + '<div style="display:flex;gap:8px;margin-top:10px"><button class="btn" id="muImportar" onclick="importarPegado()" disabled>Importar</button>'
    + '<button class="btn btn-ghost" onclick="cerrarModal()">Cancelar</button></div>', { ancho: 'wide' });
}

function filasPegadas() {
  return $('muPegado').value.split(/\r?\n/).map(l => l.split('\t').map(c => c.trim())).filter(c => c.some(Boolean))
    .filter(c => !/ruc|descrip/i.test(c[0] + c[1])) // fila de títulos
    .map(c => ({ rucProveedor: c[0], descripcion: c[1], familia: c[2], cantidadKg: c[3], precioKg: c[4] || 0, fechaLlegada: c[6] || c[5], moneda: 'USD' }));
}

export function previsualizarPegado() {
  const filas = filasPegadas();
  $('muImportar').disabled = !filas.length;
  $('muPrevia').innerHTML = filas.length
    ? '<div class="table-wrap" style="margin-top:10px"><table><thead><tr><th>RUC</th><th>Descripción</th><th>Familia</th><th class="num">Kg</th><th class="num">Precio</th><th>Llegada</th></tr></thead><tbody>'
      + filas.slice(0, 12).map(f => '<tr><td>' + esc(f.rucProveedor) + '</td><td>' + esc(corta(f.descripcion, 44)) + '</td><td>' + esc(f.familia) + '</td>'
        + '<td class="num">' + esc(f.cantidadKg) + '</td><td class="num">' + esc(f.precioKg) + '</td><td>' + esc(f.fechaLlegada) + '</td></tr>').join('')
      + '</tbody></table></div><p class="muted small">' + filas.length + ' fila' + (filas.length === 1 ? '' : 's') + ' lista' + (filas.length === 1 ? '' : 's')
      + ' para importar. La razón social se completa sola con el RUC.</p>'
    : '';
}

export async function importarPegado() {
  const filas = filasPegadas();
  try {
    const r = await api.crearMuestrasLote(filas);
    toast('Muestras importadas', r.creadas + ' muestra' + (r.creadas === 1 ? '' : 's') + ' registrada' + (r.creadas === 1 ? '' : 's') + '.');
  } catch (e) {
    $('ePegado').textContent = e.message; $('ePegado').classList.add('on');
    return;
  }
  cerrarModal();
  renderMuestras();
}
