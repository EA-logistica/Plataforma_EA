/**
 * Prueba de arranque del navegador. Se corre con:
 *
 *     node tests/frontend.mjs
 *
 * Levanta el servidor de verdad y ejecuta el grafo completo de módulos del
 * frontend contra un DOM simulado, apuntando `fetch` a ese servidor. Es la
 * prueba que atrapa lo que ninguna otra ve: una importación rota tras mover
 * carpetas, un id que ya no existe en el HTML, o una vista que quedó llamando
 * a la base local en vez de a la API.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// En Windows, import() con ruta absoluta necesita una URL file://.
const mod = p => import(pathToFileURL(path.join(RAIZ, p)).href);
const temporal = fs.mkdtempSync(path.join(os.tmpdir(), 'plansa-front-'));
process.env.PLANSA_DB = path.join(temporal, 'prueba.sqlite');
process.env.PLANSA_UPLOADS = path.join(temporal, 'uploads');

let fallos = 0;
const ok = (cond, msg) => { console.log((cond ? '  ok   ' : '  FALLA') + ' ' + msg); if (!cond) fallos++; };

// El correlativo del primer ticket nuevo sale del propio histórico, para que
// actualizar la planilla no obligue a retocar la prueba.
const { RESUMEN } = await mod('data/historico.js');
const NUM = RESUMEN.servicios + 1;
const TICKET = 'REQ-' + String(NUM).padStart(3, '0');

const { iniciar } = await import('../backend/servidor.js');
const servidor = iniciar({ puerto: 0, silencioso: true });
await new Promise(r => servidor.once('listening', r));
const BASE = 'http://127.0.0.1:' + servidor.address().port;

// La siembra ya creó una credencial para "Logistica" (el área real de
// 73012556) con una clave temporal al azar, que solo queda impresa en
// consola. Se le fija una conocida en texto plano para poder probar el
// ingreso de dos factores sin tener que pasar antes por el ingreso de admin.
const credencialesArea = await import('../backend/db/repos/credencialesArea.js');
const { hashClave } = await import('../backend/usuarios/claves.js');
const CLAVE_AREA_PRUEBA = 'ClaveDeArea1';
credencialesArea.cambiarClave('Logistica', hashClave(CLAVE_AREA_PRUEBA), { debeCambiar: false });

// --- fetch del navegador, apuntado al servidor de prueba ---
const fetchReal = globalThis.fetch;
globalThis.fetch = (ruta, init) =>
  fetchReal(String(ruta).startsWith('http') ? ruta : BASE + ruta, init);

// ----------------------------------------------------------- DOM simulado
const html = fs.readFileSync(path.join(RAIZ, 'frontend/index.html'), 'utf8');
const ids = [...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]);

function nuevoElemento(id = '') {
  const clases = new Set();
  const el = {
    id, value: '', textContent: '', innerHTML: '', min: '', max: '', step: '', disabled: false,
    dataset: {}, style: {}, children: [],
    classList: {
      add: (...c) => c.forEach(x => clases.add(x)),
      remove: (...c) => c.forEach(x => clases.delete(x)),
      toggle: (c, on) => { if (on === undefined) clases.has(c) ? clases.delete(c) : clases.add(c); else on ? clases.add(c) : clases.delete(c); },
      contains: c => clases.has(c)
    },
    setAttribute() {}, getAttribute: () => null, removeAttribute() {},
    addEventListener() {}, removeEventListener() {}, click() {}, focus() {}, blur() {},
    appendChild(h) { el.children.push(h); return h; }, removeChild() {}, remove() {},
    querySelectorAll: () => [], querySelector: () => null, closest: () => null, scrollIntoView() {}
  };
  return el;
}

const registro = new Map(ids.map(i => [i, nuevoElemento(i)]));
globalThis.document = {
  documentElement: nuevoElemento('html'),
  body: nuevoElemento('body'),
  getElementById: id => registro.get(id) || null,
  createElement: () => nuevoElemento(),
  querySelectorAll: () => [], querySelector: () => null, addEventListener() {}
};
globalThis.window = globalThis;
globalThis.scrollTo = () => {};
globalThis.open = () => null;
const almacen = new Map();
globalThis.localStorage = {
  getItem: k => (almacen.has(k) ? almacen.get(k) : null),
  setItem: (k, v) => almacen.set(k, String(v)),
  removeItem: k => almacen.delete(k)
};
const intervalos = [];
globalThis.setInterval = (fn, ms) => { intervalos.push(ms); return intervalos.length; };

const $ = id => registro.get(id);
const esperar = ms => new Promise(r => setTimeout(r, ms));

try {
  // -------------------------------------------------------------- arranque
  console.log('\n-- arranque --');
  try {
    await mod('frontend/js/main.js');
    ok(true, 'main.js carga el grafo completo de módulos sin errores');
  } catch (e) {
    ok(false, 'main.js falló al arrancar -> ' + e.message);
    console.log(e.stack);
    throw e;
  }
  await esperar(150);

  ok(typeof globalThis.entrarSolicitante === 'function', 'el puente window expone las funciones del HTML');
  ok($('dlDestinos').innerHTML.includes('<option'), 'los destinos frecuentes llegaron del servidor');
  ok(intervalos.includes(2500) && intervalos.includes(60000), 'quedan armados los dos relojes de la app');

  const bd = await mod('frontend/js/api/estado.js');
  ok(bd.DB.totalPersonal === 212, `del padrón llega el conteo, no las fichas (${bd.DB.totalPersonal})`);
  ok(!('personal' in bd.DB), 'el padrón completo no viaja al navegador');
  ok(Array.isArray(bd.DB.solicitudes) && bd.DB.solicitudes.length === 0,
     'sin sesión de logística, el historial NO viaja: llega vacío hasta que alguien se identifique');
  ok(!('usuarios' in bd.DB), 'las cuentas de logística no están en la copia del navegador');

  // ------------------------------------------------------- ingreso y flujo
  console.log('\n-- ingreso --');
  $('dniInput').value = '73012556';
  await globalThis.entrarSolicitante();
  ok($('areaStage').style.display === 'block' && $('dniStage').style.display === 'none',
     'un DNI del padrón pasa al segundo paso: pedir la credencial del área');
  ok($('areaNombre').textContent === 'Logistica', 'y muestra el área que detectó el DNI');

  $('areaUsuarioInput').value = 'logistica';
  $('areaClaveInput').value = CLAVE_AREA_PRUEBA;
  await globalThis.entrarSolicitanteArea();
  ok($('miNombre').textContent.includes('AVALOS'), 'con DNI + credencial de área, entra: ' + $('miNombre').textContent);

  $('fServicio').value = 'Envío de documentos';
  $('fOrigen').value = 'Plásticos Nacionales - Talleres';
  $('fMotivo').value = 'Entrega de facturas del mes';
  $('fDestino').value = bd.DB.destinos[0].nombre;
  $('fContacto').value = 'Mesa de partes';
  $('fTel').value = '987654321';
  $('fFecha').value = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  $('fHora').value = '10:00';
  globalThis.setAccion('Entregar');

  // Una ruta más en la misma programación: se agrega antes de enviar, junto
  // al resto del formulario, así el ticket que ya esperan las pruebas de más
  // abajo (TICKET) queda con ella, sin registrar uno aparte.
  globalThis.agregarParada();
  ok($('listaParadas').innerHTML.includes('Destino 2'), 'agregar una parada la pinta en el formulario');
  globalThis.editarParada(0, 'destino', 'CLIENTE DOS, AV. JAVIER PRADO 1200, SAN ISIDRO');
  globalThis.editarParada(0, 'contacto', 'Recepción');

  await globalThis.enviarSolicitud();
  ok($('okTitle').textContent === 'Ticket ' + TICKET + ' registrado',
     'la solicitud se guarda en SQLite y vuelve con su correlativo: ' + $('okTitle').textContent);
  ok($('listaParadas').innerHTML === '', 'y el formulario de paradas queda limpio para la próxima');

  // Consultar un ticket por id ya no es público: se verifica por la misma vía
  // de verdad que usa "Mis servicios", /solicitudes/mias, con la sesión de área.
  const ss = await mod('frontend/js/state/sessionState.js');
  const mias = await (await fetch('/api/solicitudes/mias', {
    headers: { Authorization: 'Bearer ' + ss.sesion.token }
  })).json();
  const guardada = mias.solicitudes.find(s => s.id === TICKET);
  ok(guardada && guardada.motivo === 'Entrega de facturas del mes', 'y está de verdad en la base, no solo en pantalla');
  ok(guardada.paradas.length === 1 && guardada.paradas[0].contacto === 'Recepción',
     'con la parada adicional que se cargó en el formulario');

  $('qTicket').value = String(NUM);
  globalThis.consultarTicket();
  ok($('resTicket').innerHTML.includes(TICKET), 'el seguimiento por número la encuentra');
  globalThis.salir();

  // ------------------------------------------------------------- logística
  console.log('\n-- logística --');
  $('userInput').value = 'admin';
  $('pinInput').value = 'noesla';
  await globalThis.entrarAdmin();
  ok(!$('viewAdmin').classList.contains('on'), 'una clave incorrecta no abre la vista');

  $('pinInput').value = 'admin';
  await globalThis.entrarAdmin();
  ok($('viewAdmin').classList.contains('on'), 'el usuario y clave sembrados sí, y se comprueban en el servidor');
  ok(Number($('cntBandeja').textContent) === 1, 'la bandeja muestra el ticket recién registrado');
  globalThis.cerrarModal();   // el aviso de "clave temporal" que abre solo el primer ingreso

  console.log('\n-- usuarios de logística --');
  ok($('tabUsuarios').style.display !== 'none', 'admin sí ve la pestaña de usuarios');
  globalThis.tabAdmin('usuarios');
  ok($('aUsuarios').classList.contains('on'), 'y puede abrirla');
  await globalThis.renderUsuarios();
  ok($('tbUsuarios').innerHTML.includes('admin'), 'la cuenta admin aparece en el listado');

  await globalThis.setVehiculo(TICKET, 'Motorizado');
  await globalThis.setCosto(TICKET, '25');
  await globalThis.avanzar(TICKET);
  // Consultar un ticket suelto por id ya pide sesión de logística: se
  // confirma con la copia local, que solo se actualiza cuando el servidor
  // confirma el cambio (nunca al revés), así que sigue probando lo mismo.
  const enRuta = bd.DB.solicitudes.find(s => s.id === TICKET);
  ok(enRuta.estado === 'En tránsito' && enRuta.vehiculo === 'Motorizado',
     'asignar transporte y avanzar quedó guardado en la base');

  $('qPadron').value = 'avalos';
  await globalThis.renderPadron();
  ok($('tbPadron').innerHTML.includes('AVALOS VALDIVIA'), 'el padrón se busca por apellido, contra el servidor');
  $('qPadron').value = '';
  await globalThis.renderPadron();
  ok(!$('tbPadron').innerHTML.includes('AVALOS'), 'y sin búsqueda no lista a nadie');
  ok(Number($('cntPadron').textContent) === 212, `el conteo del padrón sale del servidor (${$('cntPadron').textContent})`);

  // -------------------------------------------------------------- histórico
  console.log('\n-- histórico --');
  $('qHist').value = ''; $('histTicket').value = ''; $('histDestino').value = '';
  $('histDesde').value = ''; $('histHasta').value = '';
  globalThis.filtrarHistorico();
  const filas = () => ($('tHist').innerHTML.match(/<tr>/g) || []).length - 1;   // menos la cabecera
  ok(filas() === 20, `pagina de a 20, no vuelca las ${RESUMEN.servicios + 1} filas de golpe: pinta ${filas()}`);
  ok($('tHist').innerHTML.includes('Mostrando 1–20 de ' + (RESUMEN.servicios + 1)),
     'y dice cuántas está mostrando de cuántas');
  ok(Number($('cntHist').textContent) === RESUMEN.servicios + 1, 'el contador sigue diciendo el total de verdad');

  globalThis.irPaginaHistorico(2);
  ok($('tHist').innerHTML.includes('Mostrando 21–40 de ' + (RESUMEN.servicios + 1)), 'la página siguiente trae las 20 que siguen');

  $('qHist').value = '73012556';
  globalThis.filtrarHistorico();
  ok($('tHist').innerHTML.includes('AVALOS'), 'el filtro de persona/DNI encuentra por documento');
  ok($('tHist').innerHTML.includes('Mostrando 1–'), 'y un filtro nuevo vuelve a la página 1');

  $('qHist').value = ''; $('histTicket').value = TICKET;
  globalThis.filtrarHistorico();
  ok(filas() === 1 && $('tHist').innerHTML.includes(TICKET), 'el filtro de ticket encuentra por número de ticket');

  $('histTicket').value = ''; $('histDestino').value = bd.DB.destinos[0].nombre.slice(0, 12);
  globalThis.filtrarHistorico();
  ok(filas() > 0, 'el filtro de destino encuentra coincidencias');

  globalThis.limpiarFiltrosHistorico();
  ok(filas() === 20 && $('qHist').value === '' && $('histTicket').value === '' && $('histDestino').value === '',
     'limpiar filtros vuelve al listado completo, página 1');

  globalThis.abrirExportarExcel();
  ok($('modalBody').innerHTML.includes('expDesde') && $('modalBody').innerHTML.includes('expHasta'),
     'el modal de exportar a Excel pide un rango de fechas');
  globalThis.cerrarModal();
  // La descarga en sí (fetch + Blob + URL.createObjectURL) se prueba contra el
  // servidor real en tests/api.mjs: ese lado no tiene sentido simularlo aquí.

  // --------------------------------------------------------------- payback
  console.log('\n-- payback --');
  globalThis.tabAdmin('payback');
  const pb = $('pbCuerpo').innerHTML;
  ok(pb.length > 2000, 'el módulo payback se pinta');
  ok(/Escenario recomendado/.test(pb) && /Simulador de una salida/.test(pb),
     'con el escenario recomendado y el simulador');
  ok(!/undefined|NaN|\[object/.test(pb), 'sin valores rotos');

} finally {
  servidor.close();
  const { cerrar } = await import('../backend/db/conexion.js');
  cerrar();
  fs.rmSync(temporal, { recursive: true, force: true });
}

console.log(fallos ? `\n${fallos} comprobación(es) fallaron` : '\nTodo en verde');
process.exit(fallos ? 1 : 0);
