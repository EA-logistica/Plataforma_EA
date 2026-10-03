import { todos, ejecutar, insertarLote, aCamel, enTransaccion } from '../conexion.js';
import { tocar } from './ajustes.js';
import { clasificar, resumir } from '#shared/abc.js';

/**
 * Planeación de materia prima por código (consumo, lead time, pedidos en
 * camino, compra sugerida), copiada de productos_maestro del bot por
 * backend/mongo/sincronizar.js. Sobre ella se calcula la clasificación ABC y
 * el punto de reorden (shared/abc.js).
 */

const COLUMNAS = [
  'codigo', 'descripcion', 'tipo', 'linea', 'unidad_medida', 'stock', 'consumo_mes', 'consumo_p95',
  'costo_usd', 'lead_time_meses', 'seguridad_pct', 'en_camino', 'compra_sugerida', 'compra_sugerida_usd',
  'estado_demanda', 'proveedor_ultima', 'fecha_ultima_compra', 'ultimo_costo_usd'
];

export async function cargarInicial(filas) {
  return enTransaccion(async () => {
    await ejecutar('DELETE FROM mp_planeacion');
    const n = v => (Number.isFinite(Number(v)) ? Number(v) : 0);
    const t = v => (v == null ? '' : String(v));
    await insertarLote('mp_planeacion', COLUMNAS, filas.map(f => ({
      codigo: f.codigo, descripcion: t(f.descripcion), tipo: t(f.tipo), linea: t(f.linea), unidad_medida: t(f.unidadMedida),
      stock: n(f.stock), consumo_mes: n(f.consumoMes), consumo_p95: n(f.consumoP95), costo_usd: n(f.costoUsd),
      lead_time_meses: n(f.leadTimeMeses), seguridad_pct: n(f.seguridadPct), en_camino: n(f.enCamino),
      compra_sugerida: n(f.compraSugerida), compra_sugerida_usd: n(f.compraSugeridaUsd), estado_demanda: t(f.estadoDemanda),
      proveedor_ultima: t(f.proveedorUltima), fecha_ultima_compra: t(f.fechaUltimaCompra), ultimo_costo_usd: n(f.ultimoCostoUsd)
    })), 'ON CONFLICT (codigo) DO NOTHING');
    await tocar();
    return filas.length;
  });
}

/** ABC de un tipo (Materia Prima o Tintas; vacío = las dos juntas). */
export async function abc(tipo = '') {
  const filas = (await todos('SELECT * FROM mp_planeacion' + (tipo ? ' WHERE tipo = ?' : ''), tipo ? [tipo] : [])).map(aCamel);
  const clasificadas = clasificar(filas);
  return { filas: clasificadas, resumen: resumir(clasificadas) };
}
