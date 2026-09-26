/**
 * Padrón de personal de Plásticos Nacionales.
 *
 * Generado a partir del listado de RR.HH. (DATA_HC.csv). Es la única fuente
 * del personal habilitado: para actualizarlo, reemplaza esta lista y sube
 * VERSION_DATOS en backend/db/sembrar.js, para que las bases ya sembradas
 * -no solo las nuevas- adopten el padrón nuevo en el próximo arranque.
 *
 * Sobre el documento de identidad:
 * - Los DNI se guardan SIEMPRE con 8 dígitos. En el listado de RR.HH. algunos
 *   llegan con 7 porque el sistema de origen recorta el cero inicial; aquí ya
 *   están completados (ver normalizarDoc más abajo).
 * - Los documentos de 9 dígitos son carnés de extranjería y se guardan tal cual.
 *
 * @type {{dni: string, nombre: string, cargo: string, area: string}[]}
 */
export const PERSONAL = [
  { dni: "70361492", nombre: "THALIA LUCERO PARRA AGUIRRE", cargo: "COORDINADORA DE BIENESTAR Y CLIMA", area: "Recursos Humanos" },
  { dni: "09628739", nombre: "CESAR ANTONIO CAMPOS ANGELES", cargo: "CONTROLADOR DE DESPACHO", area: "APT" },
  { dni: "46920570", nombre: "FABIOLA VICTORIA MENDEZ APAZA", cargo: "OPERARIO DE SERIGRAFIA I", area: "Serigrafía" },
  { dni: "09515817", nombre: "MADELEINE CONSTANTINA ÑAHUIS AQUISE", cargo: "COORDINADORA DE APT", area: "APT" },
  { dni: "45733928", nombre: "JOSE CHRISTIAN SANTIAGO ARATEA", cargo: "MATRICERO", area: "Manufactura" },
  { dni: "40169301", nombre: "JOSE MARTIN ALCANTARA ARMAS", cargo: "ALMACENERO", area: "APT" },
  { dni: "76357597", nombre: "NADIA ESTRELLA DEL ROSARIO PRIETO AZAÑERO", cargo: "ASISTENTE DE CONTROL DE CALIDAD", area: "Control de Calidad" },
  { dni: "41644171", nombre: "DARIO ANTONIO GONZALES AZORIN", cargo: "TECNICO MATRICERO DE INYECCION", area: "Matriceria" },
  { dni: "75443277", nombre: "JHORGHINO ALDAIR JARAMILLO BARAHONA", cargo: "ANALISTA DE PLANTA", area: "Control de Calidad" },
  { dni: "75665374", nombre: "DIEGO ANDRES CASTILLO BARRIOS", cargo: "ALMACENERO", area: "APT" },
  { dni: "46824547", nombre: "CESAR JHONY COLLANTES BAZAN", cargo: "PROGRAMADOR/OPERADOR TORNO CNC", area: "Matriceria" },
  { dni: "43475372", nombre: "IRMA YSABEL ASHCALLA BLAS", cargo: "OPERARIO DE SERIGRAFIA I", area: "Serigrafía" },
  { dni: "10815951", nombre: "SILVIA SOLEDAD ASHCALLA BLAS", cargo: "OPERARIO DE SERIGRAFIA I", area: "Serigrafía" },
  { dni: "72971202", nombre: "YHOLVI FELIX SAENZ BLAS", cargo: "PROGRAMADOR OPERADOR CNC", area: "Matriceria" },
  { dni: "75060201", nombre: "JAIME BLAS CADILLO", cargo: "VOLANTE DE CONTROL DE CALIDAD", area: "Control de Calidad" },
  { dni: "44347053", nombre: "MARCO ANTONIO DIAZ CALLA", cargo: "INSPECTOR CONTROL DE CALIDAD", area: "Control de Calidad" },
  { dni: "41817975", nombre: "REYMI VIRILIO BERNABE CALLUPE", cargo: "FACTURADOR", area: "Finanzas" },
  { dni: "76278834", nombre: "JEAN PIERO PEREA CAMACHO", cargo: "COORDINADOR DE LOGISTICA", area: "Logistica" },
  { dni: "77279942", nombre: "RAMIRO MANUEL CHAVEZ CAMPOMANES", cargo: "PROGRAMADOR OPERADOR CNC", area: "Manufactura" },
  { dni: "75678225", nombre: "DANIEL EDUARDO ALVA CAPILLO", cargo: "TECNICO MATRICERO EROSIONADOR", area: "Matriceria" },
  { dni: "74749341", nombre: "AMELIA ALEXANDRA SANCHEZ CARBAJAL", cargo: "ASISTENTE JUNIOR DE TRANSFORMACION DIGITAL E INTEL", area: "TRANSFORMACIÓN DIGITAL" },
  { dni: "73150344", nombre: "XIMENA LUCELI PAREDES CARRANZA", cargo: "PLANNER DE OPERACIONES SENIOR", area: "Administracion" },
  { dni: "41376045", nombre: "SARITA CONSUELO CRUZ CARRAZCO", cargo: "OPERARIO DE SERIGRAFIA I", area: "Serigrafía" },
  { dni: "60627745", nombre: "CARLOS DANIEL SAAVEDRA CARRILLO", cargo: "OPERARIO DE SERIGRAFIA I", area: "Serigrafía" },
  { dni: "42962931", nombre: "LIDMAN GONZALO CARRERA CASTILLO", cargo: "ANALISTA DE PLANTA", area: "Control de Calidad" },
  { dni: "48273275", nombre: "STEFANY CAROLINA FEIJOO CASTILLO", cargo: "COORDINADORA DE SELECCIÓN Y CAPACITACIÓN", area: "Recursos Humanos" },
  { dni: "77141648", nombre: "MAX ANTONIO LEYVA CHALO", cargo: "AYUDANTE DE SERIGRAFIA", area: "Serigrafía" },
  { dni: "07330261", nombre: "RUBEN DARIO FLORES CHANGANO", cargo: "LIDER DE TALLER", area: "Mantenimiento" },
  { dni: "76889091", nombre: "VIERY EDWAR ROJAS CHAVEZ", cargo: "MAQUINISTA OPERADOR JUNIOR", area: "Serigrafía" },
  { dni: "08232268", nombre: "FRANCISCO PALACIOS CHOPITEA", cargo: "GERERENTE GENERAL", area: "Gerencia" },
  { dni: "48043153", nombre: "ELMER HUAMANI CONDORI", cargo: "TECNICO MAQUINISTA", area: "Serigrafía" },
  { dni: "08243315", nombre: "GIANNINA LOURDES CARMEN CAMBANA CORREA", cargo: "SECRETARIA / RECEPCIONISTA", area: "Administracion" },
  { dni: "77620904", nombre: "SEGUNDO JESÚS ASENCIO DE LA CRUZ", cargo: "OPERARIO DE SERIGRAFIA I", area: "Serigrafía" },
  { dni: "60881728", nombre: "AARON ELIAS RODRIGUEZ CRUZADO", cargo: "PRACTICANTE DE MANTENIMIENTO", area: "Mantenimiento" },
  { dni: "72721323", nombre: "LINDSAY MAYRA RODRIGUEZ CRUZADO", cargo: "ADMINISTRADORA COMERCIAL", area: "Ventas" },
  { dni: "60275245", nombre: "DAVID MOISES FLORES CUSINGA", cargo: "ALMACENERO", area: "APT" },
  { dni: "16726853", nombre: "LUIS ALBERTO RUBIO DELGADO", cargo: "INSPECTOR CONTROL DE CALIDAD", area: "Control de Calidad" },
  { dni: "47134192", nombre: "JULISSA IVETTE TRAVEZAÑO DIESTRA", cargo: "COORDINADORA DE MATERIA PRIMA", area: "Materia Prima" },
  { dni: "73878318", nombre: "MATEO MAURICIO MONTOYA ESPERTA", cargo: "DISEÑADOR DE PROYECTOS TERMINADOS", area: "Diseño" },
  { dni: "46709572", nombre: "ELVIRA POMA ESPINOZA", cargo: "DISEÑADOR DE MOLDES DE SOPLADO Y PRODUCTOS NUEVOS", area: "Diseño" },
  { dni: "42063280", nombre: "PEDRO LEANDRO FLORES FABIAN", cargo: "TECNICO MATRICERO DE SOPLADO", area: "Matriceria" },
  { dni: "76076246", nombre: "GABRIEL BENJAMIN RAMIREZ FALCON", cargo: "TECNICO MATRICERO DE INYECCION", area: "Matriceria" },
  { dni: "70043817", nombre: "RONY ALEXANDER BENITES FLORES", cargo: "COORDINADOR TI", area: "Sistemas" },
  { dni: "73748351", nombre: "MARTIN JAIR CHACALTANA FRANKLIN", cargo: "ALMACENERO", area: "APT" },
  { dni: "74655141", nombre: "HALLY JOSUE NOLBERTO GAONA", cargo: "COORDINADOR DE LOGISTICA", area: "Logistica" },
  { dni: "76064253", nombre: "LUIS JAVIER NUÑEZ GARAY", cargo: "ALMACENERO", area: "APT" },
  { dni: "47976435", nombre: "RAUL MARTIN AGUILAR GARCIA", cargo: "TECNICO MAQUINISTA", area: "Serigrafía" },
  { dni: "71685889", nombre: "GABRIEL D ALESSANDRO ALCANTARA GARDEZ", cargo: "ALMACENERO", area: "APT" },
  { dni: "74537046", nombre: "OMAR JONATHAN OCAÑA GIL", cargo: "ALMACENERO", area: "APT" },
  { dni: "74853815", nombre: "FIORELLA DANITZA MONDOÑEDO GONZALES", cargo: "RECEPCIONISTA", area: "Administracion" },
  { dni: "76397391", nombre: "CRISTHOFFER JOEL CAMPOS GUERRERO", cargo: "ASISTENTE ADMINISTRATIVO", area: "Administracion" },
  { dni: "80401781", nombre: "MICHAEL YVAN CHANCASANA GUTARRA", cargo: "COORDINADOR DE INYECCIÓN", area: "Matriceria" },
  { dni: "43077042", nombre: "JENRRY ALBERTO MARCELO JARAMILLO", cargo: "VERIFICADOR DE CONTROL DE CALIDAD", area: "Control de Calidad" },
  { dni: "75941659", nombre: "CARLA GERALDINE SARMIENTO JIMENEZ", cargo: "COORDINADORA DE ADM. PERSONAL Y NÓMINAS", area: "Recursos Humanos" },
  { dni: "48704197", nombre: "YONATAN BRAULIO GODOY LEON", cargo: "ANALISTA DE LABORATORIO", area: "Control de Calidad" },
  { dni: "74106449", nombre: "JORGE ALEJANDRO ANTON LEON", cargo: "PROGRAMADOR OPERADOR CNC", area: "Manufactura" },
  { dni: "75307931", nombre: "ANGELO IVAN SANCHEZ LEON", cargo: "ALMACENERO", area: "APT" },
  { dni: "41380020", nombre: "JESSICA CAROLINA RAMOS LINARES", cargo: "ADMINISTRADOR COMERCIAL IC", area: "Ventas" },
  { dni: "42812298", nombre: "HENRRY ORLANDO ALVARADO MANRIQUE", cargo: "AYUDANTE DE VERIFICACION", area: "Control de Calidad" },
  { dni: "42731429", nombre: "BLANCA ALBINA LEGUA MARQUEZ", cargo: "ANALISTA FINANCIERO Y CONTABLE", area: "Finanzas" },
  { dni: "75348270", nombre: "ERICK EMERSON MENDOZA MARQUEZ", cargo: "TECNICO DE MANTENIMIENTO", area: "Mantenimiento" },
  { dni: "70643694", nombre: "ALEXANDER PIERO FUERTES MARTINEZ", cargo: "PRACTICANTE DE IA PRODUCTOS NUEVOS", area: "Diseño" },
  { dni: "42431664", nombre: "NILTON ORTIZ MARTINEZ", cargo: "TECNICO DE AIRE ACONDICIONADO Y SERVICIOS GENERALE", area: "Mantenimiento" },
  { dni: "45213468", nombre: "DANIEL VALENCIA MAZA", cargo: "ALMACENERO", area: "APT" },
  { dni: "005232544", nombre: "CARLOS JOSE GONZALEZ MERCADO", cargo: "ANALISTA DE PLANTA", area: "Control de Calidad" },
  { dni: "23099773", nombre: "BARTOLOME MELANIO ESPINOZA MERINO", cargo: "INSPECTOR CONTROL DE CALIDAD", area: "Control de Calidad" },
  { dni: "40780970", nombre: "NAPOLEON JAMES ESPINOZA MERINO", cargo: "INSPECTOR DE SUB PROCESOS", area: "Control de Calidad" },
  { dni: "47761400", nombre: "RONALD OMAR MENDOZA MIO", cargo: "TECNICO MAQUINISTA", area: "Serigrafía" },
  { dni: "48109407", nombre: "SIMON PEDRO CAMPOS MONTES", cargo: "TECNICO DE MANTENIMIENTO", area: "Mantenimiento" },
  { dni: "75870210", nombre: "PIERO MIGUEL REINEL MORENO", cargo: "ANALISTA DE FINANZAS", area: "Finanzas" },
  { dni: "73929851", nombre: "ANDRIU DARREN ROQUE ÑAHUIS", cargo: "ALMACENERO", area: "APT" },
  { dni: "15726642", nombre: "JORGE TEODOMIRO AYALA OCROSPOMA", cargo: "JEFE DE DESARROLLO DE PRODUCTO", area: "Diseño" },
  { dni: "71811957", nombre: "ROSA NATALY IBARRA OSORIO", cargo: "AYUDANTE DE SERIGRAFIA", area: "Serigrafía" },
  { dni: "71296219", nombre: "JOSE JUNIOR AVILA PACHECO", cargo: "ASISTENTE ADMINISTRATIVO", area: "Administracion" },
  { dni: "10659421", nombre: "DORIS CARLA CUEVA PALACIOS", cargo: "SUPERINT. ADMINISTRACION Y OPERACIONES", area: "Gerencia" },
  { dni: "06367673", nombre: "FERNANDO CARBAJAL PALACIOS", cargo: "SUB GERENTE", area: "Gerencia" },
  { dni: "09656310", nombre: "EDITH KARINA CHEVEZ PARCANO", cargo: "ADMINISTRADORA COMERCIAL", area: "Ventas" },
  { dni: "44888397", nombre: "CARLOS ANTHONY VALVERDE PARICAHUA", cargo: "DISEÑADOR DE MOLDES DE SOPLADO Y PRODUCTOS NUEVOS", area: "Diseño" },
  { dni: "70409513", nombre: "ALDO MARTIN CERNA PAZ", cargo: "TECNICO MATRICERO DE SOPLADO", area: "Matriceria" },
  { dni: "41105111", nombre: "ARTEMIO RIVERA PEÑA", cargo: "JEFE DE MANTENIMIENTO", area: "Mantenimiento" },
  { dni: "74555910", nombre: "SHEYLA LUCERO ESPINOZA PUIQUIN", cargo: "JEFE DE CONTROL DE CALIDAD", area: "Control de Calidad" },
  { dni: "10776981", nombre: "HUGO ESTEBAN SEGURA QUIÑONES", cargo: "DISEÑADOR DE MAQUINA Y AUTOMATIZACION", area: "Manufactura" },
  { dni: "42797919", nombre: "CESAR JANKARLO VENTURA QUISPE", cargo: "MATRICERO", area: "Manufactura" },
  { dni: "06716698", nombre: "MARIA CARLOTA BARBA RACCHUMI", cargo: "SECRETARIA / RECEPCIONISTA", area: "Administracion" },
  { dni: "10380434", nombre: "PERCY ALEJANDRO BEDON RAMIREZ", cargo: "AUXILIAR ALMACEN DE INSUMOS", area: "Logistica" },
  { dni: "70510693", nombre: "BRANDON ALEJANDRO RIVEROS REYES", cargo: "JEFE DE MANUFACTURA", area: "Manufactura" },
  { dni: "72839801", nombre: "MAYRA ABIGAIL YANCAN REYES", cargo: "PREVENCIONISTA", area: "SSOMA" },
  { dni: "46993234", nombre: "FRANCISCO FLORES RIVADENEYRA", cargo: "INSPECTOR CONTROL DE CALIDAD", area: "Control de Calidad" },
  { dni: "77278061", nombre: "YOSELYN LISETH ALEJANDRIA RODRIGUEZ", cargo: "ASISTENTE DE PLANEAMIENTO", area: "Administracion" },
  { dni: "40124609", nombre: "MILAGROS ROXANA ARANDA ROSELL", cargo: "ASISTENTE OPERATIVO", area: "Serigrafía" },
  { dni: "76762881", nombre: "LESLIE ROSSEMARY SARITA CORDOVA SALVADOR", cargo: "ANALISTA FINANCIERO Y CONTABLE", area: "Finanzas" },
  { dni: "10389576", nombre: "DAVID OMAR HUAMAN SALVATIERRA", cargo: "CONTROLADOR DE RECEPCIÓN", area: "APT" },
  { dni: "09508133", nombre: "JOSE LUIS SANDOVAL SANDOVAL", cargo: "CONDUCTOR", area: "APT" },
  { dni: "46521966", nombre: "ERINSSON EDWARD YZAGUIRRE SEMINARIO", cargo: "ANALISTA DE LABORATORIO", area: "Control de Calidad" },
  { dni: "44210304", nombre: "JOSE MANUEL ANGELES SILVA", cargo: "PROGRAMADOR OPERADOR CNC", area: "Manufactura" },
  { dni: "41064224", nombre: "DEYVIS ALONSO ORTIZ SUCLUPE", cargo: "TECNICO MATRICERO TORNERO CONVENCIONAL", area: "Matriceria" },
  { dni: "80214776", nombre: "OSCAR CARLOS AGUIRRE TEJADA", cargo: "TECNICO EN SERVICIOS GENERALES", area: "Mantenimiento" },
  { dni: "06921357", nombre: "SANTOS WALTER DIESTRA TOLENTINO", cargo: "JEFE DE DIRECCION TECNICA DE MATRICERIA", area: "Matriceria" },
  { dni: "75012320", nombre: "ALEXANDER JEFFRY IBAÑEZ TRUJILLO", cargo: "MATIZADOR DE SERIGRAFIA", area: "Serigrafía" },
  { dni: "08154939", nombre: "ALFREDO ARONI TUCNO", cargo: "TECNICO MATRICERO DE SOPLADO", area: "Matriceria" },
  { dni: "42306291", nombre: "JUAN ANGEL CHAVARRIA UCHOFEN", cargo: "TECNICO DE MANTENIMIENTO", area: "Mantenimiento" },
  { dni: "43137288", nombre: "JUAN PABLO SALGUERON ULLOA", cargo: "TECNICO DE MANTENIMIENTO", area: "Mantenimiento" },
  { dni: "75535404", nombre: "ALBERT VITO RODRIGUEZ URBANO", cargo: "PROGRAMADOR OPERADOR CNC", area: "Manufactura" },
  { dni: "73012556", nombre: "EDDY PERCY AVALOS VALDIVIA", cargo: "COORDINADOR DE LOGISTICA", area: "Logistica" },
  { dni: "47933789", nombre: "JEASON JESUS ALVAREZ VALENCIA", cargo: "COORDINADOR DE SOPLADO", area: "Matriceria" },
  { dni: "74585635", nombre: "EDDY ANDREWNS ZAPATA VALENCIA", cargo: "TECNICO MATRICERO DE SOPLADO", area: "Matriceria" },
  { dni: "44602885", nombre: "MARITZA LISSET CESPEDES VALENZUELA", cargo: "JEFE DE SSOMA", area: "SSOMA" },
  { dni: "80217013", nombre: "MANUEL RUIZ VASQUEZ", cargo: "EJECUTIVO COMERCIAL", area: "Ventas" },
  { dni: "75005808", nombre: "ROSA KAREN FUERTES VELASQUEZ", cargo: "DISEÑADOR DE MOLDES DE SOPLADO Y PRODUCTOS NUEVOS", area: "Diseño" },
  { dni: "48396286", nombre: "MITSHELL BASILIO CALLACNA VERA", cargo: "LIDER DE TRANSFORMACION DIGITAL E INTELIGENCIA NEG", area: "TRANSFORMACIÓN DIGITAL" },
  { dni: "41185112", nombre: "JOSE ANDRES SOSA YAGUANA", cargo: "TECNICO DE MANTENIMIENTO", area: "Mantenimiento" },
  { dni: "45634440", nombre: "JONATHAN CHRISTIAN CHAVEZ ZEVALLOS", cargo: "DISEÑADOR DE MATRICERIA", area: "Matriceria" },
  { dni: "74650643", nombre: "CHRISTIAN PEDRO FLORES ZORRILLA", cargo: "AUXILIAR DE MANTENIMIENTO", area: "Mantenimiento" },
  { dni: "76173868", nombre: "YUSI ELIARA CHEVEZ ZULOAGA", cargo: "EJECUTIVO COMERCIAL", area: "Ventas" },
];

// Las reglas del documento viven en shared/documento.js: el navegador las
// necesita en cada ingreso y no debe descargarse este archivo para tenerlas.
// Se reexportan para no romper a quien ya las importaba desde aquí.
export { DOC_VALIDO, normalizarDoc } from '#shared/documento.js';

/** Copia del padrón lista para guardar en la base. */
export function padronInicial() {
  return PERSONAL.map(p => ({ ...p }));
}
