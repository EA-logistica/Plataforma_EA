/**
 * Sub-pestaña activa dentro de "Histórico": 'listado' o 'indicadores'.
 * Comparten una sola sección de la barra lateral -ya no hay un tab
 * "Indicadores" aparte-, así que history.js y kpi.js necesitan saber cuál de
 * las dos se ve de verdad antes de repintarse en cada sondeo (ver
 * renderTodo() en render.js).
 */
let actual = 'listado';
export const subtabHistoricoActual = () => actual;
export function setSubtabHistoricoActual(k) { actual = k; }
