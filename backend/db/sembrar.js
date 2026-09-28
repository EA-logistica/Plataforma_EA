import { abrir, cerrar, db } from './conexion.js';
import * as personal from './repos/personal.js';
import * as solicitudes from './repos/solicitudes.js';
import * as ajustes from './repos/ajustes.js';
import * as usuarios from '../usuarios/repositorio.js';
import * as credencialesArea from './repos/credencialesArea.js';
import * as ordenesCompra from './repos/ordenesCompra.js';
import * as ordenesCompraDetalle from './repos/ordenesCompraDetalle.js';
import * as productos from './repos/productos.js';
import * as requerimientosHistorico from './repos/requerimientosCompraHistorico.js';
import * as materiaPrima from './repos/materiaPrimaStock.js';
import * as stockValorizado from './repos/stockValorizado.js';
import * as metrajeAlmacen from './repos/metrajeAlmacen.js';
import { hashClave, generarClaveTemporal } from '../usuarios/claves.js';
import { createHash } from 'node:crypto';
import { padronInicial } from '#data/padron.js';
import { historico2026, RESUMEN } from '#data/historico.js';
import { comprasIniciales, RESUMEN as RESUMEN_COMPRAS } from '#data/compras.js';
import { productosIniciales, RESUMEN as RESUMEN_PRODUCTOS } from '#data/productos.js';
import { requerimientosHistoricoIniciales, RESUMEN as RESUMEN_RQC } from '#data/requerimientosCompraHistorico.js';
import { ordenesCompraDetalleIniciales, RESUMEN as RESUMEN_OCD } from '#data/ordenesCompraDetalle.js';
import { materiaPrimaStockInicial, RESUMEN as RESUMEN_MP } from '#data/materiaPrimaStock.js';
import { stockValorizadoInicial, RESUMEN as RESUMEN_SV } from '#data/stockValorizado.js';
import { metrajeAlmacenInicial, RESUMEN as RESUMEN_METRAJE } from '#data/metrajeAlmacen.js';

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

export const VERSION_DATOS = '2026.2';

/**
 * Las fotos del ERP (catálogo, stock de materia prima, stock valorizado) se
 * recargaban enteras en cada arranque aunque el archivo de data/ no hubiera
 * cambiado: 28 mil filas reescritas, varios MB de WAL y todos los clientes
 * recargando por el testigo nuevo. Ahora se guarda la huella del contenido
 * en `ajustes` y solo se recarga si cambió (o si la tabla quedó vacía, p. ej.
 * tras un --forzar). El resultado en la base es el mismo.
 */
const huella = filas => createHash('sha1').update(JSON.stringify(filas)).digest('hex');
function recargarSiCambio(nombre, filas, tablaConDatos, forzar, cargar) {
  const h = huella(filas);
  const clave = 'huella_' + nombre;
  if (!forzar && tablaConDatos && ajustes.leer(clave, '') === h) return false;
  cargar(filas);
  ajustes.escribir(clave, h);
  return true;
}

export function sembrar({ forzar = false, silencioso = false } = {}) {
  const decir = (...a) => { if (!silencioso) console.log(...a); };

  if (forzar) {
    db().exec('DELETE FROM adjuntos; DELETE FROM solicitudes; DELETE FROM autorizaciones; '
      + 'DELETE FROM personal; DELETE FROM usuarios; DELETE FROM credenciales_area; DELETE FROM pedidos_historico; '
      + 'DELETE FROM ordenes_compra; DELETE FROM productos; DELETE FROM requerimientos_compra_detalle; '
      + 'DELETE FROM ordenes_compra_detalle; DELETE FROM materia_prima_stock; DELETE FROM stock_valorizado; '
      + 'DELETE FROM metraje_almacen;');
    decir('Base vaciada.');
  }

  const yaHay = personal.total() > 0 || solicitudes.total() > 0;
  if (yaHay) {
    decir('La base ya tiene datos (' + personal.total() + ' personas, '
      + solicitudes.total() + ' servicios). Nada que sembrar.');

    // El padrón se refresca aparte del resto: si RR.HH. entrega un headcount
    // nuevo (altas, bajas, cambios de área), basta con reemplazar
    // data/padron.js y subir VERSION_DATOS -no hace falta --forzar, que
    // también borraría solicitudes e histórico-. Antes esto solo estaba
    // prometido en un comentario de data/padron.js sin código que lo
    // hiciera de verdad; ahora si la versión guardada no coincide, se
    // vuelve a cargar solo el padrón (cargarPadronOficial ya es un
    // reemplazo completo de los registros con origen 'padron', no un
    // agregado -ver backend/db/repos/personal.js-).
    const versionGuardada = ajustes.leer('version_datos', '');
    if (versionGuardada !== VERSION_DATOS) {
      const personas = personal.cargarPadronOficial(padronInicial());
      ajustes.escribir('version_datos', VERSION_DATOS);
      decir('Padrón actualizado a la versión ' + VERSION_DATOS + ': ' + personas + ' personas.');
    }
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

  // Órdenes de compra (registro SUNAT): carga aparte del resto -no depende de
  // `yaHay`- porque data/compras.js puede reemplazarse con un extracto más
  // reciente sin que eso sea un --forzar (que borraría todo lo demás). Solo se
  // reprocesan las 14 mil filas cuando la tabla está vacía o cuando el archivo
  // trae más comprobantes de los que ya hay en base; cargarInicial() de
  // cualquier forma es idempotente por numero_registro (ON CONFLICT DO
  // NOTHING).
  const filasCompras = comprasIniciales();
  if (ordenesCompra.total() < filasCompras.length) {
    const nuevasCompras = ordenesCompra.cargarInicial(filasCompras);
    if (nuevasCompras) {
      decir('Órdenes de compra cargadas: ' + nuevasCompras + ' comprobantes nuevos (' + RESUMEN_COMPRAS.desde
        + ' a ' + RESUMEN_COMPRAS.hasta + ', S/ ' + RESUMEN_COMPRAS.totalNeto.toFixed(2) + ' neto).');
    }
  }

  // Catálogo de productos: el stock cambia todo el tiempo, así que esto se
  // reprocesa siempre (cargarInicial hace UPSERT por código, no lo salta un
  // total() >= length como los otros).
  const filasProductos = productosIniciales();
  if (recargarSiCambio('productos', filasProductos, productos.total() > 0, forzar, f => productos.cargarInicial(f))) decir('Catálogo de productos actualizado: ' + RESUMEN_PRODUCTOS.productos + ' productos, '
    + RESUMEN_PRODUCTOS.conStock + ' con stock.');

  // Historial de requerimientos de compra del ERP: igual criterio que
  // ordenes_compra -no depende de `yaHay`, se reprocesa solo si trae filas
  // nuevas, cargarInicial es idempotente por `clave`-.
  const filasRqc = requerimientosHistoricoIniciales();
  if (requerimientosHistorico.total() < filasRqc.length) {
    const nuevosRqc = requerimientosHistorico.cargarInicial(filasRqc);
    if (nuevosRqc) {
      decir('Historial de requerimientos de compra cargado: ' + nuevosRqc + ' filas nuevas ('
        + RESUMEN_RQC.requerimientos + ' requerimientos, ' + RESUMEN_RQC.proveedores + ' proveedores).');
    }
  }

  // Historial de Órdenes de Compra del ERP: mismo criterio que los otros
  // historiales de solo lectura.
  const filasOcd = ordenesCompraDetalleIniciales();
  if (ordenesCompraDetalle.total() < filasOcd.length) {
    const nuevasOcd = ordenesCompraDetalle.cargarInicial(filasOcd);
    if (nuevasOcd) {
      decir('Historial de Órdenes de Compra cargado: ' + nuevasOcd + ' líneas nuevas ('
        + RESUMEN_OCD.ordenes + ' OC, ' + RESUMEN_OCD.proveedores + ' proveedores, '
        + RESUMEN_OCD.desde + ' a ' + RESUMEN_OCD.hasta + ').');
    }
  }

  // Stock valorizado de materia prima: es una FOTO a la fecha del reporte, no
  // un histórico -a diferencia de todo lo de arriba-, así que se reemplaza
  // entero en cada arranque (cargarInicial borra y vuelve a insertar).
  const filasMp = materiaPrimaStockInicial();
  if (recargarSiCambio('materia_prima', filasMp, materiaPrima.total() === filasMp.length, forzar, f => materiaPrima.cargarInicial(f))) decir('Stock de materia prima actualizado: ' + RESUMEN_MP.productos + ' productos, '
    + RESUMEN_MP.categorias + ' categorías, US$ ' + RESUMEN_MP.valorizadoUsd + ' valorizado.');

  // Stock valorizado completo (todos los tipos de producto, no solo materia
  // prima): mismo criterio de foto que el de arriba.
  const filasSv = stockValorizadoInicial();
  if (recargarSiCambio('stock_valorizado', filasSv, stockValorizado.total() === filasSv.length, forzar, f => stockValorizado.cargarInicial(f))) decir('Stock valorizado completo actualizado: ' + RESUMEN_SV.filas + ' filas, '
    + RESUMEN_SV.almacenes + ' almacenes, US$ ' + RESUMEN_SV.valorizadoUsd + ' valorizado.');

  // Metraje y costo del alquiler de Almacén Los Olivos: histórico de
  // METRAJE ALMACEN LOS OLIVOS.xlsx, cargado una sola vez por su clave
  // natural (tipo, fecha_desde, fecha_hasta) -no depende de `yaHay` ni se
  // vuelve a pisar si admin ya agregó/editó filas a mano-.
  const filasMetraje = metrajeAlmacenInicial();
  if (metrajeAlmacen.total() < filasMetraje.length) {
    const nuevasMetraje = metrajeAlmacen.cargarInicial(filasMetraje);
    if (nuevasMetraje) {
      decir('Metraje de Almacén Los Olivos cargado: ' + nuevasMetraje + ' filas nuevas ('
        + RESUMEN_METRAJE.desde + ' a ' + RESUMEN_METRAJE.hasta + ', ' + RESUMEN_METRAJE.pendientes + ' pendientes de validar).');
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
