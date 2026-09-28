import { $ } from './utils/dom.js';
import { hoyISO } from './utils/format.js';
import { toast } from './utils/toast.js';
import { pedirAutorizacion as apiPedirAutorizacion, ingresarLogistica, salirLogistica,
         cambiarMiClave, buscarEnPadron, cargar, cargarMiArea, limpiarDatosPrivados,
         ingresarPorArea, salirArea, cambiarMiClaveArea, confirmarSesionLogistica } from './api/estado.js';
import { setSesion, sesion, leerSesionGuardada } from './state/sessionState.js';
import { normalizarDoc, DOC_VALIDO } from '#shared/documento.js';
import { tabUser, tabAdmin, aplicarPermisosAdmin } from './views/tabs.js';
import { toggleOrigen, refrescarHoras, resetAccion, limpiarParadas } from './views/requestForm.js';
import { renderMis } from './views/tickets.js';
import { abrirModal, cerrarModal } from './views/dispatch.js';
import { cerrarAccesoLogistica } from './ui/logisticaPopover.js';
import { renderTodo } from './render.js';

/**
 * Inicio de sesión (solicitante por DNI + credencial de área / logística por
 * PIN), pedidos de autorización y apertura/cierre de las vistas principales.
 */

/** Ficha que devolvió el padrón para el DNI del primer paso, mientras se pide la credencial del área. */
let pendienteArea = null;

export async function entrarSolicitante() {
  // El documento se normaliza antes de validar: quien tenga el DNI con 7
  // dígitos (porque el sistema de RR.HH. recortó el cero inicial) entra
  // igual, lo escriba con cero o sin él.
  const dni = normalizarDoc($('dniInput').value);
  const box = $('loginAlert');
  box.classList.remove('on', 'ok');
  $('loginAlertActions').style.display = 'none';

  if (!DOC_VALIDO.test(dni)) {
    $('loginAlertTitle').textContent = 'Documento incompleto';
    $('loginAlertMsg').textContent = 'Escribe los 8 dígitos de tu DNI (9 si usas carné de extranjería).';
    box.classList.add('on');
    return;
  }
  // La ficha la busca el servidor: el navegador no tiene el padrón. Esto solo
  // detecta el área -primer factor-; el segundo (la credencial de esa área)
  // se pide recién en el paso siguiente.
  let p;
  try {
    p = await buscarEnPadron(dni);
  } catch (e) {
    if (e.status !== 404) {
      $('loginAlertTitle').textContent = 'No se pudo verificar el documento';
      $('loginAlertMsg').textContent = e.message;
      box.classList.add('on');
      return;
    }
    $('loginAlertTitle').textContent = 'Acceso denegado. Solicitar autorización a Logística';
    $('loginAlertMsg').textContent = 'El documento ' + dni + ' no figura en la base de personal de Plásticos Nacionales, así que no es posible registrar solicitudes con este DNI.';
    $('loginAlertActions').style.display = 'block';
    $('eAutorizacion').classList.remove('on');
    box.classList.add('on');
    return;
  }
  pendienteArea = p;
  $('dniStage').style.display = 'none';
  $('areaStage').style.display = 'block';
  $('areaNombre').textContent = p.area;
  $('areaUsuarioInput').value = '';
  $('areaClaveInput').value = '';
  $('areaErr').classList.remove('on');
  $('areaUsuarioInput').focus();
}

/** Vuelve al primer paso (DNI): para probar con otro documento o si el área detectada no es la esperada. */
export function volverAlDni() {
  pendienteArea = null;
  $('areaStage').style.display = 'none';
  $('dniStage').style.display = 'block';
  $('loginAlert').classList.remove('on', 'ok');
}

/** Segundo paso: usuario y clave del área que detectó el DNI. */
export async function entrarSolicitanteArea() {
  if (!pendienteArea) return volverAlDni();
  const usuario = $('areaUsuarioInput').value || '';
  const clave = $('areaClaveInput').value || '';
  let r;
  try {
    r = await ingresarPorArea(pendienteArea.dni, usuario, clave);
  } catch (e) {
    $('areaErr').textContent = e.status === 401 ? 'Usuario o clave de área incorrectos.' : e.message;
    $('areaErr').classList.add('on');
    return;
  }
  $('areaErr').classList.remove('on');
  setSesion({
    tipo: 'user', dni: r.dni, nombre: r.nombre, cargo: r.cargo, area: r.area,
    token: r.token, debeCambiarClave: r.debeCambiarClave
  });
  pendienteArea = null;
  // Los servicios del área se piden aparte, ya con el token recién obtenido.
  // Si falla (sin red), igual se entra: se ve "Mis servicios" vacío en vez de
  // trabarse en el ingreso.
  try { await cargarMiArea(); } catch (e) { /* se reintenta en el próximo sondeo */ }
  abrirVista('user');
  // Con clave temporal (recién creada o restablecida por admin) no se deja
  // trabajar hasta que el área la cambie por una propia.
  if (r.debeCambiarClave) abrirCambioClave(true);
}

export async function pedirAutorizacion() {
  const dni = normalizarDoc($('dniInput').value);
  if (!DOC_VALIDO.test(dni)) return;

  const datos = {
    apellidos: $('autApellidos').value.trim(),
    nombres: $('autNombres').value.trim(),
    celular: $('autCelular').value.replace(/\D/g, ''),
    email: $('autEmail').value.trim(),
    area: $('autArea').value.trim()
  };
  // El servidor valida igual (nunca se confía solo en el navegador), pero
  // avisar acá evita el viaje de red por un campo vacío obvio.
  if (datos.apellidos.length < 2 || datos.nombres.length < 2
      || datos.celular.length < 9 || datos.celular.length > 11) {
    $('eAutorizacion').classList.add('on');
    return;
  }
  $('eAutorizacion').classList.remove('on');

  let r;
  try {
    r = await apiPedirAutorizacion(dni, datos);
  } catch (e) {
    toast('No se pudo registrar el pedido', e.message, 'bad');
    return;
  }
  if (r.repetido) {
    toast('Ya hay un pedido en curso', 'Logística revisará el DNI ' + dni + '.', 'warn');
    return;
  }
  $('loginAlertTitle').textContent = 'Pedido enviado a logística';
  $('loginAlertMsg').textContent = 'Registramos el DNI ' + dni + ' para revisión. Vuelve a intentar el ingreso cuando logística confirme tu alta en el padrón.';
  $('loginAlert').classList.add('ok');
  $('loginAlertActions').style.display = 'none';
  ['autApellidos', 'autNombres', 'autCelular', 'autEmail', 'autArea'].forEach(id => { $(id).value = ''; });
  toast('Autorización solicitada', 'DNI ' + dni + ' en cola de revisión.');
}

export async function entrarAdmin() {
  // El usuario y la clave se comprueban en el servidor: el navegador nunca
  // conoce la clave de nadie, solo recibe un token si acierta.
  let r;
  try {
    r = await ingresarLogistica($('userInput').value || '', $('pinInput').value || '');
  } catch (e) {
    $('pinErr').textContent = e.status === 401 ? 'Usuario o clave incorrectos.' : e.message;
    $('pinErr').classList.add('on');
    $('pinInput').classList.add('bad');
    return;
  }
  $('pinErr').classList.remove('on');
  $('pinInput').classList.remove('bad');
  setSesion({
    tipo: 'admin', usuario: r.usuario, rol: r.rol, token: r.token,
    nombre: r.usuario, area: r.rol === 'admin' ? 'Administración' : 'Seguimiento'
  });
  // Recién ahora `sesion.token` existe, así que este `cargar()` -a diferencia
  // del que hizo main.js al arrancar, antes de cualquier ingreso- sí lleva el
  // header Authorization, y el servidor responde con bandeja/histórico/KPI
  // completos en vez de la versión pública y vacía.
  try { await cargar(); } catch (e) { toast('No se pudo traer la información', e.message, 'bad'); }
  abrirVista('admin');
  // Con clave temporal no se deja trabajar hasta que la cambie por una propia.
  if (r.debeCambiarClave) abrirCambioClave(true);
}

export function salir() {
  // Se avisa al servidor para cerrar el token ya mismo; si la llamada falla
  // (sin red, servidor caído) igual se sale localmente, que es lo que importa.
  if (sesion && sesion.tipo === 'admin') salirLogistica().catch(() => {});
  if (sesion && sesion.tipo === 'user' && sesion.token) salirArea().catch(() => {});
  // La copia local puede tener el historial completo (si salía de logística)
  // o los últimos servicios de un área (si salía un solicitante): en
  // cualquier caso, no debe quedar a la vista de quien entre después en esta
  // misma PC.
  limpiarDatosPrivados();
  setSesion(null);
  pendienteArea = null;
  $('viewUser').classList.remove('on');
  $('viewAdmin').classList.remove('on');
  $('session').style.display = 'none';
  $('loginStage').style.display = 'grid';
  $('btnLogisticaToggle').style.display = '';
  $('dniInput').value = '';
  $('userInput').value = '';
  $('pinInput').value = '';
  $('loginAlert').classList.remove('on', 'ok');
  $('areaStage').style.display = 'none';
  $('dniStage').style.display = 'block';
}

/**
 * Cambio de la clave propia. `obligatorio` solo cambia el aviso: justo
 * después de entrar con una clave temporal conviene cambiarla ya, porque esa
 * clave la vio también quien la generó y quien la recibió por teléfono o
 * anexo. No se bloquea el modal ni se impide seguir trabajando con ella: si
 * no la cambia ahora, se le recuerda de nuevo en el siguiente ingreso.
 */
export function abrirCambioClave(obligatorio = false) {
  const html = '<div class="field"><label for="claveActual">Clave actual</label>'
    + '<input class="input" id="claveActual" type="password" autocomplete="off"></div>'
    + '<div class="field"><label for="claveNueva">Clave nueva</label>'
    + '<input class="input" id="claveNueva" type="password" placeholder="Mínimo 6 caracteres" autocomplete="off"></div>'
    + '<div class="err" id="eClave"></div>'
    + (obligatorio ? '<div class="banner" style="margin-bottom:12px"><div>Ingresaste con una clave temporal: te conviene elegir una propia.</div></div>' : '')
    + '<button class="btn btn-sm" onclick="guardarCambioClave()">Guardar clave</button>';
  abrirModal('Cambiar mi clave', html);
}

export async function guardarCambioClave() {
  const actual = $('claveActual').value || '';
  const nueva = $('claveNueva').value || '';
  let r;
  try {
    // Logística cambia su clave personal; el solicitante, la de su área
    // (compartida). Son dos endpoints y dos tablas distintas por debajo, pero
    // el mismo modal y el mismo flujo sirven para los dos.
    r = sesion.tipo === 'user' ? await cambiarMiClaveArea(actual, nueva) : await cambiarMiClave(actual, nueva);
  } catch (e) {
    $('eClave').textContent = e.message;
    $('eClave').classList.add('on');
    return;
  }
  // El servidor cierra todas las sesiones de la cuenta al cambiar la clave
  // -por si alguna era de un token robado- y emite una nueva para esta misma
  // pestaña, que si no se adopta se quedaría con un token ya revocado.
  if (r?.token) setSesion({ ...sesion, token: r.token });
  cerrarModal();
  toast('Clave actualizada', 'Úsala la próxima vez que ingreses.');
}

/**
 * Recupera la sesión guardada en sessionStorage, si hay una, y valida contra
 * el servidor que el token siga vivo antes de mostrar la vista privilegiada.
 *
 * Antes, un simple F5 mandaba de vuelta al login aunque el token siguiera
 * vigente 12 horas más -sesion era solo una variable en memoria, se perdía
 * con cualquier recarga-. Ahora se llama una vez al arrancar (ver main.js).
 * Si el token ya no vale (venció, se reinició el servidor, se cambió la
 * clave desde otra pestaña), se cae en silencio al login normal: no hay
 * forma de "arreglar" un token ajeno, así que no tiene sentido mostrar error.
 */
export async function restaurarSesion() {
  const guardada = leerSesionGuardada();
  if (!guardada) return false;
  setSesion(guardada);
  try {
    if (guardada.tipo === 'user') {
      await cargarMiArea();
    } else {
      // /estado con sesión opcional no distingue "token vencido" de "sin
      // pendientes": hace falta una ruta que exija sesión de verdad.
      await confirmarSesionLogistica();
      await cargar();
    }
  } catch (e) {
    setSesion(null);
    return false;
  }
  abrirVista(guardada.tipo);
  return true;
}

const ROL_ETIQUETA = { admin: 'Logística · administrador', seguimiento: 'Logística · seguimiento' };

function abrirVista(tipo) {
  $('loginStage').style.display = 'none';
  $('btnLogisticaToggle').style.display = 'none';
  cerrarAccesoLogistica();
  $('session').style.display = 'flex';
  $('sessName').textContent = sesion.nombre;
  $('sessRole').textContent = tipo === 'admin' ? ROL_ETIQUETA[sesion.rol] : sesion.area;
  // Ambos tipos de sesión tienen ahora una clave que pueden cambiar: la
  // personal de logística, o la compartida del área del solicitante.
  $('btnMiClave').style.display = 'inline-block';
  if (tipo === 'user') {
    $('viewUser').classList.add('on');
    $('viewAdmin').classList.remove('on');
    $('miNombre').textContent = sesion.nombre;
    $('miDni').textContent = sesion.dni;
    $('miArea').textContent = sesion.area;
    $('miCargo').textContent = sesion.cargo || '—';
    $('fOrigen').value = '';
    toggleOrigen();
    resetAccion();
    limpiarParadas();
    $('resTicket').innerHTML = ''; $('qTicket').value = ''; $('eTicket').classList.remove('on');
    $('fFecha').min = hoyISO();
    if (!$('fFecha').value) $('fFecha').value = hoyISO();
    refrescarHoras();
    tabUser('nueva');
    renderMis();
  } else {
    $('viewAdmin').classList.add('on');
    $('viewUser').classList.remove('on');
    aplicarPermisosAdmin();
    // Al entrar, lo primero que ve admin es el Dashboard -no la bandeja
    // vacía-: el panorama de todos los módulos antes de ponerse a trabajar un
    // ticket puntual. Si la sesión es de "seguimiento" (no admin), tabAdmin()
    // igual la manda a la bandeja -Dashboard es solo de admin-.
    tabAdmin('dashboard');
    renderTodo();
  }
}
