/**
 * Materias primas homologadas (Data_export/HOMOLOGADOS_MATERIA PRIMA.xlsx):
 * de cada fila del Excel saca el código limpio y la categoría a la que
 * pertenece la resina, y la compara con el "Grupo Equiv." que trae el Excel.
 *
 * El grupo del Excel no sirve tal cual para agrupar: mezcla nombres
 * ("HDPE SOPLADO") con claves del bot ("hdpe_soplado"), mete clarificados,
 * randómicos y soplado bajo un mismo "PP COPO" y tiene códigos mal ubicados
 * (un PP copolímero en "hdpe-iny-g-02"). La categoría sale, en este orden:
 *   1. de la LÍNEA DEL ERP para ese código (productos.linea: "PP HOMO
 *      INYECCION", "HDPE SOPLADO"…), que es la clasificación oficial;
 *   2. si el código no está en el ERP o su línea es ambigua, de la
 *      descripción -polímero + proceso + tipo-;
 *   3. y si ni eso alcanza, del grupo del Excel.
 * Las otras fuentes quedan como control: si alguna contradice a la elegida,
 * la fila sale "Revisar" con el motivo.
 *
 * Puro (sin E/S): lo usan el servidor y los tests.
 */

export const CATEGORIAS = {
  HDPE_INY: 'HDPE INYECCIÓN',
  HDPE_SOP: 'HDPE SOPLADO',
  LLDPE_INY: 'LLDPE INYECCIÓN',
  PE_SOP: 'LLDPE / LDPE SOPLADO',
  PP_HOMO: 'PP HOMOPOLÍMERO',
  PP_IMP: 'PP COPOLÍMERO IMPACTO',
  PP_RAND_INY: 'PP RANDÓMICO / CLARIFICADO INYECCIÓN',
  PP_RAND_SOP: 'PP RANDÓMICO SOPLADO',
  PP_COPO: 'PP COPOLÍMERO (sin tipo)',
  OTRO: 'SIN CLASIFICAR'
};

/** "PP COPO" del Excel: abarca cualquier copolímero de PP, no un tipo concreto. */
const PP_COPO_AMPLIO = new Set(['PP_IMP', 'PP_RAND_INY', 'PP_RAND_SOP', 'PP_COPO']);

const normal = v => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()
  .replace(/[®™]/g, '').replace(/\s+/g, ' ').trim();

/** Índice de fluidez (M.I.) que figura en la descripción: "M.I. 0.35", "MI20", "M.I.: 80". */
export function indiceFluidez(nombre) {
  const m = normal(nombre).match(/\bM\.?\s?I\.?\s*:?\s*(\d+(?:[.,]\d+)?)/);
  return m ? Number(m[1].replace(',', '.')) : null;
}

/**
 * Grado Propilco/Esenttia ("12R88A", "08C01T", "16H95NA"): la letra dice el
 * tipo -H homopolímero, C copolímero impacto, R randómico-. Solo se usa cuando
 * la descripción no lo dice con palabras.
 */
function tipoPorGrado(n) {
  const m = n.match(/\b\d{2}([HCR])\d{2}/);
  return m ? { H: 'PP_HOMO', C: 'PP_IMP', R: 'PP_RAND_INY' }[m[1]] : null;
}

/** Categoría detectada de la descripción; OTRO si no alcanza para decidir. */
export function detectarCategoria(nombre) {
  const n = normal(nombre);
  const soplado = /SOPLADO|BLOW/.test(n);
  const inyeccion = /INYEC|INYECION/.test(n);

  if (/\bHDPE\b/.test(n)) {
    if (soplado || /\bHDB\b|\bBM\b/.test(n)) return 'HDPE_SOP';
    if (inyeccion) return 'HDPE_INY';
    const mi = indiceFluidez(n);
    return mi == null ? 'OTRO' : mi < 2 ? 'HDPE_SOP' : 'HDPE_INY';
  }
  // LLDPE, LDPE y el "LLPDE" mal tipeado del ERP.
  if (/\bL?L[DP]{2}E\b/.test(n)) {
    if (soplado) return 'PE_SOP';
    if (inyeccion) return 'LLDPE_INY';
    return 'OTRO';
  }
  if (/^PP\w*\b|POLIPROPILENO/.test(n)) {
    if (/HOMOPOL/.test(n)) return 'PP_HOMO';
    if (soplado) return 'PP_RAND_SOP';
    if (/IMPAC/.test(n)) return 'PP_IMP';
    if (/CLARIF|RANDO|RANDON/.test(n)) return 'PP_RAND_INY';
    return tipoPorGrado(n) || 'PP_COPO';
  }
  return 'OTRO';
}

/** El "Grupo Equiv." del Excel llevado a una categoría; 'PP_COPO_AMPLIO' para "PP COPO"; null si no trae. */
export function categoriaDeGrupo(grupo) {
  const g = normal(grupo).replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!g || /^[—–-]+$/.test(g)) return null;
  if (/^HDPE INY/.test(g)) return 'HDPE_INY';
  if (/^HDPE SOP/.test(g)) return 'HDPE_SOP';
  if (/^LLDPE INY/.test(g)) return 'LLDPE_INY';
  if (/^L?LDPE SOP/.test(g)) return 'PE_SOP';
  if (/HOMO/.test(g)) return 'PP_HOMO';
  if (/IMPACTO/.test(g)) return 'PP_IMP';
  if (/SOP\w* RANDOM|RANDOM\w* SOP/.test(g)) return 'PP_RAND_SOP';
  if (/INY\w* RANDOM|RANDOM\w* INY/.test(g)) return 'PP_RAND_INY';
  if (g === 'PP COPO') return 'PP_COPO_AMPLIO';
  return null;
}

/** `otra` no contradice a `clave`: vacía, igual, o "PP COPO"/sin tipo frente a un copolímero concreto. */
const compatible = (clave, otra) => !otra || otra === clave
  || ((otra === 'PP_COPO_AMPLIO' || otra === 'PP_COPO') && PP_COPO_AMPLIO.has(clave));
const especifica = c => Boolean(c) && c !== 'OTRO' && c !== 'PP_COPO_AMPLIO' && c !== 'PP_COPO';

/**
 * Categoría final y control a partir de las tres fuentes (claves de
 * CATEGORIAS; deGrupo y deErp pueden venir null o 'PP_COPO_AMPLIO').
 * coherencia: 'ok'; 'generico' (el Excel solo dice "PP COPO" y se precisó);
 * 'sin_grupo' (el Excel no trae grupo); 'revisar' (alguna fuente contradice
 * a la elegida, explicado en `motivo`).
 */
export function clasificar({ detectada, deGrupo = null, deErp = null }) {
  const clave = especifica(deErp) ? deErp
    : especifica(detectada) ? detectada
      : especifica(deGrupo) ? deGrupo
        : detectada !== 'OTRO' || deGrupo || deErp ? 'PP_COPO' : 'OTRO';
  const fuente = clave === deErp ? 'erp' : clave === detectada ? 'descripcion' : clave !== 'OTRO' ? 'grupo' : '';
  const motivos = [];
  if (!compatible(clave, deGrupo)) motivos.push('el grupo del Excel dice ' + (CATEGORIAS[deGrupo] || 'PP COPO'));
  if (fuente !== 'descripcion' && especifica(detectada) && !compatible(clave, detectada)) {
    motivos.push('la descripción indica ' + CATEGORIAS[detectada]);
  }
  const coherencia = motivos.length ? 'revisar'
    : !deGrupo ? 'sin_grupo'
      : deGrupo === 'PP_COPO_AMPLIO' && clave !== 'PP_COPO' ? 'generico' : 'ok';
  return { categoriaClave: clave, categoria: CATEGORIAS[clave], fuente, coherencia, motivo: motivos.join('; ') };
}

const sinEmoji = v => String(v ?? '').replace(/[\p{Extended_Pictographic}\u{1F3C5}-\u{1F3C7}️‍]/gu, '').trim();

function fechaIso(v) {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : v.toISOString().slice(0, 10);
  const m = String(v ?? '').match(/\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : '';
}

/** Valor de una celda de exceljs como texto o número plano. */
export function valorCelda(v) {
  if (v == null) return '';
  if (v instanceof Date) return v;
  if (typeof v === 'object') return v.result ?? v.text ?? (v.richText ? v.richText.map(x => x.text).join('') : '');
  return v;
}

const COLUMNAS = { codigo: 'CODIGO', nombre: 'NOMBRE', familia: 'FAMILIA', grupo: 'GRUPO', estado: 'ESTADO', preferencia: 'PREFERENCIA', fecha: 'FECHA' };

/**
 * Filas crudas (matriz de valores, una por fila de la hoja) → homologados.
 * Ubica el encabezado por nombre, no por posición: si alguien agrega o mueve
 * una columna en el Excel, sigue funcionando.
 */
export function parsearFilas(matriz) {
  const iEnc = matriz.findIndex(f => f.some(c => normal(c) === 'CODIGO'));
  if (iEnc === -1) throw new Error('El Excel de homologados no tiene la columna "Código".');
  const enc = matriz[iEnc].map(normal);
  const col = {};
  for (const [k, txt] of Object.entries(COLUMNAS)) col[k] = enc.findIndex(c => c.startsWith(txt));

  const vistos = new Set();
  const filas = [];
  for (const f of matriz.slice(iEnc + 1)) {
    const celda = k => (col[k] >= 0 ? f[col[k]] : '');
    const crudo = String(celda('codigo') ?? '');
    const codigo = (crudo.match(/\d{6,}(-[A-Z0-9]+)?/) || [''])[0];
    const nombre = String(celda('nombre') ?? '').trim();
    if (!codigo || !nombre) continue;

    const grupo = sinEmoji(celda('grupo'));
    const detectada = detectarCategoria(nombre);
    const deGrupo = categoriaDeGrupo(grupo);
    const n = normal(nombre);
    filas.push({
      codigo,
      nombre,
      familiaExcel: sinEmoji(celda('familia')),
      grupoExcel: /^[—–-]*$/.test(grupo) ? '' : grupo,
      // Todavía sin el ERP: el servidor vuelve a clasificar con la línea del código.
      detectada,
      deGrupo,
      ...clasificar({ detectada, deGrupo }),
      estado: sinEmoji(celda('estado')) || 'Sin registro',
      preferencia: sinEmoji(celda('preferencia')),
      fecha: fechaIso(celda('fecha')),
      conNota: crudo.includes('📝'),
      conAlerta: crudo.includes('⚠'),
      indiceFluidez: indiceFluidez(nombre),
      muestra: /MUESTRA/.test(n),
      agrupacion: /AGRUPACION/.test(n),
      duplicado: vistos.has(codigo)
    });
    vistos.add(codigo);
  }
  return filas;
}

// ------------------------------------------------------- descripción → código
/**
 * Empareja una descripción escrita a mano (la de una muestra) con el
 * catálogo del ERP. Pesa más lo que identifica a la resina -el grado
 * ("K8009", "HD-5502", "5502") y la marca- que lo genérico ("HDPE",
 * "SOPLADO"), y penaliza lo que el candidato tiene de más: así "SNETOR
 * HD-5502" prefiere "HDPE SOPLADO SNETOR HD-5502" a "BAYSTAR HD-5502
 * (MUESTRA-SNETOR)".
 */
const RUIDO = new Set(['MUESTRA', 'MUESTRAS', 'M', 'I', 'MI', 'DE', 'DEL', 'P', 'C', 'CON', 'LA', 'EL', 'Y', 'PARA', 'EN', 'G',
  'REEMPACADO', 'REEMPACADA', 'NUEVO', 'NUEVA']);
const GENERICAS = new Set(['HDPE', 'LLDPE', 'LDPE', 'LLPDE', 'PP', 'PPN', 'PPNI', 'PPNII', 'COPO', 'COPOLIMERO', 'HOMOPOLIMERO', 'HOMO',
  'IMPACTO', 'IMPAC', 'IMPACT', 'SOPLADO', 'INYECCION', 'INYECION', 'RANDOM', 'RANDON', 'RANDOMICO', 'CLARIF', 'CLARIFICADO',
  'POLIPROPILENO', 'POLIETILENO', 'UV', 'BLOW', 'MOLDING', 'MP']);

export function fichas(texto) {
  const n = normal(texto).replace(/\bM\.?\s?I\b\.?/g, ' ');
  const base = n.replace(/[^A-Z0-9.]+/g, ' ').split(' ').map(t => t.replace(/^\.+|\.+$/g, '')).filter(Boolean);
  // "HD-5502" y "HD 5502" también como "HD5502"; "BI850" también como "BI 850" no hace falta.
  const juntas = [...n.matchAll(/\b([A-Z]{1,4})[- ](\d{3,})\b/g)].map(m => m[1] + m[2]);
  return [...new Set([...base, ...juntas])].filter(t => !RUIDO.has(t));
}

function peso(t) {
  if (/[A-Z]/.test(t) && /\d/.test(t)) return 6;   // grado: K8009, HS5502XP
  if (/^\d+$/.test(t)) return t.length >= 3 ? 4 : 1; // 5502 sí; un "9" de M.I. casi no
  if (/^[\d.]+$/.test(t)) return 1;                 // 0.35
  return GENERICAS.has(t) ? 1 : 3;                  // marca o palabra propia
}

/** 0 a 1: cuánto de la descripción buscada está en la del candidato. */
export function puntuar(buscada, candidata) {
  const a = Array.isArray(buscada) ? buscada : fichas(buscada);
  const b = new Set(Array.isArray(candidata) ? candidata : fichas(candidata));
  let total = 0, acierto = 0, gradoBuscado = false, gradoHallado = false;
  for (const t of a) {
    const w = peso(t);
    total += w;
    if (w >= 4) gradoBuscado = true;
    if (b.has(t)) { acierto += w; if (w >= 4) gradoHallado = true; }
  }
  if (!total || (gradoBuscado && !gradoHallado)) return 0;
  const sobra = [...b].filter(t => !a.includes(t)).reduce((s, t) => s + peso(t), 0);
  return acierto / (total + sobra * 0.25);
}

/**
 * Los mejores candidatos del catálogo ([{codigo, descripcion, ...}]) para una
 * descripción. `seguro` cuando el primero es claro: puntaje alto y con
 * distancia del segundo -solo entonces se asigna el código sin preguntar-.
 */
export function coincidencias(descripcion, catalogo, max = 5) {
  const a = fichas(descripcion);
  const lista = catalogo.map(p => ({ ...p, puntaje: Math.round(puntuar(a, p.descripcion) * 100) / 100 }))
    .filter(p => p.puntaje >= 0.35)
    .sort((x, y) => y.puntaje - x.puntaje || String(y.codigo).localeCompare(String(x.codigo)))
    .slice(0, max);
  const [p1, p2] = lista;
  return { candidatos: lista, seguro: Boolean(p1 && p1.puntaje >= 0.7 && (!p2 || p1.puntaje - p2.puntaje >= 0.08)) };
}

/** Estado de una muestra → estado de homologación. */
export const ESTADO_HOMOLOGACION = {
  'Aprobada': 'Aprobado', 'Aprobada c/restricción': 'Aprobado c/restricción', 'Rechazada': 'Rechazado',
  'En evaluación': 'En evaluación', 'Recibida': 'En evaluación'
};
