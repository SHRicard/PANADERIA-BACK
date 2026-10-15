# producto: CRUD de productos (app del dueño)

Todo lo que necesita el front (`PANADERIA-FRONT`) para **listar, ver el detalle, crear, editar y eliminar** productos desde la app del dueño, incluidas las fotos de la edición: agregar, borrar y cambiar la portada.

- Todas estas rutas son **privadas**: van con `Authorization: Bearer <token>` (ver [auth.md](auth.md)). Sin token responden `401`.
- Cómo se suben las fotos en segundo plano, cómo llegan las URLs y la marca de agua está en [up-cloudinary.md](up-cloudinary.md).
- Los ejemplos siguen el código que tenía el front: RTK Query (`injectEndpoints`), Zod 4 (`rawResponseSchema`), la caché de `listarProductos` como fuente del detalle y la edición, y la cola `subidaFotosSlice`.

> ⚠️ **Lo actualiza [paginado-productos.md](paginado-productos.md).** Desde ahí:
> - la lista viene **paginada y con filtros**;
> - la `categoria` es **obligatoria** y sale de una **lista fija**;
> - `disponible: false` se muestra como **Pausado**;
> - el detalle y la edición usan **`obtenerProducto`**, en vez de buscar el producto en la lista.
>
> Donde este documento diga otra cosa, vale lo de ese.

## Resumen

| Qué | Endpoint | Responde | En el front |
|---|---|---|---|
| Listar | `GET /api/productos` | `200` una página, con filtros (también los pausados) | `listarProductos`, infinite query: ver [paginado-productos.md](paginado-productos.md) |
| Ver detalle | `GET /api/productos/:id` | `200` el producto, aunque esté pausado | `obtenerProducto`: ver [paginado-productos.md](paginado-productos.md) |
| Crear | `POST /api/productos` (JSON) + fotos por la cola | `201` el producto | `crearProducto` + `subirFotos` ✅ |
| Editar datos | `PUT /api/productos/:id` (JSON, solo lo que cambió) | `200` el producto | `editarProducto` ✅ |
| Agregar fotos | `POST /api/productos/:id/imagenes` (una por request, por la cola) | `201` la foto | `subirFotos` ✅ |
| Borrar una foto | `DELETE /api/productos/:id/imagenes/:imagenId` | `204` | `borrarFoto` ✅ |
| **Cambiar la portada** | `PUT /api/productos/:id/portada` con `{ imagenId }` | `200` el producto | `cambiarPortada` ✅ |
| Eliminar | `DELETE /api/productos/:id` | `204` (borra también **todas** sus fotos) | `borrarProducto` ✅ |

Lo que este documento pedía sumar al front ya está: `cambiarPortada`, poder borrar el peso y la cola sin fotos repetidas. Lo que falta ahora está en [paginado-productos.md](paginado-productos.md).

## El producto en las respuestas

Todas las rutas de esta página devuelven el producto **completo**, con las fotos en orden (la primera es la portada):

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
  "imagenes": [
    { "id": "6710b2…", "url": "https://res.cloudinary.com/<cloud>/image/upload/q_auto,f_auto/…", "miniatura": "https://res.cloudinary.com/<cloud>/image/upload/w_400,c_limit,q_auto,f_auto/…" }
  ]
}
```

- `descripcion` y `pesoGramos` **no vienen** si el producto no los tiene: no llegan como `null` ni como `""`. `categoria` viene siempre.
- El producto usa `_id` y cada foto usa `id`.
- Se valida con el `productoSchema` que ya tiene el front. No hay que cambiarlo.

## Ver el detalle — `GET /api/productos/:id`

| Caso | Código | Body |
|---|---|---|
| Existe | `200` | El producto completo |
| No existe, ya se eliminó o el id no es válido | `404` | `{ "error": "No encontrado" }` |

- Muestra el producto **aunque esté pausado**. El detalle público (`/api/catalogo/:id`) no lo muestra: en la app del dueño no lo uses.
- Con la lista paginada, el producto puede no estar cargado: el detalle y la edición lo leen de acá con `obtenerProducto`. Al abrirlo desde la lista no hace otro pedido. Está en [paginado-productos.md](paginado-productos.md).

## Editar los datos — `PUT /api/productos/:id`

Mandá **solo lo que cambió**, en JSON (lo que arma `cambiosDe`). Lo que no viene, no se toca.

```http
PUT /api/productos/6710a1f0c2d4e5f6a7b8c9d0
Content-Type: application/json

{ "precio": 1800, "disponible": false, "pesoGramos": null }
```

| Campo | Para cambiarlo | Para borrarlo |
|---|---|---|
| `nombre` | Texto no vacío | ❌ No se puede (`400` "El nombre es obligatorio") |
| `precio` | Número **mayor que 0** | ❌ No se puede (`400` "El precio tiene que ser un número mayor que 0") |
| `descripcion` | Texto | `null` o `""` |
| `categoria` | Una de la [lista fija](paginado-productos.md#categorías-fijas) | ❌ No se puede (`400` "La categoría es obligatoria") |
| `pesoGramos` | Número **mayor que 0** | `null` o `""` (**nuevo**: antes no se podía) |
| `ingredientes` | Array de textos | `[]` |
| `disponible` | `true` / `false` | — |

- Responde `200` con el producto completo. El `onQueryStarted` de `editarProducto` ya lo reemplaza en la caché y conserva las fotos que tenga la caché: no hace falta cambiarlo.
- Un texto con solo espacios cuenta como vacío.
- Una descripción vacía también se puede mandar como `""`.
- **Pausar en vez de eliminar:** si el dueño solo quiere que no aparezca en la web por un tiempo (por ejemplo, el pan dulce fuera de temporada), que lo **pause** (`disponible: false`). Conserva datos y fotos. Eliminar no tiene vuelta atrás.

## Fotos en la edición

El producto tiene **hasta 10 fotos**.

- **Agregar:** con la cola, igual que en el alta (`subirFotos`). Las nuevas van **al final**, así que no cambian la portada. Si una nueva tiene que ser la portada, cuando termine de subir usá *Cambiar la portada*. El selector deja elegir como máximo `10 - producto.imagenes.length - fotos de ese producto en la cola`. Si igual se pasa, esas fotos responden `400` "Un producto puede tener hasta 10 fotos".
- **Borrar una:** `DELETE /api/productos/:id/imagenes/:imagenId` → `204`. Se borra de la base y de Cloudinary. Si era la portada, pasa a serlo la siguiente. `borrarFoto` ya la saca de la caché.
- **Cambiar la portada:** `PUT /api/productos/:id/portada` con `{ "imagenId": "<id de la foto>" }` → `200` con el producto: la foto elegida queda primera y el resto en el mismo orden. Se puede usar **mientras la cola sube otras fotos**, porque el back lo hace en una sola operación y no pisa ninguna.

| Respuesta de *cambiar portada* | Cuándo |
|---|---|
| `200` producto completo | Listo (también si ya era la portada) |
| `400` "Falta la foto que va de portada (imagenId)" | No vino `imagenId` |
| `404` "No encontrado" | El producto o esa foto no existen (o ya se borraron) |

## Eliminar — `DELETE /api/productos/:id`

| Caso | Código | Body |
|---|---|---|
| Eliminado | `204` | (vacío) |
| No existe o ya se eliminó | `404` | `{ "error": "No encontrado" }` |

- **Borra también todas sus fotos de Cloudinary.** No hay que borrarlas una por una.
- **No tiene vuelta atrás:** pedí confirmación ("¿Eliminar Pan francés? Se borran también sus fotos. No se puede deshacer.").
- Los **pedidos ya hechos no se rompen**: guardan una copia del nombre y el precio del momento.
- Si la cola estaba subiendo fotos de ese producto, esas subidas responden `404` y la cola corta ese producto sola (`cortarProducto`). Las que queden con error se descartan con `quitarFoto`.

## Errores

Todos llegan como `{ "error": "mensaje" }` y el `baseApi` los convierte en `ApiError { status, mensaje }`: mostrá `mensaje` (`mensajeDeError`).

| Código | Mensaje | Cuándo |
|---|---|---|
| `400` | El nombre es obligatorio | `nombre` vacío o `null` |
| `400` | El precio tiene que ser un número mayor que 0 | `precio` vacío, `0`, negativo o no numérico |
| `400` | El peso tiene que ser un número mayor que 0 | `pesoGramos` en `0`, negativo o no numérico (para borrarlo: `null`) |
| `409` | Ya existe un producto con ese nombre: «TARTA DE FRUTILLA». | Crear, o renombrar, con un nombre que ya tiene otro producto, sin importar mayúsculas, acentos ni espacios de más. Si el otro está pausado, suma "Está pausado: activalo en vez de crear otro." Ver [nombre-unico.md](nombre-unico.md) |
| `400` | La categoría es obligatoria | Crear sin `categoria`, o mandarla en `null` o `""` |
| `400` | La categoría tiene que ser una de: Dulce, Salado, Agridulce, Ácido, Amargo, Picante | Un gusto que no es de la lista fija |
| `400` | Falta la foto que va de portada (imagenId) | `PUT …/portada` sin `imagenId` |
| `400` | Un producto puede tener hasta 10 fotos | Agregar una foto a un producto que ya tiene 10 |
| `401` | No autorizado / Token inválido o vencido | Sin sesión o vencida (el `baseApi` la cierra solo) |
| `404` | No encontrado | El producto o la foto no existen, o el id no es válido |
| `502` | No se pudo subir la foto. Probá de nuevo en unos minutos. | Falló Cloudinary al subir una foto |
| `500` | Algo falló en el servidor. Probá de nuevo en unos minutos. | Falla inesperada del back |

## Lo que hay que sumar en el front

> ✅ Ya está en el front. Con el paginado, los `updateQueryData('listarProductos', undefined, …)` de esta sección pasan a ser `cambiarProductoEnCache` (ver [paginado-productos.md](paginado-productos.md)).

### 1. `cambiarPortada` en `productosApi.ts`

Igual que `editarProducto`, reemplaza el producto en la caché de la lista cuando el back responde. El orden de las fotos lo manda el back. Si la cola sumó una foto que el back todavía no tenía cuando respondió, esa foto se mantiene al final.

```ts
    /** Pasa esa foto al primer lugar. Se puede usar mientras la cola sube otras fotos */
    cambiarPortada: build.mutation<Producto, { productoId: string; imagenId: string }>({
      query: ({ productoId, imagenId }) => ({ url: `/productos/${productoId}/portada`, method: 'PUT', body: { imagenId } }),
      rawResponseSchema: productoSchema,
      async onQueryStarted({ productoId }, { dispatch, queryFulfilled }) {
        let actualizado: Producto;
        try {
          ({ data: actualizado } = await queryFulfilled);
        } catch {
          return; // El error lo muestra la pantalla, que espera la mutación
        }
        dispatch(
          productosApi.util.updateQueryData('listarProductos', undefined, (productos) => {
            const producto = productos.find(({ _id }) => _id === productoId);
            if (!producto) return;
            const delBack = new Set(actualizado.imagenes.map(({ id }) => id));
            producto.imagenes = [...actualizado.imagenes, ...producto.imagenes.filter(({ id }) => !delBack.has(id))];
          })
        );
      },
    }),
```

Y sumá `useCambiarPortadaMutation` a los hooks que exporta el archivo.

### 2. Poder borrar el peso

En `types.ts`, el tipo de lo que viaja en el `PUT`: todo opcional, y los opcionales pueden ir en `null` para borrarlos.

```ts
/** Lo que viaja a PUT /api/productos/:id: solo lo que cambió. Un opcional en null se borra */
export type CambiosProducto = Partial<Pick<DatosProducto, 'nombre' | 'precio' | 'ingredientes' | 'disponible'>> & {
  descripcion?: string | null;
  categoria?: string | null;
  pesoGramos?: number | null;
};
```

En `productosApi.ts`, `editarProducto` pasa a recibir ese tipo:

```ts
    editarProducto: build.mutation<Producto, { id: string; datos: CambiosProducto }>({
```

En `formulario.ts`, `cambiosDe` devuelve `CambiosProducto` y manda `null` cuando un opcional quedó vacío, también el peso. El formulario ya no tiene que impedir que se borre el peso.

```ts
export function cambiosDe(original: Producto, valores: ProductoFormulario): CambiosProducto {
  const nuevos = aDatosProducto(valores);
  const cambios: CambiosProducto = {};

  if (nuevos.nombre !== original.nombre) cambios.nombre = nuevos.nombre;
  if (nuevos.precio !== original.precio) cambios.precio = nuevos.precio;
  if (nuevos.disponible !== original.disponible) cambios.disponible = nuevos.disponible;
  if (nuevos.ingredientes.join('\n') !== original.ingredientes.join('\n')) cambios.ingredientes = nuevos.ingredientes;
  // Un opcional que quedó vacío viaja como null: el back lo borra del producto
  if (nuevos.descripcion !== original.descripcion) cambios.descripcion = nuevos.descripcion ?? null;
  if (nuevos.categoria !== original.categoria) cambios.categoria = nuevos.categoria ?? null;
  if (nuevos.pesoGramos !== original.pesoGramos) cambios.pesoGramos = nuevos.pesoGramos ?? null;

  return cambios;
}
```

Si `cambiosDe` devuelve `{}`, no hay nada que guardar: no hace falta mandar el `PUT`.

### 3. La cola: no repetir una foto en la caché

Si el dueño cambia la portada mientras una foto termina de subir, la respuesta de la portada ya puede traer esa foto. En `subirUna` (`store/subidaFotosSlice.ts`), agregala a la caché **solo si no está**:

```ts
      dispatch(
        productosApi.util.updateQueryData('listarProductos', undefined, (productos) => {
          const producto = productos.find(({ _id }) => _id === productoId);
          // Puede estar ya: la respuesta de un cambio de portada la pudo haber traído
          if (producto && !producto.imagenes.some(({ id }) => id === imagen.id)) producto.imagenes.push(imagen);
        })
      );
```

### 4. (Opcional) `obtenerProducto`

> Con el paginado ya no es opcional. La versión que vale es la de [paginado-productos.md](paginado-productos.md), con tags por id: así eliminar no recarga el detalle.

Solo si hace falta abrir un producto sin tener la lista cargada:

```ts
    /** Un producto aunque no esté disponible. Para abrirlo sin tener la lista cargada */
    obtenerProducto: build.query<Producto, string>({
      query: (id) => `/productos/${id}`,
      rawResponseSchema: productoSchema,
      providesTags: ['Producto'],
    }),
```

Ojo: `borrarProducto` invalida `'Producto'`. Si una pantalla sigue mirando con `obtenerProducto` el producto recién eliminado, lo vuelve a pedir y da `404`. Volvé a la lista antes de que termine de eliminar, o no uses este endpoint en el detalle.

## Pantallas

### Detalle (`productos/[id]`)

1. El producto sale de `useProductoGuardado` (`obtenerProducto`, ver [paginado-productos.md](paginado-productos.md)): datos, fotos con `miniatura` (y `url` al tocarla) y si está activo o pausado.
2. Sumá las fotos de la cola de ese producto (`subidaFotos.fotos` con ese `productoId`), con su `uri` local y su estado: *subiendo*, o *error* con "Reintentar".
3. Botones: **Editar** (va a `productos/[id]/editar`) y **Eliminar** (con confirmación).
4. Si el back responde `404` (se eliminó), mostrá un aviso y volvé.

### Edición (`productos/[id]/editar`)

1. Cargá el formulario con `aFormulario(producto)`.
2. Al guardar: `const cambios = cambiosDe(producto, valores)`. Si hay algo, `editarProducto({ id, datos: cambios })`. Las fotos nuevas van con `dispatch(subirFotos({ productoId: id, fotos }))`, **sin esperar**. Después, volvé.
3. Cada foto que ya tiene lleva dos botones, que se aplican en el momento sin esperar a "Guardar": **borrar** (`borrarFoto`) y **hacer portada** (`cambiarPortada`).
4. El selector de fotos nuevas permite como máximo `10 - producto.imagenes.length - pendientes en la cola`.

### Eliminar

1. Confirmación con el nombre: "¿Eliminar *Pan francés*? Se borran también sus fotos. No se puede deshacer."
2. `await borrarProducto(id).unwrap()` y volvé a la lista.
3. Si falla, mostrá `mensajeDeError(e)` y quedate en la pantalla.

## Probarlo a mano

```bash
TOKEN=...   # el que devuelve POST /api/auth/login
ID=...      # el _id de un producto

# Detalle (aunque no esté disponible)
curl http://localhost:3000/api/productos/$ID -H "Authorization: Bearer $TOKEN"

# Editar: cambia el precio y borra el peso
curl -X PUT http://localhost:3000/api/productos/$ID -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{"precio":1800,"pesoGramos":null}'

# Cambiar la portada
curl -X PUT http://localhost:3000/api/productos/$ID/portada -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{"imagenId":"ID_DE_LA_FOTO"}'

# Borrar una foto
curl -X DELETE http://localhost:3000/api/productos/$ID/imagenes/ID_DE_LA_FOTO -H "Authorization: Bearer $TOKEN"

# Eliminar el producto (y todas sus fotos)
curl -X DELETE http://localhost:3000/api/productos/$ID -H "Authorization: Bearer $TOKEN"
```

## Checklist para el front

- [ ] `cambiarPortada` en `productosApi.ts` (y su hook exportado).
- [ ] `CambiosProducto` en `types.ts`, `editarProducto` recibiéndolo y `cambiosDe` mandando `null` para borrar, también el peso.
- [ ] La cola no repite una foto que ya esté en la caché.
- [ ] En la edición, botones de borrar foto y hacer portada en cada foto que ya tiene.
- [ ] El formulario de edición deja vaciar el peso.
- [ ] `npx expo lint` y `npx tsc --noEmit`.
