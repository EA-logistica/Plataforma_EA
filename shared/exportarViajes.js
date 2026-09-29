/**
 * Columnas del reporte de viajes en Excel: los mismos 24 datos del CSV del
 * histórico (ver frontend/js/views/history.js), pero con valores TIPADOS en
 * vez de texto ya formateado. El CSV existe desde antes y sigue como estaba
 * -no se toca, porque ya lo consume Power BI con esos nombres de columna en
 * snake_case-; esto es un reporte nuevo, pensado para abrirse en Excel: con
 * columnas de fecha y de número de verdad, se puede ordenar, sumar o armar
 * una tabla dinámica sin que alguien tenga que "convertir a número" cada
 * celda primero.
 *
 * Vive en shared/ porque lo arma el servidor (GET /api/solicitudes/exportar)
 * con el mismo objeto de solicitud (`aCamel` de una fila de `solicitudes`)
 * que ya recorre el navegador: un solo lugar para agregar una columna nueva,
 * no dos.
 */

const horasEntre = (a, b) => (a && b) ? (new Date(b) - new Date(a)) / 3600000 : null;

/** `fecha_prog` guarda solo el día (AAAA-MM-DD); las demás son ISO con hora. */
const fecha = iso => (iso ? new Date(iso.length <= 10 ? iso + 'T00:00:00' : iso) : null);

/** "destino (contacto, teléfono) | destino2 (...)", una sola celda para las paradas de más. */
const paradasTexto = s => (s.paradas || [])
  .map(p => p.destino + (p.contacto || p.telefono ? ' (' + [p.contacto, p.telefono].filter(Boolean).join(', ') + ')' : ''))
  .join(' | ');

// [etiqueta visible, tipo para el formato de la celda, valor a partir de la solicitud]
export const COLUMNAS_VIAJES = [
  ['Ticket', 'texto', s => s.id],
  ['Fuente', 'texto', s => (s.fuente === 'historico' ? 'Planilla 2026' : 'Aplicación')],
  ['Fecha de registro', 'fecha', s => fecha(s.creado)],
  ['DNI solicitante', 'texto', s => s.dni],
  ['Solicitante', 'texto', s => s.nombre],
  ['Área', 'texto', s => s.area],
  ['Cargo', 'texto', s => s.cargo || ''],
  ['Acción', 'texto', s => s.tipo],
  ['Tipo de servicio', 'texto', s => s.servicio || ''],
  ['Motivo', 'texto', s => s.motivo],
  ['Origen', 'texto', s => s.origen],
  ['Origen (detalle)', 'texto', s => s.origenDetalle || ''],
  ['Destino', 'texto', s => s.destino],
  ['Contacto que recibe', 'texto', s => s.contacto],
  ['Teléfono de contacto', 'texto', s => s.telefono],
  ['Fecha programada', 'fecha', s => fecha(s.fechaProg)],
  ['Hora programada', 'texto', s => s.horaProg],
  ['Vehículo', 'texto', s => s.vehiculo || ''],
  ['Costo (S/)', 'numero', s => s.costo],
  ['Estado', 'texto', s => s.estado],
  ['Fecha de tránsito', 'fechahora', s => fecha(s.tsTransito)],
  ['Fecha de conclusión', 'fechahora', s => fecha(s.tsConcluido)],
  ['Horas de espera', 'numero', s => horasEntre(s.tsEspera, s.tsTransito)],
  ['Horas en tránsito', 'numero', s => horasEntre(s.tsTransito, s.tsConcluido)],
  ['Motivo de cancelación', 'texto', s => s.motivoCancelacion || ''],
  ['Detalle de cancelación', 'texto', s => s.motivoCancelacionDetalle || ''],
  ['Cancelado por', 'texto', s => s.canceladoPor || ''],
  ['Fecha de cancelación', 'fechahora', s => fecha(s.tsCancelado)],
  ['Paradas adicionales', 'texto', paradasTexto],
  // Al final a propósito: agregarla en medio corría las columnas de quien ya usa esta planilla.
  ['Modalidad', 'texto', s => s.modalidad || 'Envíos'],
  ['Tipo de destino', 'texto', s => s.destinoTipo || '']
];

/**
 * Filtra por la fecha PROGRAMADA del viaje (la que tiene todo servicio, sea
 * de la app o de la planilla 2026), inclusive en ambos extremos. `desde` y
 * `hasta` en blanco dejan ese lado del rango abierto.
 */
export function filtrarPorRango(solicitudes, desde, hasta) {
  return solicitudes.filter(s => {
    if (desde && s.fechaProg < desde) return false;
    if (hasta && s.fechaProg > hasta) return false;
    return true;
  });
}
