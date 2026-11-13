# Panadería Digital – Backend

Node.js + TypeScript + Express + MongoDB (Mongoose) + Cloudinary + login con JWT.

## Puesta en marcha

1. Instalar dependencias: `npm install`
2. Copiar `.env.example` a `.env` y completar los valores:
   - `MONGODB_URI`: cadena de conexión de MongoDB Atlas.
   - `JWT_SECRET`: una clave larga y aleatoria.
   - `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY` y `CLOUDINARY_API_SECRET` (**obligatorias**: sin ellas la API no arranca): datos del Dashboard de Cloudinary.
   - `CLOUDINARY_WATERMARK_ID`, `WATERMARK_POSICION`, `WATERMARK_ANCHO` y `WATERMARK_OPACIDAD`: la marca de agua (ver [Fotos y marca de agua](#fotos-y-marca-de-agua)).
   - `CORS_ORIGINS` (opcional): dominios extra de la web, separados por coma. `https://panaderia-front-psi.vercel.app` y `http://localhost:5173` ya están permitidos en `src/index.ts`.
   - `ADMIN_USER` / `ADMIN_PASSWORD`: usuario y contraseña del jefe.
   - `ADMIN_EMAIL`: email del jefe, a donde le llega el código si se olvida la contraseña.
   - `SMTP_*` y `EMAIL_FROM` (opcionales): cuenta que manda ese código. Con Gmail, usá una contraseña de aplicación.
3. Crear los usuarios: `npm run crear-admin` (si ya existe, le actualiza la contraseña y el email). Lee `ADMIN_USER`, `ADMIN_PASSWORD` y `ADMIN_EMAIL` del `.env`; la app tiene **dos admins**, y para el segundo se pasan en el comando: `ADMIN_USER=… ADMIN_PASSWORD=… ADMIN_EMAIL=… npm run crear-admin`. Otro `ADMIN_USER` crea una cuenta más
   - Subir el logo de la marca de agua: `npm run subir-marca` (ver [Fotos y marca de agua](#fotos-y-marca-de-agua)).
   - (Opcional) Cargar 10 productos de ejemplo para probar el catálogo: `npm run sembrar`. Copia las fotos de los productos que ya tengan fotos (hace falta al menos uno) y saltea los nombres que ya existen, así que se puede correr más de una vez. Para sacarlos, se eliminan desde la app como cualquier producto (se borran también sus fotos).
   - (Opcional) Cargar clientes, pedidos e insumos de ejemplo para probar el inicio, la lista de pedidos y las métricas: `npm run sembrar-pedidos`. Arma unos 140 pedidos de los últimos 60 días hasta hoy (con señas, entregas, cancelaciones y cargados a mano) con los productos que ya hay y su precio de hoy, 18 clientes (algunos piden seguido) y 6 insumos con sus compras. No toca los clientes ni los pedidos que ya había. Si ya se corrió, no hace nada: `npm run sembrar-pedidos -- --rehacer` borra esos clientes y sus pedidos y los vuelve a armar con las fechas corridas a hoy (los insumos que ya existen se saltean). No corre contra la base de producción (`panaderia-producion`). Los teléfonos de ejemplo (11 5555-0001 en adelante) son de mentira: no les escribas.
   - Si la base tiene productos de antes de la anticipación: `npm run migrar-anticipacion` les pone 24 hs. Sin eso no se pueden editar. Solo toca los que no la tienen, así que se puede correr más de una vez.
   - Si trajiste el catálogo de producción a la demo (con `mongodump`/`mongorestore`), sus fotos siguen en el Cloudinary de producción: `npm run copiar-fotos` las sube a la cuenta del `.env` y les cambia la URL. Solo toca las que son de otra cuenta, así que se puede correr más de una vez. No corre contra la base de producción.
   - Si la base tiene pedidos de antes de la agenda: `npm run migrar-fecha-entrega` les pone fecha de entrega (ver [Agenda](#agenda)). Solo toca los que no la tienen, así que se puede correr más de una vez.
4. Levantar con `./run.sh`: revisa Node, dependencias (las instala si faltan), las variables del `.env`, la conexión a MongoDB, a Cloudinary y al SMTP, que exista el usuario admin (y que tenga email) y que el puerto esté libre. Si todo está bien, arranca en desarrollo (http://localhost:3000). Nunca imprime los valores del `.env`.
   - `./run.sh prod`: compila y corre lo compilado, como en Render.
   - `./run.sh check`: solo revisa, no levanta nada.
   - A mano: `npm run dev`, o `npm run build` y `npm start`.

## Deploy en Render

- Build Command: `npm install && npm run build`
- Start Command: `npm start`
- Cargar las variables del `.env` en _Environment_ (no subas el `.env` a Git).
- `CORS_ORIGINS` solo si la web suma otro dominio (sin `/` al final): `https://panaderia-front-psi.vercel.app` ya está fijo en `src/index.ts`.
- En MongoDB Atlas, permitir el acceso desde cualquier IP (`0.0.0.0/0`) en _Network Access_, porque Render no tiene IP fija en el plan gratuito.
- Ping de mantenimiento (UptimeRobot / cron-job.org): `GET /health`
- **Logs e índices, solo en Render.** Render define `RENDER=true` sola: con eso se guardan las peticiones en `logs` (Más → Logs y el aviso de IP sospechosa) y Mongoose crea los índices que falten. En la compu no, porque el `.env` apunta a la misma base que producción y las pruebas aparecían en Logs como clientes. Para probarlo en local: `GUARDAR_LOGS=true` y `CREAR_INDICES=true` en el `.env` (`src/config/entorno.ts`).

## Endpoints

### Públicos (los usa el catálogo que se envía por WhatsApp)

| Método | Ruta                                | Descripción                                                                                                                                                                                                                                                                         |
| ------ | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/health`                           | Responde `ok`                                                                                                                                                                                                                                                                       |
| GET    | `/api/catalogo`                     | Productos activos, paginados (ver [Listas paginadas y filtros](#listas-paginadas-y-filtros)). Cada uno trae `portada` (miniatura de la primera foto, o `null`) y `cantidadImagenes`, sin el array de fotos, y `puntajePromedio` y `cantidadRecomendaciones` sin las recomendaciones |
| GET    | `/api/catalogo/categorias`          | Los gustos (la lista fija de categorías), en orden: `[{ "nombre": "Dulce", "cantidad": 5 }, …]` (`cantidad` = productos activos)                                                                                                                                                    |
| GET    | `/api/catalogo/secciones`           | **La carta, agrupada por tipo**: todos los activos que coinciden, sin paginar (`?tipo=`, `?categoria=`, `?buscar=`, combinables). Secciones por nombre del tipo; los sin tipo, al final con `"tipo": null` (ver [Carta y filtros de la web](#carta-y-filtros-de-la-web)) |
| GET    | `/api/catalogo/filtros`             | Las opciones de los filtros de la web: los tipos y los gustos con al menos un producto activo, con su `cantidad` contada con el otro filtro puesto (`?tipo=`, `?categoria=`) |
| GET    | `/api/catalogo/:id`                 | Detalle de un producto activo, con todas sus fotos (`imagenes: [{ id, url, miniatura }]`) y sus recomendaciones (ver [Recomendaciones](#recomendaciones))                                                                                                                           |
| POST   | `/api/catalogo/:id/recomendaciones` | Dejar una recomendación sin login: `{ "puntaje": 5, "texto": "...", "autor": "..." }`. Solo productos activos. Máx. 10 por hora por IP y body de hasta 10kb                                                                                                                         |
| GET    | `/api/ajustes`                      | Lo que eligió el dueño para la web: `{ "estiloCatalogo": "vidriera" \| "carta" \| "dia-navidad" \| "noche-navidad", "cerrado": false, "mensajeCerrado": "", "productosPorDia": null, "tema": "claro" \| "oscuro" }`. `tema` es el de la app del dueño: la web se pinta igual (por defecto, `claro`). Sin cambios guardados, responde los de por defecto (`carta`, abierto, sin mensaje, sin productos por día). Con `cerrado: true`, `POST /api/pedidos` responde `409`. `productosPorDia` es la referencia de la [agenda](#agenda) del dueño: la web no la usa |
| GET    | `/api/datos-pago`                   | Los datos para transferirle al dueño, que la web le muestra al cliente después del pedido: `{ "nombreCompleto", "alias", "cbu", "billetera" }`. Si el dueño todavía no los cargó, `404`                                                                                             |
| POST   | `/api/carrito`                      | Cotizar el carrito: `{ "items": [{ "productoId": "...", "cantidad": 2 }] }` → precios actuales, subtotales, total, los productos que ya no están disponibles y los **días que puede elegir** para la entrega (`entrega`, ver [Agenda](#agenda)). No guarda nada (el carrito vive en el navegador). Máx. 300 cada 10 minutos por IP y body de hasta 10kb               |
| POST   | `/api/pedidos`                      | Hacer un pedido sin login (JSON, ver abajo). Máx. 30 pedidos **creados** por hora por IP (los rechazados no cuentan) y 150 intentos por hora, y body de hasta 10kb                                                                                                                                                                                           |

Body de `POST /api/pedidos`: `{ "cliente": { "nombre": "...", "telefono": "..." }, "items": [{ "productoId": "...", "cantidad": 2 }], "fechaEntrega": "2026-11-25", "nota": "...", "conEnvio": true, "intento": "8f3c…" }`. `intento` (opcional, de 16 a 64 letras, números o guiones) es una clave al azar que arma la web para cada intento de confirmar: si el mismo `intento` llega dos veces (dos toques a la vez, o se cortó la conexión después de guardarlo y el cliente volvió a confirmar), responde el pedido que ya estaba, sin crear otro. `fechaEntrega` es el día para el que lo quiere (`AAAA-MM-DD`): tiene que ser uno de los que ofrece `POST /api/carrito` (si no, `400` con el motivo; si el dueño lo marcó como lleno, `409`). ⚠️ Mientras dure la transición es opcional (la web de antes no la manda): ver [Agenda](#agenda). `conEnvio` es si quiere que se lo manden (`true`) o lo pasa a retirar (`false`); es opcional y sin él queda `false` (cualquier otro valor que no sea `true`, `false` o `null`: `400`). El precio y el total los calcula el servidor; lo que mande el cliente se ignora. Responde `201` con `{ id, items, total, estado, conEnvio, fechaEntrega, createdAt }`, sin datos de clientes. El total sale de la misma cuenta que `POST /api/carrito`, así que coincide con lo que el cliente vio en el carrito.

Respuesta de `POST /api/carrito`: `{ "items": [{ "productoId", "nombre", "precio", "cantidad", "subtotal", "portada" }], "noDisponibles": ["..."], "cantidadTotal": 3, "total": 28000, "entrega": { "desde": "2026-11-12", "hasta": "2026-11-30", "diasLlenos": ["2026-11-20"], "diasCasiLlenos": ["2026-11-18"] } }`. Los productos pausados o eliminados no son un error: vuelven en `noDisponibles` y no suman. Acepta un carrito vacío (total `0`) y las mismas reglas de ítems que el pedido (hasta 30 productos, cantidades enteras de 1 a 50, los repetidos se suman).

### Login y recuperación de contraseña (públicos)

| Método | Ruta                    | Body                                                                                                                   |
| ------ | ----------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| POST   | `/api/auth/login`       | `{ "usuario": "...", "password": "..." }` → `{ "token": "..." }`                                                       |
| POST   | `/api/auth/recuperar`   | `{ "email": "..." }` → `{ "mensaje": "..." }`. Manda un código de 6 dígitos al email del admin. Máx. 5 por hora por IP |
| POST   | `/api/auth/restablecer` | `{ "email": "...", "codigo": "123456", "password": "..." }` → `{ "token": "..." }`. Máx. 10 cada 15 minutos por IP     |

- `recuperar` responde siempre el mismo mensaje, exista o no el email. Si el SMTP no está configurado responde `503`, y si el envío falla, `502`.
- El código vence a los 15 minutos, sirve una sola vez y admite 5 intentos. Pedir otro invalida el anterior.
- `restablecer` pide una contraseña de 8 a 72 caracteres y devuelve un token, así la app entra directo. Si el código no sirve: `400` con `"Código inválido o vencido"`.

### Privados (header `Authorization: Bearer <token>`)

| Método | Ruta                                                  | Descripción                                                                                                                                                                                                                     |
| ------ | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/productos`                                      | Todos los productos, incluso los pausados, paginados y con filtros (además, `?estado=activo` o `?estado=pausado`). Cada uno con todas sus fotos y `puntajePromedio` y `cantidadRecomendaciones`, sin las recomendaciones        |
| GET    | `/api/productos/:id`                                  | Detalle de un producto, aunque esté pausado (el de `/api/catalogo/:id` solo muestra los activos), con sus recomendaciones                                                                                                       |
| POST   | `/api/productos`                                      | Crear (JSON sin fotos, o multipart/form-data con hasta 10 fotos en `imagenes`)                                                                                                                                                  |
| PUT    | `/api/productos/:id`                                  | Editar (JSON o multipart/form-data): solo cambia lo que viene. Un opcional se borra mandándolo vacío (`null` o `""`). Las fotos que vengan en `imagenes` se **suman** a las que ya tiene, hasta 10 en total (si se pasa: `400`) |
| PUT    | `/api/productos/:id/portada`                          | Cambiar la portada: `{ "imagenId": "..." }` pasa esa foto al primer lugar. Responde el producto completo                                                                                                                        |
| DELETE | `/api/productos/:id`                                  | Borrar (también borra sus fotos en Cloudinary)                                                                                                                                                                                  |
| POST   | `/api/productos/:id/imagenes`                         | Agregar **una** foto (multipart, campo `imagen`). Responde `201` con `{ id, url, miniatura }`. Es la que usa el front para subir en segundo plano                                                                               |
| DELETE | `/api/productos/:id/imagenes/:imagenId`               | Borrar una sola foto del producto (de Mongo y de Cloudinary). `imagenId` es el `id` de la foto                                                                                                                                  |
| DELETE | `/api/productos/:id/recomendaciones/:recomendacionId` | Borrar una recomendación (por ejemplo, una ofensiva). Recalcula el promedio. Responde `204`                                                                                                                                     |
| GET    | `/api/promos`                                         | La biblioteca de promos (fotos y videos para el estado de WhatsApp), la más nueva primero (ver [Promos](#promos)) |
| POST   | `/api/promos`                                         | Crear una promo (multipart: `titulo`, `texto` opcional y `archivo`: una foto de hasta 10 MB o un video de hasta 15 s y 50 MB). Responde `201` |
| PATCH  | `/api/promos/:id`                                     | Editar `titulo` y `texto` sin volver a subir el archivo (JSON). `texto` `null` o `""` lo borra |
| POST   | `/api/promos/:id/publicaciones`                       | Registrar que el dueño la compartió: suma 1 a `vecesPublicada` y guarda `ultimaPublicacion`. Responde la promo |
| DELETE | `/api/promos/:id`                                     | Borrar la promo (también su archivo en Cloudinary). Responde `204` |
| GET    | `/api/pedidos`                                        | Pedidos, del más nuevo al más viejo (`?estado=pendiente`, `?fechaEntrega=2026-11-25` para los de un día de la agenda, `?pagina=1`, `?limite=20`, máx. 100). Cada uno con su `saldo` y su `origen` (ver abajo)                                                                                             |
| GET    | `/api/pedidos/:id`                                    | Detalle de un pedido con los datos del cliente, su cantidad de pedidos el `saldo` y el `origen`                                                                                                                                             |
| POST   | `/api/pedidos/manuales`                               | Cargar un pedido que le hicieron al dueño por fuera de la web (WhatsApp, en persona). Mismo body que el pedido público (también `conEnvio` y `fechaEntrega`, pero cualquier día: sin las reglas de la agenda), más `"sena": { "monto": 35000 }` opcional. Responde `201` con el detalle (ver abajo) |
| PUT    | `/api/pedidos/:id/fecha-entrega`                      | Cambiar el día de entrega (el cliente pidió otro día): `{ "fechaEntrega": "2026-11-26" }`. Cualquier día, también uno marcado como lleno. Solo pedidos `pendiente` o `confirmado` (si no, `409`). Responde el detalle |
| PUT    | `/api/pedidos/:id/items`                              | Cambiar los productos de un pedido abierto (el cliente pidió sumar, sacar o cambiar algo): `{ "items": [{ "productoId": "...", "cantidad": 2 }] }`, la lista **completa**. Responde el detalle (ver [Editar un pedido](#editar-un-pedido)) |
| PUT    | `/api/pedidos/:id/sena`                               | Confirmar la seña: `{ "monto": 35000 }` (de 0 hasta el total; `0` = confirmado **sin seña**). Pasa a `confirmado`. Otra vez sobre un pedido confirmado, corrige el monto. Responde el detalle                                       |
| DELETE | `/api/pedidos/:id/sena`                               | Quitar la seña (por si se confirmó por error): vuelve a `pendiente`. Responde el detalle                                                                                                                                        |
| PUT    | `/api/pedidos/:id/entrega`                            | Marcar entregado, con o sin seña. Responde el detalle                                                                                                                                                                           |
| DELETE | `/api/pedidos/:id/entrega`                            | Deshacer la entrega: vuelve a `confirmado` si tiene seña, si no a `pendiente`. Responde el detalle                                                                                                                              |
| PUT    | `/api/pedidos/:id/cancelacion`                        | Cancelar el pedido (la seña, si tenía, queda registrada). Responde el detalle                                                                                                                                                   |
| DELETE | `/api/pedidos/:id/cancelacion`                        | Deshacer la cancelación: vuelve a `confirmado` o `pendiente`. Responde el detalle                                                                                                                                               |
| PUT    | `/api/pedidos/:id/visto`                              | Marcar que el dueño ya lo vio: deja de salir como nuevo. No cambia el estado ni `updatedAt`. Marcarlo otra vez no es un error. Responde el detalle |
| DELETE | `/api/pedidos/:id/visto`                              | Volver a marcarlo como nuevo (por si tocó sin querer). Responde el detalle |
| PUT    | `/api/pedidos/:id/envio`                              | El cliente quiere que se lo manden: `conEnvio: true`. Solo pedidos `pendiente` o `confirmado` (si no, `409`). Marcarlo otra vez no es un error. Responde el detalle |
| DELETE | `/api/pedidos/:id/envio`                              | Lo pasa a retirar: `conEnvio: false`. Las mismas reglas. Responde el detalle |
| GET    | `/api/clientes`                                       | Clientes con su cantidad de pedidos y la fecha del último                                                                                                                                                                       |
| GET    | `/api/clientes/:id`                                   | Un cliente con sus últimos 20 pedidos                                                                                                                                                                                           |
| PATCH  | `/api/ajustes`                                        | Cambiar los ajustes de la web: `{ "estiloCatalogo"?, "cerrado"?, "mensajeCerrado"?, "productosPorDia"?, "tema"? }` (el estilo, `vidriera`, `carta`, `dia-navidad` o `noche-navidad`; el mensaje, hasta 280 letras; `productosPorDia`, un entero de 1 a 1000 o `null` para sacarlo; `tema`, `claro` u `oscuro`: lo manda la app al cambiar el tema y la web lo usa para todos). Solo cambia lo que viene; un valor fuera de la lista da `400`. Responde los ajustes completos |
| PUT    | `/api/datos-pago`                                     | Cargar o reemplazar los datos de pago (ver abajo). Responde los datos guardados                                                                                                                                                 |
| DELETE | `/api/datos-pago`                                     | Borrar los datos de pago: la web deja de mostrarlos. Responde `204` (`404` si no había)                                                                                                                                         |
| GET    | `/api/insumos`                                        | Los insumos (harina, manteca…), por nombre, con el precio y la fecha de la última compra. Sin el historial |
| GET    | `/api/insumos/:id`                                    | Un insumo con su historial (`logs`), la entrada más nueva primero |
| POST   | `/api/insumos`                                        | Cargar un insumo: `{ "nombre": "Harina", "precio": 25000, "cantidad": 25, "unidad": "kg", "fecha": "2026-10-01" }` (`fecha` opcional: hoy). Responde `201` |
| PUT    | `/api/insumos/:id`                                    | Actualizarlo (una compra nueva o una corrección): solo lo que viene (`cantidad` y `unidad`, juntas). Suma una entrada al historial. Si una receta lo usa, no se le puede cambiar la unidad (`409`, ver [Recetas](#recetas)) |
| GET    | `/api/recetas`                                        | Las recetas, por nombre del producto, con su `rinde`, `costoTotal` y `costoPorUnidad` (sin los ingredientes) (ver [Recetas](#recetas)) |
| GET    | `/api/recetas/:productoId`                            | La receta de un producto, con lo que cuesta cada ingrediente con el último precio de su insumo. `404` si todavía no tiene |
| GET    | `/api/recetas/:productoId/produccion?unidades=24`     | Cuánto hace falta de cada ingrediente para hacer esas unidades, y lo que cuesta. Solo calcula, no guarda nada (ver [Hacer la receta](#hacer-la-receta)) |
| PUT    | `/api/recetas/:productoId`                            | Cargar o reemplazar la receta entera: `{ "rinde": 50, "ingredientes": [{ "insumo": "<_id>", "cantidad": 1000 }, { "nombre": "Agua", "unidad": "g", "cantidad": 200 }] }`. Responde la receta |
| PUT    | `/api/recetas/:productoId/precio`                     | Ponerle al producto el precio de venta que sale de la receta: `{ "multiplicador": 3, "redondeo": 100 }` → precio = `costoPorUnidad × 3`, al peso o, con `redondeo`, al múltiplo de arriba. Responde la receta (ver [Precio desde la receta](#precio-desde-la-receta)) |
| DELETE | `/api/recetas/:productoId`                            | Borrar la receta (el producto no se toca). Responde `204` (`404` si no tenía) |
| GET    | `/api/tipos`                                          | Los tipos de producto que armó el dueño (Tortas, Tartas, Alfajores…), por nombre, cada uno con `cantidadProductos` (ver [Tipos](#tipos)) |
| POST   | `/api/tipos`                                          | Crear un tipo: `{ "nombre": "Tortas" }`. Responde `201`; si ya existe (sin importar mayúsculas ni acentos), `409` |
| PUT    | `/api/tipos/:id`                                      | Renombrarlo: `{ "nombre": "Tortas heladas" }`. Los productos que lo usan muestran el nombre nuevo |
| DELETE | `/api/tipos/:id`                                      | Borrarlo: los productos que lo usaban quedan sin tipo (no se borra ninguno). Responde `204` |
| GET    | `/api/almacenamiento`                                 | Cuánto del plan de Cloudinary está usado (créditos, almacenamiento, ancho de banda y transformaciones) y qué tan cerca está del límite (ver [Almacenamiento](#almacenamiento)) |
| GET    | `/api/almacenamiento/archivos`                        | Las fotos de productos y las promos, **lo que más ocupa primero**, para elegir qué borrar (`?origen=producto` o `?origen=promo`, `?pagina=1`, `?limite=20`, máx. 100) |
| GET    | `/api/metricas/productos`                             | Los **productos más vendidos** en un rango de días (`?desde=2026-10-01&hasta=2026-10-31`, los dos opcionales), por unidades o por importe (`?orden=unidades` o `?orden=importe`), paginado (ver [Métricas](#métricas)) |
| GET    | `/api/metricas/gustos`                                | Lo vendido de **cada gusto**, del que más se vende al que menos (`?desde`, `?hasta`, `?orden`) |
| GET    | `/api/metricas/pedidos`                               | Los pedidos hechos en el rango: **por estado**, **web contra manuales**, **% de cancelados**, **ticket promedio** y **por día de la semana** |
| GET    | `/api/metricas/clientes`                              | Los clientes que compraron en el rango: **nuevos**, **los que vuelven** y los que compraron más de una vez |
| GET    | `/api/metricas/insumos`                               | **En qué insumos se gastó más** y **cuánto aumentó cada uno** respecto de la compra anterior |
| GET    | `/api/metricas/balance`                               | **Lo que entra por ventas, lo que sale en insumos y la ganancia**, con la serie por día, semana o mes (`?agrupar=dia\|semana\|mes`, por defecto `mes`) |
| GET    | `/api/resumen`                                        | **Lo de hoy** para el inicio de la app: cuántos pedidos se hicieron hoy y cuánto suman, cuántos siguen abiertos (esperando la seña o con la seña pagada) y los últimos 10 de hoy (ver [Resumen del día](#resumen-del-día)) |
| GET    | `/api/agenda`                                         | **La agenda del mes** (`?mes=2026-11`, sin él el de hoy): cada día con sus pedidos, sus productos, el color del punto y si está marcado como lleno (ver [Agenda](#agenda)) |
| PUT    | `/api/agenda/:fecha/cierre`                           | **«Agenda llena»**: la web deja de ofrecer ese día (`/api/agenda/2026-11-25/cierre`). Marcarlo otra vez no es un error. Responde el día |
| DELETE | `/api/agenda/:fecha/cierre`                           | Volver a abrir ese día. Desmarcarlo otra vez no es un error. Responde el día |
| PUT    | `/api/agenda/:fecha/quiere-hacer`                     | **Un día que quiere hacer menos**: `{ "quiereHacer": 3 }` (entero de 1 a 1000). Lo que le falta para llegar a `productosPorDia` se cuenta como ocupado (ver [Agenda](#agenda)). Responde el día |
| DELETE | `/api/agenda/:fecha/quiere-hacer`                     | Ese día vuelve a los productos de siempre. Responde el día |
| GET    | `/api/logs`                                           | **Las peticiones a la API**, la más nueva primero, con IP, ruta, código y nivel (`exito`, `aviso`, `error`). Filtros: `?nivel=`, `?ip=`, `?sospechosos=true\|false`, `?admin=true\|false`, `?pagina=`, `?limite=` (ver [Logs](#logs)) |
| DELETE | `/api/logs`                                           | **Borrar todos los logs** (los nombres de las IP quedan). Responde `204` |
| GET    | `/api/logs/resumen`                                   | Totales por nivel, visitantes (IP distintas sin contar a los admins), sospechosos y los 10 apartados más usados |
| GET    | `/api/logs/visitas`                                   | **Las visitas**: las peticiones de cada IP juntas mientras no pasen 30 minutos sin actividad (abrir la web son 3 peticiones a la vez y es 1 visita). La más reciente primero, con sus primeras 50 peticiones en orden. Filtros: `?ip=`, `?sospechosas=true\|false`, `?pagina=`, `?limite=` (ver [Logs](#logs)) |
| GET    | `/api/logs/ips`                                       | Cada IP con lo que hizo: peticiones, niveles, sospechosos, sus 5 apartados más usados, el nombre que le puso el dueño y los clientes que hicieron un pedido desde ella (`?sospechosas=true`, `?pagina=`, `?limite=`) |
| PUT    | `/api/logs/ips/:ip`                                   | Ponerle nombre a una IP: `{ "nombre": "Juan" }` (2 a 60). Responde `{ ip, nombre }` |
| DELETE | `/api/logs/ips/:ip`                                   | Sacarle el nombre. Responde `204` |
| GET    | `/api/logs/borrado-automatico`                        | `{ "diasLogs": 7 \| 15 \| 30 \| null }`: cada cuántos días se borran solos (`null` = solo a mano) |
| PUT    | `/api/logs/borrado-automatico`                        | Cambiarlo: `{ "diasLogs": 15 }`. Vale también para los logs que ya están |

Campos de producto: `nombre` (obligatorio y **único**: no puede haber dos productos con el mismo nombre, sin importar mayúsculas, acentos ni espacios de más; si se repite, `409` "Ya existe un producto con ese nombre: «…»"), `precio` (obligatorio, mayor que 0), `categoria` (obligatoria: el **gusto**, uno de la lista fija), `anticipacionHoras` (obligatoria: con cuántas horas de anticipación hay que encargarlo, entero de 0 a 720. Se muestra en el catálogo y marca el primer día que el cliente puede elegir en la web: 24 hs = mañana, 48 hs = pasado, nunca hoy; ver [Agenda](#agenda)), `descripcion`, `etiqueta` (texto libre de hasta 30 caracteres para destacarlo en el catálogo, por ejemplo "Nuevo", "Promo lanzamiento" o "El más elegido"), `ingredientes` (JSON `["harina","sal"]` o texto `harina, sal`), `pesoGramos` (mayor que 0), `tipo` (opcional: el `_id` de uno de los [tipos](#tipos)), `disponible` (`true` = activo, `false` = pausado) e `imagenes` (hasta 10 archivos por request, solo imágenes, máx. 10 MB cada uno). `descripcion`, `etiqueta`, `pesoGramos` y `tipo` son opcionales: mandarlos vacíos (`null` en JSON o `""`) los borra.

### Logs

Cada petición a la API **que no viene de la app del dueño** (la misma línea que sale en la terminal) se guarda en la colección `logs` con la **IP**, el método, la ruta sin query, el `apartado` (la ruta con `:id`, `:fecha`, `:ip` para agrupar), el código, el nivel, el error que se respondió y el tiempo. **Nunca** el body, la query ni los headers. No se guardan `/health`, los `OPTIONS` que salen bien, las consultas a `/api/logs` que salen bien **ni las peticiones con un token de admin válido** (la app del dueño: salen en la terminal, pero los logs son para mirar lo público). Sin token sí se guardan, también en rutas privadas (un `401` ahí es alguien de afuera probando). El campo `admin` y el filtro `?admin=` siguen en las respuestas, pero lo nuevo sale siempre en `false`.

- **Nombre + IP:** de un `POST /api/pedidos` que sale bien se guarda el id del pedido; al leer, `pedido.clienteNombre` (en `/api/logs`) y `clientes` (en `/api/logs/ips`) salen del pedido. Borrar los logs no toca los pedidos.
- **Visitas** (`/api/logs/visitas`): se calculan al leer, sin guardar nada. Una visita es una IP hasta que pasa 30 minutos sin hacer nada (`MINUTOS_ENTRE_VISITAS`). Trae `totalPeticiones` y solo las primeras 50 (`MAX_PETICIONES_POR_VISITA`), porque un ataque puede hacer miles.
- **La IP es una pista, no una prueba:** la de un celular cambia seguido y muchos comparten la misma; un atacante usa VPN.
- **Sospechosos** (`sospechoso`): `login-fallido`, `recuperacion-fallida`, `limite-superado` (429), `sin-autorizacion` (401 en lo privado), `ruta-inexistente` (404 de Express), `origen-no-permitido` (CORS).
- **Aviso por email:** 10 sospechosas de una misma IP en 10 minutos → un email a los admins (con `SMTP_*`; sin SMTP, solo la línea en la terminal). Por esa IP no se vuelve a avisar en una hora, y como mucho 6 emails por hora en total.
- **Borrado:** `DELETE /api/logs` cuando quiera el dueño, o solo con `borrado-automatico` (índice TTL de Mongo sobre `expiraEn`).

### Promos

La biblioteca de publicaciones del dueño: arma cada promo **una vez** (una foto o un video, con su texto) y después la comparte en su estado de WhatsApp todos los días que quiera, sin guardar el archivo en el celular. Es privada.

- **Campos:** `titulo` (de 2 a 60 caracteres, obligatorio), `texto` (opcional, hasta 500, con sus saltos de línea: es lo que acompaña la publicación) y `archivo` (multipart): una **foto** (`image/*`, hasta 10 MB) o un **video** (`video/*`, hasta **15 segundos** y 50 MB). Si el video dura más, se rechaza con `400` después de que Cloudinary lo mide (y se borra): el front lo revisa antes de subirlo.
- **Formato para compartir:** la foto se guarda como `.jpg` (hasta 1200 de ancho) y el video como `.mp4` H.264 (el lado más largo hasta 1280), los dos con la marca de agua grabada en la esquina. `url` es ese archivo, tal cual: es lo que la app descarga para compartir (un `.webp`, por ejemplo, WhatsApp lo toma como sticker).
- **Respuesta:** `{ _id, tipo: "imagen" | "video", titulo, texto?, url, miniatura, duracionSegundos?, vecesPublicada, ultimaPublicacion, createdAt, updatedAt }`. `miniatura` es un `.jpg` chico (en los videos, el primer fotograma); `duracionSegundos` solo viene en los videos; `ultimaPublicacion` es `null` si nunca se compartió.
- **Publicaciones:** `POST /api/promos/:id/publicaciones` lo llama la app al tocar Compartir. Registra que se tocó Compartir, no que se publicó: WhatsApp no le avisa a la app si el dueño terminó de publicar. No cambia `updatedAt`.
- La lista no se pagina: es lo que el dueño comparte seguido.

### Insumos

Lo que compra el dueño para producir, con lo que pagó, para tener el historial de gastos. Es privado (en la app, Más → Insumos).

- **Un documento por insumo:** `nombre` (de 2 a 60 caracteres, **único** sin importar mayúsculas ni acentos), `precio` (lo que pagó en la última compra, mayor que 0), `cantidad` y `unidad` (cuánto vino en esa compra: `cantidad` mayor que 0 y hasta 100000, con decimales; `unidad`, `kg`, `l` o `unidad`) y `fecha` (el día de esa compra, `AAAA-MM-DD`, no posterior a hoy en Argentina; si no viene, hoy).
- **`cantidad` y `unidad` van juntas** (`25` sin decir si son kilos o litros no sirve): al crear, las dos son obligatorias (`400` "Falta la cantidad" / "Falta la unidad"); al actualizar, las dos o ninguna. Así el precio se compara por kilo, por litro o por unidad: 10 kg a $ 20.000 y 25 kg a $ 25.000 son el mismo insumo (`Harina`), y el segundo sale la mitad el kilo. Los insumos cargados antes no las tienen (no salen en la respuesta) hasta que se corrigen.
- **Cada compra nueva se carga como una actualización** del mismo insumo, por ejemplo `PUT /api/insumos/:id` con `{ "precio": 54000, "fecha": "2026-10-15" }`. Crear otro con el mismo nombre da `409`.
- **`logs`** es el historial, dentro del mismo documento: el alta y cada actualización suman una entrada con cómo quedó (`nombre`, `precio`, `fecha`, `cantidad`, `unidad`), qué cambió (`cambios`: `["precio", "fecha", "cantidad"]`) y cuándo se registró (`registradoEn`). La más nueva va primero. Si lo que se manda es igual a lo guardado, no suma entrada.
- La lista no trae `logs`; el detalle, la respuesta del alta y la de la actualización sí.
- **Unidad bloqueada si una receta lo usa:** las cantidades de la receta están en gramos o en unidades según la unidad del insumo, así que mientras alguna receta lo use, pasarlo de `unidad` a `kg`/`l` (o al revés) da `409` "No se puede cambiar la unidad de «Huevos»: lo usa la receta de Chipá. Sacalo de esa receta primero". Entre `kg` y `l` sí se puede (en la receta los dos van en gramos). Si ninguna receta lo usa, se corrige como siempre.
- No hay borrado.

### Recetas

Con qué insumos se hace cada producto y cuántas unidades salen, para saber **lo que cuesta hacer cada unidad**. Es privada (solo la ve el dueño en la app) y no es `ingredientes` del producto: esa es la lista de nombres que sale en el catálogo y no cambia.

- **Una receta por producto**, guardada por el id del producto: `rinde` (cuántas **unidades** salen, entero de 1 a 10000: 1 kg de masa = 50 chipás) e `ingredientes` (de 1 a 50).
- **Cada ingrediente es un insumo** (`{ "insumo": "<_id>", "cantidad": 1000 }`) **o algo que no se compra**, como el agua (`{ "nombre": "Agua", "unidad": "g", "cantidad": 200 }`, nombre de 2 a 60 caracteres, `unidad` `g` o `unidad`). Lo que no se compra cuesta `0`, pero queda en la receta.
- **La unidad de un insumo la pone el servidor** según el insumo: `kg` y `l` se cargan en **gramos** (el dueño pesa todo, también los líquidos: 1 l ≈ 1 kg) y `unidad` (los huevos), en **unidades**.
- **`cantidad` siempre es un entero** de 1 a 100000 (`400` con la posición: "Ingrediente 2: la cantidad tiene que ser un número entero de 1 a 100000").
- **Errores:** un insumo que no existe, `400` "Uno de los insumos ya no existe: elegí otro"; uno cargado antes sin `cantidad` y `unidad`, `400` "Completá cuánto trae «Harina» (cantidad y unidad) antes de usarlo en una receta"; el mismo insumo o el mismo nombre dos veces (sin importar mayúsculas ni acentos), `400` "«Harina» está dos veces en la receta: sumá las cantidades en uno"; un producto que no existe, `404`.
- **El costo se calcula cada vez, no se guarda**, con el **último precio** de cada insumo (lo que costaría reponerlo hoy): Harina de 25 kg a $ 25.000 es $ 1 el gramo, así que 1000 g cuestan $ 1.000. Una compra más cara cambia el costo de todas las recetas que usan ese insumo. `costoTotal` es la suma de los costos de los ingredientes (redondeados a centavos) y `costoPorUnidad` es `costoTotal / rinde`.
- **Respuesta** (el detalle y el `PUT`):

```json
{
  "producto": { "_id": "...", "nombre": "Chipá", "precio": 84 },
  "rinde": 50,
  "ingredientes": [
    { "insumo": "...", "nombre": "Harina 0000", "cantidad": 1000, "unidad": "g", "costo": 1000 },
    { "insumo": "...", "nombre": "Huevos", "cantidad": 2, "unidad": "unidad", "costo": 400 },
    { "insumo": null, "nombre": "Agua", "cantidad": 200, "unidad": "g", "costo": 0 }
  ],
  "costoTotal": 1400,
  "costoPorUnidad": 28,
  "multiplicador": 3,
  "redondeo": null,
  "createdAt": "...",
  "updatedAt": "..."
}
```

  El `nombre` de un insumo sale del insumo: renombrarlo cambia todas las recetas. `costo` (y con él `costoTotal` y `costoPorUnidad`) es `null` solo si no se puede calcular, lo que hoy no pasa (los insumos no se borran y su unidad no cambia mientras una receta los use). La lista trae lo mismo sin `ingredientes` y con `cantidadIngredientes`. `producto.precio` es el precio de venta de hoy (para compararlo con `costoPorUnidad`) `multiplicador`, el último con el que se le puso el precio desde la receta (`null` si nunca), y `redondeo`, el que usó esa vez (`null` si lo dejó al peso o nunca).
- **Borrar el producto** borra también su receta.

#### Hacer la receta

`GET /api/recetas/:productoId/produccion?unidades=24` dice **cuánto hace falta de cada ingrediente para hacer esas unidades**: el dueño tiene que hacer 24 chipás y la receta rinde 12, así que es la receta ×2 (1000 g de harina pasan a 2000 g). Solo calcula: no guarda nada ni descuenta insumos.

- `unidades`: cuántas unidades va a hacer, un entero de 1 a 10000 (solo dígitos). Si no viene, `400` "Falta cuántas unidades vas a hacer"; si no sirve (`2.5`, `0`, `10001`), `400` "Las unidades tienen que ser un número entero de 1 a 10000".
- **Cada cantidad es `cantidad × unidades / rinde`, redondeada para arriba al entero:** si no da justo (30 chipás de una receta de 12 son ×2,5), 3 huevos pasan a 8 y no a 7, porque es mejor que sobre a que falte. Los gramos también quedan enteros. `redondeado` dice en cuáles pasó (`true` en los huevos: 7,5 → 8).
- `veces` es cuántas veces la receta (`unidades / rinde`, con dos decimales: 24 de 12 da `2`, 25 de 12 da `2.08`).
- `costo` de cada ingrediente y `costoTotal` son los de esas cantidades, con el último precio de cada insumo (como en la receta). `null` si alguno no se puede calcular.

```json
{
  "producto": { "_id": "...", "nombre": "Chipá", "precio": 84 },
  "rinde": 12,
  "unidades": 30,
  "veces": 2.5,
  "ingredientes": [
    { "insumo": "...", "nombre": "Harina 0000", "cantidad": 2500, "unidad": "g", "costo": 2500, "redondeado": false },
    { "insumo": "...", "nombre": "Huevos", "cantidad": 8, "unidad": "unidad", "costo": 1600, "redondeado": true },
    { "insumo": null, "nombre": "Agua", "cantidad": 500, "unidad": "g", "costo": 0, "redondeado": false }
  ],
  "costoTotal": 4100
}
```

- **Errores:** sin receta, `404` "Este producto todavía no tiene receta"; un id que no es válido, `404` "No encontrado".

#### Precio desde la receta

`PUT /api/recetas/:productoId/precio` con `{ "multiplicador": 3 }` le pone al producto el precio de venta **lo que cuesta hoy cada unidad × multiplicador**, redondeado al peso: con un costo de $ 28 y ×3, el producto pasa a valer $ 84 (y sale así en el catálogo, enseguida).

- El costo es el de ese momento, con el último precio de cada insumo: cuando aumenta la harina, se vuelve a tocar y el precio sigue al costo nuevo.
- `multiplicador`: mayor que 1, hasta 10 y con un decimal como mucho (`2.5` sí, `2.25` no). Si no, `400` "El multiplicador tiene que ser mayor que 1 y hasta 10, con un decimal como mucho (por ejemplo, 2,5)"; si no viene, `400` "Falta el multiplicador".
- `redondeo` (opcional): `10`, `50`, `100`, `500` o `1000`. Lleva el precio al múltiplo **de arriba**: con un costo de $ 5.845,33 y ×2 da $ 11.691, y con `"redondeo": 1000` queda en $ 12.000 (nunca gana menos de lo que eligió). Sin `redondeo` o con `null`, al peso. Otro valor: `400` "El redondeo tiene que ser uno de estos: 10, 50, 100, 500, 1000".
- Quedan guardados en la receta (`multiplicador` y `redondeo`; sin redondeo, se borra), para que la app los proponga la próxima vez. No le cambia el `updatedAt` a la receta (sí al producto: es una edición del precio).
- Responde la receta, como el `GET`, con el `producto.precio` nuevo.
- **Errores:** sin receta, `404` "Este producto todavía no tiene receta"; un ingrediente sin costo calculable, `409` "No se pudo calcular lo que cuesta algún ingrediente: revisá sus insumos"; una receta que da $ 0 (solo cosas que no se compran), `409` "Con lo que cuesta esta receta, el precio da $ 0: ponelo a mano desde Editar producto".

### Tipos

Qué es cada producto (Tortas, Tartas, Alfajores…): una lista que arma el dueño en la app (Más → Tipos). Es privada para editarla, y **opcional** en el producto. No reemplaza a la `categoria`, que sigue siendo el gusto (Dulce, Salado…).

- **Campos:** `nombre` (de 2 a 40 caracteres, **único** sin importar mayúsculas ni acentos; los espacios de más no cuentan).
- **Respuesta** (la lista, el alta y el renombre): `{ _id, nombre, cantidadProductos, createdAt, updatedAt }`. `cantidadProductos` cuenta los productos que lo usan, activos y pausados: sirve para avisar antes de borrar.
- **En el producto:** `POST`/`PUT /api/productos` aceptan `"tipo": "<_id>"`; `null` o `""` lo saca. Si el id no tiene formato válido, `400` "El tipo no es válido"; si no existe, `400` "Ese tipo ya no existe: elegí otro".
- **En las respuestas de productos** (privadas y del catálogo) sale como `"tipo": { "_id": "...", "nombre": "Tortas" }`, o `"tipo": null` si no tiene. El producto guarda solo el id: renombrar el tipo cambia el nombre en todos.
- **Borrar un tipo** no borra productos: los que lo usaban quedan con `tipo: null`.

### Almacenamiento

El uso de la cuenta de Cloudinary, para que el dueño vea si se está quedando sin lugar (en la app, Más → Almacenamiento). Es privado.

- **Créditos:** el plan gratis de Cloudinary tiene **25 créditos**. Un crédito es 1 GB guardado, 1 GB entregado (las fotos que se ven en la web y en la app) o 1000 transformaciones (la marca de agua al subir, las miniaturas, los formatos). Lo guardado cuenta como está **ahora**; lo entregado y las transformaciones, en los **últimos 30 días** (no se reinicia a principio de mes).
- **Si se pasa del límite**, Cloudinary le manda emails a la cuenta y, si sigue pasado, la **deshabilita**: no se pueden subir fotos y el catálogo deja de mostrarlas. Para bajar el uso: borrar promos viejas (los videos son lo que más pesa) y fotos que ya no se usan.
- **Respuesta:** `{ plan, nivel, creditos: { usados, limite, restantes, porcentaje }, almacenamiento: { bytes, creditos }, anchoDeBanda: { bytes, creditos }, transformaciones: { cantidad, creditos }, archivos, derivados, actualizadoAl, consultadoEn }`.
  - `nivel`: `ok` (menos del 75% de los créditos), `atencion` (desde el 75%), `critico` (desde el 90%) o `excedido` (desde el 100%).
  - `actualizadoAl` es el día del último cálculo de Cloudinary (`AAAA-MM-DD`, o `null`): no actualiza los números en el momento.
  - El desglose por rubro puede no sumar exacto `creditos.usados` (Cloudinary redondea y a veces descuenta un ajuste: ese rubro sale en `0`).
- El servidor guarda la respuesta **10 minutos** (la API de administración de Cloudinary permite 500 consultas por hora en el plan gratis), así que `consultadoEn` puede ser de hace un rato.
- Si Cloudinary no responde: `502` ("No se pudo consultar el uso de Cloudinary. Probá de nuevo en unos minutos.").

**Para liberar lugar**, `GET /api/almacenamiento/archivos` lista lo que hay guardado, lo que más ocupa primero, y cada archivo trae lo que hace falta para borrarlo con los endpoints de siempre:

- **Foto de un producto:** `{ origen: "producto", productoId, imagenId, nombre, portada, disponible, bytes, miniatura, subidoEn }` → `DELETE /api/productos/:productoId/imagenes/:imagenId`.
- **Promo:** `{ origen: "promo", promoId, titulo, tipo: "imagen" | "video", bytes, miniatura, subidoEn }` → `DELETE /api/promos/:promoId` (la promo entera: tiene un solo archivo).
- Responde `{ archivos, pagina, limite, totalArchivos, totalPaginas, totalBytes }` (`totalBytes`: lo que ocupan todos, con el filtro). Un `origen` que no es `producto` ni `promo` da `400`.
- `bytes` es lo que ocupa el archivo en Cloudinary (sin contar sus miniaturas). Lo que se borra sale de la lista enseguida, pero el resumen de `GET /api/almacenamiento` lo descuenta recién cuando Cloudinary recalcula.
- El servidor le pregunta a Cloudinary cuánto ocupa cada archivo **una sola vez** (no cambia nunca) y lo recuerda mientras está prendido: pedir la lista seguido no gasta consultas, salvo por lo recién subido. Si Cloudinary no responde: `502`.

### Métricas

Lo que el dueño ve de cómo va el negocio. Es privado y se calcula al vuelo sobre los pedidos y los insumos: no hay contadores guardados.

- **Una venta es un pedido que no se canceló** (pendiente, confirmado o entregado), y cuenta el **día en que se hizo el pedido, en Argentina**. Si después se cancela, deja de sumar solo.
- **Rango (en todas):** `?desde=AAAA-MM-DD&hasta=AAAA-MM-DD`, los dos días incluidos y los dos opcionales (sin ninguno, todo el historial). Una fecha que no existe o `desde` posterior a `hasta` dan `400`. La respuesta trae `desde` y `hasta` como se pidieron (`null` si no vinieron).
- **`?orden=unidades`** (por defecto) **o `?orden=importe`** en productos y gustos. Otro valor da `400`.

**Productos más vendidos** (`GET /api/metricas/productos`): `{ desde, hasta, orden, totalPedidos, totalUnidades, totalImporte, productos, pagina, limite, totalProductos, totalPaginas }`. Cada producto: `{ nombre, productoId, categoria, unidades, importe, pedidos }`.
- **Se agrupa por nombre**, sin importar mayúsculas ni acentos (el nombre del producto es único así justamente para esto): un producto borrado y vuelto a crear con el mismo nombre suma junto. Si se renombra, las ventas de antes quedan con el nombre viejo.
- `importe` es precio del momento × cantidad; `pedidos`, en cuántos pedidos salió. `nombre`, `productoId` y `categoria` (el gusto) son los de la última venta: el producto puede ya no existir. Los totales son de todo el rango, no de la página.

**Gustos** (`GET /api/metricas/gustos`): `{ desde, hasta, orden, totalPedidos, totalUnidades, totalImporte, gustos: [{ gusto, unidades, importe, pedidos }] }`. Vienen todos los gustos de la lista, también los que no se vendieron (en `0`), y al final los que ya no están en la lista pero tienen ventas viejas. `pedidos` cuenta una vez un pedido con varios productos del mismo gusto.

**Pedidos** (`GET /api/metricas/pedidos`): todos los pedidos **hechos** en el rango, con el estado que tienen hoy. `{ desde, hasta, totalPedidos, porEstado: { pendiente, confirmado, entregado, cancelado }, porOrigen: { web, manual }, porcentajeCancelados, ticketPromedio, porDiaDeLaSemana: [{ dia, pedidos }] }`.
- `ticketPromedio` es el total promedio de las ventas (sin los cancelados). `porcentajeCancelados` va de `0` a `100`, con 2 decimales.
- `porDiaDeLaSemana` va de `lunes` a `domingo` (`miércoles` y `sábado` con acento), siempre los siete.

**Clientes** (`GET /api/metricas/clientes`): de los clientes que compraron en el rango (sin contar pedidos cancelados), `{ desde, hasta, totalClientes, nuevos, recurrentes, conVariosPedidos }`. `nuevos`: su primera compra fue en el rango; `recurrentes`: ya habían comprado antes (`nuevos + recurrentes = totalClientes`); `conVariosPedidos`: compraron dos veces o más en el rango. Sin `desde`, todos son nuevos.

**Insumos** (`GET /api/metricas/insumos`): los insumos con alguna compra en el rango, del que más se gastó al que menos. `{ desde, hasta, totalGastado, totalCompras, insumos: [{ insumoId, nombre, gastado, compras, ultimaCompra, compraAnterior, variacion, precios }] }`.
- **Las compras salen del historial (`logs`)**: el alta y cada actualización que cambió la fecha son compras; una que no cambió la fecha (el precio mal cargado, el nombre) corrige la última. Corregir una fecha mal cargada cuenta como otra compra.
- `ultimaCompra` y `compraAnterior` son `{ fecha, precio, cantidad, unidad, precioPorUnidad }`: la última compra del rango y la anterior a ella, **aunque sea de antes del rango** (`null` si es la primera). `cantidad`, `unidad` y `precioPorUnidad` (`precio / cantidad`) son `null` en las compras cargadas antes de que existieran. `precios` son las compras del rango, de la más vieja a la más nueva.
- `variacion` es cuánto subió en % (negativo si bajó): **por kilo, litro o unidad** si las dos compras dicen cuánto vino en la misma unidad; por precio si ninguna lo dice (las de antes); `null` si no hay anterior o no se pueden comparar (solo una lo dice, o en otra unidad).

**Balance** (`GET /api/metricas/balance`): `{ desde, hasta, agrupar, ingresos, gastos, ganancia, porCobrar, pedidos, compras, serie: [{ periodo, ingresos, gastos, ganancia }] }`.
- `ingresos`: el total de las ventas del rango. `gastos`: las compras de insumos del rango (por el día de la compra). `ganancia = ingresos − gastos`: no cuenta los insumos que sobran.
- `porCobrar`: de esas ventas, lo que falta cobrar de las que no se entregaron (el total menos la seña). Las entregadas se toman como cobradas.
- `serie`: de a `dia` (`AAAA-MM-DD`), `semana` (el lunes, `AAAA-MM-DD`) o `mes` (`AAAA-MM`). Trae todos los períodos desde `desde` (o el primer día con datos) hasta `hasta`, sin pasar de hoy, también los que dieron `0`. Otro `agrupar` da `400`.

Datos de pago (`PUT /api/datos-pago`, los cuatro obligatorios): `nombreCompleto` (el titular, de 3 a 80 caracteres), `alias` (de 6 a 20 caracteres: letras sin acentos, números, puntos y guiones), `cbu` (CBU o CVU: 22 números, **como texto**; se aceptan espacios o guiones entre los números y se guardan solo los números; se revisan los dígitos verificadores, así un número mal copiado da `400`) y `billetera` (texto libre de 2 a 40 caracteres: "Mercado Pago", "Ualá", "Banco Nación"…). Es **un solo** juego de datos: cada `PUT` reemplaza al anterior. **Son públicos a propósito**: cualquiera los puede leer con `GET /api/datos-pago`.

### Resumen del día

Lo que ve el dueño al abrir la app (el inicio). Es privado y se calcula al vuelo, como las métricas.

`GET /api/resumen` responde `{ fecha, hoy: { pedidos, vendido }, abiertos: { pendiente, confirmado }, ultimosPedidos }`:

- `fecha`: hoy en Argentina (`AAAA-MM-DD`).
- `hoy`: las **ventas de hoy**, con la misma cuenta que las métricas (los pedidos hechos hoy que no se cancelaron). `vendido` da lo mismo que los `ingresos` de `GET /api/metricas/balance?desde=<hoy>&hasta=<hoy>`.
- `abiertos`: los pedidos que siguen `pendiente` (esperando la seña) o `confirmado` (con la seña pagada, para entregar), **de cualquier día**.
- `ultimosPedidos`: los pedidos de hoy (sin los cancelados), del más nuevo al más viejo, **hasta 10** (si `hoy.pedidos` es más, el resto se ve en `GET /api/pedidos`). Cada uno igual que en `GET /api/pedidos`, con su `saldo` y su `origen`.

### Agenda

Cada pedido tiene **`fechaEntrega`**: el día para el que es (`AAAA-MM-DD`, solo el día, sin horario). El cliente lo elige en la web con estas reglas; el dueño, en cambio, **no tiene ninguna**: en el pedido manual y al cambiar la fecha (`PUT /api/pedidos/:id/fecha-entrega`) puede poner cualquier día, porque pudo arreglarlo con el cliente por fuera.

**Los días que puede elegir el cliente** (`entrega` en `POST /api/carrito`; `POST /api/pedidos` revisa lo mismo):

- **Desde:** hoy (en Argentina) más los días del producto del carrito que más demora: 24 hs = mañana, 48 hs = pasado. Se cuentan días, no horas: el 11/11 a las 23 hs, un producto de 24 hs ya se puede pedir para el 12/11. **Nunca hoy.**
- **Hasta:** fin del mes actual. Si **faltan 7 días o menos** para fin de mes (desde hoy), hasta fin del mes siguiente: el 22/11 llega hasta el 30/11; el 23/11, hasta el 31/12.
- **`diasLlenos`:** los días del rango que la web no ofrece: **solo** los que el dueño marcó como **«Agenda llena»** (`PUT /api/agenda/:fecha/cierre`). Llegar al tope (`productosPorDia`) **no** cierra un día: lo cierra el dueño a mano. Pedir uno marcado es `409`. Si todos los días del rango están marcados, se suma el mes siguiente.
- **`diasCasiLlenos`:** los días del rango que se están llenando (nivel `medio` o `alto` de la agenda: pasaron el 40 % del tope, también los que llegaron o se pasaron) y que no están marcados. La web los muestra en amarillo con «Casi», pero **se pueden elegir**: solo avisan. Vacío mientras el dueño no ponga sus productos por día. Solo lo trae la cotización: el pedido no lo mira.

| Hoy   | El que más demora | Puede elegir        |
| ----- | ----------------- | ------------------- |
| 11/11 | 24 hs             | del 12/11 al 30/11  |
| 11/11 | 48 hs             | del 13/11 al 30/11  |
| 22/11 | 48 hs             | del 24/11 al 30/11  |
| 23/11 | 24 hs             | del 24/11 al 31/12  |
| 29/11 | 48 hs             | del 1/12 al 31/12   |

Errores de `POST /api/pedidos` por la fecha: `400` "La fecha de entrega tiene que ser un día AAAA-MM-DD", `400` "Para este pedido, el primer día que se puede elegir es el 12/11", `400` "Por ahora se puede pedir hasta el 30/11" y `409` "Ese día tenemos la agenda llena: elegí otro".

**La agenda del dueño** (`GET /api/agenda?mes=2026-11`, privada) responde todos los días del mes:

```json
{
  "mes": "2026-11",
  "productosPorDia": 25,
  "dias": [
    { "fecha": "2026-11-01", "pedidos": 0, "productos": 0, "nivel": "bajo", "llena": false, "quiereHacer": null, "tope": false, "estadoWeb": "libre" },
    { "fecha": "2026-11-17", "pedidos": 0, "productos": 0, "nivel": "medio", "llena": false, "quiereHacer": 3, "tope": false, "estadoWeb": "casi" },
    { "fecha": "2026-11-20", "pedidos": 3, "productos": 25, "nivel": "alto", "llena": true, "quiereHacer": null, "tope": true, "estadoWeb": "llena" }
  ]
}
```

- `productos`: la suma de las **cantidades** de los pedidos no cancelados para ese día (también los pendientes sin seña y los manuales). Un pack de 50 chipás es 1; 3 tartas son 3. Se calcula al vuelo: cancelar un pedido libera su lugar.
- `nivel`: qué tan lleno está contra `productosPorDia` (el número que pone el dueño con `PATCH /api/ajustes`), que es **su tope**: `bajo` («Libre», verde) hasta el 40 %, `medio` («Casi», amarillo) por arriba del 40 % sin llegar, `alto` («Llena», rojo) desde el 100 %. Con 25: hasta 10 libre, de 11 a 24 casi, 25 o más llena. `null` mientras no haya `productosPorDia`.
- `quiereHacer`: cuántos productos quiere hacer el dueño ese día, si eligió menos que los de siempre (`PUT /api/agenda/:fecha/quiere-hacer`); `null` = los de siempre. **El tope no cambia: lo que no quiere hacer se cuenta como ocupado** para el `nivel`. Con 25 y `quiereHacer: 3`, son 22 ocupados: el día arranca en `medio` («Casi», 88 %) y con 3 productos pedidos llega al tope y la web deja de ofrecerlo. Si baja poco (20 de 25), las mismas cuentas lo pueden dejar en `bajo`. `productos` sigue siendo lo pedido de verdad. Si ya tenía más pedidos que `quiereHacer`, se quedan y el día queda lleno. Sin `productosPorDia`, el tope de ese día es `quiereHacer`.
- `faltan` (solo en `GET /api/agenda?mes=`): cuántos productos le quedan por preparar a ese día: los de sus pedidos sin entregar menos lo que el dueño anotó como hecho en «Qué hay que hacer». Es el número del circulito de la agenda; con `0`, el circulito no va.
- `tope`: si llegó a `productosPorDia` (`nivel` `alto`). Es solo para la agenda del dueño: **la web lo sigue ofreciendo** (como «Casi») hasta que el dueño lo marque con «Agenda llena». `llena` sigue siendo solo la marca del dueño, que puede cerrar cualquier día aunque tenga pocos productos.
- `estadoWeb`: cómo ve el día el cliente en la web, **la misma cuenta que `POST /api/carrito`**: `llena` (lo marcó el dueño: lo único que bloquea), `casi` (nivel `medio` o `alto`, también en el tope) o `libre`. Viene resuelto para que la app pinte sin hacer cuentas y los dos calendarios no se separen. Vale para los días que la web ofrece (desde mañana o pasado hasta fin de mes).

`GET /api/agenda/:fecha/productos` (privado): **lo que hay que preparar ese día** y cuánto ya hizo el dueño, sin importar de quién es cada pedido. Suma los productos de los pedidos que falta entregar (`pendiente` y `confirmado`; los entregados ya se hicieron y los cancelados no van). Primero lo que falta, del que más hay que hacer al que menos; al final los listos. Responde `{ "fecha", "pedidos": 3, "total": 19, "hechos": 6, "productos": [{ "productoId", "nombre", "cantidad": 17, "sinSena": 4, "hechos": 5, "faltan": 12, "listo": false }] }`: `sinSena` es cuántos de esa cantidad son de pedidos sin seña; `hechos` nunca pasa de `cantidad`.

`PUT /api/agenda/:fecha/productos/:productoId` (privado) con `{ "hechos": 5 }`: anota cuántos hizo de ese producto ese día. Es **el número que queda**, no lo que suma (dos toques seguidos no se pisan); `0` lo borra. Entero de 0 a 1000. Responde la hoja entera, como el `GET`. Una fecha mal escrita o `hechos` inválido: `400`; un id mal escrito, o un producto que no está en los pedidos abiertos de ese día (con `hechos` mayor que 0): `404`.

**La colección `agenda`** guarda lo que el dueño gestiona de cada día: un documento por día (`_id` = la fecha) con `llena` (lo marcó como «Agenda llena»), `hechos` (`[{ producto, cantidad }]`) y `quiereHacer` (opcional). Solo existen los días que tocó. Los pedidos del día no viven ahí: salen de los pedidos por su `fechaEntrega`; el tope tampoco: se calcula.
- `llena`: si el dueño lo marcó. `PUT` y `DELETE` de `/api/agenda/:fecha/cierre` responden el día con esta misma forma.
- Los pedidos de un día: `GET /api/pedidos?fechaEntrega=2026-11-20`.

#### Cómo aplicar la agenda

Los pedidos de antes no tienen fecha, y la web y el APK que están publicados no la mandan. Por eso, durante la transición, `fechaEntrega` es **opcional** en `POST /api/pedidos` y en el pedido manual, y los pedidos sin fecha salen con `fechaEntrega: null`. Hay que seguir este orden. ❌ No te saltees pasos: si la fecha se vuelve obligatoria antes de migrar, los pedidos viejos dejan de validar al editarlos.

**1. Subir este back (no rompe nada de lo que ya anda).**

- Merge de `agenda-pedidos` a `staging` y después a `master`. Render hace el deploy.
- No hay variables de entorno nuevas.
- La web y el APK de antes siguen andando, porque todo lo nuevo es opcional o se suma:
  - `POST /api/pedidos` sin `fechaEntrega` sigue creando el pedido.
  - Las respuestas suman campos: `fechaEntrega` en los pedidos, `entrega` en `POST /api/carrito` y `productosPorDia` en `GET /api/ajustes`.
  - Si algún schema de Zod del front es estricto (`.strict()`), hay que aflojarlo antes de este paso.
- Lo nuevo en el back:
  - `GET /api/agenda`, `PUT`/`DELETE /api/agenda/:fecha/cierre` y `PUT /api/pedidos/:id/fecha-entrega`.
  - `GET /api/pedidos?fechaEntrega=`.
  - Una línea de log por petición (`middleware/registro.ts`).
  - Los scripts `migrar-fecha-entrega` y `copiar-fotos`.

**2. Publicar el front que manda la fecha (la web en Vercel y un APK nuevo para los dos admins).**

- **Web:**
  - Al cotizar el carrito, mostrar los días de `entrega` (`desde`, `hasta` y sin los `diasLlenos`).
  - Mandar siempre `fechaEntrega` en `POST /api/pedidos`.
  - Manejar el `400` por una fecha fuera del rango y el `409` por la agenda llena: el cliente elige otro día.
- **App:**
  - La agenda en el inicio, en lugar de «Lo de hoy»: `GET /api/agenda?mes=` y, para el día elegido, `GET /api/pedidos?fechaEntrega=`.
  - El botón «Agenda llena» (`PUT`/`DELETE /api/agenda/:fecha/cierre`).
  - `productosPorDia` en los ajustes (`PATCH /api/ajustes`).
  - La fecha en el pedido manual y el cambio de fecha en el detalle (`PUT /api/pedidos/:id/fecha-entrega`).
  - Mostrar `fechaEntrega: null` sin romperse (los pedidos viejos, hasta el paso 3).
- `GET /api/resumen` sigue en el back porque lo usa el APK de antes. Se saca cuando los dos admins actualicen.

**3. Ponerles fecha a los pedidos de antes, en las dos bases.** Correrlo recién cuando la web nueva ya esté publicada: si no, siguen entrando pedidos sin fecha. Solo toca los pedidos que no tienen fecha, así que se puede volver a correr.

```bash
npm run migrar-fecha-entrega                                                # base del .env (panaderia): ya se corrió el 2026-11-11
MONGODB_URI="<la URI de Atlas con /panaderia-producion>" npm run migrar-fecha-entrega   # producción
```

La migración les pone a los pedidos de antes:

- entregado → el día que se entregó;
- confirmado → el día de la seña;
- cancelado → el día que se hizo;
- pendiente → el día que se hizo más 1 o 2 días, según el producto que más demora.

Las fechas van en hora de Argentina. Al final lista los ids de los que siguen abiertos, por si el dueño quiere cambiarles la fecha desde la app.

**4. Volver obligatoria la fecha (otro cambio en el back, recién después del 3 en las dos bases).**

- `required` en `fechaEntrega` del esquema de `Pedido`.
- `400` en `leerPedido` si no viene.
- Que el front ya no acepte `fechaEntrega: null`.

### Estados del pedido

| Estado       | Qué significa                   | Cómo se llega                                                         |
| ------------ | ------------------------------- | --------------------------------------------------------------------- |
| `pendiente`  | Recién hecho, esperando la seña | Al crearlo, o quitando la seña                                        |
| `confirmado` | La seña está pagada (o sin seña, con `monto: 0`) | `PUT /api/pedidos/:id/sena`                          |
| `entregado`  | Ya lo retiró                    | `PUT /api/pedidos/:id/entrega` (desde `pendiente` o `confirmado`)     |
| `cancelado`  | No va                           | `PUT /api/pedidos/:id/cancelacion` (desde `pendiente` o `confirmado`) |

- El estado no se cambia directo: lo cambian estas acciones, que además guardan el dato que corresponde: `sena: { monto, pagadaEn }`, `entregadoEn` o `canceladoEn`. Los pedidos anteriores no tienen esos campos.
- Cada respuesta de pedidos (lista, detalle y acciones) trae **`saldo`**: lo que falta cobrar al entregar (total menos la seña). Se calcula, no se guarda.
- Si el pedido está en un estado que no permite la acción (por ejemplo, cancelar uno entregado), responde `409` con el motivo. Si dos acciones llegan a la vez, gana una y la otra recibe `409`.
- Cada pedido trae **`origen`**: `web` (lo hizo el cliente desde la web) o `manual` (lo cargó el dueño). Los pedidos anteriores a este campo salen como `web`.
- Cada pedido trae **`conEnvio`**: `true` si el cliente quiere que se lo manden, `false` si lo pasa a retirar. Se elige al hacer el pedido (web o manual) y el dueño lo cambia con `PUT`/`DELETE /api/pedidos/:id/envio` mientras el pedido está abierto. Los pedidos anteriores a este campo salen como `false` (antes no había envío). No cambia el total: el envío no tiene costo en el sistema.
- Cada pedido trae **`fechaEntrega`**: el día para el que es (ver [Agenda](#agenda)). Los pedidos sin fecha (de antes, hasta correr la migración) salen como `null`.
- Cada pedido trae **`visto`**: si el dueño ya lo vio en la app. Los de la web nacen en `false` (la app los marca como nuevos) hasta que el dueño abre el detalle y toca «Marcar como visto» (`PUT /api/pedidos/:id/visto`); los manuales nacen en `true` (los cargó él). Los pedidos anteriores a este campo salen como `true`. Las acciones (seña, entrega, cancelación) no lo cambian. `POST /api/pedidos` (público) no lo devuelve.

### Pedido manual

`POST /api/pedidos/manuales` (privado) es para que el dueño cargue un pedido que le hicieron por WhatsApp o en persona, y use la app como agenda:

```json
{
  "cliente": { "nombre": "Doña Rosa", "telefono": "11 4444-1234" },
  "items": [{ "productoId": "...", "cantidad": 2 }],
  "fechaEntrega": "2026-11-28",
  "nota": "Lo retira el sábado",
  "sena": { "monto": 12000 }
}
```

- Las mismas reglas que el pedido de la web: el cliente se crea o se actualiza por teléfono, y nombre, precio y total salen de la base.
- **Puede incluir productos pausados** (por ejemplo, el pan dulce que le encargan fuera de temporada). Los eliminados no: `400` con `productosNoDisponibles`.
- **La fecha es libre**: cualquier día que exista, también hoy, uno pasado o uno marcado como lleno (las reglas de la [agenda](#agenda) son solo para la web).
- `sena` es opcional. Sin `sena`, entra `pendiente`; con seña (de 0 hasta el total; `0` = confirmado sin seña), entra `confirmado`.
- Queda con `origen: "manual"` y sigue los mismos pasos que cualquier pedido: seña, entrega y cancelación.
- No tiene el límite de 10 por hora del pedido público.

### Editar un pedido

`PUT /api/pedidos/:id/items` (privado) es para cuando el cliente, después de hacer el pedido, le escribe al dueño para sumar algo, sacar algo o cambiar cantidades. Así no hace falta cargar otro pedido aparte:

```json
{ "items": [{ "productoId": "...", "cantidad": 3 }, { "productoId": "...", "cantidad": 1 }] }
```

- Va la lista **completa** como tiene que quedar: reemplaza la del pedido (lo que no viene, se saca). Las mismas reglas que al crearlo: de 1 a 30 productos, cantidades de 1 a 50, y los repetidos se juntan.
- **Lo que ya estaba conserva su precio** (el del momento del pedido), aunque cambie la cantidad o el producto haya cambiado de precio, de nombre o se haya borrado. **Lo nuevo entra con el precio de hoy** y, como en el pedido manual, puede ser un producto pausado. Un producto que no existe: `400` con `productosNoDisponibles`.
- El `total` (y el `saldo`) se recalculan en el servidor. El estado, la seña y `visto` no cambian: si estaba `confirmado`, sigue confirmado con la misma seña.
- Solo pedidos `pendiente` o `confirmado`: uno entregado o cancelado responde `409`. Si el nuevo total queda por debajo de la seña, también `409` ("La seña ($60.000) es más que el nuevo total ($30.000): corregila antes de sacar productos").
- Sirve para pedidos de la web y manuales. Las métricas usan el pedido como quedó: si se edita, cambian las ventas del día en que se hizo.
- Responde el detalle, como `GET /api/pedidos/:id`.

Categorías: son el **gusto** del producto, de una lista fija en `src/models/Producto.ts` y en este orden: Dulce, Salado, Agridulce, Ácido, Amargo, Picante. Se aceptan sin importar mayúsculas ni acentos (`acido` se guarda como `Ácido`); cualquier otra (`Dulse`, `Facturas`) responde `400` con la lista. Cada pedido guarda el gusto de cada producto al momento de la venta, para las métricas.

Un producto **pausado** (`disponible: false`, por ejemplo el pan dulce fuera de temporada) no sale en el catálogo ni se puede pedir, pero conserva sus datos y sus fotos: se reactiva con `PUT /api/productos/:id` y `{ "disponible": true }`.

### Carta y filtros de la web

La carta llega resuelta del back: el front no agrupa, no filtra ni ordena.

`GET /api/catalogo/secciones` responde `{ "secciones": [{ "tipo": { "_id", "nombre" } | null, "productos": [ … ] }], "totalProductos": 23 }`:

- Solo productos activos, sin paginar. Cada producto tiene la misma forma que un ítem de `GET /api/catalogo` (con `portada`, `cantidadImagenes` y `tipo`).
- Las secciones van por el nombre del tipo, sin importar mayúsculas ni acentos. Los productos sin tipo van juntos en una sola sección con `"tipo": null`, siempre al final. No hay secciones vacías.
- Dentro de cada sección, los productos van por gusto (en el orden de la lista fija) y por nombre.
- Los filtros son los mismos que los de `GET /api/catalogo`, con los mismos errores: `tipo` sin formato de id o `categoria` fuera de la lista dan `400`. Con `?tipo=` sale una sola sección; si no coincide nada (o el tipo no existe), `"secciones": []`.

`GET /api/catalogo/filtros?tipo=&categoria=` responde `{ "tipos": [{ "_id", "nombre", "cantidad" }], "categorias": [{ "nombre", "cantidad" }], "totales": { "tipos": 27, "categorias": 27 } }`. Salen siempre los tipos y gustos con al menos un producto activo (al elegir uno, los demás siguen apareciendo). `cantidad` cuenta **con el otro filtro puesto**: con `?tipo=` (Pizzas), cada gusto dice cuántas pizzas tiene, y puede ser `0`; con `?categoria=`, cada tipo cuenta solo los de ese gusto. Sin parámetros, son los productos activos de cada uno. `totales.tipos` es la opción «Todos los tipos» (los activos con el gusto elegido) y `totales.categorias`, «Todos los gustos» (los activos del tipo elegido). Un `tipo` o una `categoria` inválidos dan `400`, como en las listas. `tipos` va por nombre y `categorias` en el orden de la lista fija. `GET /api/catalogo/categorias` sigue trayendo todos los gustos, también los que están en `0`: lo usa el formulario del producto.

### Recomendaciones

Cualquiera puede dejar una recomendación desde la web, sin login, con `POST /api/catalogo/:id/recomendaciones`:

- `puntaje`: obligatorio, entero del 1 al 5 (las estrellas).
- `texto`: opcional, hasta 300 caracteres.
- `autor`: opcional, el nombre que se muestra, de 2 a 60 caracteres. No se pide teléfono: no es un cliente.

Responde `201` con `{ "recomendacion": { id, puntaje, texto, autor, createdAt }, "puntajePromedio": 4.7, "cantidadRecomendaciones": 3 }`. Si el producto no existe o está pausado, `404`; si un dato no cumple, `400`.

Se guardan **dentro del producto**, de la más nueva a la más vieja, y se conservan las **últimas 50**: cuando llega la 51, se descarta la más vieja. `puntajePromedio` (con un decimal, o `null` si no tiene) y `cantidadRecomendaciones` son de las que están guardadas y se recalculan en la misma operación que agrega o borra una. Las listas (`/api/catalogo` y `/api/productos`) traen solo esos dos campos; el detalle trae además `recomendaciones`. Agregar o borrar una recomendación no cambia el `updatedAt` del producto.

### Listas paginadas y filtros

`GET /api/productos` y `GET /api/catalogo` responden una página:

```json
{ "productos": [ … ], "pagina": 1, "limite": 20, "totalProductos": 31, "totalPaginas": 2 }
```

| Parámetro   | Para qué                                                                                                    |
| ----------- | ----------------------------------------------------------------------------------------------------------- |
| `pagina`    | Un entero desde 1 (por defecto 1). Una página que no existe responde `productos: []`. `0`, `-1` o `abc`: `400` |
| `limite`    | Productos por página: un entero de 1 a 100 (por defecto 20). Fuera de eso (`0`, `abc`, `9999`): `400`       |
| `buscar`    | Una parte del nombre, sin importar mayúsculas ni acentos (`sandwich` encuentra "Sándwich de miga")          |
| `categoria` | Un gusto de la lista fija. Si no es de la lista: `400`                                                      |
| `tipo`      | El `_id` de un [tipo](#tipos). Si no tiene formato de id: `400`                                              |
| `estado`    | Solo en `/api/productos`: `activo` o `pausado` (si no, `400`). El catálogo siempre muestra solo los activos |

`pagina` y `limite` valen igual en todas las listas paginadas (`/api/pedidos`, `/api/almacenamiento/archivos` y `/api/metricas/productos`): vacíos o sin mandar, el de por defecto; si vienen, tienen que ser enteros desde 1 (`limite` hasta 100), o la respuesta es `400` con `{ "error": "pagina tiene que ser un número entero desde 1" }` (o `"limite puede ser como mucho 100"`). Antes se corregían solos.

Vienen ordenados como la lista de gustos (Dulce, Salado, …) y por nombre dentro de cada uno.

Las rutas privadas de productos devuelven las fotos igual que el detalle público: `imagenes: [{ "id": "...", "url": "...", "miniatura": "..." }]`. La primera es la portada. Con ese `id` se borra una foto sola.

## Fotos y marca de agua

- Las fotos se suben a Cloudinary con la **marca de agua grabada**: Cloudinary reduce la foto a 1200 px de ancho como máximo, le pone el logo y guarda **solo esa versión**. La original no se conserva, así que no hay forma de pedir la foto sin marca.
- Cuando llegan varias fotos juntas (`POST`/`PUT` con `imagenes`), el servidor las sube a Cloudinary **de a 2** y en orden. Si una falla, no arranca las que faltan, borra las que ya se habían subido y responde `502` ("No se pudo subir la foto…"). Al borrar una foto o un producto, también se borran de Cloudinary.

### Subir fotos en segundo plano (front)

Para no dejar al usuario esperando, el front no manda todas las fotos en el mismo request:

1. Crea el producto **solo con los datos**: `POST /api/productos` con JSON. Responde al instante con el producto (`imagenes: []`) y el usuario sigue usando la app.
2. Encola las fotos y las manda **de a una** a `POST /api/productos/:id/imagenes`, con **2 requests a la vez como máximo**. Cada respuesta (`201`) trae la foto lista: `{ id, url, miniatura }`.
3. Para que la portada sea la que eligió el usuario, conviene mandar **primero la portada sola** y después el resto de a 2. Las fotos quedan en el orden en que terminan de subirse.

- El tope de 10 se controla en la misma operación que agrega la foto: aunque lleguen varias a la vez, nunca se pasa. Las que sobran responden `400` ("Un producto puede tener hasta 10 fotos") y no quedan huérfanas en Cloudinary.
- Si el producto ya no existe (por ejemplo, lo borraron mientras se subía), responde `404` y la foto se borra de Cloudinary.
- Si falla Cloudinary, responde `502`: el front puede reintentar esa foto sola.
- Las URLs que devuelve la API ya vienen optimizadas: `url` lleva `q_auto,f_auto` y `miniatura` lleva `w_400,c_limit,q_auto,f_auto`.

| Variable                  | Valores                              | Para qué                                                       |
| ------------------------- | ------------------------------------ | -------------------------------------------------------------- |
| `CLOUDINARY_WATERMARK_ID` | por ejemplo `marca/logo`             | Id del logo en Cloudinary. Vacía: las fotos se suben sin marca |
| `WATERMARK_POSICION`      | `centro` (por defecto) o `esquina`   | `esquina` es abajo a la derecha, a 20 px del borde             |
| `WATERMARK_ANCHO`         | de `0.1` a `0.7` (por defecto `0.3`) | Ancho del logo como fracción del ancho de la foto              |
| `WATERMARK_OPACIDAD`      | de `10` a `100` (por defecto `85`)   | Opacidad del logo                                              |

- Las `WATERMARK_*` solo se usan en las fotos de productos. Las promos (fotos y videos) llevan el mismo logo siempre en la esquina, con ancho `0.2` y opacidad `60`.
- Si un valor está fuera de rango, la API no arranca y dice cuál es. Si el logo no está en Cloudinary, arranca igual pero avisa que corras `npm run subir-marca`: hasta entonces Cloudinary rechaza las fotos.
- **`npm run subir-marca [ruta-al-png]`** sube (o reemplaza) el logo con el id de `CLOUDINARY_WATERMARK_ID` (por defecto `marca/logo`). Sin ruta, usa `assets/marca-blanca-sin-flor-sombra.png`. Cambiar el logo no cambia las fotos ya subidas, porque la marca quedó grabada en ellas.

## Pruebas rápidas con curl

```bash
# Login
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"usuario":"jefe","password":"cambiame"}'

# Subir el logo de la marca de agua (una vez, o cuando cambie)
npm run subir-marca

# Crear producto con dos fotos (la primera es la portada)
curl -X POST http://localhost:3000/api/productos \
  -H "Authorization: Bearer TU_TOKEN" \
  -F "nombre=Pan francés" -F "precio=1500" -F "pesoGramos=500" -F "anticipacionHoras=24" \
  -F "ingredientes=harina, agua, sal, levadura" -F "categoria=Salado" \
  -F "imagenes=@./pan.jpg" -F "imagenes=@./pan-cortado.jpg"

# Ver catálogo público (segunda página de facturas)
curl "http://localhost:3000/api/catalogo?categoria=Dulce&pagina=2"

# Hacer un pedido (público)
curl -X POST http://localhost:3000/api/pedidos \
  -H "Content-Type: application/json" \
  -d '{"cliente":{"nombre":"Ana","telefono":"11 5555-1234"},"items":[{"productoId":"ID_DEL_PRODUCTO","cantidad":2}],"fechaEntrega":"2026-11-25"}'
```
