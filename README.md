# Panadería Digital – Backend

Node.js + TypeScript + Express + MongoDB (Mongoose) + Cloudinary + login con JWT.

## Puesta en marcha

1. Instalar dependencias: `npm install`
2. Copiar `.env.example` a `.env` y completar los valores:
   - `MONGODB_URI`: cadena de conexión de MongoDB Atlas.
   - `JWT_SECRET`: una clave larga y aleatoria.
   - `CLOUDINARY_*`: datos del Dashboard de Cloudinary.
   - `CORS_ORIGINS`: dominios de tu web (separados por coma).
   - `ADMIN_USER` / `ADMIN_PASSWORD`: usuario y contraseña del jefe.
   - `ADMIN_EMAIL`: email del jefe, a donde le llega el código si se olvida la contraseña.
   - `SMTP_*` y `EMAIL_FROM` (opcionales): cuenta que manda ese código. Con Gmail, usá una contraseña de aplicación.
3. Crear el usuario del jefe: `npm run crear-admin` (si ya existe, le actualiza la contraseña y el email)
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
| GET | `/api/catalogo` | Productos disponibles (`?categoria=Panes` para filtrar) |
| GET | `/api/catalogo/:id` | Detalle de un producto |
| GET | `/api/promos` | Lista de promos |
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
| GET | `/api/productos` | Todos los productos, incluso no disponibles |
| POST | `/api/productos` | Crear (multipart/form-data, con hasta 5 fotos en `imagenes`) |
| PUT | `/api/productos/:id` | Editar (JSON o multipart/form-data). Las fotos que vengan en `imagenes` se **suman** a las que ya tiene |
| DELETE | `/api/productos/:id` | Borrar (también borra sus fotos en Cloudinary) |
| DELETE | `/api/productos/:id/imagenes/:imagenId` | Borrar una sola foto del producto |
| POST | `/api/promos` | Crear promo (multipart: `titulo`, `texto`, `imagen`) |
| DELETE | `/api/promos/:id` | Borrar promo |
| GET | `/api/pedidos` | Pedidos, del más nuevo al más viejo (`?estado=pendiente`, `?pagina=1`, `?limite=20`, máx. 100) |
| GET | `/api/pedidos/:id` | Detalle de un pedido con los datos del cliente y su cantidad de pedidos |
| PATCH | `/api/pedidos/:id/estado` | Cambiar estado: `{ "estado": "pendiente" \| "confirmado" \| "entregado" \| "cancelado" }` |
| GET | `/api/clientes` | Clientes con su cantidad de pedidos y la fecha del último |
| GET | `/api/clientes/:id` | Un cliente con sus últimos 20 pedidos |

Campos de producto: `nombre` (obligatorio), `precio` (obligatorio, mayor que 0), `descripcion`, `ingredientes` (JSON `["harina","sal"]` o texto `harina, sal`), `pesoGramos` (mayor que 0), `categoria`, `disponible` (`true`/`false`) e `imagenes` (hasta 5 archivos, máx. 5 MB cada uno).

Las fotos se devuelven como `imagenes: [{ "_id": "...", "url": "..." }]`. La primera es la portada. Con ese `_id` se borra una foto sola.

## Pruebas rápidas con curl

```bash
# Login
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"usuario":"jefe","password":"cambiame"}'

# Crear producto con dos fotos (la primera es la portada)
curl -X POST http://localhost:3000/api/productos \
  -H "Authorization: Bearer TU_TOKEN" \
  -F "nombre=Pan francés" -F "precio=1500" -F "pesoGramos=500" \
  -F "ingredientes=harina, agua, sal, levadura" -F "categoria=Panes" \
  -F "imagenes=@./pan.jpg" -F "imagenes=@./pan-cortado.jpg"

# Ver catálogo público
curl http://localhost:3000/api/catalogo

# Hacer un pedido (público)
curl -X POST http://localhost:3000/api/pedidos \
  -H "Content-Type: application/json" \
  -d '{"cliente":{"nombre":"Ana","telefono":"11 5555-1234"},"items":[{"productoId":"ID_DEL_PRODUCTO","cantidad":2}]}'
```
