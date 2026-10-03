/**
 * Pruebas de los cálculos puros de Importaciones (shared/importaciones.js) y
 * de la clasificación ABC (shared/abc.js). Sin servidor ni base:
 *
 *     node tests/importacionesAbc.mjs
 */
import { normalizar, analizar, resumir, ratiosServicio, pagosPendientes, dias } from '../shared/importaciones.js';
import { clasificar, resumir as resumirAbc } from '../shared/abc.js';

let fallos = 0;
const ok = (cond, msg) => { console.log((cond ? '  ok   ' : '  FALLA') + ' ' + msg); if (!cond) fallos++; };
const cerca = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

console.log('\n-- importaciones: normalizar --');
const HOY = '2026-10-02';
const doc = (extra = {}) => ({
  _id: 'x1', oc_numero: '4512784.0', descripcion: 'MAQUINA DE CORTE', proveedor: 'ZHANGJIAGANG LONGSN',
  codigo_producto: '10027094', familia_nombre: 'ACTIVOS FIJOS', moneda: 'USD', valor_compra: 7800, impuesto: 1404,
  estado_comercial: 'ORDEN_CONFIRMADA', estado_pago: 'PENDIENTE', estado_documentario: 'PENDIENTE', prioridad: 'NORMAL',
  fecha_emision: new Date('2026-06-30T00:00:00Z'), eta: new Date('2026-07-28T00:00:00Z'), fecha_llegada_planta: new Date('2026-07-31T00:00:00Z'),
  oc_estado: 'APROBADA', incoterm: 'PENDIENTE', ...extra
});
const n = normalizar(doc());
ok(n.oc === '4512784' && n.eta === '2026-07-28' && n.planta === '2026-07-31', 'OC sin ".0" y fechas como YYYY-MM-DD');
ok(n.incoterm === '', '"PENDIENTE" del bot no cuenta como dato');
ok(normalizar(doc({ excluido: true })) === null && normalizar(doc({ fusionada_en: 'abc' })) === null, 'lo excluido o fusionado por el bot no entra');
ok(normalizar(doc({ oc_numero: null, es_solicitud: true })).esSolicitud, 'sin OC es una solicitud');
const consolidada = normalizar(doc({ descripcion: '3 ítems consolidados', erp: { items: [{ descripcion: 'TINTA ROJA' }, { descripcion: 'TINTA AZUL' }, { descripcion: 'THINNER' }] } }));
ok(consolidada.descripcion === 'TINTA ROJA (+2 ítems)' && consolidada.items.length === 3, '"N ítems consolidados" se reemplaza por el primer ítem y cuántos más');

console.log('\n-- importaciones: analizar --');
const a = analizar(n, HOY, { OTRO: 0.06 });
ok(a.atrasoPuerto === 66 && a.atrasoPlanta === 63 && a.atraso === 66, 'atraso = días desde la ETA vencida (66) y desde la llegada a planta (63)');
ok(a.servicioEstimado && cerca(a.servicioUsd, 468) && cerca(a.costoPlanta, 8268), 'sin servicio cotizado se estima con el % típico: 7,800 + 6% = 8,268');
ok(!a.posibleLlegada, 'una OC APROBADA en el ERP no es "posible llegada"');
ok(a.faltantes.includes('incoterm') && a.faltantes.includes('vía de envío') && a.completitud < 100, 'detecta los datos de embarque que faltan');
const atendida = analizar(normalizar(doc({ oc_estado: 'ATENDIDA' })), HOY, {});
ok(atendida.posibleLlegada && atendida.atraso === 0, 'si el ERP ya la recibió, se avisa aparte y NO cuenta como atrasada');
const enPlanta = analizar(normalizar(doc({ estado_comercial: 'EN_PLANTA', fecha_llegada_planta_real: '2026-08-20' })), HOY, {});
ok(!enPlanta.enCurso && enPlanta.atraso === 0 && enPlanta.leadTime === dias('2026-06-30', '2026-08-20'), 'una ya en planta no está atrasada y su ciclo es emisión → llegada real');
const soles = analizar(normalizar(doc({ moneda: 'PEN', valor_compra: 3750, tc_compra: 3.75, serv_logistico: 375 })), HOY, {});
ok(cerca(soles.valorUsd, 1000) && cerca(soles.costoPlanta, 1100), 'una compra en soles se pasa a US$ con su tipo de cambio');
const kg = analizar(normalizar(doc({ familia_nombre: 'MATERIA PRIMA', cantidad_kg: 1000, um: 'KG', valor_compra: 1000, serv_logistico: 100 })), HOY, {});
ok(cerca(kg.porKg, 1.1), 'costo por kg = (valor + servicio) / kg, sin IGV');
ok(analizar(normalizar(doc({ cantidad_kg: 1, um: 'KG' })), HOY, {}).porKg === null, 'una máquina con "1 KG" no tiene costo por kg');

console.log('\n-- importaciones: pagos y resumen --');
const lista = [
  doc(),
  doc({ _id: 'x2', oc_numero: '2', estado_pago: 'PENDIENTE', vencimiento_factura: '2026-10-05', valor_compra: 500 }),
  doc({ _id: 'x3', oc_numero: '3', estado_comercial: 'EN_PLANTA', vencimiento_factura: '2026-05-01', valor_compra: 900 }),
  doc({ _id: 'x4', oc_numero: '4', estado_comercial: 'EN_TRANSITO', envio_por: 'MAR', serv_logistico: 300, valor_compra: 5000, eta: '2026-10-20', fecha_llegada_planta: '2026-10-25', estado_pago: 'PAGADO' }),
  doc({ _id: 'x5', oc_numero: '5', estado_comercial: 'ANULADO' })
].map(normalizar);
const ratios = ratiosServicio(lista);
const filas = lista.map(i => analizar(i, HOY, ratios));
const pagos = pagosPendientes(filas, HOY);
ok(pagos.some(p => p.oc === '2' && p.diasParaPago === 3 && !p.vencido), 'pago al proveedor con su vencimiento (en 3 días)');
ok(pagos.find(p => p.oc === '3').porConfirmar && !pagos.find(p => p.oc === '3').vencido, 'vencido hace más de 60 días = "por confirmar", no vencido');
ok(!pagos.some(p => p.oc === '4' && p.tipo === 'Proveedor'), 'lo PAGADO no aparece');
const r = resumir(filas, HOY);
ok(r.kpis.enCurso === 3 && r.kpis.atrasadas === 2, 'en curso 3 (sin anuladas ni en planta), 2 atrasadas');
ok(r.kpis.llegan30 === 1 && r.kpis.enTransito === 1, 'la que llega el 20-oct entra en "llegan en 30 días"');
ok(r.kpis.nPagosPorConfirmar === 1 && r.pagosPorConfirmar.length === 1, 'los pagos por confirmar se cuentan aparte');
ok(r.meses.length === 12 && r.meses.filter(m => m.futuro).length === 5 && r.meses.some(m => m.actual), '12 meses: 6 atrás, el actual y 5 adelante');
ok(!JSON.stringify(r).includes('NaN') && !JSON.stringify(resumir([], HOY)).includes('NaN'), 'sin NaN, ni con lista vacía');

console.log('\n-- ABC --');
const mp = [
  { codigo: 'A1', consumoMes: 1000, costoUsd: 1, stock: 500, enCamino: 0, leadTimeMeses: 1, seguridadPct: 0.15 },   // 12,000/año
  { codigo: 'A2', consumoMes: 500, costoUsd: 1, stock: 10000, enCamino: 0, leadTimeMeses: 1, seguridadPct: 0 },     // 6,000 → exceso (20 meses)
  { codigo: 'B1', consumoMes: 100, costoUsd: 1, stock: 250, enCamino: 0, leadTimeMeses: 2, seguridadPct: 0 },       // 1,200 → pronto
  { codigo: 'C1', consumoMes: 10, costoUsd: 1, stock: 100, enCamino: 0, leadTimeMeses: 1, seguridadPct: 0 },        // 120
  { codigo: 'Z0', consumoMes: 0, costoUsd: 2, stock: 50, enCamino: 0 }                                              // sin consumo
];
const c = clasificar(mp);
const de = k => c.find(f => f.codigo === k);
ok(de('A1').clase === 'A' && de('A1').rango === 1, 'el de más consumo valorizado es el n.º 1 y es A');
ok(de('A2').clase === 'A', 'el que cruza el 80% se queda en A');
ok(de('B1').clase === 'B' && de('C1').clase === 'C', 'B hasta el 95%, C el resto');
ok(de('Z0').clase === '' && de('Z0').estado === 'inmovilizado' && cerca(de('Z0').stockUsd, 100), 'sin consumo no se clasifica: es stock inmovilizado');
ok(de('A1').estado === 'pedir' && cerca(de('A1').puntoReorden, 1150), 'A1: 500 disponibles ≤ punto de reorden 1,150 → pedir ya');
ok(de('A2').estado === 'exceso', 'A2: 20 meses de cobertura → exceso');
ok(de('B1').estado === 'pronto', 'B1: llega al reorden en menos de un mes de consumo → pedir pronto');
const ra = resumirAbc(c);
ok(ra.codigos === 4 && ra.pedirA === 1 && ra.inmovilizados === 1, 'resumen: 4 clasificados, 1 clase A por pedir, 1 sin consumo');
ok(cerca(ra.clases.reduce((s, x) => s + x.pct, 0), 1), 'las tres clases suman el 100% del consumo');
ok(ra.pareto[ra.pareto.length - 1].acumulado === 1, 'la curva de Pareto termina en 100%');
ok(!JSON.stringify(resumirAbc(clasificar([]))).includes('NaN'), 'sin NaN con lista vacía');

console.log(fallos ? `\n${fallos} comprobación(es) fallaron` : '\nTodo en verde');
process.exit(fallos ? 1 : 0);
