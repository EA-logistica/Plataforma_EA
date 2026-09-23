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
ok(esc.length === 3, `los tres escenarios pedidos (${esc.length})`);
ok(esc.map(e => e.id).join(',') === Object.keys(ESCENARIOS).join(','), 'salen en el orden en que se plantearon');

const [tercero, dosMotorizados, propia] = esc;
ok(propia.cfg.personas === 1 && propia.cfg.sueldoBase === 1800 && propia.cfg.bono === 300,
   'escenario 3: una persona, S/1800 + S/300, moto suya');
ok(dosMotorizados.cfg.personas === 2 && dosMotorizados.cfg.sueldoBase === 900
   && dosMotorizados.cfg.bono === 0 && dosMotorizados.cfg.jornadaCompleta,
   'escenario 2: dos personas a tiempo completo, S/900 cada una, sin bono aparte');

console.log('\n-- tercerizar a cuota fija --');
ok(tercero.cfg.modelo === 'tercero' && tercero.cfg.cuotaMensualSinIgv === 3500,
   'escenario 1: proveedor externo, cuota fija de S/3500 sin IGV');
ok(tercero.persona === null, 'no es planilla propia: no calcula costo de persona');
ok(cerca(tercero.tercero.igv, 3500 * IGV.tasa), `el IGV es el 18% de la cuota (${tercero.tercero.igv.toFixed(2)})`);
ok(cerca(tercero.tercero.total, 3500 * 1.18), `la cuota con IGV es S/${(3500 * 1.18).toFixed(2)} (${tercero.tercero.total.toFixed(2)})`);
ok(tercero.capacidad.alcanza === true, 'la capacidad del proveedor se da por cubierta: eso compra la cuota fija');
ok(tercero.diasSinCoberturaAlAnio === 0, 'no hay vacaciones que cubrir: no es personal propio');
ok(!tercero.riesgos.some(r => r.nivel === 'alto'), 'tercerizar no dispara ningún riesgo alto por sí solo');

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
ok(dosMotorizados.capacidad.techoDiario > propia.capacidad.techoDiario,
   `dos motorizados a tiempo completo aguantan más encargos al día que uno solo (${dosMotorizados.capacidad.techoDiario.toFixed(1)} contra ${propia.capacidad.techoDiario.toFixed(1)})`);
ok(propia.riesgos.some(r => r.nivel === 'alto'), 'depender de una sola persona se marca como riesgo alto');
ok(!dosMotorizados.riesgos.some(r => r.nivel === 'alto'), 'con dos personas ese riesgo puntual desaparece');
// S/900 de básico a tiempo completo queda por debajo de la RMV (S/1130): es un
// hallazgo real, no un capricho del cálculo, y el módulo ya sabía detectarlo.
ok(dosMotorizados.persona.avisos.some(a => a.nivel === 'alto' && /mínima vital/.test(a.texto)),
   'S/900 a tiempo completo queda debajo de la RMV: el módulo lo marca como aviso legal grave');
ok(!propia.persona.avisos.some(a => a.nivel === 'alto'), 'S/1800 sí supera la RMV para jornada completa');

// --------------------------------------------------------------- payback
console.log('\n-- comparación y retorno --');
const cmp = comparar(esc, d);
ok(cerca(cmp.gastoActual, d.recientes.gastoMensual), 'compara contra el gasto real de los últimos meses');
cmp.filas.forEach(f => {
  // El proveedor a cuota fija no se arma de planilla + moto + respaldo: su
  // "suma de partes" es la cuota más el IGV, ya verificado más abajo.
  if (f.escenario.cfg.modelo !== 'tercero') {
    const suma = f.planilla + f.gastoMoto + f.coberturaVacaciones + f.courierResidual;
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
   'los dos escenarios de personal propio sí provisionan los días de vacaciones en que no hay motorizado');
ok(cmp.recomendacion.mejor, 'hay un escenario recomendado');
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

// ------------------------------------------------------------ la pantalla
console.log('\n-- pantalla --');
const ids = ['pbCuerpo'];
const registro = new Map(ids.map(i => [i, { id: i, innerHTML: '', textContent: '', value: '', style: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false } }]));
globalThis.document = {
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
globalThis.fetch = async ruta => {
  if (String(ruta).endsWith('/api/estado')) {
    return new Response(JSON.stringify({
      revision: 'prueba',
      personal: [], autorizaciones: [], adjuntos: [],
      solicitudes: historico2026(),
      destinos: DESTINOS
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
ok(/¿Alcanza una sola moto\?/.test(html), 'responde si alcanza una sola moto');
ok(/Cómo se dejan de tener urgencias/.test(html), 'incluye las medidas contra las urgencias');
ok(/Hora de corte diaria/.test(html), 'la primera medida es la hora de corte');
ok(/Cuota del proveedor/.test(html) && /IGV/.test(html), 'el escenario de tercerizar muestra la cuota y el IGV, no un desglose de planilla');
ok(!/undefined|NaN|\[object/.test(html), 'no se cuela ningún undefined, NaN ni [object Object]');

ok(/Simulador de una salida/.test(html), 'incluye el simulador de una salida');
ok(/Sale de planta/.test(html) && /Vuelve a planta/.test(html), 'la cronología arranca y termina en planta');
ok(/Beneficios sociales según la fecha de ingreso/.test(html), 'incluye el calendario de beneficios');
ok(/id="pbInicio"/.test(html), 'deja elegir la fecha de ingreso');
ok(/Ajustar los tiempos de viaje/.test(html), 'deja editar los tiempos de viaje');

vista.setBonoPayback('no');
ok(/Condición de trabajo/.test(registro.get('pbCuerpo').innerHTML),
   'cambiar el tratamiento del bono se refleja en el desglose');

console.log('\n-- controles del simulador --');
const leer = () => registro.get('pbCuerpo').innerHTML;
vista.pbReiniciarSimulador();
const antes = leer();
vista.pbAgregarParada();
ok(leer() !== antes, 'agregar una zona repinta la pantalla');
vista.pbCuantasParadas(0, 7);
ok(/value="7"/.test(leer()), 'cambiar el número de entregas se refleja');
vista.pbZonaParada(0, 'lejos');
ok(/Fuera de Lima/.test(leer()), 'cambiar la zona de una parada se refleja');
vista.pbHoraSalida('09:30');
ok(/value="09:30"/.test(leer()), 'cambiar la hora de salida se refleja');
vista.pbTiempoZona('norte', 99);
ok(/99 min desde planta/.test(leer()), 'editar el tiempo de una zona se refleja en la lista');
vista.pbDiaSimulado('sabado');
ok(/12:30/.test(leer()), 'el sábado cambia el fin de jornada');
vista.pbOrdenarMejor();
ok(leer().length > 1000, 'ordenar por el camino más corto no rompe la pantalla');
vista.pbQuitarParada(0);
vista.pbReiniciarSimulador();
ok(/value="08:00"/.test(leer()), 'reiniciar devuelve el simulador a su estado inicial');

vista.setInicioPayback('2027-01-01');
ok(/value="2027-01-01"/.test(leer()), 'cambiar la fecha de ingreso se refleja en el control');
ok(/julio 2027|diciembre 2027/.test(leer()), 'y el calendario muestra los meses que corresponden');
ok(!/undefined|NaN|\[object/.test(leer()), 'tras todos los cambios no se cuela ningún valor roto');

console.log(fallos ? `\n${fallos} comprobación(es) fallaron` : '\nTodo en verde');
process.exit(fallos ? 1 : 0);
