# Panadería Digital – Backend

Node.js + TypeScript + Express + MongoDB (Mongoose) + Cloudinary + login con JWT.

## Puesta en marcha

1. Instalar dependencias: `npm install`
2. Copiar `.env.example` a `.env` y completar los valores:
   - `MONGODB_URI`: cadena de conexión de MongoDB Atlas.
   - `JWT_SECRET`: una clave larga y aleatoria.
   - `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY` y `CLOUDINARY_API_SECRET` (**obligatorias**: sin ellas la API no arranca): datos del Dashboard de Cloudinary.
   - `CLOUDINARY_WATERMARK_ID`, `WATERMARK_POSICION`, `WATERMARK_ANCHO` y `WATERMARK_OPACIDAD`: la marca de agua (ver [Fotos y marca de agua](#fotos-y-marca-de-agua)).
   - `CORS_ORIGINS`: dominios de tu web (separados por coma).
   - `ADMIN_USER` / `ADMIN_PASSWORD`: usuario y contraseña del jefe.
   - `ADMIN_EMAIL`: email del jefe, a donde le llega el código si se olvida la contraseña.
   - `SMTP_*` y `EMAIL_FROM` (opcionales): cuenta que manda ese código. Con Gmail, usá una contraseña de aplicación.
3. Crear el usuario del jefe: `npm run crear-admin` (si ya existe, le actualiza la contraseña y el email)
   - Subir el logo de la marca de agua: `npm run subir-marca` (ver [Fotos y marca de agua](#fotos-y-marca-de-agua)).
   - (Opcional) Cargar 10 productos de ejemplo para probar el catálogo: `npm run sembrar`. Copia las fotos de los productos que ya tengan fotos (hace falta al menos uno) y saltea los nombres que ya existen, así que se puede correr más de una vez. Para sacarlos, se eliminan desde la app como cualquier producto (se borran también sus fotos).
   - Si la base tiene productos de antes de la anticipación: `npm run migrar-anticipacion` les pone 24 hs. Sin eso no se pueden editar. Solo toca los que no la tienen, así que se puede correr más de una vez.
4. Levantar con `./run.sh`: revisa Node, dependencias (las instala si faltan), las variables del `.env`, la conexión a MongoDB, a Cloudinary y al SMTP, que exista el usuario admin (y que tenga email) y que el puerto esté libre. Si todo está bien, arranca en desarrollo (http://localhost:3000). Nunca imprime los valores del `.env`.
   - `./run.sh prod`: compila y corre lo compilado, como en Render.
   - `./run.sh check`: solo revisa, no levanta nada.
   - A mano: `npm run dev`, o `npm run build` y `npm start`.

## Deploy en Render

- Build Command: `npm install && npm run build`
- Start Command: `npm start`
- Cargar las variables del `.env` en _Environment_ (no subas el `.env` a Git).
- En MongoDB Atlas, permitir el acceso desde cualquier IP (`0.0.0.0/0`) en _Network Access_, porque Render no tiene IP fija en el plan gratuito.
- Ping de mantenimiento (UptimeRobot / cron-job.org): `GET /health`

## Endpoints

### Públicos (los usa el catálogo que se envía por WhatsApp)

| Método | Ruta                                | Descripción                                                                                                                                                                                                                                                                         |
| ------ | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/health`                           | Responde `ok`                                                                                                                                                                                                                                                                       |
| GET    | `/api/catalogo`                     | Productos activos, paginados (ver [Listas paginadas y filtros](#listas-paginadas-y-filtros)). Cada uno trae `portada` (miniatura de la primera foto, o `null`) y `cantidadImagenes`, sin el array de fotos, y `puntajePromedio` y `cantidadRecomendaciones` sin las recomendaciones |
| GET    | `/api/catalogo/categorias`          | Los gustos (la lista fija de categorías), en orden: `[{ "nombre": "Dulce", "cantidad": 5 }, …]` (`cantidad` = productos activos)                                                                                                                                                    |
| GET    | `/api/catalogo/:id`                 | Detalle de un producto activo, con todas sus fotos (`imagenes: [{ id, url, miniatura }]`) y sus recomendaciones (ver [Recomendaciones](#recomendaciones))                                                                                                                           |
| POST   | `/api/catalogo/:id/recomendaciones` | Dejar una recomendación sin login: `{ "puntaje": 5, "texto": "...", "autor": "..." }`. Solo productos activos. Máx. 10 por hora por IP y body de hasta 10kb                                                                                                                         |
| GET    | `/api/ajustes`                      | Lo que eligió el dueño para la web: `{ "estiloCatalogo": "vidriera" \| "carta" }`. Sin cambios guardados, responde los de por defecto (`carta`)                                                                                                                                     |
| GET    | `/api/datos-pago`                   | Los datos para transferirle al dueño, que la web le muestra al cliente después del pedido: `{ "nombreCompleto", "alias", "cbu", "billetera" }`. Si el dueño todavía no los cargó, `404`                                                                                             |
| POST   | `/api/carrito`                      | Cotizar el carrito: `{ "items": [{ "productoId": "...", "cantidad": 2 }] }` → precios actuales, subtotales, total y los productos que ya no están disponibles. No guarda nada (el carrito vive en el navegador). Máx. 100 cada 10 minutos por IP y body de hasta 10kb               |
| POST   | `/api/pedidos`                      | Hacer un pedido sin login (JSON, ver abajo). Máx. 10 por hora por IP y body de hasta 10kb                                                                                                                                                                                           |

Body de `POST /api/pedidos`: `{ "cliente": { "nombre": "...", "telefono": "..." }, "items": [{ "productoId": "...", "cantidad": 2 }], "nota": "..." }`. El precio y el total los calcula el servidor; lo que mande el cliente se ignora. Responde `201` con `{ id, items, total, estado, createdAt }`, sin datos de clientes. El total sale de la misma cuenta que `POST /api/carrito`, así que coincide con lo que el cliente vio en el carrito.

Respuesta de `POST /api/carrito`: `{ "items": [{ "productoId", "nombre", "precio", "cantidad", "subtotal", "portada" }], "noDisponibles": ["..."], "cantidadTotal": 3, "total": 28000 }`. Los productos pausados o eliminados no son un error: vuelven en `noDisponibles` y no suman. Acepta un carrito vacío (total `0`) y las mismas reglas de ítems que el pedido (hasta 30 productos, cantidades enteras de 1 a 50, los repetidos se suman).

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
| GET    | `/api/pedidos`                                        | Pedidos, del más nuevo al más viejo (`?estado=pendiente`, `?pagina=1`, `?limite=20`, máx. 100). Cada uno con su `saldo` y su `origen` (ver abajo)                                                                                             |
| GET    | `/api/pedidos/:id`                                    | Detalle de un pedido con los datos del cliente, su cantidad de pedidos el `saldo` y el `origen`                                                                                                                                             |
| POST   | `/api/pedidos/manuales`                               | Cargar un pedido que le hicieron al dueño por fuera de la web (WhatsApp, en persona). Mismo body que el pedido público, más `"sena": { "monto": 35000 }` opcional. Responde `201` con el detalle (ver abajo) |
| PUT    | `/api/pedidos/:id/sena`                               | Confirmar la seña: `{ "monto": 35000 }` (mayor que 0 y hasta el total). Pasa a `confirmado`. Otra vez sobre un pedido confirmado, corrige el monto. Responde el detalle                                                         |
| DELETE | `/api/pedidos/:id/sena`                               | Quitar la seña (por si se confirmó por error): vuelve a `pendiente`. Responde el detalle                                                                                                                                        |
| PUT    | `/api/pedidos/:id/entrega`                            | Marcar entregado, con o sin seña. Responde el detalle                                                                                                                                                                           |
| DELETE | `/api/pedidos/:id/entrega`                            | Deshacer la entrega: vuelve a `confirmado` si tiene seña, si no a `pendiente`. Responde el detalle                                                                                                                              |
| PUT    | `/api/pedidos/:id/cancelacion`                        | Cancelar el pedido (la seña, si tenía, queda registrada). Responde el detalle                                                                                                                                                   |
| DELETE | `/api/pedidos/:id/cancelacion`                        | Deshacer la cancelación: vuelve a `confirmado` o `pendiente`. Responde el detalle                                                                                                                                               |
| GET    | `/api/clientes`                                       | Clientes con su cantidad de pedidos y la fecha del último                                                                                                                                                                       |
| GET    | `/api/clientes/:id`                                   | Un cliente con sus últimos 20 pedidos                                                                                                                                                                                           |
| PATCH  | `/api/ajustes`                                        | Cambiar los ajustes de la web: `{ "estiloCatalogo": "vidriera" \| "carta" }`. Solo cambia lo que viene; un valor fuera de la lista da `400`. Responde los ajustes completos                                                     |
| PUT    | `/api/datos-pago`                                     | Cargar o reemplazar los datos de pago (ver abajo). Responde los datos guardados                                                                                                                                                 |
| DELETE | `/api/datos-pago`                                     | Borrar los datos de pago: la web deja de mostrarlos. Responde `204` (`404` si no había)                                                                                                                                         |
| GET    | `/api/insumos`                                        | Los insumos (harina, manteca…), por nombre, con el precio y la fecha de la última compra. Sin el historial |
| GET    | `/api/insumos/:id`                                    | Un insumo con su historial (`logs`), la entrada más nueva primero |
| POST   | `/api/insumos`                                        | Cargar un insumo: `{ "nombre": "Harina", "precio": 25000, "cantidad": 25, "unidad": "kg", "fecha": "2026-10-01" }` (`fecha` opcional: hoy). Responde `201` |
| PUT    | `/api/insumos/:id`                                    | Actualizarlo (una compra nueva o una corrección): solo lo que viene (`cantidad` y `unidad`, juntas). Suma una entrada al historial |
| GET    | `/api/almacenamiento`                                 | Cuánto del plan de Cloudinary está usado (créditos, almacenamiento, ancho de banda y transformaciones) y qué tan cerca está del límite (ver [Almacenamiento](#almacenamiento)) |
| GET    | `/api/almacenamiento/archivos`                        | Las fotos de productos y las promos, **lo que más ocupa primero**, para elegir qué borrar (`?origen=producto` o `?origen=promo`, `?pagina=1`, `?limite=20`, máx. 100) |
| GET    | `/api/metricas/productos`                             | Los **productos más vendidos** en un rango de días (`?desde=2026-10-01&hasta=2026-10-31`, los dos opcionales), por unidades o por importe (`?orden=unidades` o `?orden=importe`), paginado (ver [Métricas](#métricas)) |
| GET    | `/api/metricas/gustos`                                | Lo vendido de **cada gusto**, del que más se vende al que menos (`?desde`, `?hasta`, `?orden`) |
| GET    | `/api/metricas/pedidos`                               | Los pedidos hechos en el rango: **por estado**, **web contra manuales**, **% de cancelados**, **ticket promedio** y **por día de la semana** |
| GET    | `/api/metricas/clientes`                              | Los clientes que compraron en el rango: **nuevos**, **los que vuelven** y los que compraron más de una vez |
| GET    | `/api/metricas/insumos`                               | **En qué insumos se gastó más** y **cuánto aumentó cada uno** respecto de la compra anterior |
| GET    | `/api/metricas/balance`                               | **Lo que entra por ventas, lo que sale en insumos y la ganancia**, con la serie por día, semana o mes (`?agrupar=dia\|semana\|mes`, por defecto `mes`) |

Campos de producto: `nombre` (obligatorio y **único**: no puede haber dos productos con el mismo nombre, sin importar mayúsculas, acentos ni espacios de más; si se repite, `409` "Ya existe un producto con ese nombre: «…»"), `precio` (obligatorio, mayor que 0), `categoria` (obligatoria: el **gusto**, uno de la lista fija), `anticipacionHoras` (obligatoria: con cuántas horas de anticipación hay que encargarlo, entero de 0 a 720; `0` = se puede pedir en el momento. Es informativa: se muestra en el catálogo y el pedido no la controla), `descripcion`, `etiqueta` (texto libre de hasta 30 caracteres para destacarlo en el catálogo, por ejemplo "Nuevo", "Promo lanzamiento" o "El más elegido"), `ingredientes` (JSON `["harina","sal"]` o texto `harina, sal`), `pesoGramos` (mayor que 0), `disponible` (`true` = activo, `false` = pausado) e `imagenes` (hasta 10 archivos por request, solo imágenes, máx. 10 MB cada uno). `descripcion`, `etiqueta` y `pesoGramos` son opcionales: mandarlos vacíos (`null` en JSON o `""`) los borra.

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
- No hay borrado.

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

### Estados del pedido

| Estado       | Qué significa                   | Cómo se llega                                                         |
| ------------ | ------------------------------- | --------------------------------------------------------------------- |
| `pendiente`  | Recién hecho, esperando la seña | Al crearlo, o quitando la seña                                        |
| `confirmado` | La seña está pagada             | `PUT /api/pedidos/:id/sena`                                           |
| `entregado`  | Ya lo retiró                    | `PUT /api/pedidos/:id/entrega` (desde `pendiente` o `confirmado`)     |
| `cancelado`  | No va                           | `PUT /api/pedidos/:id/cancelacion` (desde `pendiente` o `confirmado`) |

- El estado no se cambia directo: lo cambian estas acciones, que además guardan el dato que corresponde: `sena: { monto, pagadaEn }`, `entregadoEn` o `canceladoEn`. Los pedidos anteriores no tienen esos campos.
- Cada respuesta de pedidos (lista, detalle y acciones) trae **`saldo`**: lo que falta cobrar al entregar (total menos la seña). Se calcula, no se guarda.
- Si el pedido está en un estado que no permite la acción (por ejemplo, cancelar uno entregado), responde `409` con el motivo. Si dos acciones llegan a la vez, gana una y la otra recibe `409`.
- Cada pedido trae **`origen`**: `web` (lo hizo el cliente desde la web) o `manual` (lo cargó el dueño). Los pedidos anteriores a este campo salen como `web`.

### Pedido manual

`POST /api/pedidos/manuales` (privado) es para que el dueño cargue un pedido que le hicieron por WhatsApp o en persona, y use la app como agenda:

```json
{
  "cliente": { "nombre": "Doña Rosa", "telefono": "11 4444-1234" },
  "items": [{ "productoId": "...", "cantidad": 2 }],
  "nota": "Lo retira el sábado",
  "sena": { "monto": 12000 }
}
```

- Las mismas reglas que el pedido de la web: el cliente se crea o se actualiza por teléfono, y nombre, precio y total salen de la base.
- **Puede incluir productos pausados** (por ejemplo, el pan dulce que le encargan fuera de temporada). Los eliminados no: `400` con `productosNoDisponibles`.
- `sena` es opcional. Sin seña, entra `pendiente`; con seña (mayor que 0 y hasta el total), entra `confirmado`.
- Queda con `origen: "manual"` y sigue los mismos pasos que cualquier pedido: seña, entrega y cancelación.
- No tiene el límite de 10 por hora del pedido público.

Categorías: son el **gusto** del producto, de una lista fija en `src/models/Producto.ts` y en este orden: Dulce, Salado, Agridulce, Ácido, Amargo, Picante. Se aceptan sin importar mayúsculas ni acentos (`acido` se guarda como `Ácido`); cualquier otra (`Dulse`, `Facturas`) responde `400` con la lista. Cada pedido guarda el gusto de cada producto al momento de la venta, para las métricas.

Un producto **pausado** (`disponible: false`, por ejemplo el pan dulce fuera de temporada) no sale en el catálogo ni se puede pedir, pero conserva sus datos y sus fotos: se reactiva con `PUT /api/productos/:id` y `{ "disponible": true }`.

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
| `pagina`    | Desde 1 (por defecto 1). Una página que no existe responde `productos: []`                                  |
| `limite`    | Productos por página (por defecto 20, máx. 100)                                                             |
| `buscar`    | Una parte del nombre, sin importar mayúsculas ni acentos (`sandwich` encuentra "Sándwich de miga")          |
| `categoria` | Un gusto de la lista fija. Si no es de la lista: `400`                                                      |
| `estado`    | Solo en `/api/productos`: `activo` o `pausado` (si no, `400`). El catálogo siempre muestra solo los activos |

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
  -d '{"cliente":{"nombre":"Ana","telefono":"11 5555-1234"},"items":[{"productoId":"ID_DEL_PRODUCTO","cantidad":2}]}'
```
