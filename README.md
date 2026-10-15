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
4. Levantar con `./run.sh`: revisa Node, dependencias (las instala si faltan), las variables del `.env`, la conexión a MongoDB, a Cloudinary y al SMTP, que exista el usuario admin (y que tenga email) y que el puerto esté libre. Si todo está bien, arranca en desarrollo (http://localhost:3000). Nunca imprime los valores del `.env`.
   - `./run.sh prod`: compila y corre lo compilado, como en Render.
   - `./run.sh check`: solo revisa, no levanta nada.
   - A mano: `npm run dev`, o `npm run build` y `npm start`.

## Deploy en Render

- Build Command: `npm install && npm run build`
- Start Command: `npm start`
- Cargar las variables del `.env` en *Environment* (no subas el `.env` a Git).
- En MongoDB Atlas, permitir el acceso desde cualquier IP (`0.0.0.0/0`) en *Network Access*, porque Render no tiene IP fija en el plan gratuito.
- Ping de mantenimiento (UptimeRobot / cron-job.org): `GET /health`

## Endpoints

### Públicos (los usa el catálogo que se envía por WhatsApp)

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/health` | Responde `ok` |
| GET | `/api/catalogo` | Productos activos, paginados (ver [Listas paginadas y filtros](#listas-paginadas-y-filtros)). Cada uno trae `portada` (miniatura de la primera foto, o `null`) y `cantidadImagenes`, sin el array de fotos |
| GET | `/api/catalogo/categorias` | Los gustos (la lista fija de categorías), en orden: `[{ "nombre": "Dulce", "cantidad": 5 }, …]` (`cantidad` = productos activos) |
| GET | `/api/catalogo/:id` | Detalle de un producto activo, con todas sus fotos: `imagenes: [{ id, url, miniatura }]` |
| GET | `/api/promos` | Lista de promos, cada una con `imagenUrl` (optimizada) y `miniatura` |
| POST | `/api/pedidos` | Hacer un pedido sin login (JSON, ver abajo). Máx. 10 por hora por IP y body de hasta 10kb |

Body de `POST /api/pedidos`: `{ "cliente": { "nombre": "...", "telefono": "..." }, "items": [{ "productoId": "...", "cantidad": 2 }], "nota": "..." }`. El precio y el total los calcula el servidor; lo que mande el cliente se ignora. Responde `201` con `{ id, items, total, estado, createdAt }`, sin datos de clientes.

### Login y recuperación de contraseña (públicos)

| Método | Ruta | Body |
|---|---|---|
| POST | `/api/auth/login` | `{ "usuario": "...", "password": "..." }` → `{ "token": "..." }` |
| POST | `/api/auth/recuperar` | `{ "email": "..." }` → `{ "mensaje": "..." }`. Manda un código de 6 dígitos al email del admin. Máx. 5 por hora por IP |
| POST | `/api/auth/restablecer` | `{ "email": "...", "codigo": "123456", "password": "..." }` → `{ "token": "..." }`. Máx. 10 cada 15 minutos por IP |

- `recuperar` responde siempre el mismo mensaje, exista o no el email. Si el SMTP no está configurado responde `503`, y si el envío falla, `502`.
- El código vence a los 15 minutos, sirve una sola vez y admite 5 intentos. Pedir otro invalida el anterior.
- `restablecer` pide una contraseña de 8 a 72 caracteres y devuelve un token, así la app entra directo. Si el código no sirve: `400` con `"Código inválido o vencido"`.

### Privados (header `Authorization: Bearer <token>`)

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/productos` | Todos los productos, incluso los pausados, paginados y con filtros (además, `?estado=activo` o `?estado=pausado`). Cada uno con todas sus fotos |
| GET | `/api/productos/:id` | Detalle de un producto, aunque esté pausado (el de `/api/catalogo/:id` solo muestra los activos) |
| POST | `/api/productos` | Crear (JSON sin fotos, o multipart/form-data con hasta 10 fotos en `imagenes`) |
| PUT | `/api/productos/:id` | Editar (JSON o multipart/form-data): solo cambia lo que viene. Un opcional se borra mandándolo vacío (`null` o `""`). Las fotos que vengan en `imagenes` se **suman** a las que ya tiene, hasta 10 en total (si se pasa: `400`) |
| PUT | `/api/productos/:id/portada` | Cambiar la portada: `{ "imagenId": "..." }` pasa esa foto al primer lugar. Responde el producto completo |
| DELETE | `/api/productos/:id` | Borrar (también borra sus fotos en Cloudinary) |
| POST | `/api/productos/:id/imagenes` | Agregar **una** foto (multipart, campo `imagen`). Responde `201` con `{ id, url, miniatura }`. Es la que usa el front para subir en segundo plano |
| DELETE | `/api/productos/:id/imagenes/:imagenId` | Borrar una sola foto del producto (de Mongo y de Cloudinary). `imagenId` es el `id` de la foto |
| POST | `/api/promos` | Crear promo (multipart: `titulo`, `texto`, `imagen`) |
| DELETE | `/api/promos/:id` | Borrar promo |
| GET | `/api/pedidos` | Pedidos, del más nuevo al más viejo (`?estado=pendiente`, `?pagina=1`, `?limite=20`, máx. 100) |
| GET | `/api/pedidos/:id` | Detalle de un pedido con los datos del cliente y su cantidad de pedidos |
| PATCH | `/api/pedidos/:id/estado` | Cambiar estado: `{ "estado": "pendiente" \| "confirmado" \| "entregado" \| "cancelado" }` |
| GET | `/api/clientes` | Clientes con su cantidad de pedidos y la fecha del último |
| GET | `/api/clientes/:id` | Un cliente con sus últimos 20 pedidos |

Campos de producto: `nombre` (obligatorio y **único**: no puede haber dos productos con el mismo nombre, sin importar mayúsculas, acentos ni espacios de más; si se repite, `409` "Ya existe un producto con ese nombre: «…»"), `precio` (obligatorio, mayor que 0), `categoria` (obligatoria: el **gusto**, uno de la lista fija), `descripcion`, `ingredientes` (JSON `["harina","sal"]` o texto `harina, sal`), `pesoGramos` (mayor que 0), `disponible` (`true` = activo, `false` = pausado) e `imagenes` (hasta 10 archivos por request, solo imágenes, máx. 10 MB cada uno). `descripcion` y `pesoGramos` son opcionales: mandarlos vacíos (`null` en JSON o `""`) los borra.

Categorías: son el **gusto** del producto, de una lista fija en `src/models/Producto.ts` y en este orden: Dulce, Salado, Agridulce, Ácido, Amargo, Picante. Se aceptan sin importar mayúsculas ni acentos (`acido` se guarda como `Ácido`); cualquier otra (`Dulse`, `Facturas`) responde `400` con la lista. Cada pedido guarda el gusto de cada producto al momento de la venta, para las métricas.

Un producto **pausado** (`disponible: false`, por ejemplo el pan dulce fuera de temporada) no sale en el catálogo ni se puede pedir, pero conserva sus datos y sus fotos: se reactiva con `PUT /api/productos/:id` y `{ "disponible": true }`.

### Listas paginadas y filtros

`GET /api/productos` y `GET /api/catalogo` responden una página:

```json
{ "productos": [ … ], "pagina": 1, "limite": 20, "totalProductos": 31, "totalPaginas": 2 }
```

| Parámetro | Para qué |
|---|---|
| `pagina` | Desde 1 (por defecto 1). Una página que no existe responde `productos: []` |
| `limite` | Productos por página (por defecto 20, máx. 100) |
| `buscar` | Una parte del nombre, sin importar mayúsculas ni acentos (`sandwich` encuentra "Sándwich de miga") |
| `categoria` | Un gusto de la lista fija. Si no es de la lista: `400` |
| `estado` | Solo en `/api/productos`: `activo` o `pausado` (si no, `400`). El catálogo siempre muestra solo los activos |

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

| Variable | Valores | Para qué |
|---|---|---|
| `CLOUDINARY_WATERMARK_ID` | por ejemplo `marca/logo` | Id del logo en Cloudinary. Vacía: las fotos se suben sin marca |
| `WATERMARK_POSICION` | `esquina` (por defecto) o `centro` | `esquina` es abajo a la derecha, a 20 px del borde |
| `WATERMARK_ANCHO` | de `0.1` a `0.7` (por defecto `0.22`) | Ancho del logo como fracción del ancho de la foto |
| `WATERMARK_OPACIDAD` | de `10` a `100` (por defecto `85`) | Opacidad del logo |

- Las `WATERMARK_*` solo se usan en las fotos de productos. Las promos llevan el mismo logo siempre en la esquina, con ancho `0.2` y opacidad `60`.
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
  -F "nombre=Pan francés" -F "precio=1500" -F "pesoGramos=500" \
  -F "ingredientes=harina, agua, sal, levadura" -F "categoria=Salado" \
  -F "imagenes=@./pan.jpg" -F "imagenes=@./pan-cortado.jpg"

# Ver catálogo público (segunda página de facturas)
curl "http://localhost:3000/api/catalogo?categoria=Dulce&pagina=2"

# Hacer un pedido (público)
curl -X POST http://localhost:3000/api/pedidos \
  -H "Content-Type: application/json" \
  -d '{"cliente":{"nombre":"Ana","telefono":"11 5555-1234"},"items":[{"productoId":"ID_DEL_PRODUCTO","cantidad":2}]}'
```
