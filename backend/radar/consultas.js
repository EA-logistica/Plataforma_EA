import { randomUUID } from 'node:crypto';
import { todos, uno, ejecutar } from '../db/conexion.js';
import { texto, claveGrado, gruposBusqueda, escaparRegex, interpretarProducto, APLICACIONES, MATERIALES } from '#shared/radar.js';

/**
 * Radar de Importaciones: lectura del esquema "radar" (lo llena el ETL en
 * Python, backend/radar/etl). Es la traducción a SQL directo de lo que hacía
 * la API FastAPI del repo RADAR-EA (radar/api.py y radar/analytics.py), con
 * las mismas reglas:
 *   - una fila es una SERIE de una declaración; las declaraciones se cuentan
 *     aparte (aduana + año + régimen + número);
 *   - FOB/kg ponderado solo con series que tienen FOB y kg (usd_kg no nulo);
 *   - FOB, CFR y CIF son valores declarados, no costo puesto en almacén;
 *   - el histórico distingue semanas respaldadas por bases MA+MB cargadas de
 *     las que faltan: un vacío no se pinta como cero.
 * Las fechas salen como texto 'YYYY-MM-DD' (to_char) para no correrlas de día
 * por la zona horaria.
 */

const error = (msg, status = 422) => Object.assign(new Error(msg), { status });
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const DIA = 86400000;
const aMs = f => Date.parse(f + 'T00:00:00Z');
const deMs = ms => new Date(ms).toISOString().slice(0, 10);
const sumarDias = (f, n) => deMs(aMs(f) + n * DIA);
const dias = (a, b) => Math.round((aMs(b) - aMs(a)) / DIA);

const DECLARACION = "(customs || year::text || regime || declaration)";
const PAREADA = 'usd_kg IS NOT NULL';
const BUSCABLE = "(search_text || ' ' || coalesce(grade_text, ''))";
const KG_PAREADO = `nullif(sum(CASE WHEN ${PAREADA} THEN net_kg END), 0)`;
const USD_KG = `(sum(CASE WHEN ${PAREADA} THEN fob_usd END) / ${KG_PAREADO})::float8`;

// ------------------------------------------------------------------ filtros
/**
 * Los filtros comunes (los mismos de la API original) → WHERE con parámetros
 * con nombre. `q` es la búsqueda libre por conceptos; el resto son campos.
 */
export function filtros(q = {}, { sinFechas = false } = {}) {
  const cond = [];
  const p = {};
  let n = 0;
  const v = valor => { const k = 'p' + (++n); p[k] = valor; return '@' + k; };
  const fecha = (k) => {
    const f = String(q[k] || '').trim();
    if (!f) return null;
    if (!FECHA.test(f)) throw error('Fecha inválida en "' + k + '" (AAAA-MM-DD).');
    return f;
  };
  if ((q.scope || 'plastics') === 'plastics') cond.push('plastics_scope');
  const start = fecha('start'), end = fecha('end');
  if (start && end && start > end) throw error('Rango de fechas inválido');
  if (!sinFechas) {
    if (start) cond.push('numbered_on >= ' + v(start) + '::date');
    if (end) cond.push('numbered_on <= ' + v(end) + '::date');
  }
  for (const campo of ['importer', 'supplier']) {
    const t = texto(q[campo]);
    if (t) cond.push('strpos(' + campo + ', ' + v(t) + ') > 0');
  }
  if (q.ruc) cond.push('importer_ruc = ' + v(String(q.ruc).trim()));
  if (q.origin) cond.push('origin = ' + v(String(q.origin).trim().toUpperCase()));
  if (q.material) cond.push('material = ' + v(String(q.material)));
  if (q.hs) cond.push('left(hs_code, length(' + v(String(q.hs).replace(/\D/g, '')) + '::text)) = @p' + n + '::text');
  if (q.review === 'true' || q.review === true) cond.push('needs_review');
  if (q.application) cond.push("strpos(applications, '|' || " + v(String(q.application)) + " || '|') > 0");
  if (q.brand) cond.push('brand ILIKE ' + v('%' + String(q.brand).replace(/[%_]/g, '') + '%'));
  if (q.grade) cond.push('grade_key = ' + v(claveGrado(q.grade)));
  for (const [k, op] of [['mi_min', '>='], ['mi_max', '<=']]) {
    if (q[k] != null && q[k] !== '') {
      const num = Number(q[k]);
      if (!Number.isFinite(num)) throw error('"' + k + '" debe ser un número.');
      cond.push('melt_index ' + op + ' ' + v(num));
    }
  }
  // Cada concepto debe aparecer; sus sinónimos con OR. \m…\M son límites de
  // palabra de PostgreSQL: "PP" no calza dentro de otra palabra.
  for (const grupo of gruposBusqueda(q.q)) {
    cond.push('(' + grupo.map(t => BUSCABLE + ' ~ ' + v('\\m' + escaparRegex(t) + '\\M')).join(' OR ') + ')');
  }
  return { cond, p, v, start, end, scope: (q.scope || 'plastics') };
}

const donde = (cond, extra = []) => {
  const todas = [...cond, ...extra];
  return todas.length ? ' WHERE ' + todas.join(' AND ') : '';
};

// ---------------------------------------------------------- agregados base
async function resumenDe(cond, p) {
  const r = await uno(
    'SELECT count(id) AS series, count(DISTINCT ' + DECLARACION + ') AS operations, sum(fob_usd)::float8 AS fob_usd, '
    + '(sum(net_kg) / 1000)::float8 AS tonnes, count(DISTINCT importer_ruc) AS importers, count(DISTINCT supplier) AS suppliers, '
    + 'count(*) FILTER (WHERE needs_review) AS pending_review, count(*) FILTER (WHERE supplier IS NULL) AS missing_supplier, '
    + USD_KG + " AS usd_kg, to_char(min(numbered_on), 'YYYY-MM-DD') AS start, to_char(max(numbered_on), 'YYYY-MM-DD') AS end "
    + 'FROM radar.operations' + donde(cond), p);
  return r;
}

async function tendencia(cond, p) {
  return todos(
    "SELECT to_char(date_trunc('week', numbered_on), 'YYYY-MM-DD') AS period, sum(fob_usd)::float8 AS fob_usd, "
    + '(sum(net_kg) / 1000)::float8 AS tonnes, ' + USD_KG + ' AS usd_kg, count(id) AS series '
    + 'FROM radar.operations' + donde(cond) + " GROUP BY 1 ORDER BY 1", p);
}

async function desglose(cond, p, campo, limite = 10) {
  return todos(
    'SELECT ' + campo + ' AS name, sum(fob_usd)::float8 AS fob_usd, (sum(net_kg) / 1000)::float8 AS tonnes, count(id) AS series '
    + 'FROM radar.operations' + donde(cond) + ' GROUP BY ' + campo + ' ORDER BY sum(fob_usd) DESC NULLS LAST LIMIT ' + limite, p);
}

/** CFR = FOB + flete; CIF = CFR + seguro. Por kg solo con series pareadas. */
const COLUMNAS_COSTO = 'count(id) AS series, (sum(net_kg) / 1000)::float8 AS tonnes, sum(fob_usd)::float8 AS fob_usd, '
  + 'sum(freight_usd)::float8 AS freight_usd, sum(insurance_usd)::float8 AS insurance_usd, sum(fob_usd + freight_usd)::float8 AS cfr_usd, '
  + 'sum(cif_usd)::float8 AS cif_usd, ' + USD_KG + ' AS fob_kg, '
  + `(sum(CASE WHEN ${PAREADA} THEN fob_usd + freight_usd END) / ${KG_PAREADO})::float8 AS cfr_kg, `
  + `(sum(CASE WHEN ${PAREADA} THEN cif_usd END) / ${KG_PAREADO})::float8 AS cif_kg, `
  + '(100 * sum(freight_usd) / nullif(sum(fob_usd), 0))::float8 AS freight_pct, (100 * sum(insurance_usd) / nullif(sum(fob_usd), 0))::float8 AS insurance_pct';

// ------------------------------------------------------------ panel general
export async function panel(q) {
  const { cond, p } = filtros(q);
  const [summary, trend, materials, countries, importers, suppliers, costs] = await Promise.all([
    resumenDe(cond, p), tendencia(cond, p), desglose(cond, p, 'material'), desglose(cond, p, 'origin'),
    desglose(cond, p, 'importer'), desglose(cond, p, 'supplier'),
    uno('SELECT ' + COLUMNAS_COSTO + ' FROM radar.operations' + donde(cond), p)
  ]);
  return { summary, trend, materials, countries, importers, suppliers, costs };
}

// ----------------------------------------------------------------- explorar
const CAMPOS_SERIE = "id, customs, year, declaration, series, to_char(numbered_on, 'YYYY-MM-DD') AS numbered_on, importer_ruc, importer, "
  + 'supplier, supplier_status, origin, acquisition_country, hs_code, description, material, classification_reason, needs_review, '
  + 'classification_locked, currency, quantity::float8 AS quantity, unit, net_kg::float8 AS net_kg, kg_method, fob_usd::float8 AS fob_usd, '
  + 'freight_usd::float8 AS freight_usd, insurance_usd::float8 AS insurance_usd, cif_usd::float8 AS cif_usd, usd_kg::float8 AS usd_kg, '
  + 'brand, grade, grade_key, application, applications, melt_index::float8 AS melt_index, density::float8 AS density, product_name, '
  + 'grade_info, quality_flags, source_url, artifact_id, updated_at';

const pagina = (v, def, max) => {
  const n = v == null || v === '' ? def : Math.trunc(Number(v));
  if (!Number.isFinite(n) || n < 1 || n > max) throw error('Página o tamaño fuera de rango.');
  return n;
};

export async function operaciones(q) {
  const { cond, p } = filtros(q);
  const page = pagina(q.page, 1, 1e6), size = pagina(q.page_size, 25, 100);
  const [{ total }, items] = await Promise.all([
    uno('SELECT count(*) AS total FROM radar.operations' + donde(cond), p),
    todos('SELECT ' + CAMPOS_SERIE + ' FROM radar.operations' + donde(cond)
      + ' ORDER BY numbered_on DESC, id DESC OFFSET ' + (page - 1) * size + ' LIMIT ' + size, p)
  ]);
  return { total, page, page_size: size, items };
}

export async function operacion(id) {
  const n = Math.trunc(Number(id));
  if (!Number.isFinite(n)) throw error('Serie inválida.', 400);
  const fila = await uno('SELECT ' + CAMPOS_SERIE + ', raw FROM radar.operations WHERE id = @id', { id: n });
  if (!fila) throw error('Serie no encontrada', 404);
  const [artifact, revisions, reviews] = await Promise.all([
    uno("SELECT id, source, url, downloaded_at, period, bytes FROM radar.artifacts WHERE id = @id", { id: fila.artifact_id }),
    todos('SELECT id, artifact_id, record_hash, raw, observed_at FROM radar.revisions WHERE operation_id = @id ORDER BY observed_at DESC', { id: n }),
    todos('SELECT * FROM radar.reviews WHERE operation_id = @id ORDER BY created_at DESC', { id: n })
  ]);
  return { ...fila, artifact, revisions, reviews };
}

/** Celda segura para CSV/Excel: un texto que empieza con =,+,-,@ no se ejecuta como fórmula. */
export const celdaSegura = v => (v == null ? '' : typeof v === 'string' && /^\s*[=+\-@]/.test(v) ? "'" + v : v);
const csv = v => { const s = String(celdaSegura(v)); return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };

const COLUMNAS_EXPORTAR = ['numbered_on', 'customs', 'year', 'declaration', 'series', 'importer_ruc', 'importer', 'supplier', 'supplier_status',
  'origin', 'material', 'hs_code', 'description', 'net_kg', 'fob_usd', 'freight_usd', 'insurance_usd', 'cif_usd', 'usd_kg', 'kg_method',
  'source_url', 'artifact_id'];

/** CSV (con BOM, para que Excel lea los acentos) de toda la selección, hasta 100 000 series. */
export async function exportarCsv(q) {
  const { cond, p } = filtros(q);
  const { total } = await uno('SELECT count(*) AS total FROM radar.operations' + donde(cond), p);
  if (total > 100000) throw error('Reduce filtros a 100 000 series para exportar');
  const filas = await todos('SELECT ' + CAMPOS_SERIE + ' FROM radar.operations' + donde(cond) + ' ORDER BY numbered_on, id', p);
  return '﻿' + [COLUMNAS_EXPORTAR.join(','), ...filas.map(f => COLUMNAS_EXPORTAR.map(k => csv(f[k])).join(','))].join('\r\n');
}

/** Corrección humana de la clasificación: queda bloqueada para que el ETL no la pise. */
export async function revisar(id, { material, note, actor }) {
  if (!MATERIALES.includes(material)) throw error('Material no permitido');
  const nota = String(note || '').trim();
  if (nota.length < 5 || nota.length > 1000) throw error('Explica el motivo (5 a 1000 caracteres).');
  const op = await uno('SELECT id, material FROM radar.operations WHERE id = @id', { id: Math.trunc(Number(id)) });
  if (!op) throw error('Serie no encontrada', 404);
  await ejecutar('INSERT INTO radar.reviews (operation_id, previous_material, material, note, actor, created_at) VALUES (@id, @prev, @mat, @nota, @actor, now())',
    { id: op.id, prev: op.material, mat: material, nota, actor: String(actor || 'Plataforma EA').slice(0, 100) });
  await ejecutar("UPDATE radar.operations SET material = @mat::text, classification_locked = true, needs_review = (@mat::text = 'Revisar'), "
    + "classification_reason = 'Revisión humana: ' || @nota, updated_at = now() WHERE id = @id", { id: op.id, mat: material, nota });
  return { status: 'saved' };
}

// ----------------------------------------------------------------- opciones
export async function opciones() {
  const [brands, origins, suppliers] = await Promise.all([
    todos('SELECT brand FROM radar.operations WHERE brand IS NOT NULL AND plastics_scope GROUP BY brand HAVING count(*) >= 2 ORDER BY brand'),
    todos('SELECT DISTINCT origin FROM radar.operations WHERE origin IS NOT NULL ORDER BY origin'),
    todos('SELECT DISTINCT supplier FROM radar.operations WHERE supplier IS NOT NULL ORDER BY supplier')
  ]);
  return { applications: APLICACIONES, materials: MATERIALES, brands: brands.map(r => r.brand), origins: origins.map(r => r.origin), suppliers: suppliers.map(r => r.supplier) };
}

// ----------------------------------------------------------------- empresas
export async function empresas(q) {
  const { cond, p } = filtros(q);
  return todos(
    'SELECT importer_ruc AS ruc, max(importer) AS name, sum(fob_usd)::float8 AS fob_usd, (sum(net_kg) / 1000)::float8 AS tonnes, '
    + 'count(DISTINCT ' + DECLARACION + ") AS operations, to_char(min(numbered_on), 'YYYY-MM-DD') AS first, to_char(max(numbered_on), 'YYYY-MM-DD') AS last "
    + 'FROM radar.operations' + donde(cond, ['importer_ruc IS NOT NULL'])
    + ' GROUP BY importer_ruc ORDER BY sum(fob_usd) DESC NULLS LAST LIMIT 500', p);
}

export async function empresa(ruc, q) {
  if (!/^\d{11}$/.test(String(ruc))) throw error('RUC inválido', 400);
  const { cond, p, v } = filtros(q);
  const c = [...cond, 'importer_ruc = ' + v(String(ruc))];
  const [nombre, summary, trend, materials, suppliers, countries, fechas] = await Promise.all([
    uno('SELECT max(importer) AS name FROM radar.operations' + donde(c), p),
    resumenDe(c, p), tendencia(c, p), desglose(c, p, 'material'), desglose(c, p, 'supplier'), desglose(c, p, 'origin'),
    todos("SELECT DISTINCT to_char(numbered_on, 'YYYY-MM-DD') AS d FROM radar.operations" + donde(c) + ' ORDER BY 1', p)
  ]);
  const saltos = fechas.slice(1).map((f, i) => dias(fechas[i].d, f.d));
  return {
    name: nombre?.name || null, ruc: String(ruc), summary, trend, materials, suppliers, countries,
    mean_days_between_active_dates: saltos.length ? saltos.reduce((a, b) => a + b, 0) / saltos.length : null
  };
}

// ---------------------------------------------------------------- productos
const ORDEN_GRADOS = { cif_usd: 'sum(cif_usd)', tonnes: 'sum(net_kg)', importers: 'count(DISTINCT importer_ruc)', cif_kg: 'cif_kg', melt_index: 'melt_index', last: 'max(numbered_on)' };

/** Un registro por grado (código de materia prima) con su ficha, descripción y quiénes lo importan. */
async function filasGrado(cond, p, v, { sort = 'cif_usd', page = 1, size = 20, compradores = false, preferirAplicacion = null }) {
  const c = [...cond, 'grade_key IS NOT NULL'];
  const orden = ORDEN_GRADOS[sort];
  if (!orden) throw error('Orden no permitido');
  const moda = col => 'mode() WITHIN GROUP (ORDER BY ' + col + ')';
  const preferir = preferirAplicacion ? 'CASE WHEN ' + moda('application') + ' = ' + v(preferirAplicacion) + ' THEN 0 ELSE 1 END, ' : '';
  const [{ total }, filas] = await Promise.all([
    uno('SELECT count(DISTINCT grade_key) AS total FROM radar.operations' + donde(c), p),
    todos('SELECT grade_key, ' + moda('grade') + ' AS grade, ' + moda('brand') + ' AS brand, ' + moda('product_name') + ' AS product_name, '
      + moda('material') + ' AS material, ' + moda('application') + " AS application, string_agg(DISTINCT applications, '') AS applications, "
      + 'min(melt_index)::float8 AS mi_min, max(melt_index)::float8 AS mi_max, (' + moda('melt_index') + ')::float8 AS melt_index, max(density)::float8 AS density, '
      + 'count(id) AS series, count(DISTINCT ' + DECLARACION + ') AS operations, count(DISTINCT importer_ruc) AS importers, '
      + "string_agg(DISTINCT importer, ' · ') AS importer_names, (sum(net_kg) / 1000)::float8 AS tonnes, sum(fob_usd)::float8 AS fob_usd, sum(cif_usd)::float8 AS cif_usd, "
      + `(sum(CASE WHEN ${PAREADA} THEN cif_usd END) / ${KG_PAREADO})::float8 AS cif_kg, `
      + "to_char(min(numbered_on), 'YYYY-MM-DD') AS first, to_char(max(numbered_on), 'YYYY-MM-DD') AS last "
      + 'FROM radar.operations' + donde(c) + ' GROUP BY grade_key ORDER BY ' + preferir + orden + ' DESC NULLS LAST, grade_key '
      + 'OFFSET ' + (page - 1) * size + ' LIMIT ' + size, p)
  ]);
  const claves = filas.map(f => f.grade_key);
  const ficha = new Map(), quienes = new Map();
  if (claves.length) {
    const pc = { ...p, claves };
    // La ficha más informativa del grado: catálogo > MI conocido > primera serie.
    const rango = gi => [Boolean(gi.catalog), gi.mi_source != null, Boolean(gi.summary)];
    const mejor = (a, b) => { for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i]; return false; };
    for (const r of await todos('SELECT grade_key, grade_info FROM radar.operations WHERE grade_key = ANY(@claves) ORDER BY grade_key, id', pc)) {
      const gi = r.grade_info || {};
      if (!ficha.has(r.grade_key) || mejor(rango(gi), rango(ficha.get(r.grade_key)))) ficha.set(r.grade_key, gi);
    }
    if (compradores) {
      for (const r of await todos('SELECT grade_key, importer_ruc, max(importer) AS importer, count(id) AS series, (sum(net_kg) / 1000)::float8 AS tonnes, '
        + `sum(cif_usd)::float8 AS cif_usd, (sum(CASE WHEN ${PAREADA} THEN cif_usd END) / ${KG_PAREADO})::float8 AS cif_kg, `
        + "to_char(max(numbered_on), 'YYYY-MM-DD') AS last, string_agg(DISTINCT origin, ', ') AS origins "
        + 'FROM radar.operations' + donde(c, ['grade_key = ANY(@claves)'])
        + ' GROUP BY grade_key, importer_ruc ORDER BY grade_key, sum(net_kg) DESC NULLS LAST', pc)) {
        const { grade_key: k, ...resto } = r;
        if (!quienes.has(k)) quienes.set(k, []);
        quienes.get(k).push(resto);
      }
    }
  }
  const items = filas.map(f => {
    const gi = ficha.get(f.grade_key) || {};
    const d = {
      ...f,
      applications: [...new Set(String(f.applications || '').split('|').filter(Boolean))],
      importer_names: String(f.importer_names || '').split(' · ').filter(Boolean)
    };
    for (const k of ['polymer', 'family', 'summary', 'mi_hint', 'mi_condition', 'mi_source', 'application_source', 'source_url', 'confidence',
      'catalog', 'catalog_applications', 'iv', 'application_mismatch']) d[k] = gi[k] ?? null;
    if (compradores) d.buyers = quienes.get(f.grade_key) || [];
    return d;
  });
  return { total, page, page_size: size, items };
}

/** Buscador de Productos: 'hdpe inyeccion' → grados que cumplen, con su ficha y TODAS las empresas que los importaron. */
export async function productos(q) {
  const interpretacion = interpretarProducto(q.p);
  const { cond, p, v } = filtros(q);
  const c = [...cond];
  if (interpretacion.family) {
    const fam = v(interpretacion.family) + '::text';
    c.push("(material = " + fam + " OR (grade_info ->> 'family') = " + fam + ')');
  }
  if (interpretacion.application) c.push("strpos(applications, '|' || " + v(interpretacion.application) + " || '|') > 0");
  if (interpretacion.mi_min != null) c.push('melt_index >= ' + v(interpretacion.mi_min));
  if (interpretacion.mi_max != null) c.push('melt_index <= ' + v(interpretacion.mi_max));
  for (const t of interpretacion.terms) c.push('(' + BUSCABLE + ' ~ ' + v('\\m' + escaparRegex(t) + '\\M') + ' OR grade_key = ' + v(claveGrado(t)) + ')');
  const cifKg = `(sum(CASE WHEN ${PAREADA} THEN cif_usd END) / ${KG_PAREADO})::float8`;
  const [summary, importers, brands, grados] = await Promise.all([
    uno('SELECT count(id) AS series, count(DISTINCT ' + DECLARACION + ') AS operations, count(DISTINCT importer_ruc) AS importers, '
      + '(sum(net_kg) / 1000)::float8 AS tonnes, sum(cif_usd)::float8 AS cif_usd, ' + cifKg + ' AS cif_kg, count(DISTINCT grade_key) AS grades, '
      + "count(*) FILTER (WHERE grade_key IS NULL) AS ungraded_series, to_char(min(numbered_on), 'YYYY-MM-DD') AS start, to_char(max(numbered_on), 'YYYY-MM-DD') AS end "
      + 'FROM radar.operations' + donde(c), p),
    todos('SELECT importer_ruc AS ruc, max(importer) AS name, count(id) AS series, count(DISTINCT ' + DECLARACION + ') AS operations, '
      + '(sum(net_kg) / 1000)::float8 AS tonnes, sum(cif_usd)::float8 AS cif_usd, ' + cifKg + " AS cif_kg, to_char(max(numbered_on), 'YYYY-MM-DD') AS last, "
      + "string_agg(DISTINCT grade, ' · ') AS grades, string_agg(DISTINCT brand, ' · ') AS brands, string_agg(DISTINCT origin, ', ') AS origins "
      + 'FROM radar.operations' + donde(c) + ' GROUP BY importer_ruc ORDER BY sum(net_kg) DESC NULLS LAST LIMIT 200', p),
    todos('SELECT brand AS name, count(id) AS series, (sum(net_kg) / 1000)::float8 AS tonnes, sum(cif_usd)::float8 AS cif_usd, count(DISTINCT grade_key) AS grades '
      + 'FROM radar.operations' + donde(c, ['brand IS NOT NULL']) + ' GROUP BY brand ORDER BY sum(net_kg) DESC NULLS LAST LIMIT 15', p),
    filasGrado(c, p, v, {
      sort: q.sort || 'tonnes', page: pagina(q.page, 1, 1e6), size: pagina(q.page_size, 12, 50),
      compradores: true, preferirAplicacion: interpretacion.application
    })
  ]);
  return { query: q.p || '', interpretation: interpretacion, summary, importers, brands, grades: grados };
}

// ---------------------------------------------------------------- histórico
const inicioCubeta = (f, grano) => {
  if (grano === 'day') return f;
  if (grano === 'week') { const dow = (new Date(aMs(f)).getUTCDay() + 6) % 7; return sumarDias(f, -dow); }
  return f.slice(0, 8) + '01';
};
const finCubeta = (f, grano) => {
  if (grano === 'day') return f;
  if (grano === 'week') return sumarDias(f, 6);
  const [a, m] = f.split('-').map(Number);
  return deMs(Date.UTC(a, m, 0));
};
const cambioPct = (actual, previo, elegible = true) =>
  !elegible || actual == null || previo == null || previo === 0 ? null : (actual - previo) / Math.abs(previo) * 100;

/** Ventanas semanales con base MA y MB cargadas por una ejecución bulk confirmada (no basta con haber descargado). */
async function ventanasCargadas(scope) {
  const confirmadas = new Set();
  const permitidos = scope === 'plastics' ? ['plastics', 'all'] : ['all'];
  for (const r of await todos("SELECT parameters, result FROM radar.runs WHERE kind = 'bulk'")) {
    if (!permitidos.includes((r.parameters || {}).scope || 'plastics')) continue;
    for (const [k, val] of Object.entries(r.result || {})) if (val && typeof val === 'object' && 'inserted' in val) confirmadas.add(k);
  }
  const pares = new Map();
  for (const a of await todos("SELECT source, period FROM radar.artifacts WHERE source IN ('sunat_ma', 'sunat_mb')")) {
    const per = a.period || {};
    if (!confirmadas.has(per.end) || !FECHA.test(per.start || '') || !FECHA.test(per.end || '')) continue;
    const d = dias(per.start, per.end);
    if (d < 0 || d > 7) continue;
    const k = per.start + '|' + per.end;
    if (!pares.has(k)) pares.set(k, new Set());
    pares.get(k).add(a.source);
  }
  return [...pares].filter(([, s]) => s.has('sunat_ma') && s.has('sunat_mb'))
    .map(([k]) => { const [start, end] = k.split('|'); return { start, end }; })
    .sort((a, b) => a.start.localeCompare(b.start));
}

function cobertura(inicio, fin, cubiertos) {
  const total = dias(inicio, fin) + 1;
  let n = 0;
  for (let f = inicio; f <= fin; f = sumarDias(f, 1)) if (cubiertos.has(f)) n++;
  return { days: total, backed_days: n, backed_percent: Math.round(n / total * 1000) / 10, backed: n === total };
}

async function metricas(cond, p) {
  const r = await uno(
    'SELECT count(id) AS series, count(DISTINCT ' + DECLARACION + ') AS operations, sum(fob_usd)::float8 AS fob_usd, '
    + '(sum(net_kg) / 1000)::float8 AS tonnes, count(DISTINCT importer_ruc) AS importers, count(DISTINCT origin) AS origins, '
    + 'count(DISTINCT supplier) AS suppliers, ' + USD_KG + ' AS usd_kg, '
    + 'percentile_cont(0.5) WITHIN GROUP (ORDER BY usd_kg) AS median_usd_kg, percentile_cont(0.25) WITHIN GROUP (ORDER BY usd_kg) AS p25_usd_kg, '
    + 'percentile_cont(0.75) WITHIN GROUP (ORDER BY usd_kg) AS p75_usd_kg, count(*) FILTER (WHERE ' + PAREADA + ') AS priced_series, '
    + 'count(*) FILTER (WHERE net_kg IS NOT NULL) AS weighed_series, count(*) FILTER (WHERE fob_usd IS NOT NULL) AS valued_series, '
    + 'count(*) FILTER (WHERE needs_review) AS review_series, count(DISTINCT numbered_on) AS active_days '
    + 'FROM radar.operations' + donde(cond), p);
  const n = r.operations;
  r.ticket_usd = n && r.fob_usd != null ? r.fob_usd / n : null;
  r.tonnes_per_operation = n && r.tonnes != null ? r.tonnes / n : null;
  for (const [nombre, num] of [['priced_percent', 'priced_series'], ['weighed_percent', 'weighed_series'], ['review_percent', 'review_series']]) {
    r[nombre] = r.series ? Math.round(r[num] / r.series * 1000) / 10 : null;
  }
  return r;
}

async function lineaTiempo(cond, p, v, inicio, fin, grano, cubiertos) {
  const filas = await todos(
    "SELECT to_char(date_trunc('" + grano + "', numbered_on), 'YYYY-MM-DD') AS period, sum(fob_usd)::float8 AS fob_usd, "
    + '(sum(net_kg) / 1000)::float8 AS tonnes, count(id) AS series, count(DISTINCT ' + DECLARACION + ') AS operations, '
    + 'count(DISTINCT importer_ruc) AS importers, ' + USD_KG + ' AS usd_kg FROM radar.operations'
    + donde(cond, ['numbered_on >= ' + v(inicio) + '::date', 'numbered_on <= ' + v(fin) + '::date']) + ' GROUP BY 1 ORDER BY 1', p);
  const porPeriodo = new Map(filas.map(f => [f.period, f]));
  const salida = [];
  let acumulado = 0, previo = null;
  for (let cursor = inicioCubeta(inicio, grano); cursor <= fin;) {
    const final = finCubeta(cursor, grano);
    const a = cursor > inicio ? cursor : inicio, b = final < fin ? final : fin;
    const cov = cobertura(a, b, cubiertos);
    const completa = cov.backed && a === cursor && b === final;
    let fila = porPeriodo.get(cursor);
    if (!fila) {
      fila = Object.fromEntries(['fob_usd', 'tonnes', 'series', 'operations', 'importers'].map(k => [k, cov.backed ? 0 : null]));
      fila.usd_kg = null;
    } else fila = { ...fila };
    const status = completa ? 'backed' : fila.series || cov.backed_days ? 'partial' : 'missing';
    Object.assign(fila, { period: cursor, end: final, selection_start: a, selection_end: b, coverage: cov, status });
    acumulado += fila.fob_usd || 0;
    fila.observed_cumulative_fob = acumulado;
    fila.fob_change_percent = previo ? cambioPct(fila.fob_usd, previo.fob_usd, status === 'backed' && previo.status === 'backed') : null;
    salida.push(fila);
    previo = fila;
    cursor = sumarDias(final, 1);
  }
  return salida;
}

/**
 * Histórico y métricas: línea de tiempo diaria/semanal/mensual con su
 * cobertura, período actual vs. anterior (comparación válida solo si ambos
 * están respaldados, duran lo mismo y no se superponen), concentración top 5,
 * recurrencia y quiénes más movieron.
 */
export async function historico(q) {
  const grano = q.grain || 'week';
  if (!['day', 'week', 'month'].includes(grano)) throw error('Grano no permitido');
  const { cond: base, p, v, start: qInicio, end: qFin, scope } = filtros(q, { sinFechas: true });
  const limites = await uno("SELECT to_char(min(numbered_on), 'YYYY-MM-DD') AS min, to_char(max(numbered_on), 'YYYY-MM-DD') AS max FROM radar.operations"
    + (scope === 'plastics' ? ' WHERE plastics_scope' : ''));
  const ventanas = await ventanasCargadas(scope);
  const cubiertos = new Set();
  for (const w of ventanas) for (let f = w.start; f <= w.end; f = sumarDias(f, 1)) cubiertos.add(f);
  const inicios = [...ventanas.map(w => w.start), ...(limites.min ? [limites.min] : [])].sort();
  const fines = [...ventanas.map(w => w.end), ...(limites.max ? [limites.max] : [])].sort();
  const primero = inicios[0] || null, ultimo = fines[fines.length - 1] || null;
  const meta = {
    available_start: primero, available_end: ultimo, latest_base_end: ventanas.length ? ventanas[ventanas.length - 1].end : null, windows: ventanas,
    coverage_note: 'Ventanas de publicación MA/MB cargadas. Pueden contener rectificaciones; no garantizan exhaustividad nacional por fecha de numeración.',
    price_note: 'FOB/kg ponderado de series comparables; la mezcla de grados puede variar. Mediana y percentiles se calculan por serie, sin ponderación.'
  };
  if (!primero && !qInicio) return { meta, timeline: [], current: null, previous: null, comparison: null, metrics: null, movers: [] };
  const inicio = qInicio || primero || qFin;
  const fin = qFin || ultimo || inicio;
  if (!inicio || !fin || fin < inicio) throw error('Rango histórico inválido');
  if (dias(inicio, fin) > 3660) throw error('Selecciona un rango de hasta 10 años');
  // Por defecto se comparan los últimos 28 días respaldados por bases semanales.
  const actualFin = qFin || (ventanas.length ? ventanas[ventanas.length - 1].end : fin);
  const actualInicio = qInicio || [primero || inicio, sumarDias(actualFin, -27)].sort()[1];
  if (actualFin < actualInicio) throw error('El inicio supera el último período disponible');
  const cIni = String(q.compare_start || ''), cFin = String(q.compare_end || '');
  if (Boolean(cIni) !== Boolean(cFin)) throw error('Indica ambas fechas de comparación');
  if ((cIni && !FECHA.test(cIni)) || (cFin && !FECHA.test(cFin))) throw error('Fechas de comparación inválidas');
  const previoFin = cFin || sumarDias(actualInicio, -1);
  const previoInicio = cIni || sumarDias(previoFin, -dias(actualInicio, actualFin));
  if (previoFin < previoInicio || dias(previoInicio, previoFin) > 3660) throw error('Rango de comparación inválido');
  const covActual = cobertura(actualInicio, actualFin, cubiertos), covPrevio = cobertura(previoInicio, previoFin, cubiertos);
  const razones = [];
  if (!covActual.backed || !covPrevio.backed) razones.push('Faltan bases semanales en uno de los períodos');
  if (covActual.days !== covPrevio.days) razones.push('Los períodos tienen distinta duración');
  if (!(previoFin < actualInicio || previoInicio > actualFin)) razones.push('Los períodos se superponen');
  const elegible = !razones.length;
  const cActual = [...base, 'numbered_on >= ' + v(actualInicio) + '::date', 'numbered_on <= ' + v(actualFin) + '::date'];
  const cPrevio = [...base, 'numbered_on >= ' + v(previoInicio) + '::date', 'numbered_on <= ' + v(previoFin) + '::date'];
  const [actual, anterior, grupos, vistos, gruposPrevios, timeline] = await Promise.all([
    metricas(cActual, p), metricas(cPrevio, p),
    todos('SELECT importer_ruc AS ruc, max(importer) AS name, sum(fob_usd)::float8 AS fob_usd, count(DISTINCT ' + DECLARACION + ') AS operations '
      + 'FROM radar.operations' + donde(cActual, ['importer_ruc IS NOT NULL']) + ' GROUP BY importer_ruc ORDER BY sum(fob_usd) DESC NULLS LAST', p),
    todos('SELECT DISTINCT importer_ruc AS ruc FROM radar.operations' + donde(base, ['numbered_on < ' + v(actualInicio) + '::date', 'importer_ruc IS NOT NULL']), p),
    todos('SELECT importer_ruc AS ruc, sum(fob_usd)::float8 AS fob_usd FROM radar.operations' + donde(cPrevio, ['importer_ruc IS NOT NULL']) + ' GROUP BY importer_ruc', p),
    lineaTiempo(base, p, v, inicio, fin, grano, cubiertos)
  ]);
  const deltas = Object.fromEntries(['fob_usd', 'tonnes', 'operations', 'importers', 'usd_kg', 'ticket_usd'].map(k => [k, cambioPct(actual[k], anterior[k], elegible)]));
  const conocido = grupos.reduce((a, r) => a + (r.fob_usd || 0), 0);
  const top5 = grupos.slice(0, 5).reduce((a, r) => a + (r.fob_usd || 0), 0);
  const yaVistos = new Set(vistos.map(r => r.ruc));
  const previos = new Map(gruposPrevios.map(r => [r.ruc, r.fob_usd]));
  const extra = {
    ...actual,
    top5_share_percent: conocido > 0 ? top5 / conocido * 100 : null,
    identified_importer_fob_percent: actual.fob_usd > 0 ? conocido / actual.fob_usd * 100 : null,
    repeat_importers: grupos.filter(r => r.operations >= 2).length,
    first_observed_importers: grupos.filter(r => !yaVistos.has(r.ruc)).length,
    returning_importers: grupos.filter(r => yaVistos.has(r.ruc)).length
  };
  const movers = grupos.slice(0, 20).map(r => ({
    ...r, previous_fob_usd: previos.get(r.ruc) ?? null, change_percent: cambioPct(r.fob_usd, previos.get(r.ruc) ?? null, elegible),
    share_percent: r.fob_usd != null && conocido > 0 ? r.fob_usd / conocido * 100 : null, first_observed: !yaVistos.has(r.ruc)
  }));
  return {
    meta, grain: grano, timeline,
    current: { start: actualInicio, end: actualFin, coverage: covActual, metrics: actual },
    previous: { start: previoInicio, end: previoFin, coverage: covPrevio, metrics: anterior },
    comparison: { eligible: elegible, reasons: razones, deltas, zero_baseline_note: 'Sin porcentaje cuando el valor previo es cero o falta.' },
    metrics: extra, movers
  };
}

// ------------------------------------------------- fuentes y actualizaciones
/** Archivos, ejecuciones y cobertura: de dónde sale cada dato y si la carga terminó bien. */
export async function calidad() {
  const [coverage, ultima, artifacts, runs] = await Promise.all([
    resumenDe(['plastics_scope'], {}),
    uno('SELECT max(downloaded_at) AS d FROM radar.artifacts'),
    todos('SELECT id, source, url, downloaded_at, period, bytes FROM radar.artifacts ORDER BY downloaded_at DESC'),
    todos('SELECT * FROM radar.runs ORDER BY started_at DESC LIMIT 30')
  ]);
  return {
    coverage, last_download: ultima?.d || null, artifacts, runs,
    scope: 'Importación definitiva, series y períodos efectivamente cargados; no cobertura nacional completa.',
    freshness: 'Bases: publicación semanal anunciada por SUNAT. Consultas: frecuencia no verificada.',
    supplier_note: 'SUNAT puede ocultar proveedores. No se infieren a partir de marcas.',
    price_note: 'FOB USD/kg ponderado por kg de series comparables. No es precio final en almacén.'
  };
}

/**
 * Encola una carga para el worker (backend/radar/worker.js la ejecuta con el
 * ETL Python). Es la misma cola radar.runs que usaba RADAR-EA: un solo lugar
 * donde se pide y se registra cada actualización.
 */
export async function encolar(body = {}) {
  const pendientes = (await uno("SELECT count(*) AS n FROM radar.runs WHERE status IN ('queued', 'running')")).n;
  if (pendientes >= 5) throw error('Espera a que finalicen las cargas pendientes', 409);
  const kind = body.kind === 'query' ? 'query' : 'bulk';
  let parametros;
  if (kind === 'bulk') {
    const weeks = Math.trunc(Number(body.weeks ?? 1));
    if (!(weeks >= 1 && weeks <= 12)) throw error('Semanas: de 1 a 12.');
    parametros = { weeks, scope: body.scope === 'all' ? 'all' : 'plastics', force: Boolean(body.force) };
  } else {
    const tipo = body.query_kind === 'hs' ? 'hs' : 'importer';
    const valor = String(body.value || '');
    if (!new RegExp('^\\d{' + (tipo === 'importer' ? 11 : 10) + '}$').test(valor)) throw error('RUC/subpartida inválido');
    if (!FECHA.test(body.start || '') || !FECHA.test(body.end || '') || body.end < body.start || dias(body.start, body.end) > 366) {
      throw error('Fechas de consulta inválidas');
    }
    parametros = { kind: tipo, value: valor, start: body.start, end: body.end, force: Boolean(body.force) };
  }
  const id = randomUUID();
  await ejecutar("INSERT INTO radar.runs (id, kind, parameters, status, started_at, result) VALUES (@id, @kind, @par, 'queued', now(), '{}')",
    { id, kind, par: JSON.stringify(parametros) });
  return { id, status: 'queued' };
}

export async function reanudar(id) {
  const run = await uno('SELECT status FROM radar.runs WHERE id = @id', { id: String(id) });
  if (!run) throw error('Ejecución no encontrada', 404);
  if (run.status !== 'failed') throw error('Sólo se reanudan ejecuciones fallidas', 409);
  await ejecutar("UPDATE radar.runs SET status = 'queued', error = NULL WHERE id = @id", { id: String(id) });
  return { status: 'queued' };
}

/** Lo mínimo para el Dashboard y el encabezado de Radar: cuánto hay y cuándo se actualizó. */
export async function estado() {
  const [datos, ultima, cola] = await Promise.all([
    uno("SELECT count(*) AS series, count(DISTINCT importer_ruc) AS importers, sum(fob_usd)::float8 AS fob_usd, (sum(net_kg) / 1000)::float8 AS tonnes, "
      + "to_char(max(numbered_on), 'YYYY-MM-DD') AS hasta, to_char(min(numbered_on), 'YYYY-MM-DD') AS desde FROM radar.operations WHERE plastics_scope"),
    uno("SELECT id, kind, status, started_at, finished_at, error FROM radar.runs ORDER BY started_at DESC LIMIT 1"),
    uno("SELECT count(*) FILTER (WHERE status = 'queued') AS en_cola, count(*) FILTER (WHERE status = 'running') AS corriendo FROM radar.runs")
  ]);
  return { ...datos, ultimaEjecucion: ultima || null, ...cola };
}
