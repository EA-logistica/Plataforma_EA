import nodemailer from 'nodemailer';
import { todos, uno } from '../db/conexion.js';
import * as importaciones from '../db/repos/importaciones.js';
import * as mpPlaneacion from '../db/repos/mpPlaneacion.js';
import * as ajustes from '../db/repos/ajustes.js';
import { CONFIG } from '../config.js';
import { sumarDias } from '#shared/importaciones.js';
import { ETIQUETA_REORDEN } from '#shared/abc.js';

/**
 * Reporte semanal para gerencia: una página HTML autocontenida (estilos en
 * línea, sin scripts ni recursos externos) que sirve igual para abrirla y
 * guardarla como PDF desde el navegador que para mandarla como cuerpo de un
 * correo. Resume la semana que terminó ayer:
 *   - importaciones: en curso, atrasadas, llegadas próximas y pagos;
 *   - materia prima: clase A por pedir y capital inmovilizado (ABC);
 *   - mensajería: servicios y costo de la semana frente a la anterior.
 *
 * El correo se manda solo si hay SMTP y destinatarios en .env (ver
 * CONFIG.reporte); si no, el reporte igual se puede abrir a mano.
 */

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const usd = n => 'US$ ' + Math.round(Number(n) || 0).toLocaleString('es-PE');
const soles = n => 'S/ ' + (Number(n) || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const entero = n => (Number(n) || 0).toLocaleString('es-PE');
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'set', 'oct', 'nov', 'dic'];
const fecha = f => (f ? f.slice(8, 10) + '-' + MESES[Number(f.slice(5, 7)) - 1] + '-' + f.slice(2, 4) : '—');
const variacion = (a, b) => (!b ? '' : (a >= b ? '▲ ' : '▼ ') + Math.abs((a - b) / b * 100).toFixed(0) + '% vs. semana anterior');

async function mensajeria(desde, hasta) {
  // `creado` es ISO en UTC: el rango se compara como texto, con hasta+1 día exclusivo.
  return uno(
    "SELECT COUNT(*) FILTER (WHERE estado <> 'Cancelado') AS servicios, "
    + "COALESCE(SUM(costo) FILTER (WHERE estado <> 'Cancelado'), 0) AS costo, "
    + "COUNT(*) FILTER (WHERE estado = 'Cancelado') AS cancelados "
    + 'FROM solicitudes WHERE creado >= ? AND creado < ?',
    [desde, sumarDias(hasta, 1)]
  );
}

export async function datos(hoy = importaciones.hoyLima()) {
  const hasta = sumarDias(hoy, -1), desde = sumarDias(hoy, -7);
  const [imp, abc, semana, previa, muestras] = await Promise.all([
    importaciones.listar(hoy),
    mpPlaneacion.abc(),
    mensajeria(desde, hasta),
    mensajeria(sumarDias(desde, -7), sumarDias(hasta, -7)),
    todos("SELECT estado, COUNT(*) AS n FROM muestras_mp WHERE estado IN ('Recibida', 'En evaluación') GROUP BY estado").catch(() => [])
  ]);
  return { hoy, desde, hasta, imp, abc, semana, previa, muestrasPendientes: muestras.reduce((a, m) => a + Number(m.n), 0) };
}

const tile = (valor, titulo, detalle, tono = '#1B4E8E') =>
  '<td style="padding:6px;width:25%;vertical-align:top"><div style="border:1px solid #DFE4EC;border-left:3px solid ' + tono + ';border-radius:8px;padding:12px 14px">'
  + '<div style="font:650 20px/1.2 Consolas,monospace;color:#1D1D1F">' + esc(valor) + '</div>'
  + '<div style="font:600 12px/1.4 Segoe UI,Arial,sans-serif;color:#565E6C;margin-top:4px">' + esc(titulo) + '</div>'
  + '<div style="font:11px/1.4 Segoe UI,Arial,sans-serif;color:#7A8291">' + esc(detalle) + '</div></div></td>';
const fila = tiles => '<table role="presentation" style="width:100%;border-collapse:collapse;margin:0 0 6px"><tr>' + tiles.join('') + '</tr></table>';
const titulo = t => '<h2 style="font:700 15px/1.3 Segoe UI,Arial,sans-serif;color:#1D1D1F;margin:22px 0 8px;padding-bottom:6px;border-bottom:2px solid #1B4E8E">' + esc(t) + '</h2>';
function tabla(cols, filas) {
  if (!filas.length) return '<p style="font:12px Segoe UI,Arial,sans-serif;color:#7A8291">Nada pendiente.</p>';
  const th = c => '<th style="text-align:' + (c.num ? 'right' : 'left') + ';padding:6px 8px;background:#F4F6F9;font:600 11px Segoe UI,Arial,sans-serif;color:#565E6C;border-bottom:1px solid #DFE4EC">' + esc(c.t) + '</th>';
  const td = (c, v) => '<td style="text-align:' + (c.num ? 'right' : 'left') + ';padding:6px 8px;font:' + (c.num ? '12px Consolas,monospace' : '12px Segoe UI,Arial,sans-serif') + ';color:#1D1D1F;border-bottom:1px solid #ECEFF4">' + v + '</td>';
  return '<table style="width:100%;border-collapse:collapse"><thead><tr>' + cols.map(th).join('') + '</tr></thead><tbody>'
    + filas.map(f => '<tr>' + cols.map(c => td(c, c.h(f))).join('') + '</tr>').join('') + '</tbody></table>';
}

export function html(d) {
  const k = d.imp.resumen.kpis;
  const atrasadas = d.imp.filas.filter(i => i.atraso > 0).slice(0, 10);
  const proximas = d.imp.filas.filter(i => i.enCurso && i.diasParaProxima != null && i.diasParaProxima >= 0 && i.diasParaProxima <= 14)
    .sort((a, b) => a.diasParaProxima - b.diasParaProxima).slice(0, 10);
  const pagos = d.imp.resumen.pagos.filter(p => p.fecha && p.diasParaPago <= 14).slice(0, 12);
  const r = d.abc.resumen;
  const pedirA = d.abc.filas.filter(f => f.clase === 'A' && (f.estado === 'pedir' || f.estado === 'pronto')).slice(0, 12);
  const s = d.semana, p = d.previa;
  return '<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Reporte semanal · Logística</title>'
    + '<style>@media print{body{margin:0}@page{margin:14mm}}</style></head>'
    + '<body style="margin:0;padding:24px;background:#FFFFFF"><div style="max-width:880px;margin:0 auto">'
    + '<div style="font:700 11px Segoe UI,Arial,sans-serif;letter-spacing:.08em;color:#2FA84F;text-transform:uppercase">Plásticos Nacionales · Logística</div>'
    + '<h1 style="font:750 22px/1.3 Segoe UI,Arial,sans-serif;color:#1D1D1F;margin:4px 0 2px">Reporte semanal</h1>'
    + '<div style="font:12px Segoe UI,Arial,sans-serif;color:#565E6C">Semana del ' + fecha(d.desde) + ' al ' + fecha(d.hasta) + ' · generado el ' + fecha(d.hoy) + '</div>'

    + titulo('Importaciones')
    + fila([
      tile(entero(k.enCurso), 'Importaciones en curso', usd(k.valorEnCurso) + ' puesto en planta'),
      tile(entero(k.atrasadas), 'Atrasadas', k.atrasadas ? usd(k.valorAtrasado) + ' comprometidos' : 'Todo a tiempo', k.atrasadas ? '#B0271E' : '#1F8A46'),
      tile(entero(k.llegan30), 'Llegan en 30 días', usd(k.valorLlegan30)),
      tile(usd(k.pagos30), 'Pagos en 30 días', k.nPagosVencidos ? k.nPagosVencidos + ' vencidos: ' + usd(k.pagosVencidos) : 'Sin pagos vencidos', k.nPagosVencidos ? '#9A6412' : '#1B4E8E')
    ])
    + '<h3 style="font:650 13px Segoe UI,Arial,sans-serif;margin:14px 0 6px">Atrasadas</h3>'
    + tabla([
      { t: 'OC', h: i => esc(i.oc || 'Solicitud') }, { t: 'Producto', h: i => esc(i.descripcion) }, { t: 'Proveedor', h: i => esc(i.proveedor) },
      { t: 'Etapa', h: i => esc(i.etiquetaEstado) }, { t: 'Atraso', num: true, h: i => i.atraso + ' d' }, { t: 'Costo', num: true, h: i => usd(i.costoPlanta) }
    ], atrasadas)
    + '<h3 style="font:650 13px Segoe UI,Arial,sans-serif;margin:14px 0 6px">Próximas llegadas (14 días)</h3>'
    + tabla([
      { t: 'OC', h: i => esc(i.oc || 'Solicitud') }, { t: 'Producto', h: i => esc(i.descripcion) },
      { t: 'Etapa', h: i => esc(i.etiquetaEstado) }, { t: 'Fecha', h: i => fecha(i.proxima) }, { t: 'Costo', num: true, h: i => usd(i.costoPlanta) }
    ], proximas)
    + '<h3 style="font:650 13px Segoe UI,Arial,sans-serif;margin:14px 0 6px">Pagos de los próximos 14 días</h3>'
    + tabla([
      { t: 'Fecha', h: x => fecha(x.fecha) + (x.vencido ? ' <b style="color:#B0271E">vencido</b>' : '') }, { t: 'Concepto', h: x => esc(x.tipo) },
      { t: 'OC', h: x => esc(x.oc || '—') }, { t: 'Proveedor', h: x => esc(x.proveedor) }, { t: 'Monto', num: true, h: x => usd(x.monto) }
    ], pagos)

    + titulo('Materia prima · clasificación ABC')
    + fila([
      tile(entero(r.clases[0].n), 'Códigos clase A', (r.clases[0].pct * 100).toFixed(0) + '% del consumo valorizado'),
      tile(entero(r.pedirA), 'Clase A por pedir', r.pedirA ? 'En o bajo el punto de reorden' : 'Clase A cubierta', r.pedirA ? '#B0271E' : '#1F8A46'),
      tile(usd(r.inmovilizadoUsd), 'Stock sin consumo', entero(r.inmovilizados) + ' códigos sin consumo en 12 meses', '#9A6412'),
      tile(usd(r.excesoUsd), 'Exceso de stock', 'Por encima de 8 meses de cobertura', '#9A6412')
    ])
    + tabla([
      { t: 'Código', h: f => esc(f.codigo) }, { t: 'Descripción', h: f => esc(f.descripcion) },
      { t: 'Estado', h: f => esc(ETIQUETA_REORDEN[f.estado]) },
      { t: 'Cobertura', num: true, h: f => (f.coberturaTotal == null ? '—' : f.coberturaTotal.toFixed(1) + ' m') },
      { t: 'Compra sugerida', num: true, h: f => usd(f.compraSugeridaUsd) }
    ], pedirA)

    + titulo('Mensajería')
    + fila([
      tile(entero(s.servicios), 'Servicios de la semana', variacion(Number(s.servicios), Number(p.servicios)) || 'Sin semana anterior para comparar'),
      tile(soles(s.costo), 'Costo de la semana', variacion(Number(s.costo), Number(p.costo)) || '—'),
      tile(entero(s.cancelados), 'Cancelados', 'Fuera del costo', s.cancelados ? '#9A6412' : '#1B4E8E'),
      tile(entero(d.muestrasPendientes), 'Muestras por evaluar', 'Materia prima recibida sin resultado')
    ])
    + '<p style="font:11px Segoe UI,Arial,sans-serif;color:#7A8291;margin-top:22px">Montos en US$ sin IGV. Datos del ERP y del bot de logística según la última sincronización con MongoDB.</p>'
    + '</div></body></html>';
}

export async function generar(hoy) {
  const d = await datos(hoy);
  return { asunto: 'Reporte semanal de logística · ' + fecha(d.desde) + ' al ' + fecha(d.hasta), html: html(d) };
}

export const correoConfigurado = () => Boolean(CONFIG.reporte.smtp.host && CONFIG.reporte.para.length);

export async function enviar(hoy) {
  if (!correoConfigurado()) throw Object.assign(new Error('Falta configurar SMTP_HOST y REPORTE_PARA en .env para enviar el reporte por correo.'), { status: 503 });
  const { smtp, para } = CONFIG.reporte;
  const transporte = nodemailer.createTransport({
    host: smtp.host, port: smtp.port, secure: smtp.port === 465,
    auth: smtp.usuario ? { user: smtp.usuario, pass: smtp.clave } : undefined
  });
  const r = await generar(hoy);
  await transporte.sendMail({ from: smtp.de, to: para.join(', '), subject: r.asunto, html: r.html });
  return { enviado: true, para, asunto: r.asunto };
}

/**
 * Envío automático: cada 10 minutos mira si ya es el día y la hora (Lima)
 * configurados y si esta semana todavía no salió. Lo anota en ajustes para
 * que un reinicio no lo mande dos veces.
 */
export function programarEnvio() {
  if (!correoConfigurado()) return;
  const revisar = async () => {
    try {
      const lima = new Date(Date.now() - 5 * 3600000);
      if (lima.getUTCDay() !== CONFIG.reporte.dia || lima.getUTCHours() < CONFIG.reporte.hora) return;
      const hoy = lima.toISOString().slice(0, 10);
      if ((await ajustes.leer('reporte_semanal_enviado', '')) === hoy) return;
      await enviar(hoy);
      await ajustes.escribir('reporte_semanal_enviado', hoy);
      console.log('  reporte      semanal enviado a ' + CONFIG.reporte.para.join(', '));
    } catch (e) {
      console.error('[reporte] no se pudo enviar el reporte semanal:', e.message);
    }
  };
  setInterval(revisar, 10 * 60 * 1000).unref();
  revisar();
}
