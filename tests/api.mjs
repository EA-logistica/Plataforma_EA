/**
 * Pruebas de la API. Se corren con:
 *
 *     node tests/api.mjs
 *
 * Levantan un servidor de verdad contra una base SQLite temporal y una carpeta
 * de subidas temporal, y lo golpean por HTTP igual que lo hace el navegador.
 * No se simula nada: la subida pasa por multer, el archivo termina en disco y
 * se vuelve a descargar para comprobar que es el mismo.
 *
 * Al terminar se borra todo lo temporal, así que correr las pruebas no toca la
 * base real ni ensucia uploads/.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const temporal = fs.mkdtempSync(path.join(os.tmpdir(), 'plansa-test-'));
process.env.PLANSA_DB = path.join(temporal, 'prueba.sqlite');
process.env.PLANSA_UPLOADS = path.join(temporal, 'uploads');
process.env.PLANSA_PUERTO = '0';                 // puerto libre que elija el sistema

const { iniciar } = await import('../backend/servidor.js');
const { nombreUnico, marcaDeTiempo } = await import('../backend/middleware/subida.js');
const { olvidarIntentos, olvidarPeticiones } = await import('../backend/middleware/limites.js');
// Las cifras del histórico y del padrón se leen de la propia fuente: al
// actualizar la planilla o el headcount, las pruebas siguen valiendo sin
// tocar un número a mano.
const { RESUMEN } = await import('#data/historico.js');
const SEMBRADOS = RESUMEN.servicios;
const { PERSONAL } = await import('#data/padron.js');
const TOTAL_PADRON = PERSONAL.length;
const SIGUIENTE = 'REQ-' + String(SEMBRADOS + 1).padStart(3, '0');

let fallos = 0;
const ok = (cond, msg) => { console.log((cond ? '  ok   ' : '  FALLA') + ' ' + msg); if (!cond) fallos++; };

const servidor = iniciar({ puerto: 0, silencioso: true });
await new Promise(r => servidor.once('listening', r));
const BASE = 'http://127.0.0.1:' + servidor.address().port;

const api = async (metodo, ruta, cuerpo, token, extra) => {
  const init = { method: metodo, headers: { ...extra } };
  if (token) init.headers.Authorization = 'Bearer ' + token;
  if (cuerpo instanceof FormData) init.body = cuerpo;
  else if (cuerpo !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(cuerpo);
  }
  const res = await fetch(BASE + ruta, init);
  const texto = await res.text();
  let datos = null;
  try { datos = texto ? JSON.parse(texto) : null; } catch (e) { datos = texto; }
  return { status: res.status, datos, res };
};

try {
  // ------------------------------------------------------------ arranque
  console.log('\n-- arranque y siembra --');
  const salud = await api('GET', '/api/salud');
  ok(salud.status === 200 && salud.datos.ok, 'el servidor responde');
  ok(salud.datos.personal === TOTAL_PADRON, `la base se sembró con el padrón (${salud.datos.personal} personas)`);
  ok(salud.datos.solicitudes === SEMBRADOS, `y con el histórico 2026 (${salud.datos.solicitudes} servicios)`);
  ok(fs.existsSync(process.env.PLANSA_DB), 'el archivo SQLite existe en disco');

  // Sin sesión -el caso del solicitante, que nunca tuvo clave- /estado ya NO
  // trae el historial: antes cualquiera en la red se traía los 1600+
  // servicios completos (DNI, teléfono, dirección) sin autenticarse.
  const estado = await api('GET', '/api/estado');
  ok(estado.status === 200, 'GET /api/estado responde sin sesión');
  ok(estado.datos.totalPersonal === TOTAL_PADRON && estado.datos.destinos.length > 0,
     'trae lo público: conteo del padrón y catálogo de destinos');
  ok(Array.isArray(estado.datos.solicitudes) && estado.datos.solicitudes.length === 0,
     'pero NO el historial completo: sin sesión, la lista viene vacía');
  ok(estado.datos.adjuntos.length === 0 && estado.datos.autorizaciones.length === 0,
     'ni adjuntos ni autorizaciones tampoco');
  ok(estado.datos.personal === undefined,
     'y NO trae el padrón: son datos personales que la pantalla no necesita en bloque');
  ok(!('usuarios' in estado.datos) && !JSON.stringify(estado.datos).includes('claveHash'),
     'ninguna clave ni hash de usuario viaja al navegador');

  // ---------------------------------------------------------- ingreso
  console.log('\n-- ingreso --');
  const eddy = await api('GET', '/api/auth/solicitante/73012556');
  ok(eddy.status === 200 && eddy.datos.nombre.includes('AVALOS'), 'un DNI del padrón se encuentra');
  ok((await api('GET', '/api/auth/solicitante/9628739')).status === 200,
     'el DNI de 7 dígitos se encuentra escrito sin el cero inicial (09628739, sin el "0")');
  ok((await api('GET', '/api/auth/solicitante/99999999')).status === 404,
     'un documento ajeno al padrón responde 404');

  const loginAdmin = await api('POST', '/api/auth/ingresar', { usuario: 'admin', clave: 'admin' });
  ok(loginAdmin.status === 200 && loginAdmin.datos.token, 'la siembra crea el usuario admin con clave temporal "admin"');
  ok(loginAdmin.datos.rol === 'admin' && loginAdmin.datos.debeCambiarClave === true,
     'entra como admin y con aviso de clave temporal pendiente de cambiar');
  let tokenAdmin = loginAdmin.datos.token;

  ok((await api('POST', '/api/auth/ingresar', { usuario: 'admin', clave: 'noesla' })).status === 401,
     'una clave incorrecta responde 401');
  ok((await api('POST', '/api/auth/ingresar', { usuario: 'noexiste', clave: 'admin' })).status === 401,
     'un usuario que no existe responde lo mismo, sin decir cuál de los dos falló');
  ok((await api('POST', '/api/auth/ingresar', {})).status === 401, 'sin nada, tampoco entra');

  ok((await api('GET', '/api/personal', undefined)).status === 401,
     'sin sesión, ni siquiera se puede buscar en el padrón');
  ok((await api('GET', '/api/auth/yo', undefined, tokenAdmin)).datos.usuario === 'admin',
     'con el token, el servidor sabe quién es');

  // Con sesión de logística, /estado sí trae todo: es quien tiene que ver la
  // bandeja, el histórico y los indicadores completos.
  const estadoStaff = await api('GET', '/api/estado', undefined, tokenAdmin);
  ok(estadoStaff.datos.solicitudes.length === SEMBRADOS, 'con sesión, /estado sí trae el historial completo');
  ok(estadoStaff.datos.autorizaciones !== undefined && estadoStaff.datos.adjuntos !== undefined,
     'y también adjuntos y autorizaciones');

  // ---------------------------------------------------------- usuarios
  console.log('\n-- cuentas de logística --');
  ok((await api('POST', '/api/usuarios', { usuario: 'jperez', rol: 'seguimiento' })).status === 401,
     'crear un usuario sin sesión no se puede');

  const creado = await api('POST', '/api/usuarios', { usuario: 'jperez', rol: 'seguimiento' }, tokenAdmin);
  ok(creado.status === 201 && creado.datos.claveTemporal && creado.datos.claveTemporal.length === 8,
     'admin crea una cuenta de seguimiento con clave temporal de 8 caracteres');
  ok(!('claveHash' in creado.datos), 'y el hash de la clave nunca sale en la respuesta');
  ok((await api('POST', '/api/usuarios', { usuario: 'jperez', rol: 'seguimiento' }, tokenAdmin)).status === 409,
     'no deja repetir el nombre de usuario');
  ok((await api('POST', '/api/usuarios', { usuario: 'x', rol: 'seguimiento' }, tokenAdmin)).status === 400,
     'rechaza un usuario demasiado corto');
  ok((await api('POST', '/api/usuarios', { usuario: 'jgarcia', rol: 'volador' }, tokenAdmin)).status === 400,
     'y un rol que no existe');

  const loginSeg = await api('POST', '/api/auth/ingresar', { usuario: 'jperez', clave: creado.datos.claveTemporal });
  ok(loginSeg.status === 200 && loginSeg.datos.rol === 'seguimiento', 'la cuenta de seguimiento entra con su clave temporal');
  let tokenSeg = loginSeg.datos.token;

  ok((await api('GET', '/api/usuarios', undefined, tokenSeg)).status === 403,
     'seguimiento no puede listar las cuentas de logística');
  ok((await api('POST', '/api/usuarios', { usuario: 'otro', rol: 'admin' }, tokenSeg)).status === 403,
     'ni crear una cuenta nueva');

  const lista = await api('GET', '/api/usuarios', undefined, tokenAdmin);
  ok(lista.status === 200 && lista.datos.some(u => u.usuario === 'jperez'), 'admin sí ve el listado completo');

  const idAdmin = lista.datos.find(u => u.usuario === 'admin').id;
  ok((await api('PATCH', '/api/usuarios/' + idAdmin, { activo: false }, tokenAdmin)).status === 400,
     'admin no puede desactivarse a sí mismo');

  const desactivado = await api('PATCH', '/api/usuarios/' + creado.datos.id, { activo: false }, tokenAdmin);
  ok(desactivado.status === 200 && desactivado.datos.activo === 0, 'admin desactiva la cuenta de seguimiento');
  ok((await api('POST', '/api/auth/ingresar', { usuario: 'jperez', clave: creado.datos.claveTemporal })).status === 401,
     'una vez desactivada, ya no puede entrar aunque la clave sea correcta');
  ok((await api('GET', '/api/auth/yo', undefined, tokenSeg)).status === 401,
     'y su sesión anterior queda cortada de inmediato, no solo el próximo ingreso');

  const restablecida = await api('POST', '/api/usuarios/' + creado.datos.id + '/restablecer', undefined, tokenAdmin);
  ok(restablecida.status === 200 && restablecida.datos.claveTemporal, 'se le puede generar una nueva clave temporal');
  ok((await api('PATCH', '/api/usuarios/' + creado.datos.id, { activo: true }, tokenAdmin)).datos.activo === 1,
     'y reactivarla');
  const reingreso = await api('POST', '/api/auth/ingresar', { usuario: 'jperez', clave: restablecida.datos.claveTemporal });
  ok(reingreso.status === 200, 'con la nueva clave temporal, vuelve a entrar');
  tokenSeg = reingreso.datos.token;

  // ------------------------------------------------------------ personal
  console.log('\n-- padrón --');
  ok((await api('GET', '/api/personal', undefined, tokenSeg)).status === 403,
     'seguimiento no tiene acceso a "Padrón y accesos": ni para buscar');

  const sinBuscar = await api('GET', '/api/personal', undefined, tokenAdmin);
  ok(Array.isArray(sinBuscar.datos.resultados) && sinBuscar.datos.resultados.length === 0,
     'sin búsqueda no se vuelca el padrón completo');
  ok(sinBuscar.datos.total === TOTAL_PADRON, 'pero sí dice cuántos hay');

  const busq = await api('GET', '/api/personal?q=avalos', undefined, tokenAdmin);
  ok(busq.datos.length === 1 && busq.datos[0].dni === '73012556', 'la búsqueda por apellido encuentra');
  ok((await api('GET', '/api/personal?q=nunez', undefined, tokenAdmin)).datos.length > 0,
     'y encuentra NÚÑEZ escrito sin tildes');

  ok((await api('POST', '/api/personal', { dni: '12345678', nombre: 'PERSONA DE PRUEBA' }, tokenSeg)).status === 403,
     'seguimiento no puede agregar directo al padrón: solo admin');

  const alta = await api('POST', '/api/personal', { dni: '12345678', nombre: 'PERSONA DE PRUEBA', area: 'Logistica' }, tokenAdmin);
  ok(alta.status === 201 && alta.datos.origen === 'manual', 'un alta manual (de admin) se marca como manual');
  ok((await api('POST', '/api/personal', { dni: '12345678', nombre: 'OTRA' }, tokenAdmin)).status === 409,
     'no deja dar de alta dos veces el mismo documento');
  ok((await api('POST', '/api/personal', { dni: '123', nombre: 'X' }, tokenAdmin)).status === 400,
     'rechaza un documento inválido');
  ok((await api('DELETE', '/api/personal/12345678', undefined, tokenSeg)).status === 403,
     'seguimiento tampoco puede quitar del padrón');
  ok((await api('DELETE', '/api/personal/12345678', undefined, tokenAdmin)).status === 200, 'admin sí puede quitarlo');
  ok((await api('DELETE', '/api/personal/12345678', undefined, tokenAdmin)).status === 404, 'quitar dos veces responde 404');

  // --------------------------------------------------------- solicitudes
  console.log('\n-- solicitudes --');
  const nueva = {
    dni: '73012556', nombre: 'EDDY PERCY AVALOS VALDIVIA', cargo: 'COORDINADOR DE LOGISTICA', area: 'Logistica',
    tipo: 'Entregar', servicio: 'Envío de documentos', motivo: 'Entrega de facturas del mes',
    origen: 'Plásticos Nacionales - Talleres', destino: 'PLUS COSMÉTICA, AV. VÍCTOR ANDRÉS BELAÚNDE 280, SAN ISIDRO',
    contacto: 'Mesa de partes', telefono: '987654321', fechaProg: '2026-09-20', horaProg: '10:00'
  };
  // Registrar un ticket es autoservicio del solicitante: sin token.
  const creada = await api('POST', '/api/solicitudes', nueva);
  ok(creada.status === 201, 'se registra una solicitud sin sesión de logística');
  ok(creada.datos.id === SIGUIENTE, `el correlativo sigue al histórico (${creada.datos.id})`);
  ok(creada.datos.estado === 'En espera' && creada.datos.fuente === 'app',
     'entra en espera y marcada como registrada en la app');

  const otra = await api('POST', '/api/solicitudes', nueva);
  ok(otra.datos.id === 'REQ-' + String(SEMBRADOS + 2).padStart(3, '0'),
     'dos registros seguidos no repiten correlativo');

  ok((await api('POST', '/api/solicitudes', { ...nueva, telefono: '12' })).status === 400,
     'el servidor valida el teléfono aunque la pantalla no lo haga');
  ok((await api('POST', '/api/solicitudes', { ...nueva, tipo: 'Volar' })).status === 400,
     'y rechaza una acción que no existe');

  const id = creada.datos.id;
  ok((await api('PATCH', '/api/solicitudes/' + id, { vehiculo: 'Motorizado' })).status === 401,
     'gestionar el ticket sí exige sesión de logística');
  ok((await api('POST', '/api/solicitudes/' + id + '/avanzar', undefined, tokenSeg)).status === 409,
     'no deja pasar a tránsito sin transporte asignado (seguimiento sí puede intentarlo)');
  ok((await api('PATCH', '/api/solicitudes/' + id, { vehiculo: 'Bicicleta' }, tokenSeg)).status === 400,
     'rechaza un transporte que no existe');
  ok((await api('PATCH', '/api/solicitudes/' + id, { vehiculo: 'Motorizado' }, tokenSeg)).datos.vehiculo === 'Motorizado',
     'seguimiento asigna el transporte: es trabajo de despacho, no de administración');
  ok((await api('POST', '/api/solicitudes/' + id + '/avanzar', undefined, tokenSeg)).datos.estado === 'En tránsito',
     'con transporte, pasa a tránsito');
  ok((await api('POST', '/api/solicitudes/' + id + '/avanzar', undefined, tokenSeg)).status === 409,
     'no deja cerrar sin tarifa');
  ok((await api('PATCH', '/api/solicitudes/' + id, { costo: 25 }, tokenSeg)).datos.costo === 25, 'asigna la tarifa');
  const cerrada = await api('POST', '/api/solicitudes/' + id + '/avanzar', undefined, tokenSeg);
  ok(cerrada.datos.estado === 'Concluido' && cerrada.datos.tsConcluido, 'se cierra y queda la hora de cierre');
  ok((await api('PATCH', '/api/solicitudes/' + id, { costo: 99 }, tokenSeg)).status === 409,
     'un ticket concluido ya no se modifica');
  ok(Array.isArray(cerrada.datos.paradas) && cerrada.datos.paradas.length === 0,
     'un ticket de una sola ruta trae "paradas" vacío, no ausente');

  // ------------------------------------------------- paradas adicionales
  console.log('\n-- dos o más rutas en una programación --');
  const conParadas = await api('POST', '/api/solicitudes', {
    ...nueva,
    paradas: [
      { destino: 'CLIENTE DOS, AV. JAVIER PRADO 1200, SAN ISIDRO', contacto: 'Recepción', telefono: '999888777' },
      { destino: 'CLIENTE TRES, JR. LAMPA 500, CERCADO DE LIMA' }
    ]
  });
  ok(conParadas.status === 201, 'se registra un servicio con paradas adicionales');
  ok(conParadas.datos.destino === nueva.destino, 'el primer destino sigue siendo el campo de siempre');
  ok(conParadas.datos.paradas.length === 2, 'trae las dos paradas de más');
  ok(conParadas.datos.paradas[0].orden === 1 && conParadas.datos.paradas[1].orden === 2,
     'en el orden en que se cargaron');
  ok(conParadas.datos.paradas[0].contacto === 'Recepción' && conParadas.datos.paradas[0].telefono === '999888777',
     'con su contacto y teléfono cuando se dan');
  ok(conParadas.datos.paradas[1].contacto === '' && conParadas.datos.paradas[1].telefono === '',
     'y en blanco cuando no, sin exigirlos');

  ok((await api('GET', '/api/solicitudes/' + conParadas.datos.id)).status === 401,
     'consultar un ticket por id ya tampoco es público');
  const relecturaConParadas = await api('GET', '/api/solicitudes/' + conParadas.datos.id, undefined, tokenAdmin);
  ok(relecturaConParadas.datos.paradas.length === 2, 'con sesión, las paradas se releen igual desde GET /solicitudes/:id');

  const listado = await api('GET', '/api/solicitudes', undefined, tokenAdmin);
  const enListado = listado.datos.find(s => s.id === conParadas.datos.id);
  ok(enListado.paradas.length === 2, 'y también vienen en el listado completo, no solo al pedir uno por uno');

  ok((await api('POST', '/api/solicitudes', {
    ...nueva, paradas: [{ destino: 'AV' }]
  })).status === 400, 'una parada con dirección demasiado corta rechaza todo el registro');
  ok((await api('GET', '/api/solicitudes', undefined, tokenAdmin)).datos.length === listado.datos.length,
     'y no deja a medias ni el ticket ni las paradas: la transacción se revierte completa');

  // -------------------------------------------------------- cancelación
  console.log('\n-- cancelar un servicio --');
  const otraId = otra.datos.id;
  ok((await api('POST', '/api/solicitudes/' + otraId + '/cancelar')).datos.estado === 'Cancelado',
     'el propio solicitante cancela lo suyo, sin sesión y sin elegir motivo');
  const canceladaSolicitante = await api('GET', '/api/solicitudes/' + otraId, undefined, tokenAdmin);
  ok(canceladaSolicitante.datos.motivoCancelacion === 'Usuario solicitó baja'
     && canceladaSolicitante.datos.canceladoPor === 'Solicitante',
     'el servidor pone el motivo solo, y anota que fue el solicitante');
  ok((await api('POST', '/api/solicitudes/' + otraId + '/cancelar')).status === 409,
     'cancelarlo dos veces responde 409');
  ok((await api('PATCH', '/api/solicitudes/' + otraId, { costo: 10 }, tokenAdmin)).status === 409,
     'un ticket cancelado ya no se modifica');
  ok((await api('POST', '/api/solicitudes/' + otraId + '/avanzar', undefined, tokenAdmin)).status === 409,
     'ni avanza');

  const paraStaff = (await api('POST', '/api/solicitudes', nueva)).datos.id;
  ok((await api('POST', '/api/solicitudes/' + paraStaff + '/cancelar', {}, tokenSeg)).status === 400,
     'logística sí tiene que elegir un motivo');
  ok((await api('POST', '/api/solicitudes/' + paraStaff + '/cancelar', { motivo: 'Inventado' }, tokenSeg)).status === 400,
     'y no vale cualquier texto: son los tres fijos');
  ok((await api('POST', '/api/solicitudes/' + paraStaff + '/cancelar', { motivo: 'Otros' }, tokenSeg)).status === 400,
     '"Otros" exige el detalle');
  const cancStaff = await api('POST', '/api/solicitudes/' + paraStaff + '/cancelar',
    { motivo: 'Otros', detalle: 'Cliente cambió de dirección' }, tokenSeg);
  ok(cancStaff.status === 200 && cancStaff.datos.estado === 'Cancelado', 'con motivo y detalle, seguimiento sí puede cancelar');
  ok(cancStaff.datos.motivoCancelacionDetalle === 'Cliente cambió de dirección' && cancStaff.datos.canceladoPor === 'jperez',
     'y queda el detalle y quién lo hizo (su usuario), no un genérico "Solicitante"');

  // Logística puede cancelar uno que ya salió; el solicitante, no.
  const enRuta = (await api('POST', '/api/solicitudes', nueva)).datos.id;
  await api('PATCH', '/api/solicitudes/' + enRuta, { vehiculo: 'Motorizado' }, tokenAdmin);
  await api('POST', '/api/solicitudes/' + enRuta + '/avanzar', undefined, tokenAdmin);
  ok((await api('POST', '/api/solicitudes/' + enRuta + '/cancelar')).status === 409,
     'el solicitante ya no puede cancelar uno que salió: "pide a logística que lo cancele"');
  ok((await api('POST', '/api/solicitudes/' + enRuta + '/cancelar',
    { motivo: 'No autorizado' }, tokenAdmin)).datos.estado === 'Cancelado',
     'pero admin sí, incluso "En tránsito"');

  ok((await api('POST', '/api/solicitudes/REQ-999999/cancelar', { motivo: 'Otros', detalle: 'x' }, tokenAdmin)).status === 404,
     'cancelar un ticket que no existe responde 404');

  // ---------------------------------------------------- exportar a Excel
  // Es un binario, no JSON: no pasa por el helper `api()`, que decodifica la
  // respuesta como texto y corrompería el archivo.
  console.log('\n-- exportar viajes a Excel --');
  ok((await fetch(BASE + '/api/solicitudes/exportar')).status === 401,
     'exportar también exige sesión de logística');
  ok((await fetch(BASE + '/api/solicitudes/exportar?desde=feo',
    { headers: { Authorization: 'Bearer ' + tokenAdmin } })).status === 400,
     'rechaza una fecha "desde" con forma inválida');
  ok((await fetch(BASE + '/api/solicitudes/exportar?desde=2026-09-01&hasta=2026-01-01',
    { headers: { Authorization: 'Bearer ' + tokenAdmin } })).status === 400,
     'y un rango con "desde" posterior a "hasta"');

  const excel = await fetch(BASE + '/api/solicitudes/exportar', { headers: { Authorization: 'Bearer ' + tokenSeg } });
  ok(excel.status === 200, 'seguimiento también puede exportar (mismo permiso que ver el histórico)');
  ok(excel.headers.get('content-type').includes('spreadsheetml'), 'con el tipo MIME de un .xlsx');
  ok((excel.headers.get('content-disposition') || '').includes('viajes_plasticos_nacionales.xlsx'),
     'sin rango, el nombre del archivo no lleva fechas');
  const bytesExcel = Buffer.from(await excel.arrayBuffer());
  ok(bytesExcel.length > 1000 && bytesExcel.slice(0, 2).toString('latin1') === 'PK',
     'el archivo pesa lo suyo y arranca con la firma ZIP de un .xlsx de verdad');

  const acotado = await fetch(BASE + '/api/solicitudes/exportar?desde=2026-02-01&hasta=2026-02-28',
    { headers: { Authorization: 'Bearer ' + tokenAdmin } });
  ok((acotado.headers.get('content-disposition') || '').includes('2026-02-01_a_2026-02-28'),
     'con rango, el nombre del archivo lo dice');
  const ExcelJS = (await import('exceljs')).default;
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.load(await acotado.arrayBuffer());
  const hoja = libro.getWorksheet('Viajes');
  ok(hoja.getRow(1).getCell(1).value === 'Ticket' && hoja.getRow(1).getCell(19).value === 'Costo (S/)',
     'trae los encabezados de la plataforma, no nombres de columna de base de datos');
  ok(hoja.rowCount - 1 > 0 && hoja.rowCount - 1 < SEMBRADOS,
     `el rango de fechas filtra: menos filas (${hoja.rowCount - 1}) que el histórico completo`);
  const todasEnRango = [];
  for (let f = 2; f <= hoja.rowCount; f++) {
    const fp = hoja.getRow(f).getCell(16).value; // Fecha programada
    todasEnRango.push(fp >= new Date('2026-02-01') && fp <= new Date('2026-02-28T23:59:59'));
  }
  ok(todasEnRango.every(Boolean), 'y ninguna fila cae fuera del rango pedido');
  ok(hoja.getRow(2).getCell(3).type === 4, 'la fecha de registro es una fecha de Excel, no texto');
  const filaConCosto = Array.from({ length: hoja.rowCount - 1 }, (_, i) => hoja.getRow(i + 2))
    .find(r => r.getCell(19).value != null);
  ok(!filaConCosto || filaConCosto.getCell(19).type === 2, 'y el costo es un número de Excel, no texto');

  // ------------------------------------------------------- autorizaciones
  console.log('\n-- autorizaciones --');
  // Pedirla sigue siendo autoservicio del solicitante, sin sesión. Verla y
  // resolverla es "Padrón y accesos": cosa de admin, seguimiento no entra.
  const datosAut = { dni: '99999999', apellidos: 'PEREZ GOMEZ', nombres: 'JUAN CARLOS', celular: '987654321' };
  ok((await api('POST', '/api/autorizaciones', { dni: '99999998' })).status === 400,
     'sin apellidos, nombres ni celular, no se registra el pedido');
  ok((await api('POST', '/api/autorizaciones', { ...datosAut, celular: '123' })).status === 400,
     'un celular que no tiene forma de celular tampoco');
  ok((await api('POST', '/api/autorizaciones', { ...datosAut, email: 'no-es-un-email' })).status === 400,
     'un email con formato inválido, si se escribe, se rechaza');

  const pedido = await api('POST', '/api/autorizaciones', { ...datosAut, email: 'juan@example.com', area: 'Ventas' });
  ok(pedido.status === 201 && pedido.datos.repetido === false,
     'con apellidos, nombres y celular válidos, se registra el pedido de acceso sin sesión');
  ok((await api('POST', '/api/autorizaciones', datosAut)).datos.repetido === true,
     'pedirlo dos veces no duplica');
  ok((await api('GET', '/api/autorizaciones', undefined, tokenSeg)).status === 403,
     'seguimiento no puede ver la lista de pedidos pendientes: es "Padrón y accesos"');
  const listaAut = await api('GET', '/api/autorizaciones', undefined, tokenAdmin);
  ok(listaAut.status === 200, 'admin sí');
  const filaAut = listaAut.datos.find(a => a.dni === '99999999');
  ok(filaAut && filaAut.apellidos === 'PEREZ GOMEZ' && filaAut.nombres === 'JUAN CARLOS'
     && filaAut.celular === '987654321' && filaAut.email === 'juan@example.com' && filaAut.area === 'Ventas',
     'y ve quién es, no solo el DNI: apellidos, nombres, celular, email y área quedaron guardados');
  ok((await api('PATCH', '/api/autorizaciones/99999999', { estado: 'Rechazada' }, tokenSeg)).status === 403,
     'y resolverla —aprobar o rechazar— tampoco es suyo');
  ok((await api('PATCH', '/api/autorizaciones/99999999', { estado: 'Rechazada' }, tokenAdmin)).status === 200,
     'admin sí puede rechazarlo');
  ok((await api('PATCH', '/api/autorizaciones/99999999', { estado: 'Rechazada' }, tokenAdmin)).status === 404,
     'y ya no queda pendiente');

  // ------------------------------------------------- adjuntos con multer
  console.log('\n-- subida de archivos (multer) --');
  ok(/^\d{8}-\d{6}$/.test(marcaDeTiempo(new Date(2026, 8, 15, 14, 30, 12))),
     'la marca de tiempo tiene forma AAAAMMDD-HHMMSS');
  const n1 = nombreUnico('IMG_0001.jpg', 'image/jpeg');
  const n2 = nombreUnico('IMG_0001.jpg', 'image/jpeg');
  ok(n1 !== n2, 'dos archivos con el mismo nombre original reciben nombres distintos');
  ok(n1.endsWith('.jpg') && n1.includes('img-0001'), `conserva nombre y extensión: ${n1}`);
  ok(!nombreUnico('../../backend/servidor.js', 'application/pdf').includes('..'),
     'un nombre con ../ no puede escaparse de la carpeta');
  ok(nombreUnico('guía de entrega ñ.PDF', 'application/pdf').includes('guia-de-entrega'),
     'sanea tildes, eñes y espacios');

  const contenido = Buffer.from('%PDF-1.4 guía de prueba');
  const forma = new FormData();
  forma.append('ticketId', id);
  forma.append('subidoPor', 'Pruebas');
  forma.append('archivo', new Blob([contenido], { type: 'application/pdf' }), 'guía de entrega.pdf');

  ok((await api('POST', '/api/adjuntos', forma)).status === 401, 'subir un adjunto también exige sesión de logística');
  const subido = await api('POST', '/api/adjuntos', forma, tokenAdmin);
  ok(subido.status === 201, 'se sube una guía de entrega');
  ok(subido.datos.nombreOriginal === 'guía de entrega.pdf', 'se conserva el nombre original en la base');
  ok(/^\d{8}-\d{6}-[0-9a-f]{6}-guia-de-entrega\.pdf$/.test(subido.datos.archivo),
     `en disco quedó renombrado: ${subido.datos.archivo}`);
  ok(fs.existsSync(path.join(process.env.PLANSA_UPLOADS, subido.datos.archivo)),
     'el archivo está en la carpeta de subidas');

  const bajado = await fetch(BASE + '/api/adjuntos/' + subido.datos.id + '/archivo');
  const bytes = Buffer.from(await bajado.arrayBuffer());
  ok(bajado.status === 200 && bytes.equals(contenido), 'al descargarlo vuelve byte por byte igual, sin sesión: el solicitante también lo ve');
  ok(bajado.headers.get('content-type').includes('pdf'), 'y con su tipo declarado');

  const forma2 = new FormData();
  forma2.append('ticketId', id);
  forma2.append('archivo', new Blob([contenido], { type: 'application/pdf' }), 'guía de entrega.pdf');
  const subido2 = await api('POST', '/api/adjuntos', forma2, tokenSeg);
  ok(subido2.datos.archivo !== subido.datos.archivo, 'subir el mismo archivo otra vez no pisa al primero');
  ok(fs.readdirSync(process.env.PLANSA_UPLOADS).filter(f => f.endsWith('.pdf')).length === 2,
     'quedan los dos archivos en la carpeta');

  const rechazado = new FormData();
  rechazado.append('ticketId', id);
  rechazado.append('archivo', new Blob([Buffer.from('MZ')], { type: 'application/x-msdownload' }), 'virus.exe');
  ok((await api('POST', '/api/adjuntos', rechazado, tokenAdmin)).status === 415, 'un ejecutable se rechaza con 415');

  // Declarar "es una imagen" no alcanza: el contenido real tiene que empezar
  // como una imagen de verdad, o se rechaza igual aunque el tipo declarado
  // esté en la lista permitida.
  const disfrazado = new FormData();
  disfrazado.append('ticketId', id);
  disfrazado.append('archivo', new Blob([Buffer.from('<script>alert(1)</script>')], { type: 'image/jpeg' }), 'foto.jpg');
  const rtaDisfrazado = await api('POST', '/api/adjuntos', disfrazado, tokenAdmin);
  ok(rtaDisfrazado.status === 415, 'un archivo que dice ser imagen pero no lo es, también se rechaza');
  ok(fs.readdirSync(process.env.PLANSA_UPLOADS).filter(f => f.endsWith('.jpg')).length === 0,
     'y no queda guardado en el disco ni un instante');

  const sinTicket = new FormData();
  sinTicket.append('ticketId', 'REQ-999999');
  sinTicket.append('archivo', new Blob([contenido], { type: 'application/pdf' }), 'x.pdf');
  const huerfano = await api('POST', '/api/adjuntos', sinTicket, tokenAdmin);
  ok(huerfano.status === 404, 'no deja adjuntar a un ticket que no existe');
  ok((await api('GET', '/api/salud')).datos.adjuntosHuerfanos === 0,
     'y no deja el archivo suelto en disco cuando el registro falla');

  ok((await api('GET', '/api/adjuntos?ticket=' + id)).status === 401, 'listar adjuntos también pide sesión de logística');
  const delTicket = await api('GET', '/api/adjuntos?ticket=' + id, undefined, tokenAdmin);
  ok(delTicket.datos.length === 2, 'con sesión, se listan los adjuntos de un ticket');

  ok((await api('DELETE', '/api/adjuntos/' + subido.datos.id)).status === 401, 'borrar uno sí exige sesión');
  ok((await api('DELETE', '/api/adjuntos/' + subido.datos.id, {}, tokenAdmin)).status === 400,
     'y sin motivo, sesión de logística no basta: lo exige también el servidor');
  ok((await api('DELETE', '/api/adjuntos/' + subido.datos.id, { motivo: 'Guía duplicada' }, tokenAdmin)).status === 200,
     'con motivo, se puede borrar un adjunto');
  ok(!fs.existsSync(path.join(process.env.PLANSA_UPLOADS, subido.datos.archivo)),
     'y el archivo desaparece del disco, no solo de la base');
  ok((await api('DELETE', '/api/adjuntos/' + subido.datos.id, { motivo: 'Guía duplicada' }, tokenAdmin)).status === 404,
     'borrarlo dos veces responde 404');

  // ------------------------------------------------------------- payback
  console.log('\n-- payback por API --');
  ok((await api('GET', '/api/payback?inicio=2026-10-01')).status === 401, 'sin sesión no se puede consultar');
  ok((await api('GET', '/api/payback?inicio=2026-10-01', undefined, tokenSeg)).status === 403,
     'ni con sesión de seguimiento: es análisis de costos, cosa de admin');
  const pb = await api('GET', '/api/payback?inicio=2026-10-01', undefined, tokenAdmin);
  ok(pb.status === 200 && pb.datos.escenarios.length === 3, 'admin sí, y devuelve los tres escenarios');
  ok(pb.datos.gastoActual > 0 && pb.datos.recomendado, 'con el gasto actual y un recomendado');
  // El proveedor a cuota fija no es planilla: no tiene calendario de
  // beneficios, así que ese único escenario no trae costo de primer año.
  ok(pb.datos.escenarios.filter(e => e.id !== 'tercero').every(e => e.costoPrimerAnio > 0),
     'y el costo del primer año según la fecha de ingreso, para los escenarios de personal propio');
  ok(pb.datos.escenarios.find(e => e.id === 'tercero').costoPrimerAnio === null,
     'el de tercerizar no tiene ese dato: no aplica');
  ok(pb.datos.escenarios.find(e => e.id === 'tercero').capacidad === null,
     'ni capacidad: esa la asume el proveedor');

  // --------------------------------------------- exposición de data/
  // La carpeta data/ tiene el padrón y el histórico junto a los supuestos del
  // payback. Solo lo segundo puede salir del servidor.
  console.log('\n-- qué se publica de data/ --');
  const crudo = async ruta => {
    const res = await fetch(BASE + ruta);
    return { status: res.status, texto: await res.text() };
  };
  const padronWeb = await crudo('/data/padron.js');
  ok(padronWeb.status === 404, 'el padrón no se sirve al navegador');
  ok(!padronWeb.texto.includes('73012556'), 'y no se filtra ningún DNI en la respuesta');
  ok((await crudo('/data/historico.js')).status === 404, 'el histórico tampoco');
  ok((await crudo('/data/destinos.js')).status === 200, 'los destinos sí, que la pantalla los necesita');
  ok((await crudo('/data/payback/parametros.js')).status === 200, 'y los supuestos del payback');
  ok((await crudo('/backend/config.js')).status === 404, 'el código del servidor no se sirve');
  ok((await crudo('/shared/documento.js')).status === 200,
     'las reglas del documento viven en shared/, sin el padrón al lado');

  // --------------------------------------------------- red y cabeceras
  console.log('\n-- respuesta en red --');
  const comprimida = await fetch(BASE + '/api/estado', { headers: { 'Accept-Encoding': 'gzip' } });
  ok(comprimida.headers.get('content-encoding') === 'gzip', 'el estado viaja comprimido');
  ok((comprimida.headers.get('vary') || '').includes('Accept-Encoding'),
     'y avisa que la respuesta varía según la compresión');
  const cab = await fetch(BASE + '/index.html');
  ok(cab.headers.get('x-content-type-options') === 'nosniff', 'va la cabecera nosniff');
  ok(cab.headers.get('x-frame-options') === 'DENY', 'y la que impide meterlo en un iframe');
  ok((cab.headers.get('content-security-policy') || '').includes("default-src 'self'"),
     'y una CSP que ata los recursos a este servidor');
  ok(!cab.headers.get('x-powered-by'), 'no se anuncia el motor');

  // ----------------------------------------------------------- revisión
  console.log('\n-- sincronización --');
  const r1 = (await api('GET', '/api/revision')).datos.revision;
  ok(typeof r1 === 'string' && r1.length > 0, 'hay un testigo de revisión');
  ok((await api('GET', '/api/revision')).datos.revision === r1, 'sin cambios, el testigo no se mueve');
  await api('POST', '/api/solicitudes', nueva);
  ok((await api('GET', '/api/revision')).datos.revision !== r1, 'al escribir algo, el testigo cambia');

  // --------------------------------------------------------- clave propia
  console.log('\n-- cambio de clave propia --');
  ok((await api('PUT', '/api/auth/clave', { actual: 'noesla', nueva: 'claveNueva1' }, tokenAdmin)).status === 401,
     'sin la clave actual no se puede cambiar');
  ok((await api('PUT', '/api/auth/clave', { actual: 'admin', nueva: 'corta' }, tokenAdmin)).status === 400,
     'una clave de menos de 6 caracteres se rechaza');
  ok((await api('PUT', '/api/auth/clave', { actual: 'admin', nueva: 'admin' }, tokenAdmin)).status === 400,
     'y una igual a la actual también');
  ok((await api('GET', '/api/auth/yo', undefined, tokenAdmin)).status === 200, 'el token de antes del cambio, por ahora, funciona');
  const cambioClave = await api('PUT', '/api/auth/clave', { actual: 'admin', nueva: 'claveNueva1' }, tokenAdmin);
  ok(cambioClave.status === 200 && cambioClave.datos.token, 'con la clave actual sí se cambia, y devuelve un token nuevo');
  ok((await api('POST', '/api/auth/ingresar', { usuario: 'admin', clave: 'claveNueva1' })).datos.debeCambiarClave === false,
     'la nueva clave funciona y ya no pide cambiarla');
  ok((await api('POST', '/api/auth/ingresar', { usuario: 'admin', clave: 'admin' })).status === 401,
     'y la vieja deja de funcionar');
  ok((await api('GET', '/api/auth/yo', undefined, tokenAdmin)).status === 401,
     'cambiar la clave cierra la sesión que estaba abierta antes -por si el token viejo estaba comprometido-');
  ok((await api('GET', '/api/auth/yo', undefined, cambioClave.datos.token)).status === 200,
     'pero el token nuevo que devolvió la respuesta sí sirve, para no dejar afuera a quien la cambió');
  tokenAdmin = cambioClave.datos.token;

  // --------------------------------------------------- freno de intentos
  // Pocas cuentas y un usuario adivinable ('admin'): sin freno se prueba el
  // diccionario entero contra la clave.
  console.log('\n-- freno de fuerza bruta --');
  const CLAVE_VIGENTE = 'claveNueva1';
  olvidarIntentos();
  let bloqueada = null;
  for (let i = 0; i < 14 && bloqueada === null; i++) {
    const r = await api('POST', '/api/auth/ingresar', { usuario: 'admin', clave: 'probando' + i });
    if (r.status === 429) bloqueada = i;
  }
  ok(bloqueada !== null, `tras varios intentos fallidos responde 429 (al intento ${bloqueada})`);
  ok(bloqueada === 10, 'y aguanta exactamente los 10 configurados antes de frenar');
  const frenada = await api('POST', '/api/auth/ingresar', { usuario: 'admin', clave: CLAVE_VIGENTE });
  ok(frenada.status === 429, 'mientras dura el freno ni la clave correcta pasa');
  olvidarIntentos();
  ok((await api('POST', '/api/auth/ingresar', { usuario: 'admin', clave: CLAVE_VIGENTE })).status === 200,
     'pasado el castigo, la clave correcta vuelve a entrar');
  olvidarIntentos();

  // ---------------------------------------------------------- inundación
  console.log('\n-- freno de inundación (rutas públicas de escritura) --');
  olvidarPeticiones();
  let inundada = null;
  for (let i = 0; i < 13 && inundada === null; i++) {
    const r = await api('POST', '/api/autorizaciones', { dni: '9' + String(i).padStart(7, '0') });
    if (r.status === 429) inundada = i;
  }
  ok(inundada === 10, `POST /autorizaciones también se frena por volumen, no solo por fallos (al intento ${inundada})`);
  olvidarPeticiones();

  // ------------------------------------------------------------- csrf
  // Un <form> ajeno, sin JavaScript, puede mandar un POST con Content-Type
  // application/x-www-form-urlencoded o multipart -eso el navegador lo deja
  // igual entre sitios-. La defensa es doble: express.urlencoded() ya no está
  // montado (no hay quién interprete ese cuerpo) y, aparte, se rechaza
  // cualquier escritura cuyo Origin no sea el propio servidor.
  console.log('\n-- csrf: origen ajeno --');
  const ajeno = await fetch(BASE + '/api/solicitudes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://sitio-ajeno.evil' },
    body: JSON.stringify(nueva)
  });
  ok(ajeno.status === 403, 'un POST con Origin de otro sitio se rechaza, sin llegar a crear nada');
  const propio = await fetch(BASE + '/api/solicitudes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: BASE },
    body: JSON.stringify(nueva)
  });
  ok(propio.status === 201, 'con el Origin del propio servidor, sí se acepta');
  const formAjeno = new URLSearchParams({ tipo: 'Entregar', servicio: 'x', destino: 'y'.repeat(10) });
  const formResp = await fetch(BASE + '/api/solicitudes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: 'https://sitio-ajeno.evil' },
    body: formAjeno.toString()
  });
  ok(formResp.status === 403, 'y un <form> clásico (urlencoded) desde otro origen, igual');

  // Defensa independiente: aunque alguien lograra un Origin propio (por
  // ejemplo, un XSS en la propia página), un cuerpo urlencoded ya no se
  // interpreta -no hay express.urlencoded() montado-, así que llega vacío y
  // la validación normal del campo lo rechaza igual que a cualquier body malo.
  const formPropio = await fetch(BASE + '/api/solicitudes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: BASE },
    body: formAjeno.toString()
  });
  ok(formPropio.status === 400, 'y aunque el origen sea el propio, un cuerpo urlencoded ya no se interpreta');

  // ------------------------------------------------------------- salud
  console.log('\n-- salud: sin rutas de archivos en lo público --');
  const saludPublica = await api('GET', '/api/salud');
  ok(!('baseDatos' in saludPublica.datos) && !('subidas' in saludPublica.datos),
     '/salud pública no dice dónde vive la base ni las subidas en el disco');
  ok((await api('GET', '/api/salud/detalle')).status === 401, 'el detalle con las rutas pide sesión');
  ok((await api('GET', '/api/salud/detalle', undefined, tokenSeg)).status === 403,
     'y de admin puntualmente, no de cualquier logística');
  const detalle = await api('GET', '/api/salud/detalle', undefined, tokenAdmin);
  ok(detalle.status === 200 && detalle.datos.baseDatos, 'admin sí ve dónde está la base, para diagnosticar');

  // ------------------------------------------------------ auditoría
  console.log('\n-- log de seguridad --');
  ok((await api('GET', '/api/seguridad/eventos')).status === 401, 'el log de auditoría no es público');
  ok((await api('GET', '/api/seguridad/eventos', undefined, tokenSeg)).status === 403,
     'ni para cualquier cuenta de logística: solo admin');
  const eventos = await api('GET', '/api/seguridad/eventos?limite=500', undefined, tokenAdmin);
  ok(eventos.status === 200 && Array.isArray(eventos.datos), 'admin sí puede leerlo');
  const tipos = eventos.datos.map(e => e.tipo);
  for (const t of ['login_exitoso', 'login_fallido', 'usuario_creado', 'cambio_clave']) {
    ok(tipos.includes(t), 'quedó registrado al menos un evento "' + t + '"');
  }
  ok(!JSON.stringify(eventos.datos).match(/claveNueva1|admin123|scrypt\$|[0-9a-f]{32,}:[0-9a-f]{32,}/),
     'y en ninguna fila aparece una clave ni un hash: el detalle es solo contexto legible');

  // -------------------------------------------------- carga: uso simultáneo
  // No alcanza con revisar el código y confiar en que WAL + índices bastan:
  // acá se dispara de verdad el tráfico de una planta llena registrando a la
  // vez -30 solicitantes distintos, cada uno en su propia IP de LAN/Tailscale,
  // más logística subiendo guías- y se comprueba que nada se pierde, nada
  // choca y nada se queda esperando más de lo razonable.
  console.log('\n-- carga: registros y subidas simultáneas --');
  olvidarPeticiones();
  olvidarIntentos();

  const antesDeCarga = (await api('GET', '/api/salud')).datos.solicitudes;
  const USUARIOS = 30;
  const inicioCarga = Date.now();

  const registros = await Promise.all(
    Array.from({ length: USUARIOS }, (_, i) => api('POST', '/api/solicitudes', {
      ...nueva, dni: String(70000000 + i), telefono: '9' + String(10000000 + i)
    }, undefined, { 'X-Forwarded-For': '10.20.30.' + (i + 1) }))
  );
  const duracionCarga = Date.now() - inicioCarga;

  ok(registros.every(r => r.status === 201), `los ${USUARIOS} registros simultáneos se aceptan (ninguno se cae ni se frena entre sí)`);
  const idsUnicos = new Set(registros.map(r => r.datos.id));
  ok(idsUnicos.size === USUARIOS, 'cada uno recibe un correlativo distinto, sin choques por la escritura concurrente');
  ok(duracionCarga < 8000, `y responde en un tiempo razonable (${duracionCarga} ms para ${USUARIOS} registros a la vez)`);

  const despuesDeCarga = (await api('GET', '/api/salud')).datos.solicitudes;
  ok(despuesDeCarga === antesDeCarga + USUARIOS, 'los 30 quedaron guardados en la base, ni uno de más ni de menos');

  // Logística subiendo guías de entrega al mismo tiempo que entran solicitudes
  // nuevas: dos flujos que no deberían pisarse porque escriben en tablas y
  // con locks distintos.
  const SUBIDAS = 10;
  const ticketsParaSubir = registros.slice(0, SUBIDAS).map(r => r.datos.id);
  const inicioSubidas = Date.now();
  const subidas = await Promise.all(
    ticketsParaSubir.map((ticketId, i) => {
      const forma = new FormData();
      forma.append('ticketId', ticketId);
      forma.append('subidoPor', 'Carga ' + i);
      forma.append('archivo', new Blob([Buffer.from('%PDF-1.4 carga ' + i)], { type: 'application/pdf' }), 'guia-' + i + '.pdf');
      return api('POST', '/api/adjuntos', forma, i % 2 === 0 ? tokenAdmin : tokenSeg, { 'X-Forwarded-For': '10.20.31.' + (i + 1) });
    })
  );
  const duracionSubidas = Date.now() - inicioSubidas;

  ok(subidas.every(s => s.status === 201), `las ${SUBIDAS} subidas de guías simultáneas también se aceptan todas`);
  const archivosUnicos = new Set(subidas.map(s => s.datos.archivo));
  ok(archivosUnicos.size === SUBIDAS, 'cada archivo queda con nombre único en disco, sin pisarse entre sí');
  ok(duracionSubidas < 8000, `y también en tiempo razonable (${duracionSubidas} ms para ${SUBIDAS} subidas a la vez)`);
  ok((await api('GET', '/api/salud')).datos.adjuntosHuerfanos === 0, 'ninguna quedó huérfana por una escritura a medias');

  olvidarPeticiones();
  olvidarIntentos();

  // ---------------------------------------------------- ingreso por área
  // El solicitante ya no entra solo con el DNI: el DNI detecta el área (como
  // siempre) y hace falta además la credencial de esa área, una compartida
  // por todos los que trabajan ahí, que reparte admin. La siembra ya crea una
  // por cada área del padrón (ver backend/db/sembrar.js), así que se prueba
  // contra "Logistica" -el área real de 73012556- restableciéndole la clave
  // para obtener una que sí se conoce en texto plano.
  console.log('\n-- ingreso por área (solicitante) --');
  olvidarIntentos();

  ok((await api('POST', '/api/credenciales-area', { area: 'Logistica', usuario: 'otra' }, tokenAdmin)).status === 409,
     'la siembra ya creó una credencial para "Logistica": no se puede repetir');
  ok((await api('POST', '/api/credenciales-area', { area: 'Área que no existe', usuario: 'xxx' }, tokenAdmin)).status === 400,
     'ni crear una para un área que no figura en el padrón');
  ok((await api('POST', '/api/credenciales-area', { area: 'Ventas', usuario: 'nn' }, tokenSeg)).status === 403,
     'administrar credenciales de área es cosa de admin, no de cualquier cuenta de logística');

  const listaCred = await api('GET', '/api/credenciales-area', undefined, tokenAdmin);
  const credLogistica = listaCred.datos.find(c => c.area === 'Logistica');
  ok(listaCred.status === 200 && credLogistica && credLogistica.usuario === 'logistica',
     'admin ve las credenciales sembradas, una por área, con el usuario en minúsculas');
  ok(!('claveHash' in credLogistica), 'y nunca viaja el hash de la clave');

  const restablecidaArea = await api('POST', '/api/credenciales-area/Logistica/restablecer', undefined, tokenAdmin);
  ok(restablecidaArea.status === 200 && restablecidaArea.datos.claveTemporal,
     'admin le genera una clave temporal nueva a un área ya existente');
  const CLAVE_AREA = restablecidaArea.datos.claveTemporal;

  ok((await api('POST', '/api/auth/area', { dni: '99999999', usuario: 'logistica', clave: CLAVE_AREA })).status === 404,
     'un DNI que no está en el padrón no entra, aunque la credencial sea correcta');
  ok((await api('POST', '/api/auth/area', { dni: '73012556', usuario: 'logistica', clave: 'noesla' })).status === 401,
     'con la clave equivocada, tampoco');
  ok((await api('POST', '/api/auth/area', { dni: '73012556', usuario: 'otra-cosa', clave: CLAVE_AREA })).status === 401,
     'ni con el usuario equivocado, aunque la clave sea la correcta');

  const loginArea = await api('POST', '/api/auth/area', { dni: '73012556', usuario: 'logistica', clave: CLAVE_AREA });
  ok(loginArea.status === 200 && loginArea.datos.token, 'con DNI + credencial de área correctos, entra');
  ok(loginArea.datos.dni === '73012556' && loginArea.datos.area === 'Logistica',
     'y devuelve los datos de la persona, con el área que detectó el DNI');
  ok(loginArea.datos.debeCambiarClave === true, 'con la clave recién restablecida, avisa que hay que cambiarla');
  let tokenArea = loginArea.datos.token;

  ok((await api('GET', '/api/personal', undefined, tokenArea)).status === 401,
     'el token de área no sirve para ninguna ruta de logística: requiereSesion exige tipo "logistica"');
  ok((await api('GET', '/api/solicitudes/mias', undefined, tokenAdmin)).status === 401,
     'y al revés: un token de logística no sirve para "mis servicios" del área');
  ok((await api('GET', '/api/estado', undefined, tokenArea)).datos.solicitudes.length === 0,
     '/api/estado con un token de área se comporta como sin sesión: no es logística');

  // ---------------------------------------- cambio de la clave compartida
  ok((await api('PUT', '/api/auth/area/clave', { actual: 'noesla', nueva: 'otraClave1' }, tokenArea)).status === 401,
     'sin la clave actual correcta, no se puede cambiar');
  ok((await api('PUT', '/api/auth/area/clave', { actual: CLAVE_AREA, nueva: '123' }, tokenArea)).status === 400,
     'una clave nueva de menos de 6 caracteres se rechaza');

  // Un colega de la misma área, ya adentro con la clave vieja, para comprobar
  // que cambiarla también lo saca a él: es compartida, no personal.
  const tokenAreaColega = (await api('POST', '/api/auth/area', { dni: '73012556', usuario: 'logistica', clave: CLAVE_AREA })).datos.token;

  const cambioClaveArea = await api('PUT', '/api/auth/area/clave', { actual: CLAVE_AREA, nueva: 'claveDeArea1' }, tokenArea);
  ok(cambioClaveArea.status === 200 && cambioClaveArea.datos.token,
     'con la clave actual correcta, sí se cambia y devuelve un token nuevo');
  ok((await api('GET', '/api/solicitudes/mias', undefined, tokenArea)).status === 401,
     'el token con el que se pidió el cambio, por sí solo, ya no sirve');
  ok((await api('GET', '/api/solicitudes/mias', undefined, tokenAreaColega)).status === 401,
     'y tampoco el de un colega que había entrado con la clave vieja: al ser compartida, se revoca para todos');
  tokenArea = cambioClaveArea.datos.token;
  ok((await api('GET', '/api/solicitudes/mias', undefined, tokenArea)).status === 200,
     'pero el token nuevo que devolvió la respuesta sí sirve, para no dejar afuera a quien la cambió');
  ok((await api('POST', '/api/auth/area', { dni: '73012556', usuario: 'logistica', clave: CLAVE_AREA })).status === 401,
     'y la clave vieja ya no entra');

  // ------------------------------------------------- mis servicios del área
  console.log('\n-- mis servicios del área (últimos 5) --');
  ok((await api('GET', '/api/solicitudes/mias')).status === 401, 'sin sesión de área, no hay "mis servicios"');

  const nuevaLogistica = {
    dni: '73012556', nombre: 'EDDY PERCY AVALOS VALDIVIA', cargo: 'COORDINADOR DE LOGISTICA', area: 'Logistica',
    tipo: 'Entregar', servicio: 'Prueba de área', motivo: 'Verificar el alcance de mis servicios',
    origen: 'Plásticos Nacionales - Talleres', destino: 'Prueba de área, Lima',
    contacto: 'Mesa de partes', telefono: '987654321', fechaProg: '2026-09-25', horaProg: '10:00'
  };
  const nuevaOtraArea = { ...nuevaLogistica, area: 'Producción', destino: 'Otra área, no debe verse' };

  const ticketLogistica = (await api('POST', '/api/solicitudes', nuevaLogistica)).datos.id;
  const ticketOtraArea = (await api('POST', '/api/solicitudes', nuevaOtraArea)).datos.id;

  const mias = await api('GET', '/api/solicitudes/mias', undefined, tokenArea);
  ok(mias.status === 200 && Array.isArray(mias.datos.solicitudes), 'con sesión de área, "mis servicios" responde');
  ok(mias.datos.solicitudes.length <= 5, 'nunca trae más de 5');
  ok(mias.datos.solicitudes.every(s => s.area === 'Logistica'), 'y todos son del área de la sesión, ninguno de otra');
  ok(mias.datos.solicitudes.some(s => s.id === ticketLogistica), 'el que se acaba de registrar para esta área aparece');
  ok(!mias.datos.solicitudes.some(s => s.id === ticketOtraArea),
     'el de otra área nunca aparece, aunque sea más reciente que alguno de los 5');
  ok(Array.isArray(mias.datos.adjuntos), 'junto con los adjuntos de esos tickets');

  // El propio solicitante -sin sesión de logística, solo con la de área- lo
  // sigue viendo actualizarse por la misma vía, incluida una cancelación:
  // "mis servicios" no es una copia estática de cuando entró.
  await api('POST', '/api/solicitudes/' + ticketLogistica + '/cancelar');
  const miasTrasCancelar = await api('GET', '/api/solicitudes/mias', undefined, tokenArea);
  const propioCancelado = miasTrasCancelar.datos.solicitudes.find(s => s.id === ticketLogistica);
  ok(propioCancelado && propioCancelado.estado === 'Cancelado',
     'y una cancelación del propio solicitante se refleja igual en "mis servicios" del área');

  // ---------------------------------------------------- pedidos de histórico
  console.log('\n-- pedidos de histórico completo --');
  ok((await api('POST', '/api/pedidos-historico')).status === 401, 'pedir más historial también exige sesión de área');
  const pedido1 = await api('POST', '/api/pedidos-historico', undefined, tokenArea);
  ok(pedido1.status === 201 && pedido1.datos.area === 'Logistica' && pedido1.datos.repetido === false,
     'el área pide ver su histórico completo');
  const pedido2 = await api('POST', '/api/pedidos-historico', undefined, tokenArea);
  ok(pedido2.datos.repetido === true, 'pedirlo de nuevo mientras sigue pendiente no duplica');

  ok((await api('GET', '/api/pedidos-historico')).status === 401, 'verlos es cosa de logística, no autoservicio');
  ok((await api('GET', '/api/pedidos-historico', undefined, tokenSeg)).status === 403,
     'y puntualmente de admin, no de cualquier cuenta de logística');
  const pedidosList = await api('GET', '/api/pedidos-historico', undefined, tokenAdmin);
  ok(pedidosList.status === 200 && pedidosList.datos.some(p => p.area === 'Logistica' && p.estado === 'Pendiente'),
     'admin sí ve el pedido pendiente');
  const idPedido = pedidosList.datos.find(p => p.area === 'Logistica' && p.estado === 'Pendiente').id;

  ok((await api('PATCH', '/api/pedidos-historico/' + idPedido, { estado: 'volando' }, tokenAdmin)).status === 400,
     'solo se admite Atendida o Rechazada');
  ok((await api('PATCH', '/api/pedidos-historico/' + idPedido, { estado: 'Atendida' }, tokenSeg)).status === 403,
     'resolverlo también es solo de admin');
  const resuelto = await api('PATCH', '/api/pedidos-historico/' + idPedido, { estado: 'Atendida' }, tokenAdmin);
  ok(resuelto.status === 200 && resuelto.datos.estado === 'Atendida', 'admin lo marca como atendido');
  ok((await api('PATCH', '/api/pedidos-historico/' + idPedido, { estado: 'Atendida' }, tokenAdmin)).status === 404,
     'resolverlo dos veces responde 404: ya no está pendiente');

  // -------------------------------------------------------------- salida
  ok((await api('POST', '/api/auth/area/salir', undefined, tokenAdmin)).status === 401,
     'el token de logística tampoco sirve para cerrar una sesión de área');
  ok((await api('POST', '/api/auth/area/salir', undefined, tokenArea)).status === 200, 'cierra la sesión de área');
  ok((await api('GET', '/api/solicitudes/mias', undefined, tokenArea)).status === 401,
     'y el token ya no sirve después de salir');

  olvidarIntentos();

  // ------------------------------------------------------- compras y logística
  console.log('\n-- exportaciones (muestras al exterior) --');
  const nuevaExport = {
    fechaEnvio: '2026-09-20', oc: 'OC-2026-045', costoEnvio: 350.5,
    descripcion: 'Muestras de resina PP homopolímero', paisDestino: 'China',
    motivo: 'Evaluación de calidad', transportista: 'DHL', tracking: 'DHL123456'
  };
  ok((await api('POST', '/api/exportaciones', nuevaExport)).status === 401, 'sin sesión, no se registra');
  ok((await api('POST', '/api/exportaciones', nuevaExport, tokenSeg)).status === 403,
     'seguimiento no administra exportaciones: es cosa de admin');
  ok((await api('POST', '/api/exportaciones', { ...nuevaExport, descripcion: '' }, tokenAdmin)).status === 400,
     'sin descripción, no se registra');

  const expCreada = await api('POST', '/api/exportaciones', nuevaExport, tokenAdmin);
  ok(expCreada.status === 201 && expCreada.datos.paisDestino === 'China' && expCreada.datos.estado === 'En tránsito',
     'admin registra una exportación, en tránsito por defecto');
  ok((await api('GET', '/api/exportaciones', undefined, tokenSeg)).status === 403, 'ni verlas es cosa de seguimiento');
  const listaExp = await api('GET', '/api/exportaciones', undefined, tokenAdmin);
  ok(listaExp.status === 200 && listaExp.datos.some(e => e.id === expCreada.datos.id), 'admin sí las lista');

  const expActualizada = await api('PATCH', '/api/exportaciones/' + expCreada.datos.id,
    { ...nuevaExport, estado: 'Entregado', fechaLlegadaProveedor: '2026-10-05' }, tokenAdmin);
  ok(expActualizada.datos.estado === 'Entregado' && expActualizada.datos.fechaLlegadaProveedor === '2026-10-05',
     'admin actualiza el estado y la fecha de llegada al proveedor');
  ok((await api('DELETE', '/api/exportaciones/' + expCreada.datos.id, undefined, tokenSeg)).status === 403,
     'borrarla tampoco es de seguimiento');
  ok((await api('DELETE', '/api/exportaciones/' + expCreada.datos.id, { motivo: 'no' }, tokenAdmin)).status === 400,
     'y sin un motivo de al menos 3 caracteres, tampoco se borra');
  ok((await api('DELETE', '/api/exportaciones/' + expCreada.datos.id, { motivo: 'Envío cancelado por el cliente' }, tokenAdmin)).status === 200,
     'con motivo, admin sí puede borrarla');
  ok((await api('PATCH', '/api/exportaciones/' + expCreada.datos.id, { estado: 'Perdido' }, tokenAdmin)).status === 404,
     'y ya no existe para actualizar');

  console.log('\n-- requerimientos de compra --');
  const nuevoReq = {
    fechaSolicitud: '2026-09-20', areaSolicitante: 'Producción',
    descripcion: 'Resina PE para soplado, contenedor 20 pies', categoria: 'Materia prima importada',
    cantidad: 20000, unidadMedida: 'kg', prioridad: 'Alta', fechaRequerida: '2026-10-15'
  };
  ok((await api('POST', '/api/requerimientos-compra', nuevoReq)).status === 401, 'sin sesión, no se registra');
  ok((await api('POST', '/api/requerimientos-compra', nuevoReq, tokenSeg)).status === 403,
     'seguimiento no administra requerimientos de compra');
  const reqCreado = await api('POST', '/api/requerimientos-compra', nuevoReq, tokenAdmin);
  ok(reqCreado.status === 201 && reqCreado.datos.categoria === 'Materia prima importada'
     && reqCreado.datos.estado === 'Pendiente' && reqCreado.datos.correlativo > 0,
     'admin registra un requerimiento, pendiente por defecto y con correlativo propio');
  const otroReq = await api('POST', '/api/requerimientos-compra', nuevoReq, tokenAdmin);
  ok(otroReq.datos.correlativo === reqCreado.datos.correlativo + 1, 'el correlativo sigue, no se repite');
  ok((await api('POST', '/api/requerimientos-compra', { ...nuevoReq, categoria: 'Inventada' }, tokenAdmin)).status === 201,
     'una categoría que no existe no rompe el alta: cae a "Otros"');

  const reqActualizado = await api('PATCH', '/api/requerimientos-compra/' + reqCreado.datos.id,
    { ...nuevoReq, estado: 'OC emitida', numeroOc: 'OC-2026-050', costoEstimado: 45000, moneda: 'USD' }, tokenAdmin);
  ok(reqActualizado.datos.estado === 'OC emitida' && reqActualizado.datos.numeroOc === 'OC-2026-050'
     && reqActualizado.datos.moneda === 'USD', 'admin avanza el estado y liga el número de OC');
  ok((await api('DELETE', '/api/requerimientos-compra/' + reqCreado.datos.id, undefined, tokenAdmin)).status === 400,
     'y sin motivo, tampoco se borra');
  ok((await api('DELETE', '/api/requerimientos-compra/' + reqCreado.datos.id, { motivo: 'Ya no se necesita' }, tokenAdmin)).status === 200,
     'con motivo, admin puede borrarlo');

  console.log('\n-- servicios de logística --');
  const nuevoServ = {
    fechaSolicitud: '2026-09-20', tipoServicio: 'Agenciamiento de aduana', proveedor: 'Agencia XYZ',
    descripcion: 'Desaduanaje de contenedor de resina PP', costo: 1200, moneda: 'USD'
  };
  ok((await api('POST', '/api/servicios-logistica', nuevoServ)).status === 401, 'sin sesión, no se registra');
  ok((await api('POST', '/api/servicios-logistica', nuevoServ, tokenSeg)).status === 403,
     'seguimiento no administra servicios de logística');
  const servCreado = await api('POST', '/api/servicios-logistica', nuevoServ, tokenAdmin);
  ok(servCreado.status === 201 && servCreado.datos.tipoServicio === 'Agenciamiento de aduana'
     && servCreado.datos.estado === 'Cotizando', 'admin registra un servicio, cotizando por defecto');
  const servActualizado = await api('PATCH', '/api/servicios-logistica/' + servCreado.datos.id,
    { ...nuevoServ, estado: 'Concluido', fechaInicio: '2026-09-21', fechaTermino: '2026-09-25' }, tokenAdmin);
  ok(servActualizado.datos.estado === 'Concluido' && servActualizado.datos.fechaTermino === '2026-09-25',
     'admin cierra el servicio con sus fechas');
  ok((await api('GET', '/api/servicios-logistica', undefined, tokenAdmin)).datos.some(s => s.id === servCreado.datos.id),
     'y aparece en el listado');
  ok((await api('DELETE', '/api/servicios-logistica/' + servCreado.datos.id, undefined, tokenAdmin)).status === 400,
     'y sin motivo, tampoco se borra');
  ok((await api('DELETE', '/api/servicios-logistica/' + servCreado.datos.id, { motivo: 'Servicio duplicado' }, tokenAdmin)).status === 200,
     'con motivo, admin puede borrarlo');

  console.log('\n-- módulo de Almacén (ticket + cookie propia) --');
  ok((await api('POST', '/api/almacen/ticket')).status === 401, 'sin sesión, no se emite ticket');
  ok((await api('POST', '/api/almacen/ticket', undefined, tokenSeg)).status === 403,
     'seguimiento no tiene acceso al módulo de Almacén, solo admin');

  const sinNada = await fetch(BASE + '/almacen/', { redirect: 'manual' });
  ok(sinNada.status === 401, 'sin ticket ni cookie, /almacen/ rechaza');

  const emision = await api('POST', '/api/almacen/ticket', undefined, tokenAdmin);
  ok(emision.status === 200 && typeof emision.datos.ticket === 'string' && emision.datos.ticket.length > 10,
     'con sesión admin, se emite un ticket de un solo uso');
  const ticket = emision.datos.ticket;

  const canje = await fetch(BASE + '/almacen/?ticket=' + ticket, { redirect: 'manual' });
  ok(canje.status === 302 && canje.headers.get('location') === '/almacen/',
     'canjear el ticket redirige limpio, sin el ticket colgando en la URL');
  const setCookie = canje.headers.get('set-cookie') || '';
  ok(/almacen_sesion=[0-9a-f]+/.test(setCookie) && /HttpOnly/.test(setCookie) && /SameSite=Strict/.test(setCookie),
     'y pone una cookie propia, httpOnly y de solo este sitio');
  const cookie = setCookie.match(/almacen_sesion=[0-9a-f]+/)[0];

  const conCookie = await fetch(BASE + '/almacen/', { headers: { Cookie: cookie } });
  ok(conCookie.status === 200 && (await conCookie.text()).includes('<html'),
     'con la cookie, el shell del módulo carga');
  ok((await fetch(BASE + '/almacen/api/almacenes', { headers: { Cookie: cookie } })).status === 200,
     'y su propia API namespaced bajo /almacen/api responde');

  const reuso = await fetch(BASE + '/almacen/?ticket=' + ticket, { redirect: 'manual' });
  ok(reuso.status === 401, 'el mismo ticket no sirve dos veces');

  ok((await fetch(BASE + '/almacen/', { redirect: 'manual' })).status === 401,
     'y sin la cookie, sigue sin poder entrar');

  // Regresión: una cookie vieja e inválida en Path=/almacen (de antes de que
  // el Path pasara a /) no debe tapar a una nueva y válida en Path=/. El
  // navegador manda ambas con el mismo nombre en una sola cabecera Cookie,
  // la de Path=/almacen primero por ser más específica.
  const emision2 = await api('POST', '/api/almacen/ticket', undefined, tokenAdmin);
  const canje2 = await fetch(BASE + '/almacen/?ticket=' + emision2.datos.ticket, { redirect: 'manual' });
  const cookieNueva = (canje2.headers.get('set-cookie') || '').match(/almacen_sesion=[0-9a-f]+/)[0];
  const cookieMezclada = 'almacen_sesion=00000000000000000000000000000000; ' + cookieNueva;
  const conMezcla = await fetch(BASE + '/almacen/', { headers: { Cookie: cookieMezclada } });
  ok(conMezcla.status === 200,
     'una cookie vieja e inválida junto a la nueva y válida no bloquea la entrada');

  const shellHeaders = await fetch(BASE + '/almacen/', { headers: { Cookie: cookie } });
  ok(shellHeaders.headers.get('x-frame-options') === 'SAMEORIGIN'
     && /frame-ancestors 'self'/.test(shellHeaders.headers.get('content-security-policy') || ''),
     'el shell se puede enmarcar en un <iframe> del propio panel (mismo origen), no de cualquier sitio');
  // Las teselas ya NO salen a un host externo: pasan por el proxy con caché
  // del propio servidor (/almacen/api/tiles/...), así que la CSP no necesita
  // abrirse a tile.openstreetmap.org ni server.arcgisonline.com.
  ok(!/tile\.openstreetmap\.org|arcgisonline\.com/.test(shellHeaders.headers.get('content-security-policy') || ''),
     'la CSP no necesita abrirse a hosts externos: las teselas pasan por el proxy propio');

  const MAPA = '/modules/mapa-almacenes/index.html';
  ok((await fetch(BASE + MAPA)).status === 401, 'los módulos internos (mapa, radar, plano) tampoco abren sin la cookie');
  ok((await fetch(BASE + '/modules/radar-naranjal/radar_naranjal.html')).status === 401,
     'ni el radar original, que trae adentro toda la data de almacenes');
  const mapa = await fetch(BASE + MAPA, { headers: { Cookie: cookie } });
  ok(mapa.status === 200 && mapa.headers.get('x-frame-options') === 'SAMEORIGIN'
     && /frame-ancestors 'self'/.test(mapa.headers.get('content-security-policy') || ''),
     'con la cookie, el mapa carga y se deja enmarcar por el shell (antes salía bloqueado)');
  ok(/(^|;\s*)Path=\//.test(setCookie), 'la cookie vale para /modules también (Path=/)');

  console.log('\n-- proxy de teselas del mapa (con caché) --');
  ok((await fetch(BASE + '/almacen/api/tiles/esri-calles/5/16/12')).status === 401,
     'el proxy de teselas también exige la cookie: no cualquiera en la red lo usa de relay');
  const t1 = await fetch(BASE + '/almacen/api/tiles/esri-calles/5/16/12', { headers: { Cookie: cookie } });
  const bytes1 = await t1.arrayBuffer();
  ok(t1.status === 200 && t1.headers.get('content-type') === 'image/png' && bytes1.byteLength > 800,
     'con la cookie, trae una tesela real de Esri (no el aviso de bloqueo de OSM)');
  const t2 = await fetch(BASE + '/almacen/api/tiles/esri-calles/5/16/12', { headers: { Cookie: cookie } });
  const bytes2 = await t2.arrayBuffer();
  ok(t2.status === 200 && bytes2.byteLength === bytes1.byteLength,
     'y la segunda vez sale del caché en disco, no vuelve a pedirla afuera');
  ok((await fetch(BASE + '/almacen/api/tiles/otro-proveedor/5/16/12', { headers: { Cookie: cookie } })).status === 404,
     'un proveedor que no está en la lista permitida no se atiende (nada de reenviar cualquier URL)');
  ok((await fetch(BASE + '/almacen/api/tiles/esri-calles/-1/16/12', { headers: { Cookie: cookie } })).status === 404,
     'coordenadas con signo no calzan con la ruta -ni se procesan- y quedan en 404');

  const raiz = await fetch(BASE + '/');
  ok(raiz.headers.get('x-frame-options') === 'DENY', 'el resto de la app sigue sin poder enmarcarse (sin cambios)');
  ok(/fonts\.gstatic\.com/.test(raiz.headers.get('content-security-policy') || ''),
     'la CSP deja cargar la tipografía Inter de Google Fonts (antes la bloqueaba)');

  // ------------------------------------------------------------- errores
  console.log('\n-- errores --');
  const noExiste = await api('GET', '/api/no-existe');
  ok(noExiste.status === 404 && noExiste.datos.error, 'una ruta inexistente responde 404 con mensaje');
  ok((await api('GET', '/api/solicitudes/REQ-999999', undefined, tokenAdmin)).status === 404, 'un ticket inexistente responde 404');

} finally {
  servidor.close();
  const { cerrar } = await import('../backend/db/conexion.js');
  cerrar();
  fs.rmSync(temporal, { recursive: true, force: true });
}

console.log(fallos ? `\n${fallos} comprobación(es) fallaron` : '\nTodo en verde');
process.exit(fallos ? 1 : 0);
