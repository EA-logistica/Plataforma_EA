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
import { asinc } from '../middleware/errores.js';

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

const LIMITE_MIS_SERVICIOS = 10;

// -------------------------------------------------------------------- auth
// Mismo freno de fuerza bruta que el resto del ingreso (comparte presupuesto
// por IP con /auth/ingresar y /auth/solicitante/:doc): quien prueba usuario y
// clave de área a ciegas gasta el mismo cupo.
const frenoIngreso = limitarIntentos();

areas.post('/auth/area', frenoIngreso, asinc(async (req, res) => {
  res.json(await servicio.ingresarPorArea(req.body?.dni, req.body?.usuario, req.body?.clave, req));
}));

areas.post('/auth/area/salir', requiereSesionArea, asinc(async (req, res) => {
  sesiones.revocar(req.token);
  await log('logout_area', req);
  res.json({ ok: true });
}));

areas.put('/auth/area/clave', requiereSesionArea, asinc(async (req, res) => {
  const token = await servicio.cambiarClavePropiaArea(req.area, req.body?.actual, req.body?.nueva, req);
  res.json({ ok: true, token });
}));

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
areas.get('/solicitudes/mias', requiereSesionArea, frenoMiArea, asinc(async (req, res) => {
  const ultimos = await solicitudes.deArea(req.area.area, LIMITE_MIS_SERVICIOS);
  res.json({ solicitudes: ultimos, adjuntos: await adjuntos.deTickets(ultimos.map(s => s.id)) });
}));

// Buscar entre TODOS los servicios del área -reemplaza a la pestaña
// "Seguimiento", que solo encontraba un ticket si estaba entre los últimos-:
// por número de ticket, solicitante o destino. El área sale de la sesión.
areas.get('/solicitudes/mias/buscar', requiereSesionArea, frenoMiArea, asinc(async (req, res) => {
  const encontrados = await solicitudes.buscarEnArea(req.area.area, req.query.q, 20);
  res.json({ solicitudes: encontrados, adjuntos: await adjuntos.deTickets(encontrados.map(s => s.id)) });
}));

// ------------------------------------------------------ pedidos de histórico
// Autoservicio, como pedir autorización a logística: el área que quiere ver
// más de sus últimos 5 lo pide, admin lo resuelve a mano y le hace llegar el
// histórico completo por fuera de la aplicación (ya lo tiene en su propia
// pantalla). `area`/`dni` salen de la sesión, no del cuerpo, por la misma
// razón que en /solicitudes/mias.
areas.post('/pedidos-historico', requiereSesionArea, asinc(async (req, res) => {
  const r = await pedidosRepo.pedir(req.area.area, req.area.dni);
  await log('pedido_historico_creado', req, 'área "' + req.area.area + '"' + (r.repetido ? ' (ya había uno pendiente)' : ''));
  res.status(201).json(r);
}));

areas.get('/pedidos-historico', requiereSesion, requiereRol('admin'), asinc(async (req, res) => {
  res.json(await pedidosRepo.listar());
}));

areas.patch('/pedidos-historico/:id', requiereSesion, requiereRol('admin'), asinc(async (req, res) => {
  const r = await pedidosRepo.resolver(req.params.id, req.body?.estado);
  await log('pedido_historico_resuelto', req, 'pedido #' + req.params.id + ' → ' + req.body?.estado);
  res.json(r);
}));

// --------------------------------------------- credenciales de área (admin)
// Igual que /usuarios: solo admin las crea y reparte las claves temporales.
areas.get('/credenciales-area', requiereSesion, requiereRol('admin'), asinc(async (req, res) => {
  res.json(await credRepo.listar());
}));

areas.post('/credenciales-area', requiereSesion, requiereRol('admin'), asinc(async (req, res) => {
  res.status(201).json(await servicio.crearCredencialArea({
    area: req.body?.area,
    usuario: req.body?.usuario,
    creadoPor: req.usuario.usuario
  }, req));
}));

areas.post('/credenciales-area/:area/restablecer', requiereSesion, requiereRol('admin'), asinc(async (req, res) => {
  res.json(await servicio.restablecerClaveArea(req.params.area, req));
}));

areas.patch('/credenciales-area/:area', requiereSesion, requiereRol('admin'), asinc(async (req, res) => {
  if (typeof req.body?.activo !== 'boolean') throw error('Falta indicar "activo" (true/false).', 400);
  res.json(await servicio.cambiarEstadoArea(req.params.area, req.body.activo, req));
}));
