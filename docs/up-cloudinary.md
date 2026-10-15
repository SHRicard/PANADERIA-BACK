# up-cloudinary: fotos de productos y promos

Cómo consumir desde el front (`PANADERIA-FRONT`) todo lo de fotos: el formato en que llegan, cómo subirlas **en segundo plano** sin bloquear al dueño, cómo borrarlas y qué hacer con cada error.

Los ejemplos de código siguen las convenciones actuales del front: endpoints de **RTK Query** inyectados en el `baseApi` (`injectEndpoints`), respuestas validadas con **Zod 4** (`rawResponseSchema`), errores como `ApiError { status, mensaje }` y fotos mostradas con `expo-image`.

> ⚠️ **Lo actualiza [paginado-productos.md](paginado-productos.md).** Las listas (`GET /api/productos` y `GET /api/catalogo`) vienen **paginadas**, la `categoria` es **obligatoria** y de una lista fija, y la cola suma cada foto con `cambiarProductoEnCache` en vez de `updateQueryData('listarProductos', undefined, …)`. Lo de las fotos (formato, subida, errores) no cambió.

## Resumen

- Un producto tiene **hasta 10 fotos**. La primera es la **portada**.
- Cada foto llega como `{ id, url, miniatura }`, con las URLs listas para mostrar: `miniatura` en listas y grillas, `url` en el detalle. El front **no arma URLs de Cloudinary**.
- La **marca de agua ya viene grabada** en la foto. El front no tiene que agregarla, y no existe una versión sin marca.
- Para no bloquear al usuario: se crea el producto **solo con los datos** y después las fotos se suben **de a una por request, con hasta 2 a la vez**, desde una cola que vive en Redux. Así sigue corriendo aunque el usuario cambie de pantalla.

## Antes de empezar: qué tiene que estar listo en el back

- Las variables `CLOUDINARY_*` cargadas. Sin ellas el back no arranca.
- **El logo subido a Cloudinary** con `npm run subir-marca assets/marca/mark-water.png` (en el back). Si falta, **todas** las subidas de fotos responden `502`.

## Formato de las fotos en las respuestas

### Una foto

```json
{
  "id": "6710b2c4e1a9f3d2c8a1b7e0",
  "url": "https://res.cloudinary.com/<cloud>/image/upload/q_auto,f_auto/v1792072906/panaderia/productos/abc.jpg",
  "miniatura": "https://res.cloudinary.com/<cloud>/image/upload/w_400,c_limit,q_auto,f_auto/v1792072906/panaderia/productos/abc.jpg"
}
```

- `id`: con este id se borra la foto. **Ojo:** el producto usa `_id` y la foto usa `id`.
- `url`: la foto entera (hasta 1200 px de ancho), en el formato y la calidad que mejor le vengan al dispositivo.
- `miniatura`: 400 px de ancho. Usala en listas, grillas y tarjetas.

### Producto en la lista del catálogo (`GET /api/catalogo`)

No trae el array de fotos, solo la portada y cuántas hay:

```json
{
  "_id": "6710a1f0c2d4e5f6a7b8c9d0",
  "nombre": "Pan francés",
  "precio": 1500,
  "descripcion": "Crocante",
  "ingredientes": ["harina", "agua", "sal"],
  "pesoGramos": 500,
  "categoria": "Salado",
  "disponible": true,
  "createdAt": "2026-10-15T14:00:00.000Z",
  "updatedAt": "2026-10-15T14:05:00.000Z",
  "portada": "https://res.cloudinary.com/<cloud>/image/upload/w_400,c_limit,q_auto,f_auto/v1/panaderia/productos/abc.jpg",
  "cantidadImagenes": 3
}
```

`portada` es `null` si el producto no tiene fotos. `descripcion` y `pesoGramos` pueden no venir; `categoria` viene siempre.

### Producto completo (`GET /api/catalogo/:id` y todas las rutas privadas de productos)

Los mismos campos, **sin** `portada` ni `cantidadImagenes`, y **con** todas las fotos en orden:

```json
{
  "_id": "6710a1f0c2d4e5f6a7b8c9d0",
  "nombre": "Pan francés",
  "precio": 1500,
  "ingredientes": ["harina", "agua", "sal"],
  "disponible": true,
  "createdAt": "2026-10-15T14:00:00.000Z",
  "updatedAt": "2026-10-15T14:05:00.000Z",
  "imagenes": [
    { "id": "6710b2…", "url": "https://…/upload/q_auto,f_auto/…", "miniatura": "https://…/upload/w_400,c_limit,q_auto,f_auto/…" }
  ]
}
```

### Promo (`GET /api/promos` y la respuesta de `POST /api/promos`)

```json
{
  "_id": "6710c3…",
  "titulo": "2x1 en medialunas",
  "texto": "Solo hoy",
  "imagenUrl": "https://res.cloudinary.com/<cloud>/image/upload/q_auto,f_auto/v1/panaderia/promos/p.jpg",
  "miniatura": "https://res.cloudinary.com/<cloud>/image/upload/w_400,c_limit,q_auto,f_auto/v1/panaderia/promos/p.jpg",
  "createdAt": "2026-10-15T14:00:00.000Z",
  "updatedAt": "2026-10-15T14:00:00.000Z"
}
```

Una promo tiene **una sola** foto. `texto` puede no venir.

## Schemas de Zod (respuestas)

En `features/productos/schemas.ts` (y el de promo en su feature). Los tipos se infieren de acá.

```ts
import { z } from 'zod';

export const imagenSchema = z.object({
  id: z.string(),
  url: z.url(),
  miniatura: z.url(),
});

const productoBaseSchema = z.object({
  _id: z.string(),
  nombre: z.string(),
  precio: z.number().positive(),
  descripcion: z.string().optional(),
  ingredientes: z.array(z.string()),
  pesoGramos: z.number().positive().optional(),
  categoria: z.string(),
  disponible: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

/** GET /api/catalogo */
export const productoListaSchema = productoBaseSchema.extend({
  portada: z.url().nullable(),
  cantidadImagenes: z.number().int().min(0),
});
export const productosListaSchema = z.array(productoListaSchema);

/** GET /api/catalogo/:id y todas las rutas privadas de productos */
export const productoSchema = productoBaseSchema.extend({
  imagenes: z.array(imagenSchema).max(10),
});
export const productosSchema = z.array(productoSchema);

/** GET /api/promos y POST /api/promos */
export const promoSchema = z.object({
  _id: z.string(),
  titulo: z.string(),
  texto: z.string().optional(),
  imagenUrl: z.url(),
  miniatura: z.url(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export const promosSchema = z.array(promoSchema);
```

Las respuestas también traen `__v` (interno de Mongo). `z.object` lo descarta solo: no lo agregues al schema.

## Endpoints

### Públicos (web del cliente)

| Método | Ruta | Responde |
|---|---|---|
| GET | `/api/catalogo` (`?buscar=`, `?categoria=`, `?pagina=`, `?limite=`) | `200` una página de productos **activos** (`{ productos, pagina, limite, totalProductos, totalPaginas }`; cada uno con `portada` + `cantidadImagenes`) |
| GET | `/api/catalogo/:id` | `200` producto completo, o `404` si no existe o no está disponible |
| GET | `/api/promos` | `200` lista de promos, de la más nueva a la más vieja |

### Privados (app del dueño, con `Authorization: Bearer <token>`)

| Método | Ruta | Body | Responde |
|---|---|---|---|
| GET | `/api/productos` | — | `200` todos los productos (también los no disponibles), completos |
| POST | `/api/productos` | **JSON** con los datos (recomendado), o multipart con datos + hasta 10 fotos en `imagenes` | `201` producto completo |
| GET | `/api/productos/:id` | — | `200` producto completo, aunque no esté disponible |
| PUT | `/api/productos/:id` | JSON con los campos a cambiar (o multipart; las fotos en `imagenes` **se suman**) | `200` producto completo |
| PUT | `/api/productos/:id/portada` | JSON `{ "imagenId": "..." }` | `200` producto completo, con esa foto primera |
| DELETE | `/api/productos/:id` | — | `204` (también borra sus fotos) |
| POST | `/api/productos/:id/imagenes` | multipart con **una** foto en el campo `imagen` | `201` la foto: `{ id, url, miniatura }` |
| DELETE | `/api/productos/:id/imagenes/:imagenId` | — | `204` |
| POST | `/api/promos` | multipart: `titulo` (obligatorio), `texto`, `imagen` (obligatoria) | `201` la promo |
| DELETE | `/api/promos/:id` | — | `204` |

### Campos del producto (para validar el formulario igual que el back)

| Campo | Regla del back |
|---|---|
| `nombre` | Texto no vacío. Obligatorio al crear |
| `precio` | Número **mayor que 0**. Obligatorio al crear |
| `pesoGramos` | Número **mayor que 0**. Opcional |
| `categoria` | Una de la [lista fija](paginado-productos.md#categorías-fijas). Obligatoria al crear |
| `descripcion` | Texto. Opcional |
| `ingredientes` | Array de textos (`["harina", "sal"]`). También acepta `"harina, sal"` |
| `disponible` | `true` / `false`. Por defecto `true` |

- En `PUT` mandá solo lo que cambió. Lo que no viene, no se toca.
- `descripcion` y `pesoGramos` se borran mandándolos vacíos: `null` (JSON) o `""`. La categoría no se puede borrar.
- El CRUD completo del producto (detalle, edición, portada, eliminar) está en [producto.md](producto.md).

### Límites de las fotos

- Solo imágenes (`image/*`), **hasta 10 MB cada una**.
- Hasta **10 por producto**. Si ya tiene 10, la foto nueva responde `400`.
- El back guarda las fotos con un ancho máximo de **1200 px**: mandar algo más grande solo hace más lenta la subida (ver [Achicar la foto antes de subir](#achicar-la-foto-antes-de-subir)).

## Subir fotos en segundo plano

### El flujo

1. El dueño completa el formulario y elige las fotos con `expo-image-picker`.
2. Al guardar, el front **crea el producto con JSON** (`POST /api/productos`, sin fotos). Responde enseguida con el producto (`imagenes: []`) y la app vuelve a la lista.
3. Las fotos van a una **cola en Redux**, que las sube a `POST /api/productos/:id/imagenes`:
   - **Primero la portada, sola.** Cuando termina, el resto **de a 2**. Con 2 a la vez, las fotos quedan en el orden en que terminan de subirse; mandando la portada primero, la portada no cambia.
   - Cada foto que termina responde `{ id, url, miniatura }` y aparece en la lista sin recargar.
4. Mientras tanto, el usuario sigue usando la app. La cola vive en el store global, no en la pantalla, así que salir de la pantalla no la corta.

> ¿Por qué no lo resuelve el back respondiendo "recibido" y subiendo después? Porque lo lento es mandar la foto **desde el celular hasta el servidor**, y eso hay que esperarlo igual. Además, Render gratis se reinicia y se duerme, y perdería sin avisar las fotos que tuviera pendientes. Por eso la cola es del front.

### Qué hacer con cada respuesta de una foto

| Respuesta | Qué pasó | Qué hace la cola |
|---|---|---|
| `201` | Subió bien | Marca la foto como lista y la agrega al producto en la caché |
| `status: null` | Sin conexión o se cortó (timeout) | **Reintenta** (hasta 3 veces, esperando 2 s, 4 s…) |
| `502` | Falló Cloudinary ("No se pudo subir la foto…") | **Reintenta** igual |
| `500` | Falla del servidor | **Reintenta** igual |
| `400` | No es una imagen, pesa más de 10 MB o el producto ya tiene 10 fotos | Error **en esa foto** (mostrá `mensaje`) y sigue con las demás. No se reintenta |
| `404` | El producto ya no existe (por ejemplo, lo borraron) | **Corta** la cola de ese producto |
| `401` | Venció la sesión (el `baseApi` ya la cierra) | **Corta** la cola |

- Si la portada falla del todo, la siguiente que suba pasa a ser la portada.
- El back nunca deja pasar más de 10, aunque lleguen varias a la vez: las que sobran responden `400` sin dejar basura en Cloudinary.

> ⚠️ **Cómo va el archivo en el `FormData`:** con Expo 57, el `fetch` global es `expo/fetch`, que **no acepta** el `{ uri, name, type }` clásico de React Native. Falla antes de mandar nada y el front lo muestra como "No hay conexión con el servidor", aunque el back esté andando. El archivo va como `new File(uri)` de `expo-file-system`, que trae el nombre y el tipo solo.

### Endpoints de RTK Query

`features/productos/api/productosApi.ts`:

```ts
import { File } from 'expo-file-system';
import { baseApi } from '@/services/api';
import { imagenSchema, productoSchema, productosSchema } from '../schemas';
import type { DatosProducto, FotoLocal, Imagen, Producto } from '../types';

export const productosApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    listarProductos: build.query<Producto[], void>({
      query: () => '/productos',
      rawResponseSchema: productosSchema,
    }),

    /** Crea el producto SOLO con los datos; las fotos van después, por la cola */
    crearProducto: build.mutation<Producto, DatosProducto>({
      query: (datos) => ({ url: '/productos', method: 'POST', body: datos }),
      rawResponseSchema: productoSchema,
    }),

    editarProducto: build.mutation<Producto, { id: string; datos: Partial<DatosProducto> }>({
      query: ({ id, datos }) => ({ url: `/productos/${id}`, method: 'PUT', body: datos }),
      rawResponseSchema: productoSchema,
    }),

    borrarProducto: build.mutation<void, string>({
      query: (id) => ({ url: `/productos/${id}`, method: 'DELETE' }),
    }),

    /** Una foto por request. La usa la cola, no la pantalla */
    subirFoto: build.mutation<Imagen, { productoId: string; foto: FotoLocal }>({
      query: ({ productoId, foto }) => {
        const formulario = new FormData();
        // Con Expo 57 el fetch global es expo/fetch: el archivo va como un File de expo-file-system
        // (trae el nombre y el tipo solo). ❌ El { uri, name, type } clásico de React Native NO anda.
        // Sin Content-Type a mano: fetch arma el multipart (con su boundary) solo
        formulario.append('imagen', new File(foto.uri));
        // Más margen que el timeout general (60 s): con mala señal una foto puede tardar
        return { url: `/productos/${productoId}/imagenes`, method: 'POST', body: formulario, timeout: 120_000 };
      },
      rawResponseSchema: imagenSchema,
    }),

    borrarFoto: build.mutation<void, { productoId: string; imagenId: string }>({
      query: ({ productoId, imagenId }) => ({ url: `/productos/${productoId}/imagenes/${imagenId}`, method: 'DELETE' }),
    }),
  }),
});

export const {
  useListarProductosQuery,
  useCrearProductoMutation,
  useEditarProductoMutation,
  useBorrarProductoMutation,
  useBorrarFotoMutation,
} = productosApi;
```

Tipos en `features/productos/types.ts`:

```ts
import type { z } from 'zod';
import type { imagenSchema, productoSchema } from './schemas';

export type Imagen = z.infer<typeof imagenSchema>;
export type Producto = z.infer<typeof productoSchema>;
export type DatosProducto = Pick<Producto, 'nombre' | 'precio' | 'ingredientes' | 'disponible'> &
  Partial<Pick<Producto, 'descripcion' | 'pesoGramos' | 'categoria'>>;

/** Una foto elegida en el celular, ya achicada (JPEG en la caché de la app), todavía sin subir */
export interface FotoLocal {
  /** Id propio del front, para seguirla en la cola */
  idLocal: string;
  uri: string;
}
```

### La cola (slice + thunk)

`features/productos/store/subidaFotosSlice.ts`. Es un esqueleto: adaptalo a la UI.

```ts
import { createAsyncThunk, createSlice, type PayloadAction } from '@reduxjs/toolkit';
import { mensajeDeError, type ApiError } from '@/services/api';
import type { AppDispatch, RootState } from '@/store';
import { productosApi } from '../api/productosApi';
import type { FotoLocal, Imagen } from '../types';

const SUBIDAS_A_LA_VEZ = 2;
const INTENTOS = 3;

type EstadoFoto = 'pendiente' | 'subiendo' | 'lista' | 'error';

interface FotoEnCola extends FotoLocal {
  productoId: string;
  estado: EstadoFoto;
  error?: string;
}

const slice = createSlice({
  name: 'subidaFotos',
  initialState: { fotos: {} as Record<string, FotoEnCola> },
  reducers: {
    encolar(estado, { payload }: PayloadAction<{ productoId: string; fotos: FotoLocal[] }>) {
      for (const foto of payload.fotos) {
        estado.fotos[foto.idLocal] = { ...foto, productoId: payload.productoId, estado: 'pendiente' };
      }
    },
    cambiarEstado(estado, { payload }: PayloadAction<{ idLocal: string; estado: EstadoFoto; error?: string }>) {
      const foto = estado.fotos[payload.idLocal];
      if (foto) Object.assign(foto, { estado: payload.estado, error: payload.error });
    },
    // Las listas se sacan de la cola: la foto ya está en la caché del producto
    quitar(estado, { payload }: PayloadAction<string>) {
      delete estado.fotos[payload];
    },
  },
});

export const { encolar, cambiarEstado, quitar } = slice.actions;
export const subidaFotosReducer = slice.reducer;

const esperar = (ms: number) => new Promise((resolver) => setTimeout(resolver, ms));

// Tipado con el store de la app: sin esto, `dispatch` no acepta los thunks de RTK Query.
// Es un import de tipos, así que no arma una dependencia circular con src/store
const crearThunk = createAsyncThunk.withTypes<{ state: RootState; dispatch: AppDispatch }>();

/** Sube las fotos de un producto: la portada sola y después el resto de a 2 */
export const subirFotos = crearThunk(
  'subidaFotos/subir',
  async ({ productoId, fotos }: { productoId: string; fotos: FotoLocal[] }, { dispatch }) => {
    dispatch(encolar({ productoId, fotos }));
    let cortar = false;

    async function subirUna(foto: FotoLocal) {
      for (let intento = 1; intento <= INTENTOS && !cortar; intento++) {
        dispatch(cambiarEstado({ idLocal: foto.idLocal, estado: 'subiendo' }));
        try {
          const imagen: Imagen = await dispatch(productosApi.endpoints.subirFoto.initiate({ productoId, foto })).unwrap();
          // Aparece en la lista sin recargar
          dispatch(
            productosApi.util.updateQueryData('listarProductos', undefined, (productos) => {
              productos.find((p) => p._id === productoId)?.imagenes.push(imagen);
            })
          );
          dispatch(quitar(foto.idLocal));
          return;
        } catch (e) {
          const { status } = e as ApiError;
          // El producto ya no existe o venció la sesión: no tiene sentido seguir
          if (status === 404 || status === 401) cortar = true;
          const reintentable = status === null || status >= 500;
          if (cortar || !reintentable || intento === INTENTOS) {
            dispatch(cambiarEstado({ idLocal: foto.idLocal, estado: 'error', error: mensajeDeError(e) }));
            return;
          }
          await esperar(intento * 2000);
        }
      }
    }

    const [portada, ...resto] = fotos;
    if (!portada) return;
    await subirUna(portada);

    let siguiente = 0;
    const trabajador = async () => {
      while (!cortar && siguiente < resto.length) await subirUna(resto[siguiente++]);
    };
    await Promise.all(Array.from({ length: Math.min(SUBIDAS_A_LA_VEZ, resto.length) }, trabajador));
  }
);
```

Registrá `subidaFotos: subidaFotosReducer` en `src/store/index.ts`.

Uso desde la pantalla de alta:

```ts
const producto = await crearProducto(datos).unwrap(); // rápido: solo datos
dispatch(subirFotos({ productoId: producto._id, fotos: fotosElegidas })); // sin await: corre en segundo plano
router.back(); // el usuario sigue
```

### Mostrarlo en la UI

- Mientras una foto está en la cola, mostrala con su `uri` local (`expo-image` acepta `file://`) y un indicador encima: *subiendo* o *error* con un botón "Reintentar".
- Cuando termina, la foto sale de la cola y aparece en el producto con su `miniatura` del servidor.
- Para saber qué falta de un producto: las `fotos` de la cola con ese `productoId`.
- La cola **no se guarda**: si se cierra la app, lo que estaba pendiente se pierde (lo ya subido queda). Si hace falta que sobreviva, hay que persistirla con el listener `persistir(...)` de `src/store/` y copiar las fotos fuera de la caché del picker (`expo-file-system`), porque esas URIs pueden borrarse.

## Achicar la foto antes de subir

El back guarda las fotos con **1200 px** de ancho como máximo. Una foto de celular tiene 3000–4000 px y pesa entre 3 y 6 MB, y subirla así tarda mucho más para el mismo resultado.

- Antes de encolarla, redimensionala a unos **1600 px de ancho** y comprimila (JPEG, calidad ~0.8) con `expo-image-manipulator`. Queda en unos 300–600 KB.
- Hay que instalarlo con `npx expo install expo-image-manipulator`, igual que `expo-image-picker`. Las dos tienen código nativo, así que hace falta un development build nuevo.
- La API de estas librerías cambia entre versiones de Expo: seguí la doc del **SDK 57** (https://docs.expo.dev/versions/v57.0.0/sdk/imagemanipulator/ y …/sdk/imagepicker/), no ejemplos viejos.

## Borrar

- **Una foto:** `DELETE /api/productos/:id/imagenes/:imagenId` con el `id` de la foto → `204`. Sale del producto y de Cloudinary. Si era la portada, la siguiente pasa a ser la portada. Después, sacala de la caché (`updateQueryData`) o refrescá la lista.
- La URL de una foto borrada deja de funcionar en **unos minutos** (lo que tarda Cloudinary en sacarla de su CDN). `expo-image` puede seguir mostrándola desde su propia caché: si importa, limpiá esa entrada al borrar.
- **El producto:** `DELETE /api/productos/:id` → `204`. Se borran todas sus fotos. Si había fotos en la cola, van a responder `404` y la cola se corta sola.

## Promos

- Se crean con **un solo** request multipart: `titulo`, `texto` (opcional) e `imagen` (obligatoria). Es una sola foto, así que no hace falta cola.
- El endpoint se arma igual que `subirFoto` (`FormData` con `new File(uri)` de `expo-file-system` en `imagen`) y se valida con `promoSchema`.
- La marca de agua de las promos va siempre en la esquina inferior derecha, más chica y más transparente que la de los productos. Eso lo decide el back.

## Errores

Todos llegan como `{ "error": "mensaje" }`. El `baseApi` los convierte en `ApiError { status, mensaje }`: mostrá `mensaje`.

| Código | Mensaje | Cuándo |
|---|---|---|
| `400` | El nombre es obligatorio | Crear sin nombre, o `PUT` con nombre vacío |
| `400` | El precio tiene que ser un número mayor que 0 | Precio que falta, `0`, negativo o no numérico |
| `400` | El peso tiene que ser un número mayor que 0 | `pesoGramos` en `0`, negativo o no numérico |
| `400` | Solo se permiten imágenes | El archivo no es `image/*` |
| `400` | Cada imagen puede pesar hasta 10 MB | Archivo de más de 10 MB |
| `400` | Sobran imágenes o vienen en un campo que no corresponde (…) | Más de 1 archivo en `imagen`, más de 10 en `imagenes`, o un campo con otro nombre |
| `400` | Falta la foto (campo "imagen") | `POST …/imagenes` sin archivo |
| `400` | Un producto puede tener hasta 10 fotos | El producto ya tiene 10 (en `PUT` agrega "y este ya tiene N") |
| `400` | titulo e imagen son obligatorios | Promo sin título o sin foto |
| `401` | No autorizado / Token inválido o vencido | Sin token o vencido (el `baseApi` cierra la sesión) |
| `404` | No encontrado | El producto, la foto o la promo no existe (o el id no es válido) |
| `502` | No se pudo subir la foto. Probá de nuevo en unos minutos. | Cloudinary rechazó la foto. Si pasa con **todas**, falta subir el logo en el back |
| `500` | Algo falló en el servidor. Probá de nuevo en unos minutos. | Falla inesperada del back |

## La marca de agua (lo que el front tiene que saber)

- El back la **graba** al subir: la foto que queda guardada ya la tiene, y Cloudinary no conserva la original. `url` y `miniatura` la tienen.
- El front no hace nada: no hay parámetro ni opción para sacarla o moverla.
- Si cambian el logo en el back, las fotos que ya estaban **no cambian**. Solo las nuevas salen con el logo nuevo.

## Checklist para el front

- [ ] Schemas de Zod de [arriba](#schemas-de-zod-respuestas) en `features/productos/schemas.ts` (y `promoSchema` en la feature de promos).
- [ ] `productosApi.ts` con `injectEndpoints`: listar, crear (JSON), editar, borrar, `subirFoto` y `borrarFoto`.
- [ ] `npx expo install expo-image-picker expo-image-manipulator` y un development build nuevo.
- [ ] Achicar cada foto a ~1600 px antes de encolarla.
- [ ] Slice `subidaFotos` + thunk `subirFotos`, registrado en `src/store/index.ts`.
- [ ] Alta de producto: crear con JSON → `dispatch(subirFotos(...))` sin esperar → volver a la lista.
- [ ] UI de fotos pendientes (uri local + subiendo / error / reintentar).
- [ ] Listas con `miniatura` (o `portada` en el catálogo público), detalle con `url`, siempre con `expo-image`.
- [ ] Borrar foto por su `id` y sacarla de la caché.
- [ ] `npx expo lint` y `npx tsc --noEmit`.
