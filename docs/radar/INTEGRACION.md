# Radar de Importaciones dentro de Plataforma EA

Radar (antes el repositorio independiente **RADAR-EA**, con su propia base,
API FastAPI en el puerto 8000 e interfaz React) ahora es un apartado más de la
plataforma: **una sola base, un solo servidor, una sola interfaz**.

## Qué quedó dónde

| Pieza | Antes (RADAR-EA) | Ahora |
|---|---|---|
| Datos | PostgreSQL propia (`127.0.0.1:54329/radar`) | Esquema `radar` de la PostgreSQL de la plataforma |
| Esquema (DDL) | Migraciones Alembic 0001–0003 | `backend/db/migrar.js`, paso 9 (mismo modelo) |
| ETL (SUNAT, normalización, grados) | `radar/*.py` | `backend/radar/etl/radar/*.py` (sin cambios de lógica) |
| Worker de la cola | Proceso aparte que había que levantar | Proceso hijo del servidor (`backend/radar/worker.js`) |
| API | FastAPI (`radar/api.py`, `radar/analytics.py`) | Express, `/api/radar/*` (`backend/radar/consultas.js`, `rutas.js`) |
| Búsqueda (sinónimos, MI, grados) | `normalize.search_groups`, `grades.parse_product_query` | `shared/radar.js` (misma semántica) |
| Interfaz | React/Vite en otra pestaña del navegador | Menú **Mercado → Radar de Importaciones** (`frontend/js/views/radar/`) |
| Originales SUNAT (ZIP/DBF) | `RADAR-EA/data/raw` | `radar-datos/raw` (configurable con `RADAR_RAW_DIR`) |
| Logs del worker | `RADAR-EA/data/logs` | `radar-datos/logs/worker.log` |

Se descartaron, por estar cubiertos por la plataforma: la interfaz React
(`web/`), `radar/api.py`, `radar/analytics.py`, Alembic, Docker/Compose, el
PostgreSQL portátil (`scripts/local-db.mjs`) y los scripts de arranque propios.

## Cómo se mantiene sincronizado

- **Una sola escritura posible.** El worker de Python recibe del servidor la URL
  de la base de la plataforma con `search_path=radar` y la carpeta de
  originales. No tiene `.env` propio: no puede escribir en otra base.
- **Actualización automática.** Cada `RADAR_CADA_HORAS` (24 por defecto) el
  servidor encola una carga de las últimas `RADAR_SEMANAS` (2) semanas
  publicadas por SUNAT, si no hay otra en curso. El ETL es incremental e
  idempotente: lo que no cambió queda igual (no se duplica nada).
- **Carga manual.** Botón **Actualizar datos** en Radar: bases semanales o
  consulta por RUC/subpartida, con el historial de ejecuciones y reanudación
  de las fallidas.
- **Un solo worker.** Si se cae, el servidor lo vuelve a levantar; al apagar
  el servidor se termina el árbol de procesos completo. El worker toma un
  advisory lock en PostgreSQL: aunque hubiera dos, solo uno procesa la cola.

## Operación

```powershell
npm run radar:instalar   # una vez por PC: .venv + dependencias + Chromium de Playwright
npm run radar:test       # pruebas del ETL contra esta PostgreSQL (esquemas temporales)
npm test                 # pruebas de la plataforma (incluye /api/radar y las 5 pestañas)
```

`Iniciar Plataforma EA.bat` corre `radar:instalar` la primera vez si falta el
entorno. Sin Python, la plataforma arranca igual: Radar muestra lo ya cargado
y su encabezado avisa que el ETL está detenido.

Variables opcionales: `RADAR_PYTHON` (intérprete), `RADAR_RAW_DIR`,
`RADAR_WORKER=0` (no lanzar el worker), `RADAR_CADA_HORAS`, `RADAR_SEMANAS`.

## Migración de una instalación vieja

Se hizo una vez en esta PC (2026-10-02) con:

```powershell
npm run radar:importar -- --origen postgresql://radar:CLAVE@127.0.0.1:54329/radar --raw "C:\Users\JHANIRA VILELA\RADAR-EA\data\raw"
```

Copia las seis tablas tal cual (mismos id, valores exactos) en una
transacción, ajusta las secuencias, **mueve** los originales (no los copia) y
reescribe `artifacts.path`. Se negó a correr dos veces sobre datos existentes.
Verificado: 4.071 series idénticas campo a campo, 20 originales con su SHA-256
intacto, y las respuestas de `/api/radar/*` iguales a las de la API FastAPI
original en panel, costos, tendencia, Explorar, Empresas, histórico (día,
semana y mes, con comparación) y Productos.

La carpeta `C:\Users\JHANIRA VILELA\RADAR-EA` y su base quedan como respaldo de
solo lectura; ya no se usan. El acceso del escritorio "Radar Importaciones"
ahora abre la plataforma.
