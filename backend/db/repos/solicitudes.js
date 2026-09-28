import { db, aCamel, enTransaccion } from '../conexion.js';
import { tocar } from './ajustes.js';
import * as paradas from './paradas.js';

/**
 * Solicitudes de servicio: el corazón de la aplicación.
 *
 * El correlativo lo asigna el servidor, nunca el navegador. Con dos personas
 * registrando a la vez, dejar que el cliente proponga el número garantiza
 * choques; aquí se toma el máximo dentro de la misma transacción que inserta.
 */

const error = (msg, status = 400) => Object.assign(new Error(msg), { status });

const COLUMNAS = [
  'id', 'correlativo', 'creado', 'dni', 'nombre', 'cargo', 'area', 'tipo', 'servicio',
  'motivo', 'origen', 'origen_detalle', 'destino', 'contacto', 'telefono',
  'fecha_prog', 'hora_prog', 'vehiculo', 'costo', 'estado',
  'ts_espera', 'ts_transito', 'ts_concluido', 'fuente'
];

export function listar() {
  const filas = db().prepare('SELECT * FROM solicitudes ORDER BY correlativo').all().map(aCamel);
  const porTicket = paradas.todasAgrupadas();
  return filas.map(s => ({ ...s, paradas: porTicket.get(s.id) || [] }));
}

export function porId(id) {
  const fila = aCamel(db().prepare('SELECT * FROM solicitudes WHERE id = ?').get(String(id)));
  if (!fila) return null;
  fila.paradas = paradas.deTicket(fila.id);
  return fila;
}

/**
 * Los últimos `limite` servicios de UN área: es lo único que ve el
 * solicitante, que ahora entra con DNI + credencial de área (ver
 * backend/areas/). No es por DNI, porque el punto de la credencial de área es
 * que la vean todos los que trabajan ahí, no solo quien la usó para entrar.
 * `GET /api/estado` y `GET /api/solicitudes` completos siguen siendo cosa de
 * logística (ver backend/rutas/index.js).
 */
export function deArea(area, limite = 5) {
  const filas = db().prepare('SELECT * FROM solicitudes WHERE area = ? ORDER BY creado DESC LIMIT ?')
    .all(String(area), Number(limite)).map(aCamel);
  return filas.map(s => ({ ...s, paradas: paradas.deTicket(s.id) }));
}

export function total() {
  return db().prepare('SELECT COUNT(*) AS n FROM solicitudes').get().n;
}

const pad = n => String(n).padStart(3, '0');

/** Crea una solicitud nueva. Devuelve la fila ya guardada, con su correlativo. */
export function crear(datos) {
  validar(datos);

  return enTransaccion(base => {
    const max = base.prepare('SELECT COALESCE(MAX(correlativo), 0) AS n FROM solicitudes').get().n;
    const correlativo = max + 1;
    const ahora = new Date().toISOString();

    const fila = {
      id: 'REQ-' + pad(correlativo),
      correlativo,
      creado: ahora,
      // texto() y no el valor crudo: la ruta es pública, y un objeto o un
      // arreglo en cualquiera de estos campos hacía que SQLite rechazara el
      // parámetro y la petición saliera como 500 en vez de guardarse.
      dni: texto(datos.dni, 20),
      nombre: texto(datos.nombre, 200),
      cargo: texto(datos.cargo, 200),
      area: texto(datos.area, 200),
      tipo: datos.tipo,
      servicio: texto(datos.servicio),
      motivo: texto(datos.motivo),
      origen: texto(datos.origen, 200),
      origen_detalle: texto(datos.origenDetalle),
      destino: texto(datos.destino),
      contacto: texto(datos.contacto),
      telefono: texto(datos.telefono, 20),
      fecha_prog: texto(datos.fechaProg),
      hora_prog: texto(datos.horaProg),
      vehiculo: datos.vehiculo || null,
      costo: datos.costo != null && datos.costo !== '' ? Math.round(Number(datos.costo) * 100) / 100 : null,
      estado: 'En espera',
      ts_espera: ahora,
      ts_transito: null,
      ts_concluido: null,
      fuente: 'app'
    };

    base.prepare(
      'INSERT INTO solicitudes (' + COLUMNAS.join(', ') + ') VALUES (' +
      COLUMNAS.map(c => '@' + c).join(', ') + ')'
    ).run(fila);

    // Paradas de más, cuando el servicio tiene dos o más rutas en la misma
    // programación. El primer destino ya quedó en la fila de arriba.
    paradas.guardar(fila.id, datos.paradas);

    tocar('app');
    return porId(fila.id);
  });
}

// Tope superior para los campos de texto libre. Nada del formulario necesita
// más que esto; sin un tope, el único límite era el 1 MB del body completo,
// que deja meter un solo campo gigantesco (y, si algún día un campo así se
// vuelve a pintar sin `esc()` por descuido, cuanto más largo el texto, más
// margen para un payload de XSS).
const LARGO_MAX = { servicio: 200, motivo: 800, destino: 300, contacto: 150, origenDetalle: 300 };

function tope(campo, valor) {
  if (String(valor || '').length > LARGO_MAX[campo]) {
    throw error('El campo "' + campo + '" no puede superar los ' + LARGO_MAX[campo] + ' caracteres.');
  }
}

const texto = (v, max = Infinity) => (v == null || typeof v === 'object' ? '' : String(v)).slice(0, max);

const CAMPOS_TEXTO = ['dni', 'nombre', 'cargo', 'area', 'tipo', 'servicio', 'motivo', 'origen', 'origenDetalle',
  'destino', 'contacto', 'telefono', 'fechaProg', 'horaProg', 'vehiculo'];

function validar(d) {
  for (const campo of CAMPOS_TEXTO) {
    if (d[campo] != null && typeof d[campo] === 'object') throw error('El campo "' + campo + '" no es válido.');
  }
  if (!['Recoger', 'Entregar'].includes(d.tipo)) throw error('Indica si el mensajero va a recoger o a entregar.');
  if (String(d.servicio || '').trim().length < 3) throw error('Indica qué se va a mover.');
  if (!String(d.origen || '').trim()) throw error('Elige desde dónde sale el servicio.');
  if (String(d.motivo || '').trim().length < 5) throw error('Describe el motivo del servicio.');
  if (String(d.destino || '').trim().length < 6) throw error('Escribe la dirección exacta de destino.');
  if (String(d.contacto || '').trim().length < 3) throw error('Indica quién recibe.');
  const tel = String(d.telefono || '').replace(/\D/g, '');
  if (tel.length < 9 || tel.length > 11) throw error('Ingresa un teléfono válido de 9 dígitos.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(d.fechaProg || ''))) throw error('Elige una fecha válida.');
  // Nunca se validaba: cualquier texto quedaba en hora_prog y se pintaba tal
  // cual en el modal de gestión. Vacío se admite (así llega el histórico, que
  // no registraba hora), pero si viene algo, tiene que ser una hora de verdad.
  if (d.horaProg && !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(d.horaProg))) {
    throw error('La hora debe tener el formato HH:MM.');
  }
  for (const campo of ['servicio', 'motivo', 'destino', 'contacto', 'origenDetalle']) tope(campo, d[campo]);
  // Transporte y tarifa los fija logística después, pero si vienen al crear
  // tienen que ser válidos: antes un costo 'abc' entraba como NaN y un
  // vehículo cualquiera se guardaba tal cual, y los dos alimentan los KPI.
  if (d.vehiculo && !['Motorizado', 'Carro'].includes(d.vehiculo)) throw error('El transporte debe ser Motorizado o Carro.');
  if (d.costo != null && d.costo !== '' && (!isFinite(Number(d.costo)) || Number(d.costo) < 0)) {
    throw error('La tarifa debe ser un número positivo.');
  }
}

/** Cambia el transporte o la tarifa. Un ticket concluido o cancelado ya no se toca. */
export function actualizar(id, cambios) {
  const s = porId(id);
  if (!s) throw error('No existe el ticket ' + id + '.', 404);
  if (s.estado === 'Concluido' || s.estado === 'Cancelado') {
    throw error('El ticket ' + id + ' está ' + s.estado.toLowerCase() + ' y ya no se modifica.', 409);
  }

  const sets = [], valores = {};
  if ('vehiculo' in cambios) {
    const v = cambios.vehiculo || null;
    if (v && !['Motorizado', 'Carro'].includes(v)) throw error('El transporte debe ser Motorizado o Carro.');
    sets.push('vehiculo = @vehiculo'); valores.vehiculo = v;
  }
  if ('costo' in cambios) {
    const n = cambios.costo === null || cambios.costo === '' ? null : Number(cambios.costo);
    if (n !== null && (!isFinite(n) || n < 0)) throw error('La tarifa debe ser un número positivo.');
    sets.push('costo = @costo'); valores.costo = n === null ? null : Math.round(n * 100) / 100;
  }
  if (!sets.length) return s;

  valores.id = String(id);
  db().prepare('UPDATE solicitudes SET ' + sets.join(', ') + ' WHERE id = @id').run(valores);
  tocar('app');
  return porId(id);
}

/**
 * Mueve el ticket al siguiente estado del flujo.
 *
 * Las condiciones se comprueban aquí y no solo en la pantalla: sin transporte
 * no hay salida, y sin tarifa no hay cierre. Confiar en que el navegador lo
 * valide deja la puerta abierta a que un ticket se cierre sin costo y los
 * indicadores mientan.
 */
export function avanzar(id) {
  const s = porId(id);
  if (!s) throw error('No existe el ticket ' + id + '.', 404);

  const ahora = new Date().toISOString();
  if (s.estado === 'En espera') {
    if (!s.vehiculo) throw error('Asigna Carro o Motorizado antes de mover ' + id + ' a tránsito.', 409);
    db().prepare("UPDATE solicitudes SET estado = 'En tránsito', ts_transito = ? WHERE id = ?").run(ahora, id);
  } else if (s.estado === 'En tránsito') {
    if (s.costo == null) throw error('Ingresa el costo de ' + id + ' para cerrarlo.', 409);
    db().prepare("UPDATE solicitudes SET estado = 'Concluido', ts_concluido = ? WHERE id = ?").run(ahora, id);
  } else {
    throw error('El ticket ' + id + ' ya está ' + s.estado.toLowerCase() + ' y no se puede avanzar.', 409);
  }
  tocar('app');
  return porId(id);
}

/**
 * Cancela el ticket: no se elimina, queda como estado terminal con el motivo.
 * `soloDesdeEspera` es el caso del propio solicitante cancelando lo suyo: solo
 * antes de que salga un mensajero. Logística sí puede cancelar uno que ya está
 * en tránsito (por ejemplo, si el motivo es que la persona no estaba
 * autorizada y recién se descubre después de despachado).
 */
export function cancelar(id, { motivo, detalle, canceladoPor, soloDesdeEspera = false }) {
  const s = porId(id);
  if (!s) throw error('No existe el ticket ' + id + '.', 404);
  if (s.estado === 'Concluido' || s.estado === 'Cancelado') {
    throw error('El ticket ' + id + ' ya está ' + s.estado.toLowerCase() + ' y no se puede cancelar.', 409);
  }
  if (soloDesdeEspera && s.estado !== 'En espera') {
    throw error('El servicio ya salió; pide a logística que lo cancele.', 409);
  }

  db().prepare(
    "UPDATE solicitudes SET estado = 'Cancelado', motivo_cancelacion = ?, "
    + 'motivo_cancelacion_detalle = ?, cancelado_por = ?, ts_cancelado = ? WHERE id = ?'
  ).run(motivo, detalle || '', canceladoPor || '', new Date().toISOString(), id);
  tocar('app');
  return porId(id);
}

/** Carga masiva del histórico. Solo se usa al sembrar una base vacía. */
export function cargarHistorico(filas) {
  return enTransaccion(base => {
    const insertar = base.prepare(
      'INSERT INTO solicitudes (' + COLUMNAS.join(', ') + ') VALUES (' +
      COLUMNAS.map(c => '@' + c).join(', ') + ') ON CONFLICT (id) DO NOTHING'
    );
    let n = 0;
    filas.forEach((s, i) => {
      n += insertar.run({
        id: s.id,
        correlativo: i + 1,
        creado: s.creado,
        dni: s.dni || '', nombre: s.nombre || '', cargo: s.cargo || '', area: s.area || '',
        tipo: s.tipo, servicio: s.servicio || '', motivo: s.motivo || '',
        origen: s.origen || '', origen_detalle: s.origenDetalle || '', destino: s.destino || '',
        contacto: s.contacto || '', telefono: s.telefono || '',
        fecha_prog: s.fechaProg || '', hora_prog: s.horaProg || '',
        vehiculo: s.vehiculo || null,
        costo: s.costo != null ? s.costo : null,
        estado: s.estado,
        ts_espera: s.tsEspera || null, ts_transito: s.tsTransito || null, ts_concluido: s.tsConcluido || null,
        fuente: s.fuente || 'historico'
      }).changes;
    });
    tocar('app');
    return n;
  });
}
