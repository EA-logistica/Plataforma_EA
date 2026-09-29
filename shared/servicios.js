/**
 * Catálogo del formulario de solicitud, compartido por el navegador (lo que se
 * ofrece para elegir con un clic) y el servidor (lo que acepta, ver
 * backend/db/repos/solicitudes.js).
 *
 * Tres modalidades, como en las apps de reparto: cada una con su acción
 * (Recoger / Entregar) y sus tipos de servicio. Los tipos se unificaron para
 * que haya pocos y claros: "Recojo de documentos" ya incluye cheques y
 * trámites notariales o municipales, que antes eran opciones sueltas.
 */

export const MODALIDADES = [
  {
    id: 'Envíos',
    titulo: 'Envíos / Recojos',
    detalle: 'Moto o carro',
    acciones: { Recoger: 'Recoger', Entregar: 'Entregar' },
    servicios: {
      Recoger: [
        { nombre: 'Recojo de documentos', detalle: 'Incluye cheques, valores y trámites notariales o municipales' },
        { nombre: 'Recojo de paquete', detalle: 'Cajas, sobres o bultos pequeños' },
        { nombre: 'Recojo de muestras', detalle: 'Muestras de producto o de proveedor' },
        { nombre: 'Recojo de repuestos o materiales', detalle: 'Repuestos, insumos o materiales de almacén' }
      ],
      Entregar: [
        { nombre: 'Envío de documentos', detalle: 'Incluye cheques, valores y trámites notariales o municipales' },
        { nombre: 'Envío de paquete', detalle: 'Cajas, sobres o bultos pequeños' },
        { nombre: 'Envío de muestras', detalle: 'Muestras de producto para clientes' },
        { nombre: 'Envío de repuestos o materiales', detalle: 'Repuestos, insumos o materiales de almacén' }
      ]
    }
  },
  {
    id: 'Transporte',
    titulo: 'Transporte',
    detalle: 'Carro o unidad particular',
    acciones: { Recoger: 'Recoger a', Entregar: 'Llevar a' },
    servicios: {
      Recoger: [
        { nombre: 'Recojo de personal', detalle: 'Trabajadores de la empresa' },
        { nombre: 'Recojo de visitas o clientes', detalle: 'Visitas, clientes o proveedores' }
      ],
      Entregar: [
        { nombre: 'Traslado de personal', detalle: 'Trabajadores de la empresa' },
        { nombre: 'Traslado de visitas o clientes', detalle: 'Visitas, clientes o proveedores' }
      ]
    }
  },
  {
    id: 'Cargo',
    titulo: 'Cargo / Flete',
    detalle: 'Furgón, camión o tráiler',
    acciones: { Recoger: 'Recoger', Entregar: 'Entregar' },
    servicios: {
      Recoger: [
        { nombre: 'Recojo de mercadería', detalle: 'Compras o devoluciones de clientes' },
        { nombre: 'Recojo de materia prima', detalle: 'Resinas, masterbatch, insumos a granel' },
        { nombre: 'Recojo de maquinaria o moldes', detalle: 'Equipos, moldes o piezas grandes' }
      ],
      Entregar: [
        { nombre: 'Despacho de producto terminado', detalle: 'Pedidos de clientes' },
        { nombre: 'Envío de materia prima o insumos', detalle: 'A terceros, maquila o almacenes' },
        { nombre: 'Envío de maquinaria o moldes', detalle: 'Equipos, moldes o piezas grandes' }
      ]
    }
  }
];

export const IDS_MODALIDAD = MODALIDADES.map(m => m.id);
export const modalidad = id => MODALIDADES.find(m => m.id === id) || null;

/** Todos los tipos de una acción, en cualquier modalidad (para detectar contradicciones). */
export const SERVICIOS_POR_ACCION = {
  Recoger: MODALIDADES.flatMap(m => m.servicios.Recoger.map(s => s.nombre)),
  Entregar: MODALIDADES.flatMap(m => m.servicios.Entregar.map(s => s.nombre))
};

const normal = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

// Palabras que delatan la acción aunque el texto se haya escrito a mano:
// "recojo de cajas" es un recojo aunque no esté en la lista.
const PROPIAS = {
  Recoger: /\b(recojo|recoger|recoge|recogida|recepcion de)\b/,
  Entregar: /\b(envio|enviar|entrega|entregar|despacho|traslado|llevar)\b/
};

/**
 * Si `servicio` pertenece a la acción contraria, devuelve el mensaje de error;
 * si no, ''. Lo escrito a mano sin palabras delatoras vale para las dos.
 */
export function contradiccionServicio(tipo, servicio) {
  const otra = tipo === 'Recoger' ? 'Entregar' : tipo === 'Entregar' ? 'Recoger' : '';
  if (!otra) return '';
  const s = normal(servicio);
  const deLaOtra = SERVICIOS_POR_ACCION[otra].some(x => normal(x) === s)
    && !SERVICIOS_POR_ACCION[tipo].some(x => normal(x) === s);
  if (deLaOtra || (PROPIAS[otra].test(s) && !PROPIAS[tipo].test(s))) {
    return '"' + String(servicio).trim() + '" es para ' + (otra === 'Recoger' ? 'recoger' : 'entregar')
      + ', pero la acción elegida es ' + tipo + '. Cambia la acción o el tipo de servicio.';
  }
  return '';
}

// ------------------------------------------------------------- destinos
/**
 * Clave para decidir si un destino ya es conocido: sin tildes, mayúsculas,
 * sin puntuación y con los espacios colapsados. "Av. Los Alisos 945" y
 * "AV LOS ALISOS  945" son el mismo lugar; otro número, otro lugar. La usan
 * el formulario (para preguntar Cliente/Proveedor) y el servidor (para
 * exigirlo), así que los dos deciden igual.
 */
export function claveDestino(texto) {
  return String(texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
}

// Palabras que no distinguen un lugar de otro: tipo de vía, conectores,
// razón social. "AV. LOS ALISOS 945" y "AVENIDA ALISOS 945" comparten lo que
// importa -ALISOS y 945-.
const RELLENO = new Set(('AV AVENIDA JR JIRON CALLE CAL CA CALL PSJ PASAJE PROL PROLONGACION CARRETERA CARR KM MZ MZA LT LOTE '
  + 'URB URBANIZACION NRO NUMERO NO N DPTO INT DE DEL LA EL LOS LAS Y SAC S A C SA SRL EIRL E I R L PERU LIMA').split(' '));

function palabras(texto) {
  return claveDestino(texto).split(' ').filter(p => p.length > 1 && !RELLENO.has(p) || /^\d+$/.test(p));
}

/** Distancia en metros entre dos puntos (haversine). */
export function distanciaMetros(a, b) {
  const rad = x => x * Math.PI / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

/**
 * Destinos ya registrados que PARECEN la misma dirección que `texto` (o que
 * están a menos de 150 m de `punto`, si se marcó en el mapa). Así un destino
 * nuevo se canaliza hacia el que ya existe en vez de duplicarse con otra
 * redacción: "Av. Alisos 945 Los Olivos" → "AV. LOS ALISOS 945, LOS OLIVOS".
 *
 * `lista` son objetos { direccion, lat?, lng?, ... }. Devuelve hasta 3, el
 * más parecido primero, cada uno con `motivo` ('texto' o 'cercania').
 */
export function destinosParecidos(texto, punto, lista) {
  const propias = palabras(texto);
  const numeros = propias.filter(p => /^\d+$/.test(p));
  const clave = claveDestino(texto);
  const salida = [];
  for (const d of lista) {
    if (claveDestino(d.direccion) === clave) continue; // es el mismo: ya es conocido
    let puntaje = 0, motivo = '';
    if (punto && d.lat != null && d.lng != null) {
      const m = distanciaMetros(punto, { lat: d.lat, lng: d.lng });
      if (m < 150) { puntaje = 2 - m / 150; motivo = 'cercania'; }
    }
    if (propias.length >= 2) {
      const otras = new Set(palabras(d.direccion));
      const comunes = propias.filter(p => otras.has(p));
      const nums = [...otras].filter(p => /^\d+$/.test(p));
      // Mismo nombre de calle con distinto número es otro lugar.
      const numeroChoca = numeros.length && nums.length && !numeros.some(n => otras.has(n));
      const parecido = comunes.length / Math.min(propias.length, otras.size || 1);
      if (!numeroChoca && comunes.length >= 2 && parecido >= 0.6 && parecido > puntaje) { puntaje = parecido; motivo = 'texto'; }
    }
    if (puntaje) salida.push({ ...d, puntaje, motivo });
  }
  return salida.sort((a, b) => b.puntaje - a.puntaje).slice(0, 3);
}

// ------------------------------------------------------------ vehículos
/**
 * Lo que logística asigna en la bandeja. Cada modalidad sugiere los suyos
 * -un flete no sale en moto-, pero cualquiera se puede elegir: es logística
 * quien conoce la carga real.
 */
export const VEHICULOS = ['Motorizado', 'Carro', 'Furgón', 'Camión'];
export const VEHICULOS_POR_MODALIDAD = {
  'Envíos': ['Motorizado', 'Carro'],
  Transporte: ['Carro'],
  Cargo: ['Furgón', 'Camión']
};
/** La modalidad de un ticket; los anteriores al formulario nuevo eran todos envíos/recojos. */
export const modalidadDe = s => (s && s.modalidad) || 'Envíos';

// ------------------------------------------------ enlaces de Google Maps
/**
 * Hay solicitantes que pegan en el destino el link de Google Maps que les
 * mandaron por WhatsApp: "maps.google.com/maps?q=-12.0168,-77.05…" o
 * "google.com/maps/dir//NOMBRE/@-12.1,-77.0…". Así el ticket quedaba con una
 * URL ilegible. Estas funciones sacan de ahí lo que sirve: las coordenadas
 * (si vienen) y el nombre del lugar (si viene).
 */
const DOMINIO_MAPS = /^(https?:\/\/)?((www|maps)\.)?(google\.[a-z.]+\/maps|maps\.google\.[a-z.]+|goo\.gl\/maps|maps\.app\.goo\.gl)/i;

export const esEnlaceMapa = texto => DOMINIO_MAPS.test(String(texto || '').trim());

const enPeru = (lat, lng) => lat > -19 && lat < 1 && lng > -82 && lng < -68;

/** { lat, lng } de un enlace de Google Maps (o de un "lat, lng" suelto), o null. */
export function coordsDeEnlace(texto) {
  let t = String(texto || '').trim();
  try { t = decodeURIComponent(t); } catch (_) { /* queda como vino */ }
  const patrones = [
    /!3d(-?\d{1,3}\.\d+)!4d(-?\d{1,3}\.\d+)/,                                    // el punto exacto del lugar
    /[?&](?:q|query|ll|destination|daddr)=(-?\d{1,3}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/, // ?q=lat,lng
    /@(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/,                                         // centro del mapa
    /^(-?\d{1,3}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)$/                                   // "lat, lng" pegado a mano
  ];
  for (const p of patrones) {
    const m = t.match(p);
    if (m) {
      const lat = Number(m[1]), lng = Number(m[2]);
      if (enPeru(lat, lng)) return { lat, lng };
    }
  }
  return null;
}

/** Nombre del lugar que trae el enlace (/maps/place/NOMBRE o /maps/dir//NOMBRE), o ''. */
export function lugarDeEnlace(texto) {
  let t = String(texto || '');
  const m = t.match(/\/maps\/(?:place|dir\/[^/]*)\/([^/@?]+)/i) || t.match(/\/maps\/place\/([^/@?]+)/i);
  if (!m) return '';
  try { t = decodeURIComponent(m[1].replace(/\+/g, ' ')); } catch (_) { t = m[1].replace(/\+/g, ' '); }
  return t.trim();
}

/**
 * Las dos plantas de la empresa también son destino (un recojo en LIFE que se
 * trae a Talleres). Se escriben igual que en el origen del formulario, y
 * cuentan como destinos conocidos: nunca se pregunta si son cliente o proveedor.
 */
export const PLANTAS = ['Plásticos Nacionales - Talleres', 'Plásticos Nacionales - Fraguas'];
