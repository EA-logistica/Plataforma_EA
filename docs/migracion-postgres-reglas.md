# Reglas de la migración SQLite → PostgreSQL

Proyecto: Node 24, ESM, Express 4. La base pasó de `node:sqlite` (síncrono) a
PostgreSQL 17 con `pg` (asíncrono). La base de datos PG usa collation `C`
(builtin), así que ORDER BY de texto compara bytes, igual que SQLite.

## API nueva de `backend/db/conexion.js` (ya escrita, NO la cambies)

```js
import { todos, uno, ejecutar, ejecutarVarias, insertarLote, enTransaccion, aCamel, aSnake } from '../conexion.js';

await todos(sql, params)      // → filas[]            (antes .prepare(sql).all(...))
await uno(sql, params)        // → fila | undefined   (antes .prepare(sql).get(...))
await ejecutar(sql, params)   // → { changes, filas } (antes .prepare(sql).run(...)); `filas` = RETURNING
await ejecutarVarias(sql)     // varias sentencias sin parámetros (antes db().exec)
await insertarLote(tabla, columnas, filasObj, sufijo) // INSERT multi-fila en tandas; devuelve filas insertadas
await enTransaccion(async () => { ... })  // BEGIN/COMMIT; las consultas de adentro usan la misma conexión solas
```

- `params` puede ser un **arreglo** (para `?` posicionales) o un **objeto** (para
  `@nombre`). La traducción a `$1..$n` es automática. No mezcles `?` y `@` en la
  misma consulta. No hace falta reescribir los marcadores a `$n`.
- Antes `.all(a, b)` pasaba parámetros sueltos: ahora van en arreglo `[a, b]`.
- `lastInsertRowid` ya no existe: usa `RETURNING id` y lee `r.filas[0].id`.
- `db()` ya no existe. Ningún archivo debe importar `db`.
- `ajustes.leer/escribir/tocar/revision` ya son async (ver `backend/db/repos/ajustes.js`, úsalo de ejemplo). Siempre `await tocar(...)`.

## Reglas para cada repositorio

1. **Toda función exportada que toque la base pasa a ser `async`** y cada
   consulta se hace con `await`. Si una función llama a otra del repo (o de otro
   repo) que ahora es async, también `await`. Cuidado con `.map`/`.forEach`
   sobre llamadas async: usa `for...of` con `await` o `Promise.all`.
2. Funciones puras (validaciones, formateo) se quedan síncronas.
3. `enTransaccion(base => { base.prepare(...) })` → `enTransaccion(async () => { await ejecutar(...) })`.
   Las cargas masivas (cargarInicial, cargarHistorico, etc. con miles de filas)
   deben usar `insertarLote` en vez de un INSERT por fila. `insertarLote`
   devuelve cuántas filas entraron (respeta `ON CONFLICT DO NOTHING` vía `sufijo`).
   Para UPSERT: sufijo `'ON CONFLICT (codigo) DO UPDATE SET col = excluded.col, ...'`.
   OJO: en un mismo INSERT multi-fila PostgreSQL falla si dos filas chocan con la
   misma clave de conflicto en un DO UPDATE ("cannot affect row a second time"):
   deduplica en JS antes (quédate con la última) cuando uses DO UPDATE.

## SQL: diferencias SQLite → PostgreSQL a corregir

- **Alias en camelCase**: PostgreSQL pasa a minúsculas los identificadores sin
  comillas. `SELECT SUM(x) AS totalNeto` devuelve `totalneto`. Todo alias con
  mayúsculas debe ir entre comillas dobles: `AS "totalNeto"`. Revisa TODOS los alias.
- `LIKE` en SQLite no distingue mayúsculas (ASCII); en PG sí → usa `ILIKE`.
  `LIKE ... ESCAPE '\'` sigue valiendo (`ILIKE ... ESCAPE '\'`).
- `IFNULL(a,b)` → `COALESCE(a,b)`. `MAX(a,b)`/`MIN(a,b)` escalares → `GREATEST`/`LEAST`.
- `substr` sirve; `instr(a,b)` → `strpos(a,b)`. `length` sirve. `printf` → `format`/`to_char`.
- `strftime('%Y-%m', col)` sobre texto → `substr(col,1,7)` o `to_char(col::date, 'YYYY-MM')`.
  `date('now')` → `to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD')`; `datetime('now')` → `ahora_txt()`
  (función SQL ya creada en el esquema). `julianday(a) - julianday(b)` → `(a::date - b::date)` (entero en días)
  o `EXTRACT(EPOCH FROM (a::timestamp - b::timestamp))/86400.0`. `date(col, '-30 days')` → `(col::date - 30)`.
  Las columnas de fecha son TEXT: castea (`::date`, `::timestamp`) solo cuando haga falta y
  cuida valores vacíos `''` (usa `NULLIF(col,'')::date`).
- **GROUP BY estricto**: PG exige que toda columna no agregada del SELECT esté en
  GROUP BY (SQLite dejaba "columnas sueltas"). Arregla con MAX()/MIN() o agregándola.
- **Tipos en expresiones**: `SUM(col_integer)` y `COUNT(*)` vuelven como número
  (ya hay type parser). `ROUND(double, 2)` no existe en PG → `ROUND(x::numeric, 2)`.
  División entera `a/b` con enteros trunca en ambos; si SQLite daba real por ser
  REAL las columnas, en PG también (son DOUBLE PRECISION).
- Parámetros sin tipo: si PG se queja "could not determine data type of parameter",
  castea el marcador: `?::text`, `?::int`, `?::float8`.
- Comparación texto = número: PG no convierte sola (`col_text = 5` falla). Pasa
  strings o castea.
- `INSERT OR IGNORE` → `INSERT ... ON CONFLICT DO NOTHING`. `INSERT OR REPLACE` → `ON CONFLICT (...) DO UPDATE`.
- Booleanos: las columnas sí/no siguen siendo INTEGER 0/1 (la conexión convierte
  true/false a 1/0 en los parámetros). `WHERE activo` → `WHERE activo = 1`.
- `LIMIT ?` con parámetro sirve. `LIMIT -1` no existe → quítalo o usa `LIMIT ALL`.
- `PRAGMA ...` no existe: bórralo o reemplázalo.
- `rowid` no existe: usa `id`.
- Comillas dobles `"texto"` como string literal (SQLite lo toleraba) → comillas simples.
- `GLOB` → `~` (regex) o `LIKE`. `COLLATE NOCASE` → `lower(...)` o `ILIKE`.
- `json_*` de SQLite → funciones `json_build_object`, `json_agg`, `->>` de PG.
- `CAST(x AS REAL)` → `CAST(x AS DOUBLE PRECISION)`; `CAST(x AS INTEGER)` sirve.
- `||` concatena en ambos; `CONCAT` también existe.
- `total()` de SQLite (suma que da 0.0) → `COALESCE(SUM(x),0)`.

## Lo que NO debes hacer

- No cambies `backend/db/conexion.js`, `esquema.sql` ni `ajustes.js`.
- No cambies la forma de los objetos que devuelven las funciones (mismas claves
  camelCase, mismos tipos): el frontend y las pruebas dependen de eso.
- No agregues dependencias.
- Mantén el estilo y los comentarios en español del archivo; actualiza los
  comentarios que hablen de "SQLite síncrono" solo si quedan falsos.

## Cómo probar

La base PG local ya existe y tiene el esquema creado (credenciales en `.env`,
se leen solas). Puedes probar tus consultas con un script ESM temporal en el
directorio scratchpad que haga:

```js
import { abrir, cerrar } from 'file:///C:/Users/JHANIRA%20VILELA/Documents/PLATAFORMA_EA/Plataforma_EA-main/backend/db/conexion.js';
await abrir(); /* ... */ await cerrar();
```

Ejecuta con `node archivo.mjs` desde la raíz del proyecto (para que lea `.env`).
Las tablas del ERP pueden estar vacías (faltan los data/*.js en esta PC); para
probar consultas complejas puedes insertar filas de prueba DENTRO de
`enTransaccion` y lanzar un error al final para que se deshaga (rollback).
NO dejes datos de prueba en la base. NO arranques el servidor en el puerto 3000
(está ocupado por el servidor en producción).
