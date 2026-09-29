import { Router } from 'express';
import * as repo from './repositorio.js';
import * as servicio from './servicio.js';
import * as sesiones from './sesiones.js';
import { requiereSesion, requiereRol } from './middleware.js';
import { limitarIntentos } from '../middleware/limites.js';
import { log } from '../seguridad/log.js';
import { asinc } from '../middleware/errores.js';

/**
 * Cuentas de logística: ingreso, cambio de clave propia y administración de
 * usuarios (solo admin). Se monta directo en /api, junto al resto de rutas.
 *
 * Contrato: igual que el resto de la API, todo responde JSON y los errores
 * salen como { error }.
 */
export const usuarios = Router();

const error = (msg, status) => Object.assign(new Error(msg), { status });

// El freno de fuerza bruta es el mismo de siempre: pocas cuentas y quien
// entra por la fuerza no debería tener el diccionario entero para probar.
const frenoIngreso = limitarIntentos();

// -------------------------------------------------------------------- auth
usuarios.post('/auth/ingresar', frenoIngreso, asinc(async (req, res) => {
  res.json(await servicio.ingresar(req.body?.usuario, req.body?.clave, req));
}));

usuarios.post('/auth/salir', requiereSesion, asinc(async (req, res) => {
  sesiones.revocar(req.token);
  await log('logout', req);
  res.json({ ok: true });
}));

usuarios.get('/auth/yo', requiereSesion, (req, res) => {
  res.json({ usuario: req.usuario.usuario, rol: req.usuario.rol });
});

usuarios.put('/auth/clave', requiereSesion, asinc(async (req, res) => {
  // Cambiar la clave revoca todas las sesiones de la cuenta -incluida esta-,
  // así que se devuelve un token nuevo para no dejar afuera a quien la pidió.
  const token = await servicio.cambiarClavePropia(req.usuario, req.body?.actual, req.body?.nueva, req);
  res.json({ ok: true, token });
}));

// ------------------------------------------------------- gestión de cuentas
// Solo admin: es quien crea usuarios y reparte las claves temporales.
usuarios.get('/usuarios', requiereSesion, requiereRol('admin'), asinc(async (req, res) => {
  res.json(await repo.listar());
}));

usuarios.post('/usuarios', requiereSesion, requiereRol('admin'), asinc(async (req, res) => {
  res.status(201).json(await servicio.crearUsuario({
    usuario: req.body?.usuario,
    rol: req.body?.rol,
    creadoPor: req.usuario.usuario
  }, req));
}));

usuarios.post('/usuarios/:id/restablecer', requiereSesion, requiereRol('admin'), asinc(async (req, res) => {
  res.json(await servicio.restablecerClave(Number(req.params.id), req));
}));

usuarios.patch('/usuarios/:id', requiereSesion, requiereRol('admin'), asinc(async (req, res) => {
  if (typeof req.body?.activo !== 'boolean') throw error('Falta indicar "activo" (true/false).', 400);
  res.json(await servicio.cambiarEstado(Number(req.params.id), req.body.activo, req.usuario, req));
}));
