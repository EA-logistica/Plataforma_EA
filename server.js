/**
 * Punto de entrada. Arranca el servidor de backend/servidor.js.
 *
 *     npm start        producción
 *     npm run dev      recarga al guardar
 */
import { iniciar } from './backend/servidor.js';

try {
  await iniciar();
} catch (e) {
  console.error('\n  No se pudo iniciar la Plataforma EA:\n  ' + e.message + '\n');
  process.exit(1);
}
