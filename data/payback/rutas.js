/**
 * Plan de rutas semanal para UN motorizado del proveedor a cuota fija.
 *
 * La idea: dejar de mandar un courier por cada encargo y salir con rutas
 * fijas y conocidas por todos. Lunes, miércoles y viernes salen las rutas
 * fijas, que pasan por el núcleo; martes y jueves, rutas alternas que repasan
 * las zonas que no tocó la fija. Así cada zona tiene al menos dos pasadas por
 * semana y casi nada espera más de un día hábil. Todas las rutas terminan
 * antes de media tarde: el resto del día queda para urgencias aprobadas.
 * Todo sale de la planta y vuelve a ella.
 *
 * PUNTOS son los destinos con 5 o más viajes en el histórico de 2026
 * (data/historico.js): cubren cerca de dos tercios de los encargos. El resto
 * de destinos -los que aparecen una o dos veces- entra a la ruta del día que
 * le toca a su zona (ZONA_DIAS). La frecuencia de cada punto no está aquí: se
 * calcula en vivo del histórico (shared/payback/plan.js).
 *
 * Coordenadas: geocodificadas con Nominatim (OpenStreetMap) sobre la dirección
 * del histórico. `precision` dice qué tan fino quedó el punto:
 *   numero    - se encontró el número de puerta
 *   calle     - la calle, sin el número
 *   distrito  - solo el distrito: el punto está en el centro del distrito y
 *               conviene corregirlo con la ubicación real.
 * Para corregir un punto basta cambiar su lat/lon aquí.
 */

/** Salida y regreso de todas las rutas. */
export const PLANTA = {
  nombre: 'Plásticos Nacionales (planta)',
  direccion: 'Av. Los Talleres 4898, Urb. Ind. El Naranjal, Independencia',
  lat: -11.980140, lon: -77.062514
};

/** Minutos en planta antes de salir (cargar, firmar guías) y en cada punto (estacionar, entregar o recoger, firma). */
export const TIEMPOS = { cargaEnPlantaMin: 10, porParadaMin: 12 };

/**
 * Los cinco días. Los fijos pasan por el núcleo -Bohler, Unibell, Palacios,
 * Plus Cosmética y LIFE de San Isidro-, los destinos que se visitan varias
 * veces por semana.
 */
export const DIAS = [
  { id: 'lun', nombre: 'Lunes', tipo: 'fija', ruta: 'Núcleo + Lima este',
    detalle: 'Corredor Cercado - San Isidro y luego Ate, Santa Anita y La Molina.' },
  { id: 'mar', nombre: 'Martes', tipo: 'alterna', ruta: 'Norte, Callao, Cercado y sur',
    detalle: 'Segunda pasada por lo que no toca el lunes: Lima norte, Callao, Cercado y Lima sur. La tarde queda para urgencias.' },
  { id: 'mie', nombre: 'Miércoles', tipo: 'fija', ruta: 'Núcleo + Callao y Cercado',
    detalle: 'Corredor a San Isidro, Callao, Cercado, Rímac, Jesús María y San Miguel.' },
  { id: 'jue', nombre: 'Jueves', tipo: 'alterna', ruta: 'Lima este, norte y Chilca',
    detalle: 'Segunda pasada por Lima este y Lima norte. Chilca cada 15 días. La tarde queda para urgencias.' },
  { id: 'vie', nombre: 'Viernes', tipo: 'fija', ruta: 'Núcleo + sur, centro y norte',
    detalle: 'Corredor a San Isidro, Lima sur (Chorrillos, San Juan de Miraflores), Cercado y Lima norte.' }
];

/** Día de la semana de JavaScript (0 = domingo) de cada día del plan. */
export const DIA_JS = { lun: 1, mar: 2, mie: 3, jue: 4, vie: 5 };

/**
 * Qué días pasa la ruta por cada zona (data/payback/zonas.js). Vale para los
 * PUNTOS que no son del núcleo y para cualquier destino suelto. Lima moderna y
 * lo sin clasificar van a los tres días fijos porque el núcleo ya pasa por ahí.
 */
export const ZONA_DIAS = {
  este: ['lun', 'jue'], moderna: ['lun', 'mie', 'vie'], centro: ['mar', 'mie', 'vie'], callao: ['mar', 'mie'],
  norte: ['mar', 'jue', 'vie'], sur: ['mar', 'vie'], lejos: ['jue'], otros: ['lun', 'mie', 'vie']
};

/**
 * Reglas para que todo quede planificado. La urgencia deja de ser "mándalo
 * ya" y pasa a tener un lugar: la tarde libre de cada día.
 */
export const POLITICA = {
  horaCorte: '16:00',          // lo pedido hasta esta hora sale en la ruta del día siguiente que le toca
  salida: '08:00',
  finJornada: '17:30',
  inicioUrgencias: '14:30',    // desde esta hora el motorizado queda para urgencias aprobadas
  maxUrgenciasPorDia: 2        // sobre esto, la urgencia pasa al día siguiente o al courier (y se carga al área)
};

export const PUNTOS = [
  { id: "plus-cosmetica-san-isidro", destino: "PLUS COSMÉTICA, AV. VÍCTOR ANDRÉS BELAÚNDE 280, SAN ISIDRO",
    lat: -12.095536, lon: -77.039093, precision: "calle", dias: ["lun", "mie", "vie"] },
  { id: "bohler-cercado-de-lima", destino: "BOHLER, CASTRO RONCEROS 777, CERCADO DE LIMA",
    lat: -12.045275, lon: -77.068475, precision: "numero", dias: ["lun", "mie", "vie"] },
  { id: "life-san-isidro", destino: "LIFE, AV. JAVIER PRADO ESTE 578, SAN ISIDRO",
    lat: -12.091148, lon: -77.014164, precision: "calle", dias: ["lun", "mie", "vie"] },
  { id: "oficina-del-sr-palacios-magdalena-del-ma", destino: "OFICINA DEL SR. PALACIOS, AV. JAVIER PRADO OESTE 757, MAGDALENA DEL MAR",
    lat: -12.09294, lon: -77.06132, precision: "numero", dias: ["lun", "mie", "vie"] },
  { id: "vicco-ate", destino: "VICCO, AV. SEPARADORA INDUSTRIAL 1815, ATE",
    lat: -12.067357, lon: -76.972304, precision: "calle", dias: ["lun", "jue"] },
  { id: "unibell-brena", destino: "UNIBELL, JR. VARELA 352, BREÑA",
    lat: -12.063782, lon: -77.0499, precision: "calle", dias: ["lun", "mie", "vie"] },
  { id: "unibell-san-isidro", destino: "UNIBELL, AV. JAVIER PRADO OESTE 1475, SAN ISIDRO",
    lat: -12.094131, lon: -77.056813, precision: "calle", dias: ["lun", "mie", "vie"] },
  { id: "life-chorrillos", destino: "LIFE, AV. CORDILLERA CENTRAL, CHORRILLOS",
    lat: -12.195218, lon: -76.995537, precision: "calle", dias: ["mar", "vie"] },
  { id: "torneria-san-martin-de-porres", destino: "TORNERÍA, JR. PASCO, SAN MARTÍN DE PORRES",
    lat: -12.030582, lon: -77.079324, precision: "calle", dias: ["mar", "jue", "vie"] },
  { id: "cipesa-cercado-de-lima", destino: "CIPESA, AV. COLONIAL 2066, CERCADO DE LIMA",
    lat: -12.048722, lon: -77.068717, precision: "numero", dias: ["mar", "mie", "vie"] },
  { id: "tratar-peru-callao", destino: "TRATAR PERÚ, AV. ELMER FAUCETT 3430, CALLAO",
    lat: -12.06248, lon: -77.097245, precision: "calle", dias: ["mar", "mie"] },
  { id: "ciplast-ate", destino: "CIPLAST, AV. NICOLÁS AYLLÓN 292, ATE",
    lat: -12.063788, lon: -76.986303, precision: "calle", dias: ["lun", "jue"] },
  { id: "jaime-chavez-ate", destino: "JAIME CHÁVEZ, AV. MARISCAL DOMINGO NIETO, ATE",
    lat: -12.038728, lon: -76.896873, precision: "distrito", dias: ["lun", "jue"] },
  { id: "jalexa-san-martin-de-porres", destino: "JALEXA, JR. ALEJANDRO DEUSTUA 3749, SAN MARTÍN DE PORRES",
    lat: -12.024175, lon: -77.087028, precision: "calle", dias: ["mar", "jue", "vie"] },
  { id: "box-clean-san-juan-de-miraflores", destino: "BOX CLEAN, PAITA 164, SAN JUAN DE MIRAFLORES",
    lat: -12.155392, lon: -76.972444, precision: "distrito", dias: ["mar", "vie"] },
  { id: "prochilca-chilca", destino: "PROCHILCA, AV. LOS ÁLAMOS MZ. D, CHILCA",
    lat: -12.419141, lon: -76.603862, precision: "distrito", dias: ["jue"], cadaSemanas: 2 },
  { id: "afersa-lurigancho-chosica", destino: "AFERSA, CAL. LOS QUÍMICOS MZ. A LT. 12, LURIGANCHO - CHOSICA",
    lat: -11.948832, lon: -76.762701, precision: "distrito", dias: ["lun", "jue"] },
  { id: "shalom-los-olivos", destino: "SHALOM, AV. LAS PALMERAS 5236, LOS OLIVOS",
    lat: -11.96813, lon: -77.071513, precision: "calle", dias: ["mar", "jue", "vie"] },
  { id: "casa-del-sr-bellido-miraflores", destino: "CASA DEL SR. BELLIDO, TRIANA 185, MIRAFLORES",
    lat: -12.114514, lon: -77.041311, precision: "calle", dias: ["lun", "mie", "vie"] },
  { id: "yavengraf-ate", destino: "YAVENGRAF, CL. MARISCAL JOSÉ DE LA MAR 590, ATE",
    lat: -12.038728, lon: -76.896873, precision: "distrito", dias: ["lun", "jue"] },
  { id: "troquelados-mozo-san-juan-de-miraflores", destino: "TROQUELADOS MOZO, MZ. S LT. 11, SAN JUAN DE MIRAFLORES",
    lat: -12.155392, lon: -76.972444, precision: "distrito", dias: ["mar", "vie"] },
  { id: "serigrafia-gamarra-san-juan-de-luriganch", destino: "SERIGRAFÍA GAMARRA, AV. CAMPOY, SAN JUAN DE LURIGANCHO",
    lat: -12.015671, lon: -76.964519, precision: "calle", dias: ["lun", "jue"] },
  { id: "bcp-mega-plaza", destino: "BCP, MEGA PLAZA",
    lat: -11.994405, lon: -77.063114, precision: "calle", dias: ["mar", "jue", "vie"] },
  { id: "plus-cosmetica-los-olivos", destino: "PLUS COSMÉTICA, JR. HELIO 5647, LOS OLIVOS",
    lat: -11.965985, lon: -77.073071, precision: "distrito", dias: ["mar", "jue", "vie"] },
  { id: "mastercol-ate", destino: "MASTERCOL, AV. LOS FRUTALES 211, ATE",
    lat: -12.059246, lon: -76.967195, precision: "numero", dias: ["lun", "jue"] },
  { id: "conte-ate", destino: "CONTE, AV. SEPARADORA INDUSTRIAL 1591, ATE",
    lat: -12.048989, lon: -76.939137, precision: "calle", dias: ["lun", "jue"] },
  { id: "suminox-cercado-de-lima", destino: "SUMINOX, AV. MAQUINARIAS 1891, CERCADO DE LIMA",
    lat: -12.043324, lon: -77.069051, precision: "calle", dias: ["mar", "mie", "vie"] },
  { id: "jhomeron-chacra-cerro-comas", destino: "JHOMERON, AV. SANTA ANA 48, CHACRA CERRO - COMAS",
    lat: -11.921119, lon: -77.063658, precision: "calle", dias: ["mar", "jue", "vie"] },
  { id: "laboratorio-alab-bellavista-callao", destino: "LABORATORIO ALAB, AV. GUARDIA CHALACA 1877, BELLAVISTA - CALLAO",
    lat: -12.061733, lon: -77.124322, precision: "calle", dias: ["mar", "mie"] },
  { id: "bbva-la-molina", destino: "BBVA, AV. LA MOLINA 540, LA MOLINA",
    lat: -12.077671, lon: -76.944957, precision: "calle", dias: ["lun", "mie", "vie"] },
  { id: "industrial-center-bellavista-callao", destino: "INDUSTRIAL CENTER, LOS ROBLES 161, BELLAVISTA - CALLAO",
    lat: -12.06016, lon: -77.100765, precision: "calle", dias: ["mar", "mie"] },
  { id: "beltran-santa-anita", destino: "BELTRÁN, AV. CASCANUECES MZ. M LT. 6, SANTA ANITA",
    lat: -12.043273, lon: -76.961946, precision: "distrito", dias: ["lun", "jue"] },
  { id: "ics-pack-comas", destino: "ICS PACK, CHACRA CERRO, COMAS",
    lat: -11.921119, lon: -77.063658, precision: "calle", dias: ["mar", "jue", "vie"] },
  { id: "cima-fertilizantes-san-borja", destino: "CIMA FERTILIZANTES, AV. JULIO BAILETTI 352, SAN BORJA",
    lat: -12.084667, lon: -76.994993, precision: "calle", dias: ["lun", "mie", "vie"] },
  { id: "notaria-danon-magdalena-del-mar", destino: "NOTARÍA DANÓN, AV. JAVIER PRADO OESTE 705, MAGDALENA DEL MAR",
    lat: -12.092674, lon: -77.06178, precision: "numero", dias: ["lun", "mie", "vie"] },
  { id: "marvisur-los-olivos", destino: "MARVISUR, AV. LAS PALMERAS 5343, LOS OLIVOS",
    lat: -11.96813, lon: -77.071513, precision: "calle", dias: ["mar", "jue", "vie"] },
  { id: "grobdi-jesus-maria", destino: "GROBDI, AV. BRASIL 1215, JESÚS MARÍA",
    lat: -12.085533, lon: -77.062268, precision: "calle", dias: ["lun", "mie", "vie"] },
  { id: "alicorp-callao", destino: "ALICORP, AV. ARGENTINA 4793, CALLAO",
    lat: -12.047176, lon: -77.092985, precision: "numero", dias: ["mar", "mie"] },
  { id: "silvestre-lurigancho-chosica", destino: "SILVESTRE, CAJAMARQUILLA, LURIGANCHO - CHOSICA",
    lat: -11.981111, lon: -76.896667, precision: "numero", dias: ["lun", "jue"] },
  { id: "laboratorio-labet-carabayllo", destino: "LABORATORIO LABET, MZ. A LT. 1-2, CARABAYLLO",
    lat: -11.794993, lon: -76.989292, precision: "distrito", dias: ["mar", "jue", "vie"] },
  { id: "alkofarma-comas", destino: "ALKOFARMA, AV. CHACRA CERRO 41, COMAS",
    lat: -11.921119, lon: -77.063658, precision: "calle", dias: ["mar", "jue", "vie"] },
  { id: "empaques-y-servicios-ate", destino: "EMPAQUES Y SERVICIOS, CALLE BOULEVARD 254, ATE",
    lat: -12.038728, lon: -76.896873, precision: "distrito", dias: ["lun", "jue"] },
  { id: "fire-bond-san-juan-de-lurigancho", destino: "FIRE BOND, C. LOS MIRABLES 1136, SAN JUAN DE LURIGANCHO",
    lat: -12.016768, lon: -77.002685, precision: "calle", dias: ["lun", "jue"] },
  { id: "ecofull-rimac", destino: "ECOFULL, JR. PATROCINIO 124, RÍMAC",
    lat: -12.020304, lon: -77.035463, precision: "distrito", dias: ["mar", "mie", "vie"] },
  { id: "hub-peru-cargo-san-miguel", destino: "HUB PERÚ CARGO, CALLE HERNANDO DE SOTO 170, SAN MIGUEL",
    lat: -12.079114, lon: -77.094787, precision: "distrito", dias: ["lun", "mie", "vie"] },
  { id: "molmac-surco", destino: "MOLMAC, JR. MONTERREY 373, SURCO",
    lat: -12.127818, lon: -76.986377, precision: "distrito", dias: ["lun", "mie", "vie"] },
  { id: "anvip-chorrillos", destino: "ANVIP, AV. PRODUCCIÓN NACIONAL 229B, CHORRILLOS",
    lat: -12.177412, lon: -77.017686, precision: "calle", dias: ["mar", "vie"] },
  { id: "araceli-ceballos-gamarra-san-juan-de-lur", destino: "ARACELI CEBALLOS GAMARRA, SAN JUAN DE LURIGANCHO",
    lat: -11.948751, lon: -76.977911, precision: "distrito", dias: ["lun", "jue"] },
  { id: "scotiabank-av-alfredo-mendiola-2695", destino: "SCOTIABANK, MEGA PLAZA, AV. ALFREDO MENDIOLA 2695",
    lat: -11.994405, lon: -77.063114, precision: "calle", dias: ["mar", "jue", "vie"] },
  { id: "arganipro-miraflores", destino: "ARGANIPRO, AV. AREQUIPA 4130, MIRAFLORES",
    lat: -12.107734, lon: -77.030953, precision: "calle", dias: ["lun", "mie", "vie"] },
  { id: "industrial-center-cercado-de-lima", destino: "INDUSTRIAL CENTER, AV. ARGENTINA 523, CERCADO DE LIMA",
    lat: -12.044614, lon: -77.048703, precision: "numero", dias: ["mar", "mie", "vie"] },
  { id: "rodasur-cercado-de-lima", destino: "RODASUR, AV. GUILLERMO DANSEY 1912, CERCADO DE LIMA",
    lat: -12.04713, lon: -77.061133, precision: "calle", dias: ["mar", "mie", "vie"] }
];
