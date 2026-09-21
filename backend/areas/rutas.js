import { Router } from 'express';
import * as credRepo from '../db/repos/credencialesArea.js';
import * as pedidosRepo from '../db/repos/pedidosHistorico.js';
import * as solicitudes from '../db/repos/solicitudes.js';
import * as adjuntos from '../db/repos/adjuntos.js';
import * as sesiones from '../usuarios/sesiones.js';
import * as servicio from './servicio.js';
import { requiereSesion, requiereRol, requiereSesionArea } from '../usuarios/middleware.js';
import { limitarIntentos, limitarPeticiones } from '../middleware/limites.js';
import { log } from '../seguridad/log.js';

/**
 * Ingreso del solicitante por DNI + credencial de área, "mis servicios"
 * acotado a los últimos 5 del área, pedidos de histórico completo y
 * administración de las credenciales de área (solo admin).
 *
 * Vive en su propio módulo, igual que usuarios/, porque agrupa una cosa
 * conceptualmente distinta: no son cuentas de logística, son el segundo
 * factor del autoservicio del solicitante. Se monta en /api, junto al resto.
 */
export const areas = Router();

const error = (msg, status) => Object.assign(new Error(msg), { status });

const LIMITE_MIS_SERVICIOS = 5;

// -------------------------------------------------------------------- auth
// Mismo freno de fuerza bruta que el resto del ingreso (comparte presupuesto
// por IP con /auth/ingresar y /auth/solicitante/:doc): quien prueba usuario y
// clave de área a ciegas gasta el mismo cupo.
const frenoIngreso = limitarIntentos();

areas.post('/auth/area', frenoIngreso, (req, res) => {
  res.json(servicio.ingresarPorArea(req.body?.dni, req.body?.usuario, req.body?.clave, req));
});

areas.post('/auth/area/salir', requiereSesionArea, (req, res) => {
  sesiones.revocar(req.token);
  log('logout_area', req);
  res.json({ ok: true });
});

areas.put('/auth/area/clave', requiereSesionArea, (req, res) => {
  const token = servicio.cambiarClavePropiaArea(req.area, req.body?.actual, req.body?.nueva, req);
  res.json({ ok: true, token });
});

// ------------------------------------------------------- mis servicios
/**
 * Los últimos 5 servicios del área de quien pregunta -no de "quien pidió",
 * del área entera-, y solo eso. `area` sale de la sesión, nunca de un
 * parámetro que mande el navegador: si viniera por query string, cualquiera
 * con una credencial de área válida (la suya) podría pedir la de cualquier
 * otra con solo cambiar el texto, que es exactamente lo que este cambio
 * quiere impedir.
 */
const frenoMiArea = limitarPeticiones({
  maximo: 60, ventanaMs: 5 * 60 * 1000, nombre: 'mi-area',
  mensaje: 'Demasiadas consultas. Espera unos minutos y vuelve a intentar.'
});
areas.get('/solicitudes/mias', requiereSesionArea, frenoMiArea, (req, res) => {
  const ultimos = solicitudes.deArea(req.area.area, LIMITE_MIS_SERVICIOS);
  res.json({ solicitudes: ultimos, adjuntos: adjuntos.deTickets(ultimos.map(s => s.id)) });
});

// ------------------------------------------------------ pedidos de histórico
// Autoservicio, como pedir autorización a logística: el área que quiere ver
// más de sus últimos 5 lo pide, admin lo resuelve a mano y le hace llegar el
// histórico completo por fuera de la aplicación (ya lo tiene en su propia
// pantalla). `area`/`dni` salen de la sesión, no del cuerpo, por la misma
// razón que en /solicitudes/mias.
areas.post('/pedidos-historico', requiereSesionArea, (req, res) => {
  const r = pedidosRepo.pedir(req.area.area, req.area.dni);
  log('pedido_historico_creado', req, 'área "' + req.area.area + '"' + (r.repetido ? ' (ya había uno pendiente)' : ''));
  res.status(201).json(r);
});

areas.get('/pedidos-historico', requiereSesion, requiereRol('admin'), (req, res) => {
  res.json(pedidosRepo.listar());
});

areas.patch('/pedidos-historico/:id', requiereSesion, requiereRol('admin'), (req, res) => {
  const r = pedidosRepo.resolver(req.params.id, req.body?.estado);
  log('pedido_historico_resuelto', req, 'pedido #' + req.params.id + ' → ' + req.body?.estado);
  res.json(r);
});

// --------------------------------------------- credenciales de área (admin)
// Igual que /usuarios: solo admin las crea y reparte las claves temporales.
areas.get('/credenciales-area', requiereSesion, requiereRol('admin'), (req, res) => {
  res.json(credRepo.listar());
});

areas.post('/credenciales-area', requiereSesion, requiereRol('admin'), (req, res) => {
  res.status(201).json(servicio.crearCredencialArea({
    area: req.body?.area,
    usuario: req.body?.usuario,
    creadoPor: req.usuario.usuario
  }, req));
});

areas.post('/credenciales-area/:area/restablecer', requiereSesion, requiereRol('admin'), (req, res) => {
  res.json(servicio.restablecerClaveArea(req.params.area, req));
});

areas.patch('/credenciales-area/:area', requiereSesion, requiereRol('admin'), (req, res) => {
  if (typeof req.body?.activo !== 'boolean') throw error('Falta indicar "activo" (true/false).', 400);
  res.json(servicio.cambiarEstadoArea(req.params.area, req.body.activo, req));
});
