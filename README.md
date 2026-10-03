# Plataforma EA

Mensajería y encargos de Plásticos Nacionales: registro de solicitudes,
trazabilidad del despacho, guías de entrega e indicadores de costo.

Aplicación Node.js + PostgreSQL. El navegador no guarda nada: la verdad vive en el
servidor, así que lo que registra una persona lo ve el resto al instante, desde
cualquier PC de la red.

---

## Dirección en Plansa

La plataforma corre en la PC **`pla073li`** y se abre desde cualquier equipo
conectado a la red Tailscale de Plansa:

> **http://100.123.225.96:3000**  (o http://pla073li:3000 si MagicDNS está activo)

Desde la red local de la oficina: http://192.168.1.156:3000

Para que responda, en `pla073li` tiene que estar abierta la ventana de
`Iniciar Plataforma EA.bat` y el firewall debe tener la regla
**"Plataforma EA (puerto 3000)"** (entrada TCP 3000, solo desde Tailscale
`100.64.0.0/10` y la subred local).

---

## Arrancar

```bash
npm install     # solo la primera vez
npm start       # http://localhost:3000
```

La primera vez se crean las tablas en PostgreSQL y se siembran con el padrón de RR.HH.
(114 personas) y el histórico real de 2026: **1 600 servicios del 15 de enero al
15 de septiembre, S/ 35 234,60**.

```bash
npm run dev            # recarga al guardar
npm test               # las tres suites de pruebas
npm run db:reiniciar   # vacía y vuelve a sembrar la base
```

Al arrancar imprime por qué direcciones se llega, incluida la de Tailscale:

```
  Plataforma EA
  en esta PC   http://localhost:3000
  en la red    http://100.93.169.28:3000   (Tailscale)
  en la red    http://192.168.0.10:3000
```

Variables de entorno, para mover la base a un disco de red o cerrar el acceso:

| | |
|---|---|
| `PLANSA_PUERTO` | Puerto. Por defecto 3000. |
| `PLANSA_HOST` | Interfaz. Por defecto todas; `127.0.0.1` lo deja solo en esta PC. |
| `PLANSA_PG_URL` | Base PostgreSQL (va en `.env`, nunca al repo). |
| `PLANSA_DB` | SQLite de antes de la migración: solo lo lee `db:importar-sqlite`. |
| `PLANSA_RESPALDOS` | Carpeta de respaldos. Por defecto `respaldos/`. |
| `PLANSA_UPLOADS` | Carpeta de las guías. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USUARIO`, `SMTP_CLAVE`, `SMTP_DE` | Servidor de correo para el reporte semanal (opcional). |
| `REPORTE_PARA` | Destinatarios del reporte semanal, separados por coma. Sin esto, el reporte solo se abre a mano desde el Dashboard. |
| `REPORTE_DIA`, `REPORTE_HORA` | Cuándo sale el correo (hora de Lima). Por defecto lunes (1) a las 8. |

```bash
PLANSA_PUERTO=8080 PLANSA_UPLOADS=D:/datos/guias npm start
```

- **Acceso solicitante:** con un DNI del padrón, por ejemplo `73012556`.
- **Acceso logística:** usuario y clave. La siembra crea la cuenta
  `admin` / `admin` (rol admin, clave temporal): la aplicación pide cambiarla
  al primer ingreso. Desde ahí, admin crea el resto de cuentas —rol `admin` o
  `seguimiento`— en la pestaña **Usuarios**, con una clave temporal de un solo
  uso que solo se muestra una vez. Ver [Usuarios y roles](#usuarios-y-roles).

---

## Estructura

```
server.js                    Punto de entrada: arranca el servidor

backend/                     ← NODE.JS. Nada de esto llega al navegador.
  servidor.js                 Express: API, estáticos, apagado ordenado
  config.js                   Puerto, rutas y límites; todo por variable de entorno
  db/
    esquema.sql               DDL de las tablas: la forma de los datos, para una base nueva
    migrar.js                 Cambios de forma en una base que ya existe
    conexion.js               PostgreSQL (pg), transacciones, snake_case ↔ camelCase
    sembrar.js                Carga inicial: padrón + histórico 2026
    repos/                    Único sitio del proyecto que escribe SQL
      personal.js              padrón y búsqueda
      solicitudes.js           tickets, correlativo y flujo de estados
      paradas.js               destinos adicionales de un servicio con dos o más rutas
      autorizaciones.js        pedidos de acceso
      adjuntos.js              metadatos de las guías
      ajustes.js               testigo de revisión
      importaciones.js         importaciones del bot (Mongo) y sus hitos de rastreo
      mpPlaneacion.js          consumo / lead time por materia prima → ABC y reorden
  usuarios/                   Cuentas de logística: quién puede ENTRAR
    claves.js                  hash de claves (scrypt) y clave temporal
    repositorio.js              SQL de la tabla usuarios
    sesiones.js                 tokens en memoria (ingreso/salida)
    middleware.js               requiereSesion / requiereRol
    servicio.js                  reglas: ingresar, crear, resetear, (des)activar
    rutas.js                     /api/auth/* y /api/usuarios/*
  middleware/
    subida.js                 multer → uploads/, renombrado único
    limites.js                Freno de fuerza bruta, cabeceras, qué se publica
    errores.js                Formato uniforme de errores
  rutas/
    index.js                  La API REST completa (monta usuarios/rutas.js)
    compras.js                Compras y Logística: importaciones, materia prima, ABC…
    herramientas.js           Buscador global, exportar a Excel, reporte semanal
  reportes/semanal.js         Reporte semanal (HTML / PDF) y su envío por correo
  radar/                      Radar de Importaciones SUNAT (ver docs/radar/INTEGRACION.md)
    consultas.js               lectura del esquema "radar": panel, histórico, explorar…
    rutas.js                   /api/radar/*
    worker.js                  lanza y vigila el ETL Python; actualización diaria
    importar.js / instalar.js  migración única desde RADAR-EA · preparar el ETL
    etl/                       ETL Python (SUNAT → esquema radar), con sus pruebas

frontend/                    ← NAVEGADOR
  index.html                  Marcado de las vistas + import map
  css/styles.css              Hoja de estilos única (claro/oscuro/negro)
  js/
    main.js                   Arranque, listeners y puente window.*
    auth.js                   Ingreso por DNI / usuario+clave, apertura de vistas
    render.js                 Orquestador de repintado y sondeo
    config.js                 Constantes de la interfaz
    api/                      ← Lo único que habla con el servidor
      cliente.js               fetch, errores, URL base, token de sesión
      estado.js                Copia local del estado + escrituras
      adjuntos.js              Subida y descarga de guías
    state/ ui/ utils/          Sesión, tema, período global y utilidades
      ui/graficos.js            Gráficos SVG con tooltip y clic (una serie, un eje)
      ui/tablas.js              Toda tabla: encabezado fijo, columnas, Excel y PDF
      ui/buscador.js            Buscador global (Ctrl+K)
      ui/esqueleto.js           Carga con la forma de lo que llega
      ui/frescura.js            "Actualizado hace X min"
    views/                     Una vista por pestaña
      usuarios.js               Alta y gestión de cuentas (solo admin)
      dashboard.js              Dashboard por perfil: metas, tendencias, acciones pendientes
      importaciones.js          Seguimiento de importaciones (de la OC a la planta)
      abc.js                    Materia Prima → ABC y reorden
      radar/                   Radar: panel, histórico, explorar, productos, empresas
      payback/                 Pantalla del análisis payback

shared/                      ← CÁLCULO PURO. Lo usan el servidor Y el navegador.
  documento.js                Validar y normalizar un DNI, sin el padrón al lado
  exportarViajes.js           Columnas del reporte Excel (hoy solo las usa el servidor)
  cancelacion.js              Los tres motivos de cancelación, en un solo lugar
  radar.js                    Búsqueda de Radar (sinónimos, MI, grados), igual que el ETL
  homologados.js              Clasificación de materias primas homologadas
  importaciones.js            Atrasos, costo puesto en planta, pagos y completitud
  abc.js                      Clasificación ABC, cobertura y punto de reorden
  payback/                    Sin DOM, sin base de datos, sin red: se verifica
    planilla.js               en Node número por número.
    flota.js  demanda.js  capacidad.js  ruta.js  devengos.js
    escenarios.js  payback.js

data/                        ← DATOS DE REFERENCIA (código versionado)
  padron.js                   Las 114 personas de RR.HH.     ← NO se publica
  historico.js                Los 1 600 servicios de 2026    ← NO se publica
  destinos.js                 Destinos frecuentes + tarifa de referencia
  payback/                    Supuestos del análisis: jornada, ley, motos, zonas

uploads/                     ← Guías de entrega subidas (fuera de git)
radar-datos/                 ← Originales SUNAT de Radar y log del worker (fuera de git)
.env                         ← PLANSA_PG_URL con la clave de PostgreSQL (fuera de git)
tests/                       node tests/payback.mjs · importacionesAbc.mjs · api.mjs · frontend.mjs
docs/payback.md              El análisis payback, escrito
```

### Por qué `shared/` existe

El cálculo del payback es aritmética pura: no toca el DOM, ni la base, ni la
red. Ponerlo en `backend/` obligaría al navegador a pedir por HTTP cada cambio
del simulador de rutas; ponerlo en `frontend/` dejaría a la API sin poder
calcular. Está en medio, y lo importan los dos con el mismo especificador:

```js
import { comparar } from '#shared/payback/payback.js';
```

En Node lo resuelve el campo `imports` de `package.json`; en el navegador, el
`<script type="importmap">` de `index.html`. Un solo archivo en disco, dos
formas de encontrarlo, cero duplicación.

---

## La base de datos

**PostgreSQL 17**, instalado como servicio de Windows en la PC servidor
(`pla073li`), que arranca solo con la PC. La aplicación se conecta con el
usuario `plansa` a la base `plansa`; la dirección y la clave van en `.env`:

```
PLANSA_PG_URL=postgresql://plansa:<clave>@localhost:5432/plansa
```

La base usa collation `C` (orden por bytes, igual que el SQLite de antes).
PostgreSQL solo escucha en esta PC (`localhost`): el resto de la red entra a
la aplicación, no a la base. Para conectar otra plataforma o Power BI hay que
abrirla a propósito (`listen_addresses` y `pg_hba.conf`), idealmente con un
usuario de solo lectura.

Las tablas se definen en `backend/db/esquema.sql`. Las reglas viven en la
base, no solo en el código: un estado que no existe o una tarifa negativa los
rechaza PostgreSQL con un CHECK, aunque el bug esté en la pantalla. Las fechas
siguen siendo TEXT y los sí/no INTEGER 0/1, como en SQLite, para que nada fuera
de `backend/db/` tuviera que cambiar.

`personal` y `usuarios` son universos distintos y no hay que confundirlos:
`personal` es el padrón de RR.HH. (quién puede **pedir** un servicio, cientos
de filas); `usuarios` son las cuentas de logística (quién puede **entrar** a
despachar o administrar, unas pocas filas).

Todo el SQL está en `backend/db/repos/`. Ninguna ruta, ninguna vista y ningún
cálculo escriben una consulta. Los repositorios usan `todos()`, `uno()`,
`ejecutar()`, `insertarLote()` y `enTransaccion()` de `conexion.js`, todas
asíncronas.

### Traer los datos de un SQLite anterior

Hasta la migración la base era un archivo `plansa.sqlite`. Para pasar sus datos
(usuarios y claves, solicitudes, padrón, compras…) a PostgreSQL, con el
servidor apagado:

```bash
npm run db:importar-sqlite -- D:/copia/plansa.sqlite --reemplazar
```

`--reemplazar` vacía PostgreSQL y lo llena con el archivo, todo en una
transacción. Las guías (`uploads/`) se copian aparte, carpeta entera.

### Respaldos

`npm run db:respaldo` deja en `respaldos/<fecha>/` un `pg_dump` de la base y
una copia de `uploads/`, y conserva los últimos 14. Una tarea programada de
Windows ("Plataforma EA - respaldo") lo corre todos los días. Conviene que
`PLANSA_RESPALDOS` apunte a un disco de red o a una carpeta sincronizada,
**fuera de esta PC**. Restaurar (servidor apagado):

```bash
pg_restore --clean --if-exists -d "<PLANSA_PG_URL>" respaldos/<fecha>/plansa.dump
```

### Migraciones (`backend/db/migrar.js`)

`esquema.sql` usa `CREATE TABLE IF NOT EXISTS`: sirve para una base nueva,
pero no le cambia nada a una que ya existe. `migrar()` se corre solo al abrir
la base y aplica en orden los pasos que falten según `esquema_version` en
`ajustes`. La base PostgreSQL nació en la versión 3 (las v2 y v3 fueron de la
época de SQLite); los cambios nuevos empiezan en la 4.

### Pruebas

`npm test` crea una base PostgreSQL desechable (`plansa_prueba_…`) en el mismo
servidor, corre contra ella y la borra al terminar (ver `tests/pgTemporal.mjs`):
nunca toca la base real. El usuario de `.env` necesita permiso `CREATEDB`.

### Sincronización entre pestañas

Cada escritura mueve un testigo de revisión. El navegador sondea solo ese valor
—unos bytes— y recarga el estado completo únicamente cuando cambió de verdad.
Sin eso, con el histórico cargado, sondear cada dos segundos sería descargar
cientos de KB una y otra vez.

---

## Archivos y fotos

Las guías de entrega se suben con **multer** a `uploads/`. El nombre que manda
el usuario no se usa nunca como nombre en disco:

```
20260915-143012-a3f9c1-guia-de-entrega.jpg
│        │      │      │                └── extensión derivada del tipo declarado
│        │      │      └── nombre original saneado (sin tildes, sin espacios)
│        │      └── 6 caracteres al azar
│        └── hora
└── fecha
```

La marca de tiempo va primero para que la carpeta se ordene sola, y lleva azar
porque dos subidas en el mismo segundo son perfectamente posibles: el timestamp
por sí solo no garantiza unicidad. Construir el nombre desde cero también cierra
la puerta a un `../../backend/servidor.js` como nombre de archivo.

`uploads/` **no** se publica como carpeta estática. Los archivos se sirven por
`GET /api/adjuntos/:id/archivo`, que comprueba que el adjunto exista en la base;
exponer la carpeta permitiría listarla y adivinar nombres.

---

## La API

| | | Sesión |
|---|---|---|
| `GET /api/estado` | Todo lo que la pantalla necesita, en una llamada (sin el padrón) | — |
| `GET /api/revision` | El testigo, para el sondeo | — |
| `GET /api/auth/solicitante/:doc` | Busca un DNI en el padrón | — |
| `POST /api/solicitudes` | Registra un ticket propio | — |
| `GET /api/solicitudes/:id` | Consulta un ticket | — |
| `POST /api/autorizaciones` | Pide alta en el padrón | — |
| `GET /api/adjuntos` y `GET /api/adjuntos/:id/archivo` | Ver y descargar guías de entrega | — |
| `POST /api/auth/ingresar` | Usuario + clave → token | — |
| `POST /api/auth/salir` | Cierra el token actual | logística |
| `GET /api/auth/yo` | Quién es, según el token | logística |
| `PUT /api/auth/clave` | Cambia la clave propia (pidiendo la vigente) | logística |
| `PATCH /api/solicitudes/:id` | Transporte y tarifa | logística |
| `POST /api/solicitudes/:id/avanzar` | Mueve el ticket por el flujo | logística |
| `POST /api/solicitudes/:id/cancelar` | Cancela un servicio | — / logística* |
| `POST/DELETE /api/adjuntos` | Sube o quita una guía | logística |
| `GET /api/solicitudes/exportar` | Reporte de viajes en Excel, con `?desde=&hasta=` opcionales | logística |
| `GET /api/personal?q=` | Busca en el padrón; sin `q` no devuelve nada | **admin** |
| `POST/DELETE /api/personal` | Alta y baja manual en el padrón | **admin** |
| `GET /api/autorizaciones` | Lista los pedidos pendientes | **admin** |
| `PATCH /api/autorizaciones/:dni` | Aprueba o rechaza un pedido | **admin** |
| `GET /api/payback` | El análisis completo, en JSON | **admin** |
| `GET/POST /api/usuarios` | Lista y crea cuentas de logística | **admin** |
| `POST /api/usuarios/:id/restablecer` | Nueva clave temporal | **admin** |
| `PATCH /api/usuarios/:id` | Activa o desactiva una cuenta | **admin** |
| `GET /api/salud` | Estado del servidor y de la base | — |

En la columna Sesión, "logística" acepta cualquiera de los dos roles
(`admin` o `seguimiento`); "**admin**" en negrita exige ese rol puntual. El
control es del servidor (`backend/usuarios/middleware.js`), no de la pantalla:
ocultar un botón evita confundir a quien no puede usarlo, pero quien llame a
la API directo sin el rol que toca recibe igual 401 (sin sesión) o 403 (con
sesión, pero rol insuficiente).

\* Cancelar es la única ruta con sesión OPCIONAL (`sesionOpcional` en
`backend/usuarios/middleware.js`): sin token es el propio solicitante
cancelando lo suyo -motivo fijo "Usuario solicitó baja", solo mientras sigue
"En espera"-; con sesión de logística hay que elegir motivo (uno de tres, con
detalle obligatorio si es "Otros") y también se puede cancelar uno "En
tránsito". Ver [Cancelar un servicio](#cancelar-un-servicio).

Las validaciones de negocio también están en el servidor, no solo en la
pantalla: sin transporte no hay salida, sin tarifa no hay cierre, y un ticket
concluido ya no se modifica. Confiar en que el navegador lo valide deja la
puerta abierta a que un ticket se cierre sin costo y los indicadores mientan.

### Dos formas de exportar el histórico

- **CSV** (botón "Descargar CSV", 100 % en el navegador): 29 columnas en
  snake_case, todo como texto. Es el que consume Power BI / Looker Studio —
  las columnas nuevas (cancelación, paradas) se agregaron al final, para no
  romper ningún tablero que ya apunte a las que había antes.
- **Excel** (botón "Exportar a Excel", `GET /api/solicitudes/exportar`, lo
  arma el servidor con `exceljs`): las mismas columnas, pero con encabezados
  legibles y celdas TIPADAS -fecha y número de verdad, no texto-, para
  ordenar, sumar o armar una tabla dinámica en la propia hoja sin pasos
  previos. Acepta `?desde=AAAA-MM-DD&hasta=AAAA-MM-DD` para acotar por la
  fecha programada del viaje; sin ninguno de los dos, exporta todo.

### Histórico: filtros y paginación

La tabla pagina de a 20 filas -no un tope fijo con aviso de recorte, como
antes- para poder llegar a cualquier servicio pasando página, sin importar
cuántos haya. Cuatro filtros, combinables: **persona o DNI**, **ticket**,
**destino** y **rango de fechas** (por la fecha programada del viaje). El
botón "Exportar a Excel" toma como punto de partida el rango de fechas que ya
esté puesto en los filtros de la tabla.

### Transporte: iconos, no solo texto

Donde se muestra el vehículo asignado -bandeja, "Gestionar", seguimiento del
solicitante e histórico- va acompañado de un icono: una moto para
"Motorizado", un auto para "Carro". Es puramente visual (`iconoVehiculo` /
`vehiculoHTML` en `frontend/js/views/presenters.js`); el valor que se guarda y
se valida en el servidor no cambió.

### Dos o más rutas en una misma programación

Un servicio puede tener más de un destino: en "Nueva solicitud", el botón
"+ Agregar otra parada" agrega cuantas rutas adicionales hagan falta, cada una
con su propio destino (obligatorio, misma regla que el destino principal) y
contacto/teléfono (opcionales). El primer destino sigue siendo el campo de
siempre -`solicitudes.destino`-, así que nada de lo que ya existía tuvo que
cambiar; las paradas de más viven en su propia tabla (`paradas`, ver
`backend/db/repos/paradas.js`) y solo se cargan al crear el ticket, no se
editan después. Se muestran en el detalle del ticket (bandeja, "Gestionar",
seguimiento del solicitante) y se exportan en su propia columna, tanto en el
CSV como en el Excel.

---

## Cancelar un servicio

Un ticket cancelado no se ejecuta: queda como estado terminal (`Cancelado`),
igual de definitivo que `Concluido`, pero sin costo ni indicadores asociados.
No se borra —se audita—, con motivo, quién lo hizo y cuándo.

- **El propio solicitante** cancela lo suyo desde "Mis servicios", sin elegir
  motivo -el servidor pone "Usuario solicitó baja" solo- y solo mientras el
  ticket sigue "En espera": una vez que salió un mensajero, ya no es
  autoservicio.
- **Logística** (admin o seguimiento) cancela desde el modal "Gestionar" de
  la bandeja o el histórico, con uno de tres motivos obligatorios —"Usuario
  solicitó baja", "No autorizado" u "Otros" (este último con detalle en texto
  libre)— y puede cancelar también uno que ya está "En tránsito".
- Un ticket `Cancelado` ya no admite cambios de transporte/tarifa ni avanzar
  de estado, igual que uno `Concluido`.
- Los indicadores (KPI) excluyen los cancelados del valorizado, el promedio de
  viajes y los rankings; se cuentan aparte, en su propia tarjeta.

---

## Usuarios y roles

No confundir con el **padrón** (`data/padron.js` → tabla `personal`): eso es
quién puede *pedir* un servicio, y sigue sin clave, solo con el DNI. Esto es
quién puede *entrar a logística* — despachar, ver indicadores, administrar el
padrón — y ahora hace falta usuario y clave para todo.

| Rol | Puede |
|---|---|
| `admin` | Todo: bandeja, histórico, indicadores, payback, "Padrón y accesos" (alta/baja, resolver autorizaciones), crear y administrar usuarios. |
| `seguimiento` | Bandeja de despacho e histórico: asignar transporte y tarifa, mover el ticket por el flujo, cancelar un servicio, subir o quitar guías de entrega. No tiene "Padrón y accesos" -ni el botón ni la API se lo permiten-: si se topa con alguien fuera del padrón, se lo reporta a admin. |

Cómo se administran:

- **Solo admin crea usuarios y reparte claves.** Pestaña **Usuarios** →
  usuario + rol → se genera una clave temporal de 8 caracteres (sin `0/O` ni
  `1/I/l`, para dictarla por teléfono o anexo sin confusiones). Se muestra
  **una sola vez**, en un modal: el servidor solo guarda el hash (scrypt), así
  que si se pierde, la única salida es generar otra con "Nueva clave
  temporal".
- **Clave temporal → cambio obligatorio en la práctica.** El servidor marca
  `debeCambiarClave` y la pantalla lo recuerda al ingresar; el usuario la
  cambia por la propia desde "Mi clave", junto al botón de salir.
- **Desactivar, no borrar.** Una cuenta desactivada no puede volver a entrar y
  pierde al instante cualquier sesión abierta (no espera a que expire el
  token). Nadie puede desactivarse a sí mismo, para no dejar a logística sin
  nadie con acceso por accidente.
- **Las sesiones son tokens en memoria, sin tabla en la base**
  (`backend/usuarios/sesiones.js`), igual que el freno de fuerza bruta:
  duran 12 horas y se pierden si el servidor se reinicia. Es la misma decisión
  que ya regía para el freno de intentos: simple, y de sobra para una PC que
  se queda prendida durante el turno.

La cuenta `admin`/`admin` la crea `backend/db/sembrar.js` la primera vez que
arranca el servidor (o si la tabla `usuarios` queda sin ningún admin activo):
es el único punto de entrada inicial, así que conviene cambiar esa clave y
crear las cuentas de verdad antes de repartir el enlace de la red.

---

## Datos y producción

- **El padrón** (`data/padron.js`) son las 114 personas de RR.HH. Para
  actualizarlo se reemplaza esa lista y se corre `npm run db:reiniciar`. Las
  altas manuales de logística (`origen: 'manual'`) sobreviven a la recarga.
- **Documento de identidad.** Se guarda siempre en forma canónica: los DNI de
  7 dígitos, que el sistema de RR.HH. entrega sin el cero inicial, se completan
  a 8. La persona entra escriba `8161848` o `08161848`. Los de 9 dígitos son
  carnés de extranjería y se respetan tal cual.
- **El padrón no sale del servidor.** Son datos personales de todo el personal.
  La tabla aparece vacía y solo muestra las fichas que logística busca; la
  búsqueda la resuelve el servidor, ficha por ficha. `GET /api/estado` manda el
  conteo, no la lista, y `/data/padron.js` no se publica. Antes el navegador
  recibía el padrón completo para filtrarlo en local: la tabla no lo mostraba,
  pero bastaba abrir la consola para leer los 114 documentos.
- **Nada de datos inventados.** La base arranca con el histórico real de 2026,
  cargado como concluido. Lo que la planilla no registraba —vehículo, contacto,
  teléfono— se deja vacío en vez de rellenarse. Cada servicio lleva `fuente`
  (`historico` o `app`).
- **La hora del histórico es la programada, no la medida.** La planilla anota
  una hora de inicio y una de salida, pero el 89 % de las filas declara
  exactamente 60 minutos y el 92 % empieza justo cuando termina la anterior:
  es la grilla de la agenda. La de inicio se conserva como hora programada; los
  tiempos del flujo (`tsTransito`, `tsConcluido`) siguen vacíos y se llenan con
  los tickets que se registren en la app. La tarde venía en formato de 12 horas
  sin avisarlo y se normalizó a 24 por día, siguiendo el orden de anotación.
- No incluye IGV ni otros impuestos: es un registro operativo interno.

---

## Una prueba con gente conectada

Para que varias personas entren a la vez basta con dejar el servidor corriendo
y pasarles una de las direcciones que imprime al arrancar. Sobre Tailscale
funciona sin abrir nada en el router: quien esté en la red de la empresa entra
con la IP `100.x`.

Lo que ya está resuelto para eso:

| | |
|---|---|
| Respuestas comprimidas | El estado inicial baja de ~1 MB a ~70 KB |
| El padrón no viaja | Solo el conteo; las fichas se piden de a una |
| `data/` cerrado | Solo se publica lo declarado en `CONFIG.datosPublicos` |
| Freno de fuerza bruta | 10 intentos fallidos por IP y a esperar 5 minutos |
| Cabeceras | `nosniff`, `X-Frame-Options`, CSP, sin `X-Powered-By` |
| Tabla paginada | El histórico pinta 20 filas por página, no el total; el CSV y el Excel sí exportan todas |
| Sesiones de verdad | Usuario + clave por persona (ver [Usuarios y roles](#usuarios-y-roles)); la API rechaza sin token lo que antes aceptaba de cualquiera |

**Lo que sigue sin estar, y hay que saberlo antes de repartir el enlace:**

- **El tráfico va en HTTP.** Dentro del tailnet va cifrado por Tailscale; en la
  LAN de la planta, no. Una clave (temporal o no) que viaje por la LAN sin
  Tailscale de por medio se puede capturar.
- **Los tokens de sesión son un valor fijo por 12 horas, en memoria.** Sirven
  para esta prueba, en una red de confianza; no son cookies con flags de
  seguridad ni tienen renovación. **No expongas esto con Tailscale Funnel ni
  con un port forwarding**: la base tiene 114 documentos de identidad reales.
- **El padrón sigue sin clave, a propósito.** Cualquiera con un DNI del
  padrón registra solicitudes a su nombre; no hay forma de que finjan ser
  logística (eso sí pide usuario y clave), pero tampoco hay forma de que
  logística sepa si de verdad fue esa persona quien pidió el servicio.

Si la prueba sale bien y esto pasa a ser permanente, el siguiente paso es
HTTPS, y recién ahí pensar en accesos desde fuera de la red de la empresa.

---

## Análisis payback

El módulo que compara tercerizar la mensajería contra tener motorizado propio
—tres escenarios, capacidad, simulador de rutas y calendario de beneficios
sociales— está documentado aparte en **[docs/payback.md](docs/payback.md)**.
