import { abrir, cerrar, db } from './conexion.js';
import * as personal from './repos/personal.js';
import * as solicitudes from './repos/solicitudes.js';
import * as ajustes from './repos/ajustes.js';
import * as usuarios from '../usuarios/repositorio.js';
import * as credencialesArea from './repos/credencialesArea.js';
import { hashClave, generarClaveTemporal } from '../usuarios/claves.js';
import { padronInicial } from '#data/padron.js';
import { historico2026, RESUMEN } from '#data/historico.js';

const sinTildes = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
const slugArea = area => sinTildes(area).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/**
 * Carga inicial de la base.
 *
 * No hay datos inventados: el padrón es el listado de RR.HH. y las solicitudes
 * son los servicios de mensajería que de verdad se hicieron en 2026, cargados
 * como concluidos. Así los indicadores abren con el gasto real del año y la
 * bandeja abre vacía, que es lo correcto: no hay nada pendiente hasta que
 * alguien registre una solicitud.
 *
 * Es idempotente: si la base ya tiene datos no hace nada, salvo que se pase
 * --forzar, que la vacía y la vuelve a llenar.
 *
 *     node backend/db/sembrar.js            carga solo si está vacía
 *     node backend/db/sembrar.js --forzar   borra y recarga
 */

export const VERSION_DATOS = '2026.1';

export function sembrar({ forzar = false, silencioso = false } = {}) {
  const decir = (...a) => { if (!silencioso) console.log(...a); };

  if (forzar) {
    db().exec('DELETE FROM adjuntos; DELETE FROM solicitudes; DELETE FROM autorizaciones; '
      + 'DELETE FROM personal; DELETE FROM usuarios; DELETE FROM credenciales_area; DELETE FROM pedidos_historico;');
    decir('Base vaciada.');
  }

  const yaHay = personal.total() > 0 || solicitudes.total() > 0;
  if (yaHay) {
    decir('La base ya tiene datos (' + personal.total() + ' personas, '
      + solicitudes.total() + ' servicios). Nada que sembrar.');
  } else {
    const personas = personal.cargarPadronOficial(padronInicial());
    decir('Padrón cargado: ' + personas + ' personas.');

    const servicios = solicitudes.cargarHistorico(historico2026());
    decir('Histórico cargado: ' + servicios + ' servicios de 2026 (S/ ' + RESUMEN.gasto.toFixed(2)
      + ', del ' + RESUMEN.desde + ' al ' + RESUMEN.hasta + ').');

    ajustes.escribir('version_datos', VERSION_DATOS);
  }

  // El usuario admin se siembra aparte y siempre se comprueba, no solo la
  // primera vez: si alguien restaura una base sin la tabla de usuarios llena
  // (o la vació a mano), el sistema no debe quedar sin nadie que pueda entrar.
  let credencialesAdmin = null;
  if (!usuarios.hayAdmin()) {
    const claveTemporal = 'admin';
    usuarios.crear({ usuario: 'admin', claveHash: hashClave(claveTemporal), rol: 'admin', creadoPor: 'siembra' });
    credencialesAdmin = { usuario: 'admin', claveTemporal };
    decir('Usuario "admin" creado con clave temporal "admin". Cámbiala en el primer ingreso.');
  }

  // Credenciales de área: el segundo factor del ingreso del solicitante. Se
  // siembra una por cada área que ya tenga gente en el padrón -si no, nadie
  // podría entrar hasta que admin las creara a mano, una por una- y, como con
  // admin, se revisa siempre y no solo la primera vez: un área nueva en el
  // padrón (o una base restaurada sin esta tabla) no debe quedar sin forma de
  // entrar. Cada iteración va en su propio try/catch porque es sembrado de
  // mejor esfuerzo: un choque de nombre de usuario entre dos áreas no debe
  // impedir que arranque el servidor.
  const credencialesAreaCreadas = [];
  for (const area of personal.areas()) {
    if (credencialesArea.porArea(area)) continue;
    try {
      const usuario = slugArea(area);
      const claveTemporal = generarClaveTemporal();
      credencialesArea.crear({ area, usuario, claveHash: hashClave(claveTemporal), creadoPor: 'siembra' });
      credencialesAreaCreadas.push({ area, usuario, claveTemporal });
      decir('Credencial del área "' + area + '" creada: usuario "' + usuario + '", clave temporal "' + claveTemporal + '".');
    } catch (e) {
      decir('No se pudo crear la credencial del área "' + area + '": ' + e.message);
    }
  }

  ajustes.tocar();

  return { sembrado: !yaHay, credencialesAdmin, credencialesArea: credencialesAreaCreadas };
}

// Ejecutable directo: node backend/db/sembrar.js [--forzar]
if (import.meta.filename === process.argv[1]) {
  abrir();
  sembrar({ forzar: process.argv.includes('--forzar') });
  cerrar();
}
