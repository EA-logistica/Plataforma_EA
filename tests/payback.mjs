/**
 * Pruebas del análisis payback. Se corren con:
 *
 *     node tests/payback.mjs
 *
 * Cubren solo este módulo. El backend se prueba directo, porque es cálculo
 * puro; la vista se prueba contra un DOM simulado mínimo, lo justo para
 * comprobar que arma la pantalla sin reventar y con los números adentro.
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mod = p => import(pathToFileURL(path.join(RAIZ, p)).href);

let fallos = 0;
const ok = (cond, msg) => { console.log((cond ? '  ok   ' : '  FALLA') + ' ' + msg); if (!cond) fallos++; };
const cerca = (a, b, tol = 0.01) => Math.abs(a - b) <= tol;

const { LEY, JORNADA, ESCENARIOS, IGV } = await mod('data/payback/parametros.js');
const { zonaDe, ZONAS, zonaPorId } = await mod('data/payback/zonas.js');
const { minutosEntre, MINUTOS_MISMA_ZONA, claveDePar } = await mod('data/payback/tiempos.js');
const { simularSalida, mejorOrden } = await mod('shared/payback/ruta.js');
const { calendario, leerFecha } = await mod('shared/payback/devengos.js');
const { costoPersona, horasSemanales } = await mod('shared/payback/planilla.js');
const { analizarDemanda } = await mod('shared/payback/demanda.js');
const { minutosRequeridos, minutosDisponibles } = await mod('shared/payback/capacidad.js');
const { construir } = await mod('shared/payback/escenarios.js');
const { comparar } = await mod('shared/payback/payback.js');
const { evaluar: evaluarCapacidad } = await mod('shared/payback/capacidad.js');
const plan = await mod('shared/payback/plan.js');
const rutas = await mod('data/payback/rutas.js');
const { historico2026, RESUMEN } = await mod('data/historico.js');

// ---------------------------------------------------------------- jornada
console.log('\n-- jornada --');
const h = horasSemanales();
ok(cerca(h.porDiaSemana, 8.5), `lun-vie 8.5 h efectivas con refrigerio de ${JORNADA.refrigerioMin} min (${h.porDiaSemana})`);
ok(cerca(h.sabado, 4.5), `sábado 4.5 h (${h.sabado})`);
ok(cerca(h.total, 47), `47 h a la semana (${h.total})`);
ok(h.total <= JORNADA.topeLegalSemanalHoras, 'la jornada pedida cabe en el tope legal de 48 h');

// --------------------------------------------------------------- planilla
console.log('\n-- costo laboral --');
const tc = costoPersona({ sueldoBase: 1800, bono: 300, bonoRemunerativo: true, jornadaCompleta: true });
ok(cerca(tc.base, 2100), `base computable 2100 (${tc.base})`);
ok(cerca(tc.gratificaciones, 350), `gratificaciones 350/mes (${tc.gratificaciones.toFixed(2)})`);
ok(cerca(tc.bonificacionExtraordinaria, 31.5), `bonificación extraordinaria 31.50 (${tc.bonificacionExtraordinaria.toFixed(2)})`);
ok(cerca(tc.cts, 2100 * (7 / 6) / 12), `CTS sobre 7/6 de sueldo al año (${tc.cts.toFixed(2)})`);
ok(cerca(tc.essalud, 189), `EsSalud 9% (${tc.essalud.toFixed(2)})`);
ok(tc.factor > 1.35 && tc.factor < 1.5, `el factor de costo empresa cae en el rango peruano (${tc.factor.toFixed(3)})`);
ok(tc.diasVacaciones === 30, 'jornada completa: 30 días de vacaciones');

const pt = costoPersona({ sueldoBase: 800, bono: 250, bonoRemunerativo: true, jornadaCompleta: false, fraccionJornada: 0.5 });
ok(pt.cts === 0, 'el part time por debajo de 4 h no genera CTS');
ok(pt.diasVacaciones === LEY.vacacionesDiasPartTime, `part time: ${LEY.vacacionesDiasPartTime} días de vacaciones`);
ok(pt.factor < tc.factor, `el part time cuesta proporcionalmente menos (${pt.factor.toFixed(3)} contra ${tc.factor.toFixed(3)})`);

const sinBono = costoPersona({ sueldoBase: 1800, bono: 300, bonoRemunerativo: false, jornadaCompleta: true });
ok(sinBono.total < tc.total, 'tratar el bono como condición de trabajo abarata el escenario');
ok(cerca(sinBono.bonoFueraDePlanilla, 300), 'el bono no remunerativo se paga igual, pero fuera de la base');

console.log('\n-- avisos legales --');
const bajoMinimo = costoPersona({ sueldoBase: 900, bono: 0, bonoRemunerativo: true, jornadaCompleta: true });
ok(bajoMinimo.avisos.some(a => a.nivel === 'alto' && /mínima vital/.test(a.texto)),
   'avisa si el básico de jornada completa queda debajo de la RMV');
const partTimeLargo = costoPersona({ sueldoBase: 800, bono: 250, bonoRemunerativo: true, jornadaCompleta: false, fraccionJornada: 1 });
ok(partTimeLargo.avisos.some(a => a.nivel === 'alto' && /ya no es part time/.test(a.texto)),
   'avisa si el "part time" llega o pasa las 4 h diarias');
ok(pt.avisos.every(a => a.nivel !== 'alto'), 'el part time a media jornada no dispara ningún aviso grave');

// ----------------------------------------------------------------- zonas
console.log('\n-- clasificación de destinos --');
ok(zonaDe('PLUS COSMÉTICA, AV. VÍCTOR ANDRÉS BELAÚNDE 280, SAN ISIDRO') === 'moderna', 'San Isidro cae en Lima moderna');
ok(zonaDe('PROCHILCA, AV. LOS ÁLAMOS MZ. D, CHILCA') === 'lejos', 'Chilca no se confunde con Lima norte por la sílaba PRO');
ok(zonaDe('BOHLER, CASTRO RONCEROS 777, CERCADO DE LIMA') === 'centro', 'Cercado de Lima cae en Lima centro');
ok(zonaDe('INDUSTRIAL CENTER, LOS ROBLES 161, BELLAVISTA - CALLAO') === 'callao', 'Bellavista cae en Callao');
ok(zonaDe('Una dirección sin distrito') === 'otros', 'lo que no se reconoce va a sin clasificar');

console.log('\n-- tiempos de viaje --');
ok(ZONAS.every(z => z.minutosIdaVuelta === z.minutosDesdePlanta * 2),
   'ida y vuelta siempre es el doble del trayecto en un sentido');
ok(minutosEntre('norte', 'centro') === minutosEntre('centro', 'norte'),
   'la matriz es simétrica: A-B vale lo mismo que B-A');
ok(minutosEntre('norte', 'norte') === MINUTOS_MISMA_ZONA,
   'moverse dentro de la misma zona no es gratis');
ok(minutosEntre('norte', 'moderna') < zonaPorId('norte').minutosDesdePlanta + zonaPorId('moderna').minutosDesdePlanta,
   'encadenar dos zonas cuesta menos que volver a planta entre una y otra');
ok(minutosEntre('inventada', 'otra') > 0, 'un par desconocido cae en el promedio, no en cero');
ok(minutosEntre('norte', 'centro', { [claveDePar('norte', 'centro')]: 5 }) === 5,
   'los ajustes del simulador pisan la matriz');

console.log('\n-- simulador de una salida --');
const rutaBase = [{ zonaId: 'norte', paradas: 3 }, { zonaId: 'centro', paradas: 2 }, { zonaId: 'moderna', paradas: 3 }];
const sim = simularSalida(rutaBase, { salida: '08:00' });
ok(sim.paradas === 8 && sim.zonas === 3, `cuenta 8 entregas en 3 zonas (${sim.paradas} en ${sim.zonas})`);
ok(sim.salida === '08:00' && /^\d{2}:\d{2}$/.test(sim.retorno), `sale 08:00 y retorna ${sim.retorno}`);
ok(cerca(sim.total, sim.minutosViaje + sim.minutosParadas), 'el total es tránsito más tiempo en los puntos');
ok(cerca(sim.total, sim.tramos.reduce((a, t) => a + t.minutos, 0)), 'los tramos suman el total');
ok(sim.tramos[0].texto.startsWith('Planta →'), 'el primer tramo sale de planta');
ok(sim.tramos[sim.tramos.length - 1].texto.endsWith('→ Planta'), 'el último tramo es el retorno a planta');
ok(sim.entra, 'esa salida entra en la jornada');

// Doce entregas en las tres zonas más lejanas SÍ entran, pero solo saliendo
// temprano: ocupan el día completo y no dejan margen para nada más.
const tresLejanas = [{ zonaId: 'lejos', paradas: 4 }, { zonaId: 'sur', paradas: 4 }, { zonaId: 'este', paradas: 4 }];
const temprano = simularSalida(tresLejanas, { salida: '08:00' });
ok(temprano.entra && temprano.minutosSobrantes < 60,
   `Chilca, sur y este entran saliendo a las 8, justo: retorna ${temprano.retorno}`);
const tarde = simularSalida(tresLejanas, { salida: '10:00' });
ok(!tarde.entra && tarde.minutosSobrantes < 0,
   `la misma ruta saliendo a las 10 ya no entra: retornaría ${tarde.retorno}`);

ok(simularSalida([], {}).vacia, 'una salida sin zonas no rompe el cálculo');
ok(simularSalida(rutaBase, { salida: '08:00', sabado: true }).finJornada === '12:30',
   'el sábado se mide contra el fin de jornada del sábado');
ok(simularSalida(rutaBase, { salida: '08:00', minutosPorParada: 30 }).total > sim.total,
   'subir los minutos por parada alarga la salida');
ok(simularSalida(rutaBase, { salida: '08:00', desdePlanta: { norte: 90 } }).total > sim.total,
   'editar el tiempo de una zona cambia el resultado');

const alReves = [rutaBase[2], rutaBase[0], rutaBase[1]];
ok(simularSalida(alReves, { salida: '08:00' }).total > sim.total,
   'el orden de las zonas importa: al revés cuesta más');
const mejorado = mejorOrden(alReves, { salida: '08:00' });
ok(mejorado.mejora > 0, `reordenar ahorra ${mejorado.mejora} min`);
ok(simularSalida(mejorado.orden, { salida: '08:00' }).total <= simularSalida(alReves, { salida: '08:00' }).total,
   'el orden propuesto nunca es peor que el original');

// ---------------------------------------- beneficios por fecha de ingreso
console.log('\n-- gratificación y CTS según la fecha de ingreso --');
ok(leerFecha('2026-10-01') && !leerFecha('no es fecha') && !leerFecha('2026-13-01'),
   'la fecha se valida antes de calcular');
ok(calendario('cualquier cosa', { base: 2100 }).valido === false,
   'con una fecha inválida devuelve un calendario vacío en vez de romperse');

const enero = calendario('2026-01-01', { base: 2100, personas: 1 }, 24);
const julio26 = enero.filas.find(f => f.mes === 7 && f.anio === 2026);
ok(cerca(julio26.gratificacion, 2100),
   `entrando el 1 de enero, la gratificación de julio es un sueldo completo (${julio26.gratificacion.toFixed(2)})`);
ok(cerca(julio26.bonificacion, 2100 * 0.09), 'encima va la bonificación extraordinaria del 9%');
const mayo26 = enero.filas.find(f => f.mes === 5 && f.anio === 2026);
ok(cerca(mayo26.cts, 2100 * 4 / 12),
   `la CTS de mayo cubre solo 4 meses, no 6, porque entró en enero (${mayo26.cts.toFixed(2)})`);
const nov26 = enero.filas.find(f => f.mes === 11 && f.anio === 2026);
ok(cerca(nov26.cts, (2100 + 2100 / 6) * 6 / 12),
   `la CTS de noviembre ya suma un sexto de la gratificación de julio (${nov26.cts.toFixed(2)})`);

const octubre = calendario('2026-10-01', { base: 2100, personas: 1 }, 24);
const dic26 = octubre.filas.find(f => f.mes === 12 && f.anio === 2026);
ok(cerca(dic26.gratificacion, 2100 * 3 / 6),
   `entrando en octubre, la gratificación de diciembre es de 3 de 6 meses (${dic26.gratificacion.toFixed(2)})`);
ok(octubre.primerAnio.total < enero.primerAnio.total,
   'el primer año de quien entra en octubre cuesta menos que el de quien entra en enero');

const quincena = calendario('2026-09-15', { base: 2100, personas: 1 }, 24);
ok(quincena.filas[0].diasDelMes === 16, 'entrando un 15, el primer mes se paga por 16 días');
ok(quincena.filas[0].sueldo < 2100, 'y el sueldo de ese mes sale proporcional');
const novQ = quincena.filas.find(f => f.mes === 11 && f.anio === 2026);
ok(cerca(novQ.cts, 2100 * (1 / 12 + 16 / 360)),
   `la CTS cuenta meses Y días: 1 mes y 16 días (${novQ.cts.toFixed(2)})`);

const sinCts = calendario('2026-01-01', { base: 1050, personas: 2, conCts: false }, 24);
ok(sinCts.filas.every(f => f.cts === 0), 'el part time bajo 4 h no genera CTS en ningún mes');
ok(sinCts.filas.some(f => f.gratificacion > 0), 'pero sí genera gratificaciones');
ok(cerca(sinCts.filas.find(f => f.mes === 7).gratificacion, 1050 * 2),
   'con dos personas, la gratificación es la de ambas');

ok(enero.filas.filter(f => f.gratificacion > 0).length === 4,
   'en 24 meses caen 4 gratificaciones');
ok(enero.filas.filter(f => f.cts > 0).length === 4, 'y 4 depósitos de CTS');
ok(enero.primerAnio.mesMasCaro.mes === 7 || enero.primerAnio.mesMasCaro.mes === 12,
   `el mes más caro del año es uno con gratificación (${enero.primerAnio.mesMasCaro.etiqueta})`);

// --------------------------------------------------------------- demanda
console.log('\n-- demanda real --');
const d = analizarDemanda(historico2026());
ok(d.hay && d.totalViajes === RESUMEN.servicios,
   `lee los ${RESUMEN.servicios} servicios del histórico (${d.totalViajes})`);
ok(d.recientes.meses.length === 3, `promedia 3 meses completos: ${d.recientes.meses.join(', ')}`);
ok(!d.recientes.meses.includes(d.hasta), 'descarta el último mes, que está incompleto');
ok(d.recientes.gastoMensual > 4000 && d.recientes.gastoMensual < 6000,
   `gasto mensual en courier S/ ${d.recientes.gastoMensual.toFixed(2)}`);
ok(d.viajesPorDia.entreSemana > d.viajesPorDia.sabado,
   `entre semana se mueve más que el sábado (${d.viajesPorDia.entreSemana.toFixed(1)} contra ${d.viajesPorDia.sabado.toFixed(1)})`);
ok(d.viajesPorDia.p90 > d.viajesPorDia.promedio, `el día cargado (p90=${d.viajesPorDia.p90}) supera al promedio (${d.viajesPorDia.promedio.toFixed(1)})`);
ok(cerca(d.mezcla.reduce((a, m) => a + m.participacion, 0), 1), 'el reparto por zona suma 100%');
ok(d.viajesPorDia.excedenteSobre(1000) === 0, 'con un techo altísimo no queda excedente');
ok(d.viajesPorDia.excedenteSobre(0) > 0, 'con techo cero, todo el volumen es excedente');

ok(analizarDemanda([]).hay === false, 'sin servicios devuelve un análisis vacío en vez de romperse');

// ------------------------------------------------------------- capacidad
console.log('\n-- capacidad --');
const disp = minutosDisponibles(1, 1);
ok(disp.neto < disp.bruto, 'el tiempo neto descuenta la holgura reservada para imprevistos');
ok(cerca(minutosDisponibles(2, 0.5).bruto, disp.bruto),
   'dos personas a media jornada suman las mismas horas que una completa');

const agrupado = minutosRequeridos(9, d.mezcla, { respetarDiasDeRuta: true });
const suelto = minutosRequeridos(9, d.mezcla, { respetarDiasDeRuta: false });
ok(agrupado.total < suelto.total,
   `agrupar por zona ahorra tiempo (${(agrupado.total / 60).toFixed(1)} h contra ${(suelto.total / 60).toFixed(1)} h)`);
ok(suelto.total > disp.neto, 'atendiendo cada urgencia por separado no entra en la jornada');
ok(minutosRequeridos(20, d.mezcla, { respetarDiasDeRuta: true }).total
   > minutosRequeridos(8, d.mezcla, { respetarDiasDeRuta: true }).total, 'más encargos exigen más tiempo');
ok(minutosRequeridos(0, d.mezcla).total === 0, 'sin encargos no hay ruta que pagar');

// ------------------------------------------------------------ escenarios
console.log('\n-- escenarios --');
const esc = construir(d);
ok(esc.length === 2, `los dos escenarios en evaluación: tercero y dos part time (${esc.length})`);
ok(esc.map(e => e.id).join(',') === Object.keys(ESCENARIOS).join(','), 'salen en el orden en que se plantearon');

const [tercero, dosMotorizados] = esc;
ok(dosMotorizados.cfg.personas === 2 && dosMotorizados.cfg.sueldoBase === 1100
   && dosMotorizados.cfg.bono === 0 && !dosMotorizados.cfg.jornadaCompleta,
   'escenario 2: dos personas part time en planilla, S/1100 cada una (básico competitivo), sin bono aparte');

console.log('\n-- tercerizar a cuota fija --');
ok(tercero.cfg.modelo === 'tercero' && tercero.cfg.cuotaMensualSinIgv === 3500,
   'escenario 1: proveedor externo, presupuesto ideal de S/3500 sin IGV');
ok(construir(d, { cuotaTercero: 3800 })[0].tercero.cuotaMensualSinIgv === 3800, 'se puede simular la cuota tope de S/3800');
ok(construir(d, { cuotaTercero: 2000 })[0].tercero.cuotaMensualSinIgv === 3500, 'una cuota fuera de las planteadas cae al presupuesto ideal');
ok(/S\/ 3[ ,.]?500 /.test(tercero.detalle), 'el detalle del proveedor muestra la cuota elegida');
ok(tercero.persona === null, 'no es planilla propia: no calcula costo de persona');
ok(cerca(tercero.tercero.igv, 3500 * IGV.tasa), `el IGV es el 18% de la cuota (${tercero.tercero.igv.toFixed(2)})`);
ok(cerca(tercero.tercero.total, 3500 * 1.18), `la cuota con IGV es S/${(3500 * 1.18).toFixed(2)} (${tercero.tercero.total.toFixed(2)})`);
ok(tercero.capacidad.alcanza === true, 'la capacidad del proveedor se da por cubierta: eso compra la cuota fija');
ok(tercero.diasSinCoberturaAlAnio === 0, 'no hay vacaciones que cubrir: no es personal propio');
ok(!tercero.riesgos.some(r => r.nivel === 'alto'), 'tercerizar no dispara ningún riesgo alto por sí solo');

console.log('\n-- plazo de pago al proveedor --');
ok(tercero.tercero.plazoPagoDias === 30, 'por defecto, 30 días');
const [terceroA45] = construir(d, { plazoPagoDias: 45 });
ok(terceroA45.tercero.plazoPagoDias === 45, 'se puede pedir a 45 días');
ok(cerca(terceroA45.tercero.costoReal, tercero.tercero.costoReal),
   'el plazo no cambia cuánto se debe, solo cuándo se paga');
ok(construir(d, { plazoPagoDias: 60 })[0].tercero.plazoPagoDias === 30,
   'un plazo que no es 30 ni 45 cae al valor por defecto, no se inventa uno');

console.log('\n-- IGV: crédito fiscal o costo real --');
ok(tercero.tercero.creditoFiscalIgv === true, 'por defecto se asume que la empresa puede usar el crédito fiscal');
ok(cerca(tercero.tercero.costoReal, 3500), 'con crédito fiscal, el costo real es la cuota sin IGV (S/3500)');

const [sinCredito] = construir(d, { creditoFiscalIgv: false });
ok(sinCredito.tercero.creditoFiscalIgv === false, 'se puede apagar el supuesto (Nuevo RUS, o débito insuficiente)');
ok(cerca(sinCredito.tercero.costoReal, sinCredito.tercero.total),
   'sin crédito fiscal, el costo real es el total facturado con IGV (S/4130)');
ok(sinCredito.tercero.costoReal > tercero.tercero.costoReal,
   'sin poder usar el crédito, tercerizar sale más caro en la comparación');
const cmpSinCredito = comparar(construir(d, { creditoFiscalIgv: false }), d);
ok(cerca(cmpSinCredito.filas.find(f => f.escenario.id === 'tercero').costoMensual, sinCredito.tercero.total),
   'y ese costo mayor es el que de verdad entra a competir contra el courier');

console.log('\n-- uno o dos motorizados en planilla --');
// Dos personas a media jornada suman las mismas horas que una completa: la
// capacidad no se duplica solo por ser dos, hay que salir a la vez.
const unoCompleto = evaluarCapacidad({ personas: 1, fraccionJornada: 1, viajesPorDia: d.viajesPorDia.entreSemana, viajesPico: d.viajesPorDia.p90, mezcla: d.mezcla });
ok(cerca(dosMotorizados.capacidad.techoDiario, unoCompleto.techoDiario),
   `dos part time aguantan lo mismo que una sola moto a tiempo completo (${dosMotorizados.capacidad.techoDiario.toFixed(1)} contra ${unoCompleto.techoDiario.toFixed(1)})`);
ok(!dosMotorizados.riesgos.some(r => r.nivel === 'alto' && /una sola persona/.test(r.texto)),
   'con dos personas el riesgo de depender de una sola desaparece');
ok([dosMotorizados].every(e => e.riesgos.some(r => r.nivel === 'alto' && /accidente/.test(r.texto))),
   'en planilla, la responsabilidad por accidentes es de la empresa: riesgo alto');
// S/1100 de básico a media jornada SÍ supera la mínima proporcional (a
// diferencia de a tiempo completo, donde no alcanzaría la RMV de S/1130).
ok(dosMotorizados.persona.avisos.every(a => a.nivel !== 'alto'),
   'S/1100 a media jornada no dispara ningún aviso legal grave: supera la mínima proporcional a esa jornada');

// --------------------------------------------------------------- payback
console.log('\n-- comparación y retorno --');
const cmp = comparar(esc, d);
ok(cerca(cmp.gastoActual, d.recientes.gastoMensual), 'compara contra el gasto real de los últimos meses');
cmp.filas.forEach(f => {
  // El proveedor a cuota fija no se arma de planilla + moto + respaldo: su
  // "suma de partes" es la cuota más el IGV, ya verificado más abajo.
  if (f.escenario.cfg.modelo !== 'tercero') {
    const suma = f.planilla + f.gastoMoto + f.coberturaVacaciones + f.courierResidual
      + f.margen + f.costosOcultos.total;
    ok(cerca(suma, f.costoMensual), `[${f.escenario.id}] el costo mensual es la suma de sus partes`);
  }
  ok(cerca(f.ahorroMensual, cmp.gastoActual - f.costoMensual), `[${f.escenario.id}] el ahorro es gasto actual menos costo`);
});
const fTercero = cmp.filas.find(f => f.escenario.id === 'tercero');
ok(cerca(fTercero.costoMensual, tercero.tercero.costoReal),
   'el costo mensual del tercero es el costo real (neto de crédito fiscal por defecto), no el total facturado');
ok(cerca(tercero.tercero.costoReal, tercero.tercero.cuotaMensualSinIgv),
   'con crédito fiscal (el supuesto por defecto), el costo real es la cuota sin IGV: el IGV no es un costo');
ok(tercero.tercero.total > tercero.tercero.costoReal,
   'el total facturado sigue siendo mayor: eso es lo que factura el proveedor, no lo que cuesta de verdad');
ok(fTercero.coberturaVacaciones === 0 && fTercero.courierResidual === 0,
   'no arrastra cobertura de vacaciones ni courier residual: eso es cosa del proveedor');
ok(cmp.filas.every(f => f.inversion === 0 && f.mesesRetorno === 0),
   'ningún escenario tiene ya inversión inicial que recuperar (ni personal propio, ni el proveedor)');
ok(cmp.filas.filter(f => f.escenario.cfg.modelo !== 'tercero').every(f => f.coberturaVacaciones > 0),
   'el escenario de personal propio sí provisiona los días de vacaciones en que no hay motorizado');
ok(cmp.recomendacion.mejor, 'hay un escenario recomendado');
ok(cmp.recomendacion.mejor.escenario.id === 'tercero',
   'se recomienda tercerizar: es el único escenario sin responsabilidad por accidentes');
const fDos = cmp.filas.find(f => f.escenario.id === 'dosMotorizados');
ok(fDos.margen === 160, 'dos part time llevan el margen de gasto de logística (S/160)');
const conBasico = b => comparar(construir(d, { basicoPartTime: b }), d).filas.find(f => f.escenario.id === 'dosMotorizados');
ok(conBasico(900).escenario.cfg.sueldoBase === 900 && conBasico(1000).escenario.cfg.sueldoBase === 1000,
   'el básico del part time se puede elegir entre S/900, 1000 y 1100');
ok(conBasico(1234).escenario.cfg.sueldoBase === 1100, 'un básico fuera de las opciones cae al recomendado');
ok(conBasico(900).costoMensual < conBasico(1000).costoMensual && conBasico(1000).costoMensual < fDos.costoMensual,
   'subir el básico sube el costo del escenario');
ok(/S\/ 1[ ,.]?100 /.test(fDos.escenario.detalle), 'el detalle del escenario muestra el básico elegido');
ok(comparar(construir(d, { basicoPartTime: 900 }), d).recomendacion.mejor.escenario.id === 'tercero',
   'aun con el básico más bajo se recomienda tercerizar: la responsabilidad pesa más que la diferencia');
ok(fDos.costosOcultos.total > 0 && fTercero.costosOcultos === null,
   'solo el personal propio carga lo que no sale en la boleta');
ok(cmp.condiciones.length >= 3, 'se listan las condiciones que valen para cualquier escenario');
ok(cmp.condiciones.some(c => /agrupan por zona/.test(c.titulo)), 'la primera condición es programar por zona');

console.log('\n-- flujo real con fecha de ingreso --');
ok(cmp.filas.every(f => f.flujo === null), 'sin fecha de ingreso no se inventa un flujo');
const conFecha = comparar(esc, d, { inicio: '2026-10-01' });
ok(conFecha.filas.find(f => f.escenario.id === 'tercero').flujo === null,
   'el proveedor a cuota fija nunca tiene calendario de beneficios: no es planilla');
conFecha.filas.filter(f => f.escenario.cfg.modelo !== 'tercero').forEach(f => {
  ok(f.flujo && f.flujo.meses.length === 24, `[${f.escenario.id}] proyecta 24 meses`);
  ok(cerca(f.flujo.costoPrimerAnio, f.flujo.meses.slice(0, 12).reduce((a, m) => a + m.costo, 0)),
     `[${f.escenario.id}] el costo del primer año es la suma de sus doce meses`);
  ok(f.flujo.mesMasCaro.costo > f.flujo.mesMasBarato.costo,
     `[${f.escenario.id}] hay meses que aprietan más que otros`);
  ok(f.flujo.mesRecuperacion === null, `[${f.escenario.id}] sin inversión no hay mes de recuperación`);
});
const enEnero = comparar(esc, d, { inicio: '2027-01-01' });
const conModelo = filas => filas.find(f => f.escenario.cfg.modelo !== 'tercero');
ok(conModelo(enEnero.filas).flujo.costoPrimerAnio !== conModelo(conFecha.filas).flujo.costoPrimerAnio,
   'cambiar la fecha de ingreso cambia el costo del primer año');

// --------------------------------------------------------- plan de rutas
console.log('\n-- plan de rutas semanal --');
const enLima = p => p.lat > -13.2 && p.lat < -11.2 && p.lon > -77.9 && p.lon < -76.2;
ok(enLima(rutas.PLANTA) && rutas.PUNTOS.every(enLima), `la planta y los ${rutas.PUNTOS.length} puntos están en Lima`);
ok(rutas.PUNTOS.every(p => p.dias.length && p.dias.every(x => rutas.DIAS.some(dd => dd.id === x))), 'cada punto sale al menos un día del plan');
ok(new Set(rutas.PUNTOS.map(p => p.id)).size === rutas.PUNTOS.length, 'los ids de los puntos no se repiten');
ok(rutas.DIAS.map(x => x.id).join(',') === 'lun,mar,mie,jue,vie', 'cinco días, de lunes a viernes');
ok(rutas.DIAS.filter(x => x.tipo === 'fija').map(x => x.id).join(',') === 'lun,mie,vie', 'rutas fijas lunes, miércoles y viernes');

const pl = plan.analizarPlan(historico2026());
ok(pl.viajes === RESUMEN.servicios, `el plan se mide con los ${RESUMEN.servicios} viajes del histórico`);
ok(pl.cobertura > 0.6, `los puntos recurrentes cubren la mayoría de encargos (${(pl.cobertura * 100).toFixed(0)}%)`);
const e = pl.espera;
ok(cerca(e.mismoDia + e.unDia + e.dosDias + e.tresOMas, 1), 'la distribución de espera suma 100%');
ok(e.mismoDia + e.unDia > 0.85, `casi todo sale el mismo día o al siguiente (${((e.mismoDia + e.unDia) * 100).toFixed(0)}%)`);
ok(e.urgenciasSemana <= rutas.POLITICA.maxUrgenciasPorDia * 5,
   `las urgencias que quedan (${e.urgenciasSemana.toFixed(1)}/sem) caben en el cupo de las tardes`);
ok(cerca(pl.dias.reduce((a, x) => a + x.encargosSemana, 0), pl.encargosSemana), 'todo encargo cae en algún día del plan');
ok(pl.salidasPlanSemana === 5 && pl.salidasHoySemana > 30, 'de una salida por encargo a cinco rutas por semana');

const bohler = rutas.PUNTOS.find(p => p.id.startsWith('bohler'));
ok(plan.espera('2026-09-14', bohler.destino).dias === 0, 'un lunes, Bohler sale ese mismo día (núcleo)');
ok(plan.espera('2026-09-15', bohler.destino).dias === 1, 'un martes, Bohler espera al miércoles');
ok(plan.espera('2026-09-19', bohler.destino).dias === 0, 'lo del sábado se adelanta al viernes, que es día de núcleo');
ok(plan.diasDe('UN SITIO SUELTO, ATE').join(',') === rutas.ZONA_DIAS.este.join(','), 'un destino suelto sale el día de su zona');

const lun = pl.dias.find(x => x.id === 'lun');
const selLun = plan.seleccionInicial('lun', pl.puntos, { objetivo: lun.paradasSemana });
ok(selLun.length >= pl.puntos.filter(p => p.dias.includes('lun') && p.fija).length, 'la ruta típica lleva al menos todas las paradas fijas');
const jue = plan.seleccionInicial('jue', pl.puntos, { objetivo: 8 });
const jueChilca = plan.seleccionInicial('jue', pl.puntos, { objetivo: 8, conQuincenales: true });
ok(!jue.some(i => i.startsWith('prochilca')) && jueChilca.some(i => i.startsWith('prochilca')), 'Chilca entra solo la semana que toca');
ok(jueChilca.length <= jue.length, 'la semana de Chilca el jueves no carga paradas "a pedido"');
const par = plan.paradasDelDia('lun', { ids: selLun, extra: [{ nombre: 'Urgencia', lat: -12.1, lon: -77.0 }] });
ok(par[0].id === 'planta' && par.length === selLun.length + 2, 'las paradas arrancan en planta y suman las urgencias');
const enl = plan.enlacesGoogleMaps(Array.from({ length: 22 }, (_, i) => ({ lat: -12 - i / 100, lon: -77 })));
ok(enl.length === 3 && enl.every(u => u.startsWith('https://www.google.com/maps/dir/?api=1')), 'una ruta larga se parte en tramos de Google Maps');

console.log('\n-- buscador del histórico de envíos --');
const nuevos = [
  { destino: 'maps.google.com/maps?q=-12.0168152%2C-76.9610026&z=17&hl=es', fechaProg: '2026-09-29', estado: 'Concluido' },
  { destino: 'av. los alisos 945', fechaProg: '2026-09-29', estado: 'En espera' },
  { destino: 'SITIO CANCELADO, LIMA', fechaProg: '2026-09-30', estado: 'Cancelado' }
];
const hist = plan.destinosHistorico([...historico2026(), ...nuevos]);
const distintos = new Set(historico2026().map(x => x.destino.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ').trim())).size;
ok(hist.length === distintos + 2, `el buscador ve todos los destinos del histórico, no solo los del plan (${hist.length})`);
ok(hist[0].viajes >= hist[1].viajes, 'van del más al menos visitado');
ok(!hist.some(h => /CANCELADO/.test(h.destino)), 'lo cancelado no cuenta como destino');
ok(plan.buscarDestinos(hist, 'alisos').length === 1, 'un ticket nuevo de la app ya se encuentra en el buscador');
ok(plan.buscarDestinos(hist, 'bohler')[0].punto && plan.buscarDestinos(hist, 'bohler')[0].lat, 'Bohler aparece primero, como punto del plan y con coordenadas');
ok(plan.buscarDestinos(hist, 'plus cosmetica').length >= 2, 'busca sin tildes ni mayúsculas');
const conUrl = hist.find(h => h.destino.startsWith('maps.google'));
ok(conUrl && cerca(conUrl.lat, -12.0168152, 1e-6) && cerca(conUrl.lon, -76.9610026, 1e-6), 'un enlace de Google Maps trae sus coordenadas');
ok(plan.coordsEnTexto('sin coordenadas') === null, 'un texto sin coordenadas no inventa un punto');
ok(/^Luis Carranza 777/.test(plan.direccionParaBuscar('https://www.google.com/maps/dir//ACEROS+BOHLER,+Luis+Carranza+777,+Lima+15081/data=!4m6')),
   'de un enlace de "cómo llegar" se saca la dirección');
ok(plan.direccionParaBuscar('UNIBELL, JR. VARELA 352, BREÑA').startsWith('Jirón VARELA 352, BREÑA'), 'para ubicar se quita el nombre de la empresa');

// ------------------------------------------------------------ la pantalla
console.log('\n-- pantalla --');
const ids = ['pbCuerpo', 'pbPlanDias', 'pbPlanLado', 'pbPlanSemana', 'pbMapa', 'pbPlanQ', 'pbPlanBusqueda'];
const registro = new Map(ids.map(i => [i, { id: i, innerHTML: '', textContent: '', value: '', style: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false } }]));
globalThis.document = {
  body: { contains: () => false },
  getElementById: id => registro.get(id) || null,
  documentElement: { setAttribute() {}, getAttribute: () => null },
  querySelectorAll: () => [], addEventListener() {}
};
globalThis.window = globalThis;
const almacen = new Map();
globalThis.localStorage = {
  getItem: k => (almacen.has(k) ? almacen.get(k) : null),
  setItem: (k, v) => almacen.set(k, String(v)),
  removeItem: k => almacen.delete(k)
};

// La pantalla pide el estado al servidor. Aquí se le responde con el histórico
// real sin levantar uno: lo que se prueba es la vista, no la red.
const { DESTINOS } = await mod('data/destinos.js');
globalThis.fetch = async (ruta, op = {}) => {
  if (String(ruta).endsWith('/api/estado')) {
    return new Response(JSON.stringify({
      revision: 'prueba',
      personal: [], autorizaciones: [], adjuntos: [],
      solicitudes: historico2026(),
      destinos: DESTINOS
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  // La ruta por calles se simula: lo que se prueba es la pantalla, no OSRM.
  if (String(ruta).endsWith('/api/payback/ruta')) {
    const { paradas } = JSON.parse(op.body);
    return new Response(JSON.stringify({
      distanciaKm: 60, duracionEstimadaMin: 150, servicioMin: 12 * (paradas.length - 1), fin: '13:10', excedeJornada: false, avisos: [],
      geometria: { type: 'LineString', coordinates: paradas.map(p => [p.lon, p.lat]) },
      cronograma: [{ indice: 0, salida: '08:10' },
        ...paradas.slice(1).map((p, i) => ({ indice: i + 1, llegada: '09:0' + (i % 10), tramo: { distanciaKm: 5, duracionEstimadaMin: 15 } })),
        { indice: 0, regreso: true, llegada: '13:10', tramo: { distanciaKm: 8, duracionEstimadaMin: 25 } }]
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  return new Response(JSON.stringify({ error: 'ruta no simulada: ' + ruta }), { status: 404 });
};

const bd = await mod('frontend/js/api/estado.js');
await bd.cargar();
const vista = await mod('frontend/js/views/payback/vista.js');
vista.renderPayback();
const html = registro.get('pbCuerpo').innerHTML;

ok(html.length > 2000, `la pantalla se arma (${html.length} caracteres)`);
ok(/Escenario recomendado/.test(html), 'muestra el escenario recomendado arriba');
esc.forEach(e => ok(html.includes(e.nombre), `aparece el escenario "${e.nombre}"`));
ok(/S\/\s/.test(html), 'muestra importes en soles');
ok(/Por qué el básico del part time sube/.test(html) && html.includes('id="pbBasico"'),
   'sustenta la subida del básico y deja elegirlo');
ok(/para que PLANSA no se responsabilice/.test(html), 'el recomendado explica que tercerizar evita la responsabilidad');
ok(/¿Alcanza una sola moto\?/.test(html), 'responde si alcanza una sola moto');
ok(/Plan de rutas semanal/.test(html) && html.includes('id="pbMapa"'), 'incluye el plan de rutas con su mapa');
ok(/Urgencias: con rutas fijas casi desaparecen/.test(html), 'incluye el análisis de urgencias');
ok(/Hora de corte: 16:00/.test(html), 'la primera regla es la hora de corte');
ok(html.includes('id="pbCuota"') && /presupuesto ideal/.test(html), 'deja elegir la cuota del proveedor, con S/3500 como presupuesto ideal');
ok(!/Un motorizado con moto propia/.test(html), 'el escenario de un motorizado a tiempo completo ya no se muestra');
ok(/Cuota del proveedor/.test(html) && /IGV/.test(html), 'el escenario de tercerizar muestra la cuota y el IGV, no un desglose de planilla');
ok(!/undefined|NaN|\[object/.test(html), 'no se cuela ningún undefined, NaN ni [object Object]');

ok(/Beneficios sociales según la fecha de ingreso/.test(html), 'incluye el calendario de beneficios');
ok(/id="pbInicio"/.test(html), 'deja elegir la fecha de ingreso');

vista.setBonoPayback('no');
ok(/value="no" selected/.test(registro.get('pbCuerpo').innerHTML),
   'cambiar el tratamiento del bono se refleja en el control');

console.log('\n-- plan de rutas en pantalla --');
const leer = () => registro.get('pbCuerpo').innerHTML;
const lado = () => registro.get('pbPlanLado').innerHTML;
const espera50 = () => new Promise(r => setTimeout(r, 50));
await espera50();
ok(/Sale de planta/.test(lado()) && /Vuelve a planta/.test(lado()), 'la ruta del día arranca y termina en planta');
ok(/Abrir en Google Maps|Google Maps, tramo/.test(lado()), 'ofrece navegar la ruta en Google Maps');
ok(/Entra: vuelve a planta a las 13:10/.test(lado()), 'dice a qué hora vuelve y cuánto queda para urgencias');
ok(/Vuelve a planta/.test(registro.get('pbPlanSemana').innerHTML), 'el resumen de la semana muestra a qué hora vuelve cada día');
vista.pbPlanDia('jue');
await espera50();
ok(/Jueves/.test(lado()) && /Semana de Chilca/.test(lado()), 'el jueves deja marcar la semana de Chilca');
const marcadas = () => (lado().match(/checked/g) || []).length;
const antes = marcadas();
vista.pbPlanChilca(true);
await espera50();
ok(marcadas() !== antes, 'la semana de Chilca cambia las paradas del jueves');
const unoMenos = marcadas();
const primero = pl.dias.find(x => x.id === 'jue').puntos.find(p => lado().includes("pbPlanParada('" + p.id + "'"));
vista.pbPlanParada(primero.id, !lado().includes('checked onchange="pbPlanParada(\'' + primero.id + '\''));
await espera50();
ok(marcadas() !== unoMenos, 'marcar o desmarcar una parada recalcula la ruta');
registro.get('pbPlanQ').value = 'bohler';
vista.pbPlanBuscar();
const buscador = registro.get('pbPlanBusqueda').innerHTML;
ok(/En el histórico de envíos/.test(buscador) && /BOHLER, CASTRO RONCEROS 777/.test(buscador), 'el buscador del plan encuentra destinos del histórico');
ok(/como dirección en el mapa/.test(buscador), 'y deja buscar la dirección en el mapa si no está');
vista.pbPlanAgregar(0);
await espera50();
ok(/pbPlanQuitarExtra|BOHLER/.test(lado()), 'agregar un destino del histórico lo suma a la ruta');
ok(/Otros destinos del histórico que salen este día/.test(lado()), 'cada día lista los demás destinos del histórico que le tocan');
vista.setCuotaPayback('3800');
ok(/S\/ 3,800|S\/ 3800/.test(leer()), 'cambiar la cuota se refleja en la pantalla');

vista.setInicioPayback('2027-01-01');
ok(/value="2027-01-01"/.test(leer()), 'cambiar la fecha de ingreso se refleja en el control');
ok(/julio 2027|diciembre 2027/.test(leer()), 'y el calendario muestra los meses que corresponden');
ok(!/undefined|NaN|\[object/.test(leer()), 'tras todos los cambios no se cuela ningún valor roto');

console.log(fallos ? `\n${fallos} comprobación(es) fallaron` : '\nTodo en verde');
process.exit(fallos ? 1 : 0);
