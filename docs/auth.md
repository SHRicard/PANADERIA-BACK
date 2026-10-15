# Auth: login y recuperación de contraseña

Cómo inicia sesión el dueño desde la app (`PANADERIA-FRONT`), cómo recupera la contraseña y cómo se usa el token en las rutas privadas. Al final está cómo quedó hecho en el front: **Redux Toolkit + RTK Query**, con el token cifrado en MMKV.

Hay **un solo usuario**: el dueño. No hay registro ni roles; el usuario se crea en el back con `npm run crear-admin`.

## El flujo

1. La app manda usuario y contraseña a `POST /api/auth/login` y recibe un `token`.
2. Lo guarda cifrado en el celular y lo manda como `Authorization: Bearer <token>` en cada ruta privada.
3. Si una ruta privada responde `401`, la sesión se cierra y la app vuelve al login.
4. Si se olvidó la contraseña: pide un código por email (`POST /api/auth/recuperar`) y lo canjea por una contraseña nueva (`POST /api/auth/restablecer`). Esa respuesta trae un token, así que entra directo.

## URL base

| Entorno | URL |
|---|---|
| Desarrollo | `http://localhost:3000` (en Android, `./run.sh android` del front redirige el puerto 3000 del celular a la compu) |
| Producción | La URL del servicio en Render, cargada en `EXPO_PUBLIC_API_URL` |

- **Render gratis se duerme** a los 15 minutos sin tráfico: el primer pedido puede tardar casi un minuto. Por eso el timeout del `baseApi` es de 60 segundos (`config.apiTimeoutMs`). No lo bajes.
- **CORS:** la APK no manda `origin` y siempre se acepta. Si probás desde la web (`expo start --web`), ese origen (por ejemplo `http://localhost:8081`) tiene que estar en `CORS_ORIGINS` del back.

## `POST /api/auth/login` (pública)

```http
POST /api/auth/login
Content-Type: application/json

{ "usuario": "jefe", "password": "cambiame" }
```

| Campo | Tipo | Notas |
|---|---|---|
| `usuario` | string | Sin espacios al principio ni al final: el back lo compara tal cual (`loginSchema` ya hace `trim`). |
| `password` | string | Tal cual la escribió el usuario, **sin** `trim`. |

| Caso | Código | Body |
|---|---|---|
| Credenciales correctas | `200` | `{ "token": "eyJhbGciOi..." }` |
| Falta `usuario` o `password`, o no son texto | `400` | `{ "error": "Usuario y contraseña requeridos" }` |
| Usuario que no existe o contraseña incorrecta | `401` | `{ "error": "Usuario o contraseña incorrectos" }` |
| El body no es un JSON válido | `400` | `{ "error": "El cuerpo de la petición no es un JSON válido" }` |
| Falla del servidor (por ejemplo, la base no responde) | `500` | `{ "error": "Algo falló en el servidor. Probá de nuevo en unos minutos." }` |

- El `401` dice **siempre lo mismo**, exista o no el usuario, a propósito. No intentes distinguir los dos casos.
- Validá en el formulario que ninguno de los dos esté vacío: el back acepta un texto vacío y responde `401`.
- Hoy `/login` no tiene límite de frecuencia. Si se agrega, va a responder `429` con `{ "error": "..." }`, como las rutas de recuperación.

## Recuperar la contraseña

El código lo manda el back por email a la dirección del dueño (`ADMIN_EMAIL`):

- **6 dígitos**, vence a los **15 minutos** y admite **5 intentos**.
- Sirve **una sola vez**. Pedir otro **invalida el anterior**.
- Si el back no tiene configurado el SMTP, `recuperar` responde `503`. Hoy el `.env` de desarrollo no lo tiene.

### `POST /api/auth/recuperar` (pública)

```http
POST /api/auth/recuperar
Content-Type: application/json

{ "email": "duenio@ejemplo.com" }
```

| Caso | Código | Body |
|---|---|---|
| Pedido aceptado | `200` | `{ "mensaje": "Si el email está registrado, te mandamos un código para restablecer la contraseña" }` |
| Email con formato inválido | `400` | `{ "error": "Ingresá un email válido" }` |
| Más de **5 pedidos por hora** desde la misma IP | `429` | `{ "error": "Pediste demasiados códigos. Probá de nuevo en un rato." }` |
| No se pudo mandar el email | `502` | `{ "error": "No se pudo enviar el email. Probá de nuevo en unos minutos." }` |
| El back no tiene SMTP | `503` | `{ "error": "La recuperación por email no está configurada" }` |

- El `200` dice **lo mismo exista o no el email**, a propósito. Mostrá `mensaje` tal cual y pasá a la pantalla del código.
- El front no deja reenviar hasta que pasen 60 segundos. Igual, después de 5 pedidos en una hora, el back responde `429`.

### `POST /api/auth/restablecer` (pública)

```http
POST /api/auth/restablecer
Content-Type: application/json

{ "email": "duenio@ejemplo.com", "codigo": "123456", "password": "nueva-contraseña" }
```

| Caso | Código | Body |
|---|---|---|
| Código correcto | `200` | `{ "token": "eyJhbGciOi..." }`: la contraseña ya cambió y la app entra con ese token |
| Código incorrecto, vencido, ya usado o sin intentos (también si el email o el código vienen mal formados) | `400` | `{ "error": "Código inválido o vencido" }` |
| Contraseña de menos de 8 o más de 72 caracteres | `400` | `{ "error": "La contraseña tiene que tener entre 8 y 72 caracteres" }` |
| Más de **10 intentos cada 15 minutos** desde la misma IP | `429` | `{ "error": "Demasiados intentos. Probá de nuevo en un rato." }` |

- `email` tiene que ser el mismo al que se pidió el código. El front lo toma de `recuperacionSlice`.
- `password` va de 8 a 72 caracteres, porque bcrypt ignora lo que pase de 72. `restablecerSchema` usa los mismos límites (`PASSWORD_MIN` y `PASSWORD_MAX`).

## El token

- Es un **JWT que vence a los 30 días**. No hay endpoint para renovarlo: cuando vence, el dueño vuelve a iniciar sesión.
- Trae `{ id, usuario, iat, exp }`, pero el front **no necesita decodificarlo** ni verificar la firma: lo valida el back en cada pedido.
- Va cifrado en el celular y nunca se muestra ni se manda a logs.

## Rutas privadas y el `401`

Todas las rutas privadas (`/api/productos`, `/api/clientes`, `GET /api/pedidos`, `POST`/`DELETE` de `/api/promos`, etc.) piden `Authorization: Bearer <token>`:

| Caso | Código | Body |
|---|---|---|
| No se mandó el header | `401` | `{ "error": "No autorizado" }` |
| Token inválido o vencido | `401` | `{ "error": "Token inválido o vencido" }` |

Ante un `401` de un pedido **que llevaba token**, la sesión se cierra. Un `401` del login (credenciales incorrectas) no cierra nada, porque ese pedido no lleva token: solo se muestra el error en el formulario.

## Cerrar sesión

- No hay endpoint: cerrar sesión es **borrar el token del celular**.
- El back no invalida tokens: uno que sigue guardado vale hasta que vence. **Restablecer la contraseña tampoco cierra la sesión en otros dispositivos.**
- Si un token se filtró, la única forma de invalidarlo es cambiar `JWT_SECRET` en el back, y eso cierra la sesión en todos los dispositivos.

## Schemas de Zod (respuestas)

Están en `features/auth/schemas.ts`. Cada endpoint los valida con `rawResponseSchema`:

```ts
export const tokenRespuestaSchema = z.object({ token: z.string().min(1) }); // login y restablecer
export const recuperarRespuestaSchema = z.object({ mensaje: z.string() }); // recuperar
```

Si el back cambia la forma de la respuesta, el `baseApi` lo convierte en un error con el mensaje "El servidor respondió algo inesperado. Probá de nuevo más tarde." (`catchSchemaFailure`), en vez de romperse en la pantalla.

## Cómo está hecho en el front

### Pedidos al back (RTK Query)

`features/auth/api/authApi.ts` inyecta tres endpoints en el `baseApi` (`injectEndpoints`):

| Endpoint | Pedido | Devuelve |
|---|---|---|
| `login` | `POST /auth/login` con `{ usuario, password }` | el token (`transformResponse` saca `.token`) |
| `pedirCodigo` | `POST /auth/recuperar` con `{ email }` | el `mensaje` |
| `restablecer` | `POST /auth/restablecer` con `{ email, codigo, password }` | el token |

El `baseApi` (`services/api/baseApi.ts`) se encarga del resto:
- **El token:** lo pone en `Authorization` en cada pedido (`prepareHeaders`, tomándolo de `state.sesion.token`).
- **Los errores:** los convierte en `ApiError { status, mensaje }`. Sin conexión o con timeout, `status` es `null`. Para el texto a mostrar está `mensajeDeError(e)`.
- **El `401` con token:** despacha `sesionVencida`.

### Estado (Redux)

| Slice | Guarda | Cuándo cambia |
|---|---|---|
| `sesion` (`store/sesionSlice.ts`) | `token` | Se carga de MMKV al abrir la app. Se llena cuando `login` o `restablecer` salen bien (con `matchFulfilled`, sin código extra en las pantallas). Se vacía con `cerrarSesion` o con `sesionVencida` (un `401` con token) |
| `recuperacion` (`store/recuperacionSlice.ts`) | `email` y `pedidoEn` del último código | Cuando `pedirCodigo` sale bien. **No se guarda**: si se cierra la app a mitad de camino, se vuelve a pedir el código |

- **Persistencia:** `src/store/index.ts` escucha los cambios de `sesion.token` y lo guarda cifrado en MMKV (`storageService.seguro`, clave `token`). No usa redux-persist: MMKV es síncrono, así que el token ya está cargado al abrir la app.
- **Navegación:** el layout `app/(admin)/_layout.tsx` usa `Stack.Protected` con `useHaySesion()`. Con token muestra las pestañas; sin token, login, recuperar y restablecer. Al iniciar o cerrar sesión **no hace falta navegar a mano**: cambia el guard y Expo Router lleva a la pantalla que corresponde.

### Hooks de las pantallas

| Hook | Qué hace |
|---|---|
| `useLogin` | Formulario (`loginSchema`). Llama a `login(datos).unwrap()`; si falla, muestra `mensajeDeError` y limpia la contraseña |
| `useRecuperar` | Formulario (`recuperarSchema`). Llama a `pedirCodigo(email)` y pasa a `/restablecer` |
| `useRestablecer` | Formulario (`restablecerSchema`, con confirmación). Llama a `restablecer({ email, codigo, password })`. Reenvío con espera de 60 s (`useCuentaRegresiva`) |
| `useCerrarSesion` | Despacha `cerrarSesion` |
| `useHaySesion` | `true` si hay token. Lo usa el guard |

Fuera de la feature solo se usan `useCerrarSesion` y `useHaySesion`, desde `@/features/auth`.

### Ejemplo de uso

```ts
const [login] = useLoginMutation();
await login({ usuario: 'jefe', password: 'cambiame' }).unwrap();
// No hace falta más: sesionSlice guarda el token, el listener lo persiste y el guard muestra las pestañas
```

## Probarlo a mano

```bash
# Login
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"usuario":"jefe","password":"cambiame"}'

# Ruta privada con el token que devolvió
curl http://localhost:3000/api/productos -H "Authorization: Bearer TU_TOKEN"

# Pedir el código (llega al email del dueño)
curl -X POST http://localhost:3000/api/auth/recuperar \
  -H "Content-Type: application/json" \
  -d '{"email":"duenio@ejemplo.com"}'

# Canjearlo por una contraseña nueva (devuelve un token)
curl -X POST http://localhost:3000/api/auth/restablecer \
  -H "Content-Type: application/json" \
  -d '{"email":"duenio@ejemplo.com","codigo":"123456","password":"nueva-contraseña"}'
```
