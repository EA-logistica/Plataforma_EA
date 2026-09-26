/*
 * Script clásico (NO módulo), cargado de forma bloqueante en el <head>, igual
 * que frontend/js/ui/themeBoot.js del resto de la plataforma -y a propósito
 * con el mismo patrón-: aplica el tema antes del primer pintado para que no
 * parpadee, y de ahí en más se mantiene sincronizado con el selector de modo
 * de PLANSA (claro / oscuro 1 / oscuro 2), aunque este documento viva dentro
 * de un iframe (el shell de Almacén, o uno de sus módulos).
 *
 * localStorage es por origen, no por frame: esta página y la de arriba
 * comparten el mismo origen, así que leen la MISMA clave sin necesitar
 * postMessage. El evento "storage" -que el navegador dispara en cualquier
 * documento del mismo origen que no fue el que escribió, justo el caso de un
 * iframe cuando el padre cambia de tema- es lo que mantiene esto reactivo
 * mientras la pantalla sigue abierta.
 */
(function () {
  var TEMA_KEY = 'pn_mensajeria_tema';
  var TEMAS_VALIDOS = { light: 1, dark: 1, black: 1 };

  function aplicar() {
    var tema = 'light';
    try {
      var guardado = localStorage.getItem(TEMA_KEY);
      if (guardado && TEMAS_VALIDOS[guardado]) tema = guardado;
    } catch (e) { /* almacenamiento bloqueado: se queda en claro */ }
    document.documentElement.setAttribute('data-theme', tema);
  }

  aplicar();
  window.addEventListener('storage', function (e) {
    if (!e.key || e.key === TEMA_KEY) aplicar();
  });
})();
