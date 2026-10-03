/**
 * Radar de Importaciones: reglas de búsqueda compartidas entre el servidor
 * (backend/radar/consultas.js) y las pruebas. Son la traducción a JS de
 * radar/normalize.py (search_groups) y radar/grades.py (grade_key,
 * parse_product_query) del ETL, con la misma semántica: si una cambia allá,
 * cambia aquí. El ETL sigue siendo quien CALCULA marca/grado/MI de cada serie;
 * esto solo interpreta lo que el usuario escribe en el buscador.
 */

export const MATERIALES = ['HDPE', 'LDPE', 'LLDPE', 'PE', 'PP', 'PET', 'Masterbatch', 'Aditivos', 'Otros', 'Revisar'];

export const APLICACIONES = [
  'Soplado', 'Inyección', 'Película / film', 'Tubería', 'Rafia / monofilamento', 'Termoformado / lámina',
  'Fibra / no tejido', 'Rotomoldeo', 'Cables', 'Recubrimiento', 'Tapas / compresión', 'Extrusión'
];

/** Sin acentos, en mayúsculas y con espacios simples (normalize.text). */
export const texto = v => String(v ?? '').normalize('NFKD').replace(/[^\x00-\x7F]/g, '').replace(/\s+/g, ' ').trim().toUpperCase();

/** Código de grado comparable: solo letras y dígitos (grades.grade_key). */
export const claveGrado = v => texto(v).replace(/[^A-Z0-9]/g, '');

const PALABRA = /[A-Z0-9]+(?:[.\-/][A-Z0-9]+)*/g;

const ALIAS = {
  HDPE: ['HDPE', 'PEAD', 'HIGH DENSITY POLYETHYLENE', 'POLIETILENO DE ALTA DENSIDAD'],
  LDPE: ['LDPE', 'PEBD', 'LOW DENSITY POLYETHYLENE', 'POLIETILENO DE BAJA DENSIDAD'],
  LLDPE: ['LLDPE', 'LINEAR LOW DENSITY', 'BAJA DENSIDAD LINEAL'],
  PP: ['PP', 'POLIPROPILENO', 'POLYPROPYLENE'],
  SOPLADO: ['SOPLADO', 'BLOW MOLDING', 'BLOW MOULDING'],
  INYECCION: ['INYECCION', 'INJECTION'],
  MI: ['MI', 'MFI', 'MELT INDEX', 'INDICE DE FLUIDEZ']
};

/**
 * Búsqueda libre de Explorar: todos los conceptos deben aparecer; dentro de
 * un concepto, cualquiera de sus sinónimos. Los decimales quedan enteros
 * ("0.35" no calza con "0.3509").
 */
export function gruposBusqueda(consulta) {
  const q = texto(consulta).replace(/,/g, '.');
  return (q.match(PALABRA) || []).map(t => ALIAS[t] || [t]);
}

/** Escapa un término para usarlo dentro de una regex de PostgreSQL (\m…\M). */
export const escaparRegex = t => t.replace(/[.*+?^${}()|[\]\\\/-]/g, '\\$&');

const FAMILIAS = [
  ['LLDPE', /\bLLDPE\b|\bPEBDL\b|\bPELBD\b|\bMLLDPE\b|\bLINEAL\b|LINEAR LOW/],
  ['HDPE', /\bHDPE\b|\bPEAD\b|ALTA DENSIDAD|HIGH DENSITY/],
  ['LDPE', /\bLDPE\b|\bPEBD\b|BAJA DENSIDAD|LOW DENSITY/],
  ['PP', /\bPP\b|POLIPROPILENO|POLYPROPYLENE|\bPROPILENO\b/],
  ['PET', /\bPET\b|TEREFTALATO/]
];
const APLICACION_TERMINOS = [
  ['Inyección', /\bINY\w*|\bINJ\w*/],
  ['Soplado', /\bSOPLAD\w*|\bBLOW MOLD\w*|\bBLOW\b|\bBOTELLAS?\b|\bFRASCOS?\b|\bBIDON\w*/],
  ['Película / film', /\bPELICULA\w*|\bFILMS?\b|\bBOLSAS?\b/],
  ['Tubería', /\bTUBERIA\w*|\bTUBOS?\b|\bPIPE\w*/],
  ['Rafia / monofilamento', /\bRAFF?IA\b|\bMONOFILAMENTO\w*|\bCINTAS?\b/],
  ['Termoformado / lámina', /\bTERMOFORM\w*|\bTHERMOFORM\w*|\bLAMINAS?\b/],
  ['Fibra / no tejido', /\bFIBRAS?\b|NO TEJIDO|\bNONWOVEN\b/],
  ['Rotomoldeo', /\bROTOMOLD\w*|\bROTOMOLDEO\b/],
  ['Cables', /\bCABLES?\b/],
  ['Recubrimiento', /\bRECUBRIM\w*|\bCOATING\b/],
  ['Tapas / compresión', /\bTAPAS?\b|\bCOMPRESION\b/],
  ['Extrusión', /\bEXTRUSION\b|\bEXTRUIDO\b/]
];
const MI_CONSULTA = /\b(?:MI|MFI|MFR|IF|MELT INDEX|INDICE DE FLUIDEZ|FLUIDEZ)\s*(<=?|>=?|=)?\s*(\d+(?:\.\d+)?)(?:\s*(?:-|A)\s*(\d+(?:\.\d+)?))?/;
const RELLENO = new Set(['DE', 'PARA', 'EL', 'LA', 'LOS', 'LAS', 'POR', 'Y', 'CON', 'GRADO', 'MOLDEO', 'POLIETILENO', 'RESINA', 'USO', 'EN', 'G/10', 'MIN', 'G', '10']);
const redondear3 = n => Math.round(n * 1000) / 1000;

/**
 * Buscador de Productos en lenguaje natural ("hdpe inyeccion", "pp rafia mi 3",
 * "certene soplado"): familia, aplicación y rango de MI se vuelven filtros; lo
 * que sobra (marca, grado) se busca literal. "MI 3" sin operador es ±15 %.
 */
export function interpretarProducto(consulta) {
  let t = texto(consulta).replace(/,/g, '.');
  const out = { family: null, application: null, mi_min: null, mi_max: null, terms: [] };
  const m = t.match(MI_CONSULTA);
  if (m) {
    const op = m[1], a = Number(m[2]), b = m[3];
    if (b) { out.mi_min = a; out.mi_max = Number(b); }
    else if (op && op.startsWith('<')) out.mi_max = a;
    else if (op && op.startsWith('>')) out.mi_min = a;
    else { out.mi_min = redondear3(a * 0.85); out.mi_max = redondear3(a * 1.15); }
    t = t.slice(0, m.index) + ' ' + t.slice(m.index + m[0].length);
  }
  for (const [nombre, rx] of FAMILIAS) {
    if (rx.test(t)) { out.family = nombre; t = t.replace(new RegExp(rx.source, 'g'), ' '); break; }
  }
  for (const [nombre, rx] of APLICACION_TERMINOS) {
    if (rx.test(t)) { out.application = nombre; t = t.replace(new RegExp(rx.source, 'g'), ' '); break; }
  }
  t = t.replace(/\b(?:POLIETILENO|POLYETHYLENE|PE)\b/g, ' ');
  out.terms = (t.match(PALABRA) || []).filter(w => !RELLENO.has(w));
  return out;
}
