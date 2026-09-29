import { todos, uno, ejecutar, insertarLote, aCamel, enTransaccion } from '../conexion.js';
import { tocar } from './ajustes.js';
import * as paradas from './paradas.js';
import * as destinos from './destinos.js';
import { contradiccionServicio, IDS_MODALIDAD, VEHICULOS, coordsDeEnlace } from '#shared/servicios.js';

/**
 * Solicitudes de servicio: el corazón de la aplicación.
 *
 * El correlativo lo asigna el servidor, nunca el navegador. Con dos personas
 * registrando a la vez, dejar que el cliente proponga el número garantiza
 * choques; aquí se toma el máximo dentro de la misma transacción que inserta
 * (con un candado consultivo, ver crear()).
 */

const error = (msg, status = 400) => Object.assign(new Error(msg), { status });

const COLUMNAS = [
  'id', 'correlativo', 'creado', 'dni', 'nombre', 'cargo', 'area', 'tipo', 'servicio',
  'motivo', 'origen', 'origen_detalle', 'destino', 'contacto', 'telefono',
  'fecha_prog', 'hora_prog', 'vehiculo', 'costo', 'estado',
  'ts_espera', 'ts_transito', 'ts_concluido', 'fuente'
];

// Columnas de la versión 4 (ver db/migrar.js): solo las llena el formulario
// actual. El histórico no las trae, así que cargarHistorico() sigue con
// COLUMNAS y estas quedan en su valor por defecto.
const COLUMNAS_NUEVAS = ['origen_lat', 'origen_lng', 'destino_lat', 'destino_lng', 'destino_tipo', 'modalidad'];

export async function listar() {
  const filas = (await todos('SELECT * FROM solicitudes ORDER BY correlativo')).map(aCamel);
  const porTicket = await paradas.todasAgrupadas();
  return filas.map(s => ({ ...s, paradas: porTicket.get(s.id) || [] }));
}

export async function porId(id) {
  const fila = aCamel(await uno('SELECT * FROM solicitudes WHERE id = ?', [String(id)]));
  if (!fila) return null;
  fila.paradas = await paradas.deTicket(fila.id);
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
export async function deArea(area, limite = 5) {
  const filas = (await todos(
    'SELECT * FROM solicitudes WHERE area = ? ORDER BY creado DESC LIMIT ?',
    [String(area), Number(limite)]
  )).map(aCamel);
  const salida = [];
  for (const s of filas) salida.push({ ...s, paradas: await paradas.deTicket(s.id) });
  return salida;
}

/**
 * Búsqueda en TODOS los servicios de un área (no solo los últimos): por
 * número de ticket, por quien lo pidió o por destino. Siempre acotada al área
 * de la sesión -el área sale del token, no de la consulta-.
 */
export async function buscarEnArea(area, q, limite = 20) {
  const texto = String(q || '').trim().slice(0, 100);
  if (texto.length < 2) return [];
  const numero = texto.replace(/[^0-9]/g, '');
  const filas = (await todos(
    'SELECT * FROM solicitudes WHERE area = @area AND ('
    + 'nombre ILIKE @q OR destino ILIKE @q OR id ILIKE @q OR motivo ILIKE @q OR servicio ILIKE @q'
    + (numero ? ' OR correlativo = @numero' : '') + ') ORDER BY creado DESC LIMIT @limite',
    { area: String(area), q: '%' + texto + '%', numero: numero ? Number(numero) : null, limite: Number(limite) }
  )).map(aCamel);
  const salida = [];
  for (const s of filas) salida.push({ ...s, paradas: await paradas.deTicket(s.id) });
  return salida;
}

export async function total() {
  return (await uno('SELECT COUNT(*) AS n FROM solicitudes')).n;
}

const pad = n => String(n).padStart(3, '0');

/** Crea una solicitud nueva. Devuelve la fila ya guardada, con su correlativo. */
export async function crear(datos) {
  validar(datos);

  // Un destino que la plataforma no conoce tiene que venir clasificado: así
  // logística sabe si va a un cliente o a un proveedor, y la dirección queda
  // registrada para la próxima vez.
  const conocido = await destinos.esConocido(datos.destino);
  const destinoTipo = destinos.TIPOS_DESTINO.includes(datos.destinoTipo) ? datos.destinoTipo : '';
  if (!conocido && !destinoTipo) {
    throw error('Este destino no está registrado: indica si es un cliente o un proveedor.');
  }
  const origenPunto = punto(datos.origenLat, datos.origenLng, 'del origen');
  const destinoPunto = punto(datos.destinoLat, datos.destinoLng, 'del destino');
  if (destinoPunto.lat == null) {
    const delEnlace = coordsDeEnlace(datos.destino);
    if (delEnlace) Object.assign(destinoPunto, punto(delEnlace.lat, delEnlace.lng, 'del enlace de Google Maps'));
  }

  return enTransaccion(async () => {
    // En PostgreSQL (READ COMMITTED) dos transacciones simultáneas verían el
    // mismo MAX y sacarían el mismo número. El candado consultivo de
    // transacción las pone en fila: la segunda espera al COMMIT de la primera
    // y recién entonces lee el MAX, que ya incluye la fila nueva.
    await ejecutar('SELECT pg_advisory_xact_lock(4201)');
    const max = (await uno('SELECT COALESCE(MAX(correlativo), 0) AS n FROM solicitudes')).n;
    const correlativo = max + 1;
    const ahora = new Date().toISOString();

    const fila = {
      id: 'REQ-' + pad(correlativo),
      correlativo,
      creado: ahora,
      // texto() y no el valor crudo: la ruta es pública, y un objeto o un
      // arreglo en cualquiera de estos campos hacía que la base rechazara el
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
      fuente: 'app',
      origen_lat: datos.origen === 'Otros' ? origenPunto.lat : null,
      origen_lng: datos.origen === 'Otros' ? origenPunto.lng : null,
      destino_lat: destinoPunto.lat,
      destino_lng: destinoPunto.lng,
      destino_tipo: destinoTipo,
      // Sin modalidad (una llamada a la API de antes del formulario nuevo) es
      // un envío/recojo, que es lo que era todo hasta entonces.
      modalidad: datos.modalidad || 'Envíos'
    };

    const columnas = [...COLUMNAS, ...COLUMNAS_NUEVAS];
    await ejecutar(
      'INSERT INTO solicitudes (' + columnas.join(', ') + ') VALUES (' +
      columnas.map(c => '@' + c).join(', ') + ')',
      fila
    );

    if (conocido) await destinos.usar(fila.destino);
    if (!conocido) {
      await destinos.registrar({
        direccion: fila.destino, tipo: destinoTipo, lat: destinoPunto.lat, lng: destinoPunto.lng,
        area: fila.area, creadoPor: fila.dni
      });
    }

    // Paradas de más, cuando el servicio tiene dos o más rutas en la misma
    // programación. El primer destino ya quedó en la fila de arriba.
    await paradas.guardar(fila.id, datos.paradas);

    await tocar('app');
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

/**
 * Coordenadas de un punto elegido en el mapa: las dos o ninguna, y dentro
 * del Perú (con holgura). Un par fuera de ese recuadro es un error de
 * captura, no un servicio real de la mensajería.
 */
function punto(lat, lng, cual) {
  const vacio = v => v == null || v === '';
  if (vacio(lat) && vacio(lng)) return { lat: null, lng: null };
  const la = Number(lat), lo = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(lo) || la < -19 || la > 1 || lo < -82 || lo > -68) {
    throw error('La ubicación ' + cual + ' elegida en el mapa no es válida.');
  }
  return { lat: Math.round(la * 1e6) / 1e6, lng: Math.round(lo * 1e6) / 1e6 };
}

const texto = (v, max = Infinity) => (v == null || typeof v === 'object' ? '' : String(v)).slice(0, max);

const CAMPOS_TEXTO = ['dni', 'nombre', 'cargo', 'area', 'tipo', 'servicio', 'motivo', 'origen', 'origenDetalle',
  'destino', 'contacto', 'telefono', 'fechaProg', 'horaProg', 'vehiculo', 'destinoTipo', 'modalidad',
  'origenLat', 'origenLng', 'destinoLat', 'destinoLng'];

function validar(d) {
  for (const campo of CAMPOS_TEXTO) {
    if (d[campo] != null && typeof d[campo] === 'object') throw error('El campo "' + campo + '" no es válido.');
  }
  if (!['Recoger', 'Entregar'].includes(d.tipo)) throw error('Indica si el mensajero va a recoger o a entregar.');
  if (d.modalidad && !IDS_MODALIDAD.includes(d.modalidad)) throw error('Elige la modalidad: Envíos, Transporte o Cargo.');
  if (String(d.servicio || '').trim().length < 3) throw error('Indica qué se va a mover.');
  const contradiccion = contradiccionServicio(d.tipo, d.servicio);
  if (contradiccion) throw error(contradiccion);
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
  if (d.vehiculo && !VEHICULOS.includes(d.vehiculo)) throw error('El transporte debe ser ' + VEHICULOS.join(', ') + '.');
  if (d.costo != null && d.costo !== '' && (!isFinite(Number(d.costo)) || Number(d.costo) < 0)) {
    throw error('La tarifa debe ser un número positivo.');
  }
}

/** Cambia el transporte o la tarifa. Un ticket concluido o cancelado ya no se toca. */
export async function actualizar(id, cambios) {
  const s = await porId(id);
  if (!s) throw error('No existe el ticket ' + id + '.', 404);
  if (s.estado === 'Concluido' || s.estado === 'Cancelado') {
    throw error('El ticket ' + id + ' está ' + s.estado.toLowerCase() + ' y ya no se modifica.', 409);
  }

  const sets = [], valores = {};
  if ('vehiculo' in cambios) {
    const v = cambios.vehiculo || null;
    if (v && !VEHICULOS.includes(v)) throw error('El transporte debe ser ' + VEHICULOS.join(', ') + '.');
    sets.push('vehiculo = @vehiculo'); valores.vehiculo = v;
  }
  if ('costo' in cambios) {
    const n = cambios.costo === null || cambios.costo === '' ? null : Number(cambios.costo);
    if (n !== null && (!isFinite(n) || n < 0)) throw error('La tarifa debe ser un número positivo.');
    sets.push('costo = @costo'); valores.costo = n === null ? null : Math.round(n * 100) / 100;
  }
  // El gestor puede corregir QUÉ se pidió (el solicitante eligió mal la
  // modalidad o la acción). Se valida el par resultante, no cada campo
  // suelto: cambiar solo la acción de un "Recojo de paquete" a Entregar
  // dejaría el ticket contradictorio.
  if ('modalidad' in cambios || 'tipo' in cambios || 'servicio' in cambios) {
    const modalidad = 'modalidad' in cambios ? cambios.modalidad : s.modalidad;
    const tipo = 'tipo' in cambios ? cambios.tipo : s.tipo;
    const servicio = 'servicio' in cambios ? texto(cambios.servicio, 200).trim() : s.servicio;
    if (modalidad && !IDS_MODALIDAD.includes(modalidad)) throw error('Elige la modalidad: Envíos, Transporte o Cargo.');
    if (!['Recoger', 'Entregar'].includes(tipo)) throw error('La acción debe ser Recoger o Entregar.');
    if (String(servicio || '').length < 3) throw error('Indica el tipo de servicio.');
    const contradiccion = contradiccionServicio(tipo, servicio);
    if (contradiccion) throw error(contradiccion);
    sets.push('modalidad = @modalidad', 'tipo = @tipo', 'servicio = @servicio');
    Object.assign(valores, { modalidad: modalidad || 'Envíos', tipo, servicio });
  }
  if (!sets.length) return s;

  valores.id = String(id);
  await ejecutar('UPDATE solicitudes SET ' + sets.join(', ') + ' WHERE id = @id', valores);
  await tocar('app');
  return porId(id);
}

/**
 * Mueve el ticket al siguiente estado del flujo.
 *
 * Las condiciones se comprueban aquí y no solo en la pantalla: sin tarifa no
 * hay cierre. (Antes también se exigía asignar Carro o Motorizado para salir;
 * desde que el solicitante elige la modalidad -Envíos, Transporte, Cargo- la
 * unidad ya viene dada y la bandeja dejó de pedirla.) Confiar en que el navegador lo
 * valide deja la puerta abierta a que un ticket se cierre sin costo y los
 * indicadores mientan.
 */
export async function avanzar(id) {
  const s = await porId(id);
  if (!s) throw error('No existe el ticket ' + id + '.', 404);

  const ahora = new Date().toISOString();
  if (s.estado === 'En espera') {
    await ejecutar("UPDATE solicitudes SET estado = 'En tránsito', ts_transito = ? WHERE id = ?", [ahora, String(id)]);
  } else if (s.estado === 'En tránsito') {
    if (s.costo == null) throw error('Ingresa el costo de ' + id + ' para cerrarlo.', 409);
    await ejecutar("UPDATE solicitudes SET estado = 'Concluido', ts_concluido = ? WHERE id = ?", [ahora, String(id)]);
  } else {
    throw error('El ticket ' + id + ' ya está ' + s.estado.toLowerCase() + ' y no se puede avanzar.', 409);
  }
  await tocar('app');
  return porId(id);
}

/**
 * Cancela el ticket: no se elimina, queda como estado terminal con el motivo.
 * `soloDesdeEspera` es el caso del propio solicitante cancelando lo suyo: solo
 * antes de que salga un mensajero. Logística sí puede cancelar uno que ya está
 * en tránsito (por ejemplo, si el motivo es que la persona no estaba
 * autorizada y recién se descubre después de despachado).
 */
export async function cancelar(id, { motivo, detalle, canceladoPor, soloDesdeEspera = false }) {
  const s = await porId(id);
  if (!s) throw error('No existe el ticket ' + id + '.', 404);
  if (s.estado === 'Concluido' || s.estado === 'Cancelado') {
    throw error('El ticket ' + id + ' ya está ' + s.estado.toLowerCase() + ' y no se puede cancelar.', 409);
  }
  if (soloDesdeEspera && s.estado !== 'En espera') {
    throw error('El servicio ya salió; pide a logística que lo cancele.', 409);
  }

  await ejecutar(
    "UPDATE solicitudes SET estado = 'Cancelado', motivo_cancelacion = ?, "
    + 'motivo_cancelacion_detalle = ?, cancelado_por = ?, ts_cancelado = ? WHERE id = ?',
    [motivo, detalle || '', canceladoPor || '', new Date().toISOString(), String(id)]
  );
  await tocar('app');
  return porId(id);
}

/** Carga masiva del histórico. Solo se usa al sembrar una base vacía. */
export async function cargarHistorico(filas) {
  return enTransaccion(async () => {
    const lote = filas.map((s, i) => ({
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
    }));
    const n = await insertarLote('solicitudes', COLUMNAS, lote, 'ON CONFLICT (id) DO NOTHING');
    await tocar('app');
    return n;
  });
}
