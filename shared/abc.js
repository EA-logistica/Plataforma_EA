/**
 * Clasificación ABC de materias primas y punto de reorden. Puro: lo usan el
 * servidor (backend/db/repos/mpPlaneacion.js) y los tests.
 *
 * ABC por CONSUMO VALORIZADO ANUAL (consumo promedio mensual de 12 meses × 12
 * × costo unitario en US$), el criterio clásico de Pareto: no por stock ni
 * por cantidad de compras.
 *   A: los códigos que juntos hacen el primer 80% del consumo valorizado.
 *   B: los que llevan del 80% al 95%.
 *   C: el 5% restante.
 * Un código sin consumo en 12 meses no entra al ranking: si tiene stock es
 * capital inmovilizado, y se muestra aparte.
 *
 * Reorden: con el lead time del bot y su % de seguridad,
 *   punto de reorden = consumo mensual × lead time (meses) × (1 + seguridad)
 * y se compara con lo disponible = stock + lo que ya está en camino (OC
 * abiertas). La cobertura es disponible / consumo mensual, en meses.
 */

export const CORTES = { A: 0.8, B: 0.95 };
/** Por encima de esta cobertura (meses) el stock es exceso: config_alertas_cobertura.politica_stock_meses del bot. */
export const MESES_EXCESO = 8;
/** Lead time cuando el bot no tiene uno: configuracion_stock.lead_time_default (30 días). */
export const LEAD_TIME_DEFECTO = 1;

export const ESTADOS_REORDEN = [
  { k: 'pedir', t: 'Pedir ya', d: 'Lo disponible ya está en el punto de reorden o por debajo' },
  { k: 'pronto', t: 'Pedir pronto', d: 'Llega al punto de reorden en menos de un mes de consumo' },
  { k: 'ok', t: 'Cubierto', d: 'Cobertura sana' },
  { k: 'exceso', t: 'Exceso', d: 'Más de ' + MESES_EXCESO + ' meses de cobertura' },
  { k: 'inmovilizado', t: 'Sin consumo', d: 'Tiene stock pero no se consumió en 12 meses' }
];
export const ETIQUETA_REORDEN = Object.fromEntries(ESTADOS_REORDEN.map(e => [e.k, e.t]));

const n = v => (Number.isFinite(Number(v)) ? Number(v) : 0);

function reorden(f) {
  const disponible = n(f.stock) + n(f.enCamino);
  const consumo = n(f.consumoMes);
  if (consumo <= 0) return { estado: n(f.stock) > 0 ? 'inmovilizado' : '', puntoReorden: 0, cobertura: null, coberturaTotal: null };
  const lt = n(f.leadTimeMeses) > 0 ? n(f.leadTimeMeses) : LEAD_TIME_DEFECTO;
  const puntoReorden = consumo * lt * (1 + n(f.seguridadPct));
  const coberturaTotal = disponible / consumo;
  const estado = disponible <= puntoReorden ? 'pedir'
    : disponible <= puntoReorden + consumo ? 'pronto'
    : coberturaTotal > MESES_EXCESO ? 'exceso' : 'ok';
  return { estado, puntoReorden, cobertura: n(f.stock) / consumo, coberturaTotal, leadTime: lt };
}

/** Filas de planeación → cada una con su clase, % acumulado, valor anual, cobertura y estado de reorden. */
export function clasificar(filas, cortes = CORTES) {
  const conValor = filas.map(f => ({
    ...f,
    valorAnual: n(f.consumoMes) * 12 * n(f.costoUsd),
    stockUsd: n(f.stock) * n(f.costoUsd),
    ...reorden(f)
  }));
  const total = conValor.reduce((a, f) => a + f.valorAnual, 0);
  const ranking = conValor.filter(f => f.valorAnual > 0).sort((a, b) => b.valorAnual - a.valorAnual);
  let acumulado = 0;
  ranking.forEach((f, i) => {
    const antes = total ? acumulado / total : 0;
    acumulado += f.valorAnual;
    f.rango = i + 1;
    f.participacion = total ? f.valorAnual / total : 0;
    f.acumulado = total ? acumulado / total : 0;
    // La fila que cruza el corte se queda en la clase de arriba: así el
    // primer código ya es A aunque él solo pase del 80%.
    f.clase = antes < cortes.A ? 'A' : antes < cortes.B ? 'B' : 'C';
  });
  const sinRanking = conValor.filter(f => !(f.valorAnual > 0)).map(f => ({ ...f, clase: '', rango: null, participacion: 0, acumulado: null }));
  return [...ranking, ...sinRanking];
}

/** Totales por clase, la matriz clase × estado de reorden y la curva de Pareto. */
export function resumir(clasificadas) {
  const clases = ['A', 'B', 'C'].map(c => {
    const xs = clasificadas.filter(f => f.clase === c);
    return {
      clase: c, n: xs.length,
      valorAnual: xs.reduce((a, f) => a + f.valorAnual, 0),
      stockUsd: xs.reduce((a, f) => a + f.stockUsd, 0),
      pedir: xs.filter(f => f.estado === 'pedir').length,
      pronto: xs.filter(f => f.estado === 'pronto').length,
      exceso: xs.filter(f => f.estado === 'exceso').length
    };
  });
  const total = clases.reduce((a, c) => a + c.valorAnual, 0);
  clases.forEach(c => { c.pct = total ? c.valorAnual / total : 0; });
  const ranking = clasificadas.filter(f => f.clase);
  const inmovilizados = clasificadas.filter(f => f.estado === 'inmovilizado');
  const matriz = {};
  for (const f of ranking) {
    const fila = (matriz[f.clase] ||= {});
    fila[f.estado] = (fila[f.estado] || 0) + 1;
  }
  // Curva de Pareto con a lo sumo ~120 puntos: suficiente para dibujarla.
  const paso = Math.max(1, Math.ceil(ranking.length / 120));
  const pareto = ranking.filter((f, i) => i % paso === 0 || i === ranking.length - 1)
    .map(f => ({ rango: f.rango, pctCodigos: f.rango / ranking.length, acumulado: f.acumulado, clase: f.clase }));
  const excesoUsd = clasificadas.filter(f => f.estado === 'exceso' && f.coberturaTotal != null)
    .reduce((a, f) => a + Math.max(0, n(f.stock) - n(f.consumoMes) * MESES_EXCESO) * n(f.costoUsd), 0);
  return {
    clases,
    valorAnual: total,
    codigos: ranking.length,
    stockUsd: clasificadas.reduce((a, f) => a + f.stockUsd, 0),
    inmovilizados: inmovilizados.length,
    inmovilizadoUsd: inmovilizados.reduce((a, f) => a + f.stockUsd, 0),
    excesoUsd,
    pedir: ranking.filter(f => f.estado === 'pedir').length,
    pedirA: ranking.filter(f => f.estado === 'pedir' && f.clase === 'A').length,
    compraSugeridaUsd: ranking.filter(f => f.estado === 'pedir' || f.estado === 'pronto').reduce((a, f) => a + n(f.compraSugeridaUsd), 0),
    matriz,
    pareto
  };
}
