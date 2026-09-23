import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';

import * as personal from '../db/repos/personal.js';
import * as solicitudes from '../db/repos/solicitudes.js';
import * as autorizaciones from '../db/repos/autorizaciones.js';
import * as adjuntos from '../db/repos/adjuntos.js';
import * as ajustes from '../db/repos/ajustes.js';
import { conSubida } from '../middleware/subida.js';
import { limitarIntentos, limitarPeticiones } from '../middleware/limites.js';
import { asinc } from '../middleware/errores.js';
import { usuarios } from '../usuarios/rutas.js';
import { areas } from '../areas/rutas.js';
import { requiereSesion, requiereRol, sesionOpcional } from '../usuarios/middleware.js';
import { log, eventosRecientes } from '../seguridad/log.js';
import { CONFIG } from '../config.js';

import { DESTINOS } from '#data/destinos.js';
import { analizarDemanda } from '#shared/payback/demanda.js';
import { construir } from '#shared/payback/escenarios.js';
import { comparar } from '#shared/payback/payback.js';
import { COLUMNAS_VIAJES, filtrarPorRango } from '#shared/exportarViajes.js';
import { MOTIVOS_CANCELACION, motivoValido } from '#shared/cancelacion.js';

/**
 * La API. Un archivo por ahora, porque son pocas rutas y tenerlas juntas deja
 * ver el contrato completo de un vistazo; si crece, se parte por recurso.
 *
 * Contrato general:
 *   - Todo responde JSON.
 *   - Los errores salen como { error: "mensaje" } con el código HTTP que toca.
 *   - Las escrituras devuelven el objeto ya guardado, para que el navegador
 *     actualice su copia sin tener que volver a preguntar.
 */

export const api = Router();

// Ingreso, cambio de clave propia y administración de usuarios de logística.
// Vive en su propio módulo (usuarios/) porque agrupa hashing de claves,
// sesiones y permisos: cosas que no tienen nada que ver con el resto de la API.
api.use(usuarios);

// Ingreso del solicitante por DNI + credencial de área, "mis servicios" del
// área y pedidos de histórico completo. Vive en su propio módulo por la misma
// razón que usuarios/: agrupa algo que no tiene que ver con el resto de la API.
api.use(areas);

const error = (msg, status) => Object.assign(new Error(msg), { status });

// ------------------------------------------------------------------ estado
/**
 * Una sola llamada con lo que la pantalla necesita para pintarse. El
 * contenido depende de QUIÉN pregunta, porque este endpoint no pedía sesión:
 * cualquiera en la red podía traer el historial completo -1600+ servicios
 * con DNI, teléfono y dirección de cada uno- sin conocer usuario ni clave.
 *
 *   - Con sesión de logística: todo, como siempre (bandeja, histórico, KPI,
 *     padrón, payback lo necesitan completo, y ya están autenticados).
 *   - Sin sesión de logística (incluida la de un solicitante con credencial
 *     de área, que es otro tipo de sesión): solo lo que no es personal de
 *     nadie -destinos, conteo del padrón, testigo de revisión-. Los
 *     servicios del área de un solicitante autenticado los trae por
 *     separado GET /solicitudes/mias (backend/areas/rutas.js), acotados a
 *     los últimos 5 y exigiendo esa sesión.
 */
api.get('/estado', sesionOpcional, (req, res) => {
  const base = {
    revision: ajustes.revision(),
    versionDatos: ajustes.leer('version_datos', ''),
    // Aquí va el CONTEO del padrón, no el padrón. Mandarlo entero ponía los
    // 212 nombres con su DNI en la memoria de cualquier navegador que abriera
    // la página, lo que dejaba sin efecto la decisión de no listarlo en
    // pantalla: bastaba con abrir la consola. Las fichas se piden de a una
    // por /api/personal?q= y por /api/auth/solicitante/:doc.
    totalPersonal: personal.total(),
    destinos: DESTINOS
  };
  if (!req.usuario) return res.json({ ...base, solicitudes: [], autorizaciones: [], adjuntos: [] });

  res.json({
    ...base,
    solicitudes: solicitudes.listar(),
    autorizaciones: autorizaciones.listar(),
    adjuntos: adjuntos.listar()
  });
});

// El testigo, para el sondeo entre pestañas: unos bytes en vez de la base.
api.get('/revision', (req, res) => res.json({ revision: ajustes.revision() }));

// -------------------------------------------------------------------- auth
// El DNI por sí solo ya no basta para ver nada: solo detecta el área contra
// el padrón (primer factor). El segundo -la credencial de esa área- y todo lo
// que un solicitante puede ver una vez adentro viven en backend/areas/rutas.js.
// El ingreso de logística (usuario + clave) vive en usuarios/rutas.js.
//
// Esta ruta lleva freno por IP: responde distinto según el DNI, así que sirve
// para probar documentos a ciegas uno tras otro.
const frenoIngreso = limitarIntentos();

api.get('/auth/solicitante/:doc', frenoIngreso, (req, res) => {
  const p = personal.porDocumento(req.params.doc);
  if (!p) throw error('El documento no figura en el padrón de personal.', 404);
  res.json(p);
});

// ---------------------------------------------------------------- personal
// Todo "Padrón y accesos" es cosa de admin: seguimiento no lo ve ni en la
// pantalla ni por acá. Quien encuentra a alguien no identificado durante el
// despacho lo reporta a admin, no lo agrega ni lo busca él mismo.
api.get('/personal', requiereSesion, requiereRol('admin'), (req, res) => {
  // Sin búsqueda no se devuelve el padrón completo: son datos personales de
  // todo el personal y no hay motivo para volcarlos por pedir la ruta.
  const q = req.query.q;
  res.json(q ? personal.buscar(q) : { total: personal.total(), resultados: [] });
});

api.post('/personal', requiereSesion, requiereRol('admin'), (req, res) => {
  const p = personal.agregar(req.body || {});
  log('personal_agregado', req, 'DNI ' + p.dni + ' (' + p.nombre + ')');
  res.status(201).json(p);
});
api.delete('/personal/:dni', requiereSesion, requiereRol('admin'), (req, res) => {
  const r = personal.quitar(req.params.dni);
  log('personal_eliminado', req, 'DNI ' + req.params.dni);
  res.json(r);
});

// ------------------------------------------------------------- solicitudes
// El listado completo -y un ticket suelto por id- ya no son públicos: son el
// mismo volcado masivo de /estado, solo que por otra puerta. El solicitante
// llega a lo suyo por /solicitudes/mias; quien pide un ticket por id acá
// tiene que estar en la sesión de logística (o ser un script con su token,
// para Power BI o una hoja de cálculo, el mismo caso que /payback).
api.get('/solicitudes', requiereSesion, (req, res) => res.json(solicitudes.listar()));

/**
 * Reporte de viajes en Excel, con columnas tipadas (fecha, número) en vez del
 * texto plano del CSV: pensado para abrirse y trabajarse en la propia hoja de
 * cálculo, no para alimentar otro sistema. `desde`/`hasta` filtran por la
 * fecha PROGRAMADA del viaje; en blanco, ese lado del rango queda abierto.
 *
 * Va ANTES de `/solicitudes/:id`: si no, "exportar" caería en `:id` y el
 * servidor respondería "no existe el ticket exportar" en vez de exportar nada.
 */
api.get('/solicitudes/exportar', requiereSesion, asinc(async (req, res) => {
  const { desde, hasta } = req.query;
  if (desde && !/^\d{4}-\d{2}-\d{2}$/.test(desde)) throw error('La fecha "desde" no es válida.', 400);
  if (hasta && !/^\d{4}-\d{2}-\d{2}$/.test(hasta)) throw error('La fecha "hasta" no es válida.', 400);
  if (desde && hasta && desde > hasta) throw error('La fecha "desde" no puede ser posterior a "hasta".', 400);

  const filas = filtrarPorRango(solicitudes.listar(), desde, hasta);

  const libro = new ExcelJS.Workbook();
  libro.creator = 'PLANSA Delivery';
  libro.created = new Date();

  const hoja = libro.addWorksheet('Viajes', { views: [{ state: 'frozen', ySplit: 1 }] });
  const formato = { numero: '#,##0.00', fecha: 'dd/mm/yyyy', fechahora: 'dd/mm/yyyy hh:mm' };
  hoja.columns = COLUMNAS_VIAJES.map(([etiqueta, tipo]) => ({
    header: etiqueta,
    width: Math.max(12, etiqueta.length + 2),
    style: formato[tipo] ? { numFmt: formato[tipo] } : {}
  }));
  hoja.getRow(1).font = { bold: true };
  filas.forEach(s => hoja.addRow(COLUMNAS_VIAJES.map(([, , valor]) => valor(s))));

  const rango = desde || hasta ? '_' + (desde || 'inicio') + '_a_' + (hasta || 'hoy') : '';
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="viajes_plasticos_nacionales' + rango + '.xlsx"');
  await libro.xlsx.write(res);
  res.end();
}));

api.get('/solicitudes/:id', requiereSesion, (req, res) => {
  const s = solicitudes.porId(req.params.id);
  if (!s) throw error('No existe el ticket ' + req.params.id + '.', 404);
  res.json(s);
});

// Crear un ticket sigue siendo autoservicio del solicitante: no lleva sesión
// de logística (consultar uno solo ya no es público, ver arriba). Asignar
// transporte/tarifa y mover el estado sí piden sesión, porque
// es trabajo de despacho.
//
// Sin clave de por medio, nada evitaba que un script registrara miles de
// tickets falsos; 20 en 5 minutos es de sobra para una persona pidiendo
// varios servicios seguidos y frena un script en seco.
const frenoSolicitudes = limitarPeticiones({
  maximo: 20, ventanaMs: 5 * 60 * 1000, nombre: 'solicitudes',
  mensaje: 'Demasiados servicios registrados en poco tiempo. Espera unos minutos.'
});
api.post('/solicitudes', frenoSolicitudes, (req, res) => res.status(201).json(solicitudes.crear(req.body || {})));
api.patch('/solicitudes/:id', requiereSesion, (req, res) =>
  res.json(solicitudes.actualizar(req.params.id, req.body || {})));
api.post('/solicitudes/:id/avanzar', requiereSesion, (req, res) =>
  res.json(solicitudes.avanzar(req.params.id)));

/**
 * Cancela un ticket. Lo puede pedir tanto el solicitante (autoservicio, sin
 * sesión) como logística, así que la sesión es OPCIONAL y la ruta decide
 * según si `req.usuario` quedó puesto:
 *
 *   - Sin sesión: es el solicitante cancelando lo suyo. El motivo queda fijo
 *     en "Usuario solicitó baja" -no se le pregunta nada más- y solo puede
 *     mientras el ticket sigue "En espera": una vez que salió un mensajero,
 *     ya no es autoservicio.
 *   - Con sesión (admin o seguimiento): tiene que elegir uno de los tres
 *     motivos de la lista, con detalle obligatorio si elige "Otros", y puede
 *     cancelar también uno que ya está "En tránsito".
 *
 * El freno va antes de mirar la sesión: sin él, alguien podría recorrer
 * REQ-001, REQ-002... cancelando lo que encuentre "En espera" sin necesitar
 * clave ni acertar nada, solo conocer el patrón del id.
 */
const frenoCancelar = limitarPeticiones({
  maximo: 20, ventanaMs: 5 * 60 * 1000, nombre: 'cancelar',
  mensaje: 'Demasiadas cancelaciones en poco tiempo. Espera unos minutos.'
});
api.post('/solicitudes/:id/cancelar', frenoCancelar, sesionOpcional, (req, res) => {
  if (!req.usuario) {
    return res.json(solicitudes.cancelar(req.params.id, {
      motivo: 'Usuario solicitó baja',
      canceladoPor: 'Solicitante',
      soloDesdeEspera: true
    }));
  }

  const { motivo, detalle } = req.body || {};
  if (!motivoValido(motivo)) throw error('Elige un motivo válido: ' + MOTIVOS_CANCELACION.join(', ') + '.', 400);
  if (motivo === 'Otros' && !String(detalle || '').trim()) throw error('Escribe el detalle del motivo.', 400);

  const r = solicitudes.cancelar(req.params.id, { motivo, detalle, canceladoPor: req.usuario.usuario });
  log('solicitud_cancelada', req, req.params.id + ' · ' + motivo + (detalle ? ': ' + detalle : ''));
  res.json(r);
});

// ---------------------------------------------------------- autorizaciones
// Pedirla sigue siendo autoservicio: el solicitante cuyo DNI no está en el
// padrón la pide él mismo, sin sesión. Verla y resolverla —"Padrón y
// accesos"— es cosa de admin, igual que /personal.
api.get('/autorizaciones', requiereSesion, requiereRol('admin'), (req, res) => res.json(autorizaciones.listar()));
const frenoAutorizaciones = limitarPeticiones({
  maximo: 10, ventanaMs: 5 * 60 * 1000, nombre: 'autorizaciones',
  mensaje: 'Demasiados pedidos en poco tiempo. Espera unos minutos.'
});
api.post('/autorizaciones', frenoAutorizaciones, (req, res) => res.status(201).json(autorizaciones.pedir(req.body?.dni)));
api.patch('/autorizaciones/:dni', requiereSesion, requiereRol('admin'), (req, res) => {
  const r = autorizaciones.resolver(req.params.dni, req.body?.estado);
  log('autorizacion_resuelta', req, 'DNI ' + req.params.dni + ' → ' + req.body?.estado);
  res.json(r);
});

// ---------------------------------------------------------------- adjuntos
// El solicitante ve los suyos en su tarjeta -sin poder tocarlos- a partir de
// lo que ya le trajo /solicitudes/mias, no llamando a esto. Esta ruta la usa
// solo la pantalla de logística (bandeja, "Gestionar", subir/borrar), así que
// pide sesión igual que el resto de esa pantalla.
api.get('/adjuntos', requiereSesion, (req, res) =>
  res.json(req.query.ticket ? adjuntos.deTicket(req.query.ticket) : adjuntos.listar()));

/**
 * Subida de una guía. multer deja el archivo en uploads/ con un nombre único y
 * aquí solo se registra dónde quedó. Si el registro falla, se borra el archivo:
 * sin esto, cada error dejaría basura en la carpeta.
 */
api.post('/adjuntos', requiereSesion, conSubida, (req, res) => {
  if (!req.file) throw error('No llegó ningún archivo en el campo "archivo".', 400);
  try {
    res.status(201).json(adjuntos.registrar({
      ticketId: req.body.ticketId,
      archivo: req.file.filename,
      nombreOriginal: req.file.originalname,
      tipo: req.file.mimetype,
      tamano: req.file.size,
      subidoPor: req.body.subidoPor
    }));
  } catch (e) {
    try { fs.unlinkSync(req.file.path); } catch (_) { /* ya no estaba */ }
    throw e;
  }
});

/** Sirve el binario. El nombre en disco no se toma de la URL, sino de la base. */
api.get('/adjuntos/:id/archivo', (req, res) => {
  const a = adjuntos.porId(req.params.id);
  if (!a) throw error('No existe ese adjunto.', 404);
  const ruta = adjuntos.rutaDe(a.archivo);
  if (!fs.existsSync(ruta)) throw error('El archivo ya no está en el servidor.', 410);

  res.type(a.tipo || 'application/octet-stream');
  res.setHeader('Content-Disposition',
    'inline; filename*=UTF-8\'\'' + encodeURIComponent(a.nombreOriginal));
  res.sendFile(path.resolve(ruta));
});

api.delete('/adjuntos/:id', requiereSesion, (req, res) => res.json(adjuntos.eliminar(req.params.id)));

// ----------------------------------------------------------------- payback
/**
 * El análisis completo, calculado en el servidor.
 *
 * La pantalla también sabe calcularlo —el código de shared/ lo usan los dos,
 * directo contra el estado que ya tiene cargado— así que esta ruta no la pisa
 * la interfaz. Existe para consultarlo desde Power BI, un script o una hoja de
 * cálculo, y por eso es la única "vista" de datos que se reserva a admin: es
 * el análisis de costos completo, no un ticket suelto.
 */
api.get('/payback', requiereSesion, requiereRol('admin'), (req, res) => {
  const demanda = analizarDemanda(solicitudes.listar());
  if (!demanda.hay) throw error('Todavía no hay servicios registrados para analizar.', 409);

  const opciones = {
    bonoRemunerativo: req.query.bono !== 'no',
    inicio: req.query.inicio
  };
  const cmp = comparar(construir(demanda, opciones), demanda, opciones);

  res.json({
    gastoActual: cmp.gastoActual,
    viajesPorDia: cmp.viajesPorDia,
    condiciones: cmp.condiciones,
    recomendado: cmp.recomendacion.mejor ? cmp.recomendacion.mejor.escenario.id : null,
    escenarios: cmp.filas.map(f => ({
      id: f.escenario.id,
      nombre: f.escenario.nombre,
      costoMensual: f.costoMensual,
      ahorroMensual: f.ahorroMensual,
      ahorroAnual: f.ahorroAnual,
      inversion: f.inversion,
      mesesRetorno: f.mesesRetorno,
      costoPrimerAnio: f.flujo ? f.flujo.costoPrimerAnio : null,
      mesRecuperacion: f.flujo ? f.flujo.mesRecuperacion : null,
      // El proveedor a cuota fija no tiene techo ni uso de jornada que
      // reportar: esa capacidad es suya, no se dimensiona contra planilla propia.
      capacidad: f.escenario.cfg.modelo === 'tercero' ? null : {
        techoDiario: f.escenario.capacidad.techoDiario,
        usoConPrograma: f.escenario.capacidad.usoConPrograma,
        usoSinPrograma: f.escenario.capacidad.usoSinPrograma
      }
    }))
  });
});

// ------------------------------------------------------------------- salud
// Pública a propósito, para un chequeo rápido de "¿está vivo?": son conteos,
// no dice nada de la máquina. Las rutas de archivos SÍ dicen algo de la
// máquina (sistema operativo, usuario, si el proyecto vive en una carpeta
// sincronizada a la nube) y se guardan para el detalle, que pide admin.
api.get('/salud', (req, res) => res.json({
  ok: true,
  personal: personal.total(),
  solicitudes: solicitudes.total(),
  adjuntosHuerfanos: adjuntos.huerfanos().length
}));

api.get('/salud/detalle', requiereSesion, requiereRol('admin'), (req, res) => res.json({
  ok: true,
  baseDatos: CONFIG.baseDatos,
  subidas: CONFIG.subidas,
  personal: personal.total(),
  solicitudes: solicitudes.total(),
  adjuntosHuerfanos: adjuntos.huerfanos().length
}));

// -------------------------------------------------------------- seguridad
// Auditoría: quién entró, quién falló, qué cambió. Sirve para lo que en el
// resto del sistema es "el log de seguridad" -ver backend/seguridad/log.js-,
// sin necesitar herramientas aparte para leer la base a mano.
api.get('/seguridad/eventos', requiereSesion, requiereRol('admin'), (req, res) => {
  res.json(eventosRecientes(req.query.limite));
});
