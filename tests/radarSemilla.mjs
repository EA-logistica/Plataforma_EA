/**
 * Series de Radar para las pruebas (api.mjs y frontend.mjs): una semana con
 * bases MA y MB cargadas por una ejecución bulk confirmada, otra semana sin
 * base (parcial), dos importadores y tres grados. Mismo formato que deja el
 * ETL Python en el esquema radar.
 */
export async function sembrarRadar(ejecutar) {
  const art = (id, source, start, end) => ejecutar(
    "INSERT INTO radar.artifacts (id, source, url, path, downloaded_at, period, bytes) VALUES (@id::text, @source, 'https://sunat.test/' || @id::text, '/raw/' || @id::text, now(), @period, 10)",
    { id, source, period: JSON.stringify({ start, end }) });
  await art('a'.repeat(64), 'sunat_ma', '2026-09-14', '2026-09-20');
  await art('b'.repeat(64), 'sunat_mb', '2026-09-14', '2026-09-20');
  await art('c'.repeat(64), 'sunat_ma', '2026-09-07', '2026-09-13');
  await ejecutar("INSERT INTO radar.runs (id, kind, parameters, status, started_at, finished_at, result) VALUES "
    + "('11111111-1111-1111-1111-111111111111', 'bulk', '{\"weeks\": 2, \"scope\": \"plastics\"}', 'completed', now() - interval '1 hour', now(), "
    + "'{\"2026-09-20\": {\"inserted\": 4}, \"2026-09-13\": {\"inserted\": 1}}')");
  let n = 0;
  const op = (o) => ejecutar(
    'INSERT INTO radar.operations (country, regime, customs, year, declaration, series, numbered_on, importer_ruc, importer, supplier_status, origin, '
    + 'hs_code, description, material, classification_reason, needs_review, classification_locked, currency, net_kg, fob_usd, freight_usd, insurance_usd, '
    + 'cif_usd, usd_kg, search_text, quality_flags, raw, record_hash, source_priority, source_url, artifact_id, created_at, updated_at, plastics_scope, '
    + 'brand, grade, grade_key, application, applications, melt_index, grade_info) VALUES '
    + "('PE', '10', '118', 2026, @decl::text, 1, @fecha::date, @ruc, @imp, 'redacted', @origen, @hs, @desc, @mat, 'subpartida', @rev, false, 'USD', @kg, @fob, "
    + "@flete, 10, @fob::numeric + @flete::numeric + 10, @fob::numeric / @kg::numeric, @desc, '[]', '{}', md5(@decl::text), 20, 'https://sunat.test', @art, now(), now(), true, "
    + '@marca, @grado, @clave, @app, @apps, @mi, @info)',
    {
      decl: String(100000 + (++n)), fecha: o.fecha, ruc: o.ruc, imp: o.imp, origen: o.origen || 'US', hs: o.hs || '3901200000', desc: o.desc,
      mat: o.mat, rev: Boolean(o.rev), kg: o.kg, fob: o.fob, flete: 100, art: o.art || 'a'.repeat(64), marca: o.marca || null, grado: o.grado || null,
      clave: o.grado ? o.grado.replace(/[^A-Z0-9]/g, '') : null, app: o.app || null, apps: o.app ? '|' + o.app + '|' : null, mi: o.mi ?? null,
      info: JSON.stringify(o.info || {})
    });
  await op({ fecha: '2026-09-15', ruc: '20100367395', imp: 'EMPRESA PLASTICA SAC', desc: 'HDPE SOPLADO MI 0.35 FORMOLENE 5502B', mat: 'HDPE', kg: 24750, fob: 27690,
    marca: 'Formosa Plastics', grado: 'HB5502B', app: 'Soplado', mi: 0.35, info: { family: 'HDPE', summary: 'HDPE para soplado' } });
  await op({ fecha: '2026-09-16', ruc: '20100367395', imp: 'EMPRESA PLASTICA SAC', desc: 'POLIPROPILENO HOMOPOLIMERO INYECCION H200MA', mat: 'PP', kg: 20000, fob: 22000,
    origen: 'IN', hs: '3902100000', marca: 'Reliance', grado: 'H200MA', app: 'Inyección', mi: 23 });
  await op({ fecha: '2026-09-18', ruc: '20512345678', imp: 'OTRA INDUSTRIA SAC', desc: 'HDPE SOPLADO MI 0.35 FORMOLENE 5502B', mat: 'HDPE', kg: 10000, fob: 12000,
    marca: 'Formosa Plastics', grado: 'HB5502B', app: 'Soplado', mi: 0.35 });
  await op({ fecha: '2026-09-19', ruc: '20512345678', imp: 'OTRA INDUSTRIA SAC', desc: 'MASTERBATCH BLANCO', mat: 'Masterbatch', kg: 1000, fob: 3000, rev: true, hs: '3206110000' });
  await op({ fecha: '2026-09-10', ruc: '20512345678', imp: 'OTRA INDUSTRIA SAC', desc: 'LLDPE PELICULA', mat: 'LLDPE', kg: 5000, fob: 6000, art: 'c'.repeat(64) });
}
