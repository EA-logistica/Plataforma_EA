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

// El correlativo del primer ticket nuevo sale del propio histórico, y el
// total del padrón de su propia fuente: al actualizar la planilla o el
// headcount, la prueba sigue valiendo sin tocar un número a mano.
const { RESUMEN } = await mod('data/historico.js');
const NUM = RESUMEN.servicios + 1;
const TICKET = 'REQ-' + String(NUM).padStart(3, '0');
const { PERSONAL } = await mod('data/padron.js');
const TOTAL_PADRON = PERSONAL.length;

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
// Con cookie jar propia: el fetch de Node (a diferencia del de un navegador
// real) no guarda ni reenvía cookies solo, y el módulo de Almacén depende
// justo de eso (ver frontend/js/views/almacen.js: canjea el ticket con un
// fetch y confía en que la cookie httpOnly quede puesta para el siguiente).
const fetchReal = globalThis.fetch;
// Clave por Path además de por nombre: dos cookies con el mismo nombre pero
// distinto Path (como pasa justo al canjear el ticket de Almacén, que limpia
// una cookie vieja de /almacen mientras pone la nueva en /) son cosas
// DISTINTAS para un navegador real, no una pisa a la otra.
const cookieJar = new Map(); // `${path}\u0000${nombre}` -> {nombre, valor, ruta}
function guardarCookies(res) {
  const crudas = typeof res.headers.getSetCookie === 'function'
    ? res.headers.getSetCookie()
    : (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')] : []);
  for (const cruda of crudas) {
    const partes = cruda.split(';').map(p => p.trim());
    const [nombre, valor] = partes[0].split('=');
    const pathAttr = partes.find(p => /^path=/i.test(p));
    const ruta = pathAttr ? pathAttr.slice(5) : '/';
    const maxAgeAttr = partes.find(p => /^max-age=/i.test(p));
    const clave = ruta + '\u0000' + nombre;
    if (maxAgeAttr && Number(maxAgeAttr.slice(8)) <= 0) { cookieJar.delete(clave); continue; }
    cookieJar.set(clave, { nombre, valor, ruta });
  }
}
function cookiesParaRuta(rutaPedida) {
  return [...cookieJar.values()]
    .filter(c => c.ruta === '/' || rutaPedida === c.ruta || rutaPedida.startsWith(c.ruta.replace(/\/$/, '') + '/'))
    .sort((a, b) => b.ruta.length - a.ruta.length) // más específico primero, como en un navegador real
    .map(c => `${c.nombre}=${c.valor}`).join('; ');
}
// Node sigue los redirects él solo, pero al hacerlo no aplica el Set-Cookie
// del salto intermedio -a diferencia de un navegador de verdad-, y el canje
// del ticket de Almacén es justo un 302 con Set-Cookie. Se sigue el redirect
// a mano acá para que la cookie quede guardada en cada salto, como pasaría
// en un navegador real.
async function fetchConCookies(url, init) {
  let destino = url;
  let opciones = init;
  for (let saltos = 0; saltos < 5; saltos++) {
    const cabeceras = { ...(opciones && opciones.headers) };
    const pathname = new URL(destino).pathname;
    const cookies = cookiesParaRuta(pathname);
    if (cookies && !cabeceras.Cookie && !cabeceras.cookie) cabeceras.Cookie = cookies;
    const res = await fetchReal(destino, { ...opciones, headers: cabeceras, redirect: 'manual' });
    guardarCookies(res);
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      destino = new URL(res.headers.get('location'), destino).href;
      opciones = { method: 'GET' };
      continue;
    }
    return res;
  }
  throw new Error('Demasiados redirects siguiendo ' + url);
}
globalThis.fetch = (ruta, init) => fetchConCookies(String(ruta).startsWith('http') ? ruta : BASE + ruta, init);

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
// Aparte de localStorage: la sesión se guarda en sessionStorage (sobrevive un
// F5, no un cierre de pestaña ni de navegador -ver state/sessionState.js-).
const almacenSesion = new Map();
globalThis.sessionStorage = {
  getItem: k => (almacenSesion.has(k) ? almacenSesion.get(k) : null),
  setItem: (k, v) => almacenSesion.set(k, String(v)),
  removeItem: k => almacenSesion.delete(k)
};
const intervalos = [];
globalThis.setInterval = (fn, ms) => { intervalos.push(ms); return intervalos.length; };

const $ = id => registro.get(id);
const esperar = ms => new Promise(r => setTimeout(r, ms));
const { esc } = await mod('frontend/js/utils/dom.js');

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
  ok(bd.DB.totalPersonal === TOTAL_PADRON, `del padrón llega el conteo, no las fichas (${bd.DB.totalPersonal})`);
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

  console.log('\n-- sesión que sobrevive un F5 --');
  const authMod = await mod('frontend/js/auth.js');
  const sessionMod = await mod('frontend/js/state/sessionState.js');
  ok(sessionMod.leerSesionGuardada()?.tipo === 'admin', 'entrar como admin ya la dejó guardada en sessionStorage');

  // Un F5 de verdad recarga todo el JS, pero sessionStorage sigue ahí -eso es
  // justo lo que hay que probar-: se llama restaurarSesion() otra vez, como
  // haría main.js al arrancar de nuevo, sin haber pasado por el login.
  $('viewAdmin').classList.remove('on');
  const restaurada = await authMod.restaurarSesion();
  ok(restaurada === true && $('viewAdmin').classList.contains('on'),
     'restaurarSesion() la recupera y abre la vista de logística sin pasar por el login');

  const guardadaOriginal = sessionMod.leerSesionGuardada();
  sessionStorage.setItem('pn_mensajeria_sesion', JSON.stringify({ ...guardadaOriginal, token: 'no-existe-en-el-servidor' }));
  $('viewAdmin').classList.remove('on');
  const conTokenVencido = await authMod.restaurarSesion();
  ok(conTokenVencido === false && !$('viewAdmin').classList.contains('on'),
     'pero un token que el servidor ya no reconoce -vencido, o el servidor se reinició- cae en silencio al login, no rompe la pantalla');

  // Se deja la sesión real (no la del token inventado) para lo que sigue.
  sessionStorage.setItem('pn_mensajeria_sesion', JSON.stringify(guardadaOriginal));
  await authMod.restaurarSesion();

  console.log('\n-- usuarios de logística --');
  ok($('btnMenuUsuarios').style.display !== 'none', 'admin sí ve "Usuarios" en el menú de la cuenta');
  ok($('btnMenuPadron').style.display !== 'none', 'y también "Padrón y accesos"');
  globalThis.alternarMenuCuenta();
  ok($('cuentaPopover').classList.contains('on'), 'el menú de la cuenta se abre al hacer clic en el nombre');
  globalThis.tabAdmin('usuarios');
  ok(!$('cuentaPopover').classList.contains('on'), 'y elegir una opción lo cierra solo');
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

  console.log('\n-- bandeja: concluidos/cancelados solo se ven el mismo día --');
  ok(!$('fBandeja').innerHTML.includes('Todos'), 'sin pestaña "Todos": ya se repite en Histórico');
  await globalThis.avanzar(TICKET); // En tránsito -> Concluido
  globalThis.tabAdmin('bandeja');
  globalThis.setFiltroBandeja('Concluido');
  ok($('tBandeja').innerHTML.includes(TICKET), 'recién concluido hoy, todavía aparece en la Bandeja');
  const concluidosConHoy = ($('fBandeja').innerHTML.match(/Concluidos \((\d+)\)/) || [])[1];

  // Se lo "concluye ayer" directo en la base -sin pasar por avanzar(), que
  // pondría la hora de ahora- para probar la regla sin esperar un día real.
  const { db } = await import('../backend/db/conexion.js');
  const ayer = new Date(Date.now() - 86400000).toISOString();
  db().prepare("UPDATE solicitudes SET ts_concluido = ? WHERE id = ?").run(ayer, TICKET);
  await bd.cargar();
  globalThis.renderBandeja();
  ok(!$('tBandeja').innerHTML.includes(TICKET),
     'concluido AYER ya no aparece en la Bandeja -vive en el Histórico-');
  const concluidosSinAyer = ($('fBandeja').innerHTML.match(/Concluidos \((\d+)\)/) || [])[1];
  ok(Number(concluidosSinAyer) === Number(concluidosConHoy) - 1,
     'y ya no cuenta en "Concluidos" tampoco');

  $('qPadron').value = 'avalos';
  await globalThis.renderPadron();
  ok($('tbPadron').innerHTML.includes('AVALOS VALDIVIA'), 'el padrón se busca por apellido, contra el servidor');
  $('qPadron').value = '';
  await globalThis.renderPadron();
  ok(!$('tbPadron').innerHTML.includes('AVALOS'), 'y sin búsqueda no lista a nadie');
  ok(Number($('cntPadron').textContent) === TOTAL_PADRON, `el conteo del padrón sale del servidor (${$('cntPadron').textContent})`);

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

  $('qHist').value = ''; $('histDestino').value = ''; $('histTicket').value = TICKET;
  globalThis.filtrarHistorico();
  const metrTicket = $('histMetricsWrap').innerHTML;
  ok(/<div class="v">1<\/div>/.test(metrTicket) && /Según el filtro aplicado/.test(metrTicket),
     'las métricas de arriba se recalculan sobre el filtro, no sobre todo el histórico');

  globalThis.limpiarFiltrosHistorico();
  ok(filas() === 20 && $('qHist').value === '' && $('histTicket').value === '' && $('histDestino').value === '',
     'limpiar filtros vuelve al listado completo, página 1');
  ok($('histMetricsWrap').innerHTML.includes('Todo el histórico'),
     'y las métricas vuelven a ser las del histórico completo');

  globalThis.abrirExportarExcel();
  ok($('modalBody').innerHTML.includes('expDesde') && $('modalBody').innerHTML.includes('expHasta'),
     'el modal de exportar a Excel pide un rango de fechas');
  globalThis.cerrarModal();
  // La descarga en sí (fetch + Blob + URL.createObjectURL) se prueba contra el
  // servidor real en tests/api.mjs: ese lado no tiene sentido simularlo aquí.

  // ------------------------------------------------------------ indicadores
  // "Indicadores" ya no es una pestaña aparte: es una sub-pestaña dentro de
  // "Histórico" (ver frontend/js/state/historicoSubtab.js).
  console.log('\n-- indicadores --');
  globalThis.tabAdmin('historico');
  globalThis.subtabHistorico('indicadores');
  ok($('aHistorico').classList.contains('on') && $('histPanelIndicadores').style.display !== 'none',
     'la sub-pestaña de indicadores abre dentro de Histórico');
  const totalSinFiltro = Number($('kpiCards').innerHTML.match(/<div class="v">([\d.,]+)<\/div>/)[1].replace(/,/g, ''));
  ok(totalSinFiltro > 0, `sin búsqueda, muestra los viajes totales del rango (${totalSinFiltro})`);

  globalThis.setQKpi('73012556');
  ok($('kpiRango').textContent.includes('filtrado por "73012556"'), 'buscar por DNI se refleja en el rótulo del rango');
  const totalConFiltro = Number($('kpiCards').innerHTML.match(/<div class="v">([\d.,]+)<\/div>/)[1].replace(/,/g, ''));
  ok(totalConFiltro > 0 && totalConFiltro < totalSinFiltro,
     `y acota los indicadores a esa persona, no a todo el rango (${totalConFiltro} de ${totalSinFiltro})`);

  globalThis.limpiarFiltroKpi();
  ok($('qKpi').value === '' && !$('kpiRango').textContent.includes('filtrado por'),
     'limpiar la búsqueda vuelve a los indicadores del rango completo');

  // --------------------------------------------------------------- payback
  console.log('\n-- payback --');
  globalThis.tabAdmin('payback');
  const pb = $('pbCuerpo').innerHTML;
  ok(pb.length > 2000, 'el módulo payback se pinta');
  ok(/Escenario recomendado/.test(pb) && /Simulador de una salida/.test(pb),
     'con el escenario recomendado y el simulador');
  ok(!/undefined|NaN|\[object/.test(pb), 'sin valores rotos');

  // Regresión: setAsignacionPayback existía pero nunca se expuso en window ni
  // tenía control en el HTML -el campo quedaba imposible de tocar-.
  ok(pb.includes('id="pbAsignacion"') && pb.includes('setAsignacionPayback'),
     'el campo de asignación familiar está en pantalla y conectado');
  ok(typeof globalThis.setAsignacionPayback === 'function',
     'y setAsignacionPayback sí llegó al puente de window (antes faltaba)');
  globalThis.setAsignacionPayback('150');
  ok($('pbCuerpo').innerHTML.includes('id="pbAsignacion" type="number" min="0" step="0.5" value="150"'),
     'cambiar el valor se refleja en el propio campo tras repintar');

  // ---------------------------------------------- compras y logística (sidebar)
  console.log('\n-- compras y logística (nueva sección del sidebar) --');
  ok($('navCompras').style.display !== 'none', 'admin sí ve el grupo "Compras y Logística" del menú');
  globalThis.alternarMenu();
  ok($('adminNav').classList.contains('abierto') && $('navScrim').classList.contains('on') && $('adminNav').inert === false,
     'el botón de arriba a la izquierda abre el menú desplegable');
  globalThis.tabAdmin('bandeja');
  ok(!$('adminNav').classList.contains('abierto') && $('adminNav').inert === true,
     'elegir una sección lo cierra solo, y cerrado no recibe foco (inert)');
  const auth = { Authorization: 'Bearer ' + ss.sesion.token, 'Content-Type': 'application/json' };

  await fetch('/api/exportaciones', { method: 'POST', headers: auth, body: JSON.stringify({
    fechaEnvio: '2026-09-20', oc: 'OC-9001', descripcion: 'Muestra de resina PP', paisDestino: 'China', costoEnvio: 350
  }) });
  globalThis.tabAdmin('exportaciones');
  ok($('aExportaciones').classList.contains('on'), 'la pestaña de exportaciones abre');
  await globalThis.renderExportaciones();
  ok($('tExportaciones').innerHTML.includes('China') && $('tExportaciones').innerHTML.includes('OC-9001'),
     'y pinta el envío recién creado, con país destino y OC');
  ok(/Envíos registrados/.test($('expMetrics').innerHTML), 'con sus indicadores arriba');

  await fetch('/api/requerimientos-compra', { method: 'POST', headers: auth, body: JSON.stringify({
    fechaSolicitud: '2026-09-20', areaSolicitante: 'Producción', descripcion: 'Resina PE para soplado',
    categoria: 'Materia prima importada', cantidad: 20000, unidadMedida: 'kg'
  }) });
  globalThis.tabAdmin('requerimientos');
  ok($('aRequerimientos').classList.contains('on'), 'la pestaña de requerimientos de compra abre');
  await globalThis.renderRequerimientos();
  ok($('tRequerimientos').innerHTML.includes('Resina PE para soplado'),
     'y pinta el requerimiento recién creado');
  ok(/Requerimientos totales/.test($('reqMetrics').innerHTML), 'con sus indicadores arriba');

  await fetch('/api/servicios-logistica', { method: 'POST', headers: auth, body: JSON.stringify({
    fechaSolicitud: '2026-09-20', tipoServicio: 'Agenciamiento de aduana', proveedor: 'Agencia XYZ',
    descripcion: 'Desaduanaje de contenedor de resina PP', costo: 1200, moneda: 'USD'
  }) });
  globalThis.tabAdmin('servicios');
  ok($('aServiciosLogistica').classList.contains('on'), 'la pestaña de servicios abre');
  await globalThis.renderServiciosLogistica();
  ok($('tServiciosLogistica').innerHTML.includes('Agencia XYZ'), 'y pinta el servicio recién creado');

  console.log('\n-- Proveedores --');
  globalThis.tabAdmin('proveedores');
  ok($('aProveedores').classList.contains('on'), 'la pestaña de proveedores abre');
  await globalThis.renderProveedores();
  const panoramaProv = $('provCuerpo').innerHTML;
  ok(((panoramaProv.match(/prov-rank-row/g) || []).length) >= 2 && panoramaProv.includes('Top proveedores'),
     'sin elegir proveedor, muestra el top por SUNAT y por historial de OC');
  ok(/Concentración top 5/.test(panoramaProv) && /del total/.test(panoramaProv),
     'el panorama explica la concentración y la participación de cada uno');
  ok(!/undefined|NaN|\[object/.test(panoramaProv), 'sin valores rotos en el panorama');

  // El buscador reemplaza al <select> gigante: sugiere en el navegador, con RUC y monto.
  const desEsc = s => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  const sugeridos = await globalThis.buscarProveedorSeccion('');
  const enCaja = [...$('provSugerencias').innerHTML.matchAll(/data-prov="([^"]+)"/g)].map(m => desEsc(m[1]));
  ok(sugeridos.length > 0 && enCaja.length === sugeridos.length && $('provSugerencias').classList.contains('on'),
     'el buscador trae proveedores de verdad, no vacío (' + sugeridos.length + ' sugeridos)');
  const elegido = sugeridos[0];
  const fragmento = elegido.split(/\s+/)[0].toLowerCase();
  const porNombre = await globalThis.buscarProveedorSeccion(fragmento);
  ok(porNombre.includes(elegido), 'buscar por parte del nombre (sin importar mayúsculas) lo encuentra: "' + fragmento + '"');
  ok((await globalThis.buscarProveedorSeccion('zzqq-no-existe')).length === 0 && $('provSugerencias').innerHTML.includes('Ningún proveedor coincide'),
     'una búsqueda sin coincidencias lo dice, no deja la lista vacía');

  await globalThis.elegirProveedorSeccion(elegido);
  const cuerpoProv = $('provCuerpo').innerHTML;
  ok(cuerpoProv.includes(esc(elegido).slice(0, 20)), 'elegir uno pinta su propio detalle');
  ok(/Primera compra/.test(cuerpoProv) && /Ticket promedio/.test(cuerpoProv) && /Facturado por mes/.test(cuerpoProv),
     'la ficha trae primera/última compra, ticket promedio y la evolución mensual');
  ok(/irARegistroDeProveedor|irAOCDeProveedor/.test(cuerpoProv), 'y los atajos a Registro de compras / Historial de OC');
  ok(!/undefined|NaN|\[object/.test(cuerpoProv), 'sin valores rotos en el detalle del proveedor');
  await globalThis.elegirProveedorSeccion('');
  ok($('provCuerpo').innerHTML.includes('Top proveedores'), 'volver al top no se queda pegado en el detalle');

  // Regresión: esc(nombre).replace(/'/g, '&#39;') dentro de onclick="…('…')"
  // se decodifica de vuelta a ' antes de llegar a JS, y un proveedor como
  // "'NEGOCIACION KIO' SAC" rompía el clic. Todo onclick generado debe compilar.
  const onclicks = html => [...html.matchAll(/onclick="([^"]*)"/g)].map(m => desEsc(m[1]));
  const compila = code => { try { new Function(code); return true; } catch (e) { return false; } };
  const conComilla = sugeridos.length && (await globalThis.buscarProveedorSeccion("'"))[0];
  if (conComilla) {
    await globalThis.elegirProveedorSeccion(conComilla);
    ok(onclicks($('provCuerpo').innerHTML).every(compila), 'con un proveedor con comillas en el nombre, sus botones siguen funcionando');
    await globalThis.elegirProveedorSeccion('');
  }
  globalThis.tabAdmin('ordenesCompra');
  await globalThis.elegirProveedorOrdenesCompra(conComilla || elegido);
  await globalThis.elegirProveedorOC(conComilla || elegido);
  ok($('ocProveedor').value === (conComilla || elegido) && $('ocdProveedor').value === (conComilla || elegido),
     'el atajo desde Proveedores deja el filtro puesto en ambas tablas, aunque la pestaña recién abra');
  ok([$('ocProveedores').innerHTML, $('ocdProveedores').innerHTML, $('tOC').innerHTML].every(h => onclicks(h).every(compila)),
     'los onclick de Registro de compras / Historial de OC compilan (nombres con comillas incluidos)');

  console.log('\n-- Materia Prima --');
  globalThis.tabAdmin('materiaPrima');
  await globalThis.renderMateriaPrima();
  ok(/Valorizado total/.test($('mpMetrics').innerHTML) && /Concentración/.test($('mpMetrics').innerHTML),
     'tarjetas: valorizado, productos, cantidad, almacenes y concentración');
  ok($('mpNivel').innerHTML.includes('ordenarMateriaPrima') && $('mpNivel').innerHTML.includes('% del nivel'),
     'las categorías salen en tabla ordenable con su participación');
  ok($('mpBreadcrumb').innerHTML.includes('Paso 1 de 3'), 'la miga de pan explica en qué paso se está');
  globalThis.filaMateriaPrima('cat', 0);
  await esperar(200);
  ok($('mpBreadcrumb').innerHTML.includes('Paso 2 de 3') && $('mpNivel').innerHTML.includes('Línea (familia)'),
     'clic en una categoría baja a sus líneas');
  globalThis.ordenarMateriaPrima('lin', 'nombre');
  ok($('mpNivel').innerHTML.includes('aria-sort="ascending"'), 'clic en un encabezado reordena la tabla');
  globalThis.filaMateriaPrima('lin', 0);
  await esperar(200);
  ok($('mpBreadcrumb').innerHTML.includes('Paso 3 de 3') && $('mpNivel').innerHTML.includes('Costo prom.'),
     'y de la línea, a sus productos');
  ok(!/undefined|NaN|\[object/.test($('mpNivel').innerHTML + $('mpMetrics').innerHTML + $('mpAlmacenes').innerHTML),
     'sin valores rotos en Materia Prima');
  // Regresión: la categoría OTROS existe en ambos tipos; sus líneas no deben mezclarlos.
  const tiposMp = await (await fetch('/api/materia-prima/tipos', { headers: auth })).json();
  if (tiposMp.length > 1) {
    const t = tiposMp[tiposMp.length - 1].tipo;
    const cats = await (await fetch('/api/materia-prima/categorias?tipo=' + encodeURIComponent(t), { headers: auth })).json();
    const c = cats[0];
    const lineas = await (await fetch('/api/materia-prima/categorias/' + encodeURIComponent(c.categoria) + '/lineas?tipo=' + encodeURIComponent(t), { headers: auth })).json();
    const suma = lineas.reduce((a, l) => a + l.valorizadoUsd, 0);
    ok(Math.abs(suma - c.valorizadoUsd) < 0.01, 'las líneas de una categoría suman lo mismo que la categoría dentro de su tipo (no mezclan tipos)');
  }

  console.log('\n-- Control de Almacenes (mapa/radar/plano, pestañas nativas) --');
  const almacenVista = await mod('frontend/js/views/almacen.js');
  ok((await fetch(BASE + '/almacen/api/almacenes')).status === 401,
     'antes de abrir la pestaña, la sesión de Almacén todavía no existe');
  globalThis.tabAdmin('almacen');
  ok($('aAlmacen').classList.contains('on'), 'la pestaña "Control de Almacenes" abre');
  await almacenVista.abrirAlmacen();
  ok((await fetch(BASE + '/almacen/api/almacenes')).status === 200,
     'al abrirla, se canjea un ticket por su cuenta -sin mostrar ningún shell aparte- y la cookie queda puesta');
  ok($('almacenFrames').children.length === 1, 'crea el iframe del primer sub-módulo (mapa) dentro de la propia pestaña');

  await globalThis.verModuloAlmacen('radar');
  ok($('almacenFrames').children.length === 2, 'cambiar a "Radar Naranjal" crea su iframe, sin recrear el del mapa');
  await globalThis.verModuloAlmacen('mapa');
  ok($('almacenFrames').children.length === 2, 'y volver al mapa reutiliza el que ya existía, no crea uno nuevo');

} finally {
  servidor.close();
  const { cerrar } = await import('../backend/db/conexion.js');
  cerrar();
  fs.rmSync(temporal, { recursive: true, force: true });
}

console.log(fallos ? `\n${fallos} comprobación(es) fallaron` : '\nTodo en verde');
process.exit(fallos ? 1 : 0);
