# paginado-productos: lista paginada, filtros, activo/pausado y gustos

Para quien implemente en el front (`PANADERIA-FRONT`) estos cambios de la app del dueño:

- la lista de productos **paginada**, con **búsqueda por nombre** y filtros por **estado** y **categoría**;
- el estado **activo / pausado**;
- el **gusto** del producto (su categoría: Dulce, Salado…), elegido de una lista fija.

También deja lista la API del catálogo público para cuando se arme la web.

> ✅ **Esto ya está aplicado en el front.** Después cambió una cosa: las categorías pasaron a ser **gustos** (Dulce, Salado, Agridulce, Ácido, Amargo, Picante). El contrato de abajo ya está actualizado. Los textos que faltan cambiar en la app ("Gusto", "Todos", "Elegí un gusto") están en [gustos.md](gustos.md). El código de este documento es el que se aplicó.

> ⚠️ **La app actual se rompe hasta aplicar esto.**
> - `GET /api/productos` ya no devuelve un array sino una página (`{ productos, pagina, … }`), así que la lista va a mostrar "El servidor respondió algo inesperado".
> - Crear un producto sin categoría, o con una que no sea de la lista, responde `400`.

Cómo se verificó el código de este documento:

- **Compila contra el front actual.** Corrí `tsc` sobre una copia del front, sin tocar su repo.
- **Los schemas Zod aceptan las respuestas reales del back.** Los probé contra el back en ejecución.
- **La lógica de caché anda en ejecución.** Probé la lista infinita, `upsertQueryData` y `cambiarProductoEnCache` con el RTK 2.13 del front, contra el back.
- **Falta probarlo en el celular.** Esa parte la tiene que hacer el front.

## Qué cambió en el back

| Qué | Antes | Ahora |
|---|---|---|
| `GET /api/productos` | Un array con todos | Una página `{ productos, pagina, limite, totalProductos, totalPaginas }`, con filtros |
| `GET /api/catalogo` | Un array con todos los disponibles | Una página con el mismo formato y los mismos filtros (solo activos) |
| `categoria` | Texto libre, opcional | **Obligatoria**: es el **gusto**, de una **lista fija** |
| Activo / pausado | `disponible` | Igual: `disponible: true` es activo y `false` es pausado. Nuevo filtro `?estado=` |
| `GET /api/catalogo/categorias` | — | **Nuevo:** los gustos, en orden, con cuántos productos activos tiene cada uno |
| Ítems de cada pedido | `{ producto, nombre, precio, cantidad }` | Suman `categoria`: el gusto al momento de la venta (ver [gustos.md](gustos.md)) |

Los 2 productos que había quedaron en "Dulce". No cambiaron el detalle, crear, editar, eliminar ni las fotos.

### Listas paginadas

`GET /api/productos` (privado) y `GET /api/catalogo` (público) aceptan:

| Parámetro | Para qué | Si viene mal |
|---|---|---|
| `pagina` | Desde 1. Por defecto, 1 | Usa el de por defecto |
| `limite` | Productos por página. Por defecto 20, máximo 100 | Usa el de por defecto (o 100) |
| `buscar` | Una parte del nombre. **No distingue mayúsculas ni acentos**: `sandwich` encuentra "Sándwich de miga" y `cañon` o `canon` encuentran "Cañoncito". Hasta 50 caracteres | Vacío: no filtra |
| `categoria` | Un gusto de la lista. Acepta cualquier mayúscula o acento (`acido`) | `400` |
| `estado` | Solo en `/api/productos`: `activo` o `pausado`. El catálogo siempre muestra solo los activos | `400` |

```json
{
  "productos": [ { "_id": "…", "nombre": "Medialuna", "categoria": "Dulce", "disponible": true, "imagenes": [ … ] } ],
  "pagina": 1,
  "limite": 20,
  "totalProductos": 31,
  "totalPaginas": 2
}
```

- **El orden** sigue la lista de gustos (Dulce, Salado, Agridulce…) y, dentro de cada uno, el nombre, sin importar mayúsculas ni acentos. El orden no cambia entre páginas: un producto no se repite ni se saltea al pasar de página.
- Una página que no existe responde `200` con `productos: []`.
- En `/api/productos`, cada producto trae todas sus fotos `{ id, url, miniatura }`, igual que antes. En `/api/catalogo` trae `portada` (la miniatura, o `null`) y `cantidadImagenes`.

### Categorías fijas

La categoría es el **gusto** del producto. La lista está en el back (`src/models/Producto.ts`) y en este orden:

**Dulce · Salado · Agridulce · Ácido · Amargo · Picante**

- **En la app se muestra como "Gusto".** El campo de la API sigue llamándose `categoria`.
- **El back normaliza:** acepta cualquier mayúscula o acento y guarda la forma de la lista (`acido` se guarda como "Ácido"). Cualquier otro valor, como "Dulse" o "Facturas", responde `400`.
- **No la copies en el front: pedila.** `GET /api/catalogo/categorias` es público y responde así:

  ```json
  [ { "nombre": "Dulce", "cantidad": 8 }, { "nombre": "Salado", "cantidad": 7 }, …, { "nombre": "Picante", "cantidad": 0 } ]
  ```

  - Trae siempre los 6, en orden.
  - `cantidad` es la cantidad de productos **activos**: el formulario y los filtros del dueño usan todos, y la web pública puede esconder los que tienen `cantidad: 0`.
- **En los schemas de las respuestas, `categoria` es `z.string()` y no un enum.** Por eso el cambio a gustos no rompió la app.

### Activo / pausado

Un producto **pausado** (`disponible: false`):

- no sale en el catálogo público: su detalle responde `404`;
- no se puede pedir: el back rechaza el pedido;
- **conserva sus datos y sus fotos**.

Es para los productos de temporada. Por ejemplo, el pan dulce: se pausa en enero y se activa en diciembre. Para cambiarlo alcanza con `PUT /api/productos/:id` y `{ "disponible": false }` o `true`.

No hay un campo `estado` en el producto: `?estado=activo|pausado` es solo el filtro de la lista. En la app, el campo se muestra como **Activo / Pausado** en vez de "Disponible / No disponible".

### Errores nuevos

| Código | Mensaje | Cuándo |
|---|---|---|
| `400` | La categoría es obligatoria | Crear sin `categoria`, o editar con `categoria` en `null` o `""` |
| `400` | La categoría tiene que ser una de: Dulce, Salado, Agridulce, Ácido, Amargo, Picante | Crear o editar con un gusto que no es de la lista, o `?categoria=` con uno que no es de la lista |
| `400` | estado tiene que ser activo o pausado | `?estado=` con otro valor |

Llegan como siempre, `{ "error": "mensaje" }`, y se muestran con `mensajeDeError`.

## Qué cambia en el front

| Archivo | Cambio |
|---|---|
| `productos/schemas.ts` | `categoria` obligatoria; `paginaProductosSchema` y `categoriasSchema`; en el formulario, "Elegí una categoría" |
| `productos/types.ts` | `PaginaProductos`, `Categoria`, `EstadoProducto`, `FiltrosProductos`; `categoria` obligatoria y sin `null` |
| `productos/formulario.ts` | La categoría siempre viaja |
| `productos/api/productosApi.ts` | `listarProductos` pasa a **infinite query** con filtros. Nuevos: `obtenerProducto`, `listarCategorias` y `cambiarProductoEnCache` |
| `productos/store/subidaFotosSlice.ts` | La foto que sube se suma con `cambiarProductoEnCache` |
| `productos/hooks/useProductos.ts` | Filtros (búsqueda con espera, estado y categoría), páginas y "cargar más" |
| `productos/hooks/useProductoGuardado.ts` | **Nuevo:** el producto para el detalle y la edición |
| `productos/hooks/useCategorias.ts` | **Nuevo:** los nombres de la lista fija |
| `productos/hooks/useProducto.ts` | Usa `useProductoGuardado` y suma **Pausar / Activar** |
| `productos/hooks/useEditarProducto.ts`, `useNuevoProducto.ts` | Usan `useProductoGuardado` y devuelven `categorias` |
| `productos/components/ChipsCategorias.tsx` | **Nuevo:** elegir una categoría con chips (filtro y formulario) |
| `productos/components/CamposProducto.tsx` | Estado **Activo / Pausado** y categoría con chips |
| `productos/components/TarjetaProducto.tsx` | Badge "Pausado" |
| `shared/ui/atoms/ScreenContainer` | Prop `alLlegarAlFinal`, para la página siguiente |
| `productos/screens/*` | Lista con filtros, contador y final de lista; botón Pausar/Activar en el detalle; `categorias` al formulario |

## Por qué está hecho así

- **Infinite query de RTK Query (`build.infiniteQuery`)**: la lista se arma con las páginas que se van cargando y cada combinación de filtros tiene su caché. Volver a "Todos" después de filtrar es instantáneo. Tirar para refrescar vuelve a pedir las páginas que ya estaban cargadas, así no se pierde el lugar.
- **`currentData` y no `data`**: al cambiar de filtro no se ve un momento la lista del filtro anterior. Aparece la rueda y después los resultados.
- **La búsqueda espera 350 ms** a que el dueño deje de escribir: no hace un pedido por letra.
- **El detalle y la edición ya no buscan en la lista**: con páginas, el producto puede no estar cargado. Usan `obtenerProducto`. Al tocar una tarjeta, `upsertQueryData` copia el producto de la lista a esa caché, así el detalle se ve **al instante y sin otro pedido**. Abierto desde un link, lo pide.
- **`cambiarProductoEnCache`** cambia el producto en su detalle y en **todas** las listas cargadas, con cualquier filtro. Lo usan editar, cambiar la portada, borrar una foto y la cola cuando termina de subir una foto. Sigue la regla de antes: editar **no recarga** la lista, para no pisar las fotos que se están subiendo.
- Por eso, **un producto editado queda donde estaba** hasta que se refresque, aunque ya no coincida con el filtro. Un activo que se pausa estando en "Activos" sigue a la vista, con el badge "Pausado", y no desaparece bajo el dedo del dueño.
- **Crear y eliminar sí recargan** las listas (tag `LISTA`): el nuevo aparece en su lugar y el borrado se va. Eliminar **no** recarga el detalle, así no muestra "ya no existe" mientras vuelve.
- **"Ver más productos"** al final es el respaldo del scroll automático: si la primera página no llena la pantalla, no hay scroll que dispare la siguiente.
- **Pausar / Activar desde el detalle**, sin entrar a editar: es lo que el dueño va a hacer cada temporada.

## El código

Los diffs son contra el front actual (`a/` es el actual y `b/` cómo queda). Los archivos nuevos o casi reescritos van completos.

### 1. Schemas y tipos

```diff
--- a/src/features/productos/schemas.ts
+++ b/src/features/productos/schemas.ts
@@ -16,14 +16,26 @@
   descripcion: z.string().optional(),
   ingredientes: z.array(z.string()),
   pesoGramos: z.number().positive().optional(),
-  categoria: z.string().optional(),
+  // z.string() y no un enum: si el back suma una categoría, la app no se rompe
+  categoria: z.string(),
+  /** false = pausado: no sale en el catálogo ni se puede pedir */
   disponible: z.boolean(),
   createdAt: z.string(),
   updatedAt: z.string(),
   imagenes: z.array(imagenSchema).max(10),
 });
 
-export const productosSchema = z.array(productoSchema);
+/** GET /api/productos: una página de la lista */
+export const paginaProductosSchema = z.object({
+  productos: z.array(productoSchema),
+  pagina: z.number().int(),
+  limite: z.number().int(),
+  totalProductos: z.number().int(),
+  totalPaginas: z.number().int(),
+});
+
+/** GET /api/catalogo/categorias: la lista fija del back, en orden, con cuántos productos activos tiene cada una */
+export const categoriasSchema = z.array(z.object({ nombre: z.string(), cantidad: z.number().int() }));
 
 // ── Formulario ────────────────────────────────────────────────────────────────
 
@@ -43,13 +55,13 @@
     .regex(entero, 'Solo números, sin puntos ni comas')
     .refine((valor) => Number(valor) > 0, 'El precio tiene que ser mayor que 0'),
   descripcion: z.string().trim(),
-  categoria: z.string().trim(),
+  categoria: z.string().min(1, 'Elegí una categoría'),
   pesoGramos: z
     .string()
     .trim()
     .refine((valor) => valor === '' || entero.test(valor), 'Solo números, sin puntos ni comas')
     .refine((valor) => valor === '' || Number(valor) > 0, 'El peso tiene que ser mayor que 0'),
   ingredientes: z.string().trim(),
-  /** Los no disponibles no aparecen en el catálogo público */
+  /** true = activo; false = pausado (no aparece en el catálogo público) */
   disponible: z.boolean(),
 });
```

```diff
--- a/src/features/productos/types.ts
+++ b/src/features/productos/types.ts
@@ -1,18 +1,38 @@
 import type { z } from 'zod';
-import type { imagenSchema, productoFormSchema, productoSchema } from './schemas';
+import type {
+  categoriasSchema,
+  imagenSchema,
+  paginaProductosSchema,
+  productoFormSchema,
+  productoSchema,
+} from './schemas';
 
 export type Imagen = z.infer<typeof imagenSchema>;
 export type Producto = z.infer<typeof productoSchema>;
+export type PaginaProductos = z.infer<typeof paginaProductosSchema>;
+export type Categoria = z.infer<typeof categoriasSchema>[number];
 export type ProductoFormulario = z.infer<typeof productoFormSchema>;
 
+/** activo = disponible: true; pausado = disponible: false */
+export type EstadoProducto = 'activo' | 'pausado';
+
+/** Los filtros de GET /api/productos. Lo que no viene, no filtra */
+export interface FiltrosProductos {
+  /** Una parte del nombre: el back no distingue mayúsculas ni acentos */
+  buscar?: string;
+  categoria?: string;
+  estado?: EstadoProducto;
+}
+
 /** Lo que viaja a POST /api/productos (JSON, sin fotos: las fotos van después, por la cola) */
-export type DatosProducto = Pick<Producto, 'nombre' | 'precio' | 'ingredientes' | 'disponible'> &
-  Partial<Pick<Producto, 'descripcion' | 'pesoGramos' | 'categoria'>>;
+export type DatosProducto = Pick<Producto, 'nombre' | 'precio' | 'categoria' | 'ingredientes' | 'disponible'> &
+  Partial<Pick<Producto, 'descripcion' | 'pesoGramos'>>;
 
 /** Lo que viaja a PUT /api/productos/:id: solo lo que cambió. Un opcional en null se borra del producto */
-export type CambiosProducto = Partial<Pick<DatosProducto, 'nombre' | 'precio' | 'ingredientes' | 'disponible'>> & {
+export type CambiosProducto = Partial<
+  Pick<DatosProducto, 'nombre' | 'precio' | 'categoria' | 'ingredientes' | 'disponible'>
+> & {
   descripcion?: string | null;
-  categoria?: string | null;
   pesoGramos?: number | null;
 };
```

### 2. Formulario

```diff
--- a/src/features/productos/formulario.ts
+++ b/src/features/productos/formulario.ts
@@ -17,7 +17,7 @@
     nombre: producto.nombre,
     precio: String(producto.precio),
     descripcion: producto.descripcion ?? '',
-    categoria: producto.categoria ?? '',
+    categoria: producto.categoria,
     pesoGramos: producto.pesoGramos ? String(producto.pesoGramos) : '',
     ingredientes: producto.ingredientes.join(', '),
     disponible: producto.disponible,
@@ -29,13 +29,13 @@
   return {
     nombre: valores.nombre,
     precio: Number(valores.precio),
+    categoria: valores.categoria,
     disponible: valores.disponible,
     ingredientes: valores.ingredientes
       .split(',')
       .map((ingrediente) => ingrediente.trim())
       .filter(Boolean),
     ...(valores.descripcion && { descripcion: valores.descripcion }),
-    ...(valores.categoria && { categoria: valores.categoria }),
     ...(valores.pesoGramos && { pesoGramos: Number(valores.pesoGramos) }),
   };
 }
@@ -50,11 +50,11 @@
 
   if (nuevos.nombre !== original.nombre) cambios.nombre = nuevos.nombre;
   if (nuevos.precio !== original.precio) cambios.precio = nuevos.precio;
+  if (nuevos.categoria !== original.categoria) cambios.categoria = nuevos.categoria;
   if (nuevos.disponible !== original.disponible) cambios.disponible = nuevos.disponible;
   if (nuevos.ingredientes.join('\n') !== original.ingredientes.join('\n')) cambios.ingredientes = nuevos.ingredientes;
   // Un opcional que quedó vacío viaja como null: el back lo borra del producto
   if (nuevos.descripcion !== original.descripcion) cambios.descripcion = nuevos.descripcion ?? null;
-  if (nuevos.categoria !== original.categoria) cambios.categoria = nuevos.categoria ?? null;
   if (nuevos.pesoGramos !== original.pesoGramos) cambios.pesoGramos = nuevos.pesoGramos ?? null;
 
   return cambios;
```

### 3. `productosApi.ts` (completo)

`src/features/productos/api/productosApi.ts`

```ts
import { current } from '@reduxjs/toolkit';
import { File } from 'expo-file-system';
import { baseApi } from '@/services/api';
import type { AppDispatch, RootState } from '@/store';
import { categoriasSchema, imagenSchema, paginaProductosSchema, productoSchema } from '../schemas';
import type {
  CambiosProducto,
  Categoria,
  DatosProducto,
  FiltrosProductos,
  FotoLocal,
  Imagen,
  PaginaProductos,
  Producto,
} from '../types';

// Una foto con mala señal tarda más que un pedido común (60 s)
const TIMEOUT_FOTO_MS = 120_000;
/** Productos por página. El back acepta hasta 100 */
const POR_PAGINA = 20;
/** Las listas (con cualquier filtro). Cada detalle tiene su propio tag: { type: 'Producto', id } */
const LISTA = { type: 'Producto', id: 'LISTA' } as const;

export const productosApi = baseApi.enhanceEndpoints({ addTagTypes: ['Producto'] }).injectEndpoints({
  endpoints: (build) => ({
    /**
     * La lista del admin, de a páginas, también los pausados, con sus fotos.
     * Cada combinación de filtros es una caché aparte: volver a un filtro ya visto es instantáneo
     */
    listarProductos: build.infiniteQuery<PaginaProductos, FiltrosProductos, number>({
      infiniteQueryOptions: {
        initialPageParam: 1,
        getNextPageParam: (ultima) => (ultima.pagina < ultima.totalPaginas ? ultima.pagina + 1 : undefined),
      },
      // Los filtros en undefined no viajan
      query: ({ queryArg, pageParam }) => ({
        url: '/productos',
        params: { ...queryArg, pagina: pageParam, limite: POR_PAGINA },
      }),
      rawResponseSchema: paginaProductosSchema,
      providesTags: [LISTA],
    }),

    /** Un producto, aunque esté pausado. Lo usan el detalle y la edición */
    obtenerProducto: build.query<Producto, string>({
      query: (id) => `/productos/${id}`,
      rawResponseSchema: productoSchema,
      providesTags: (_resultado, _error, id) => [{ type: 'Producto', id }],
    }),

    /** Las categorías fijas del back, en orden. Solo cambian con un deploy del back: se piden una vez */
    listarCategorias: build.query<Categoria[], void>({
      query: () => '/catalogo/categorias',
      rawResponseSchema: categoriasSchema,
      keepUnusedDataFor: 60 * 60,
    }),

    /** Crea el producto SOLO con los datos: responde enseguida. Las fotos van después, por la cola */
    crearProducto: build.mutation<Producto, DatosProducto>({
      query: (datos) => ({ url: '/productos', method: 'POST', body: datos }),
      rawResponseSchema: productoSchema,
      // Recarga las listas: el nuevo aparece en su lugar (por categoría y nombre)
      invalidatesTags: [LISTA],
    }),

    /** Manda solo lo que cambió. Lo que no viene, el back no lo toca; un opcional en null lo borra */
    editarProducto: build.mutation<Producto, { id: string; datos: CambiosProducto }>({
      query: ({ id, datos }) => ({ url: `/productos/${id}`, method: 'PUT', body: datos }),
      rawResponseSchema: productoSchema,
      // Se reemplaza en las cachés en vez de recargar: así no pisa las fotos que se están subiendo.
      // Si cambió el estado o la categoría, queda donde estaba en la lista hasta que se refresque: no salta
      async onQueryStarted({ id }, { dispatch, queryFulfilled }) {
        let editado: Producto;
        try {
          ({ data: editado } = await queryFulfilled);
        } catch {
          return; // El error lo muestra la pantalla, que espera la mutación
        }
        // Las fotos se quedan como están en la caché: la cola puede haber sumado alguna mientras tanto
        dispatch(cambiarProductoEnCache(id, (producto) => ({ ...editado, imagenes: producto.imagenes })));
      },
    }),

    /** Pasa esa foto al primer lugar. Se puede usar mientras la cola sube otras: el back no pisa ninguna */
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
        // El orden lo manda el back. Si la cola sumó una foto que el back todavía no tenía, queda al final
        const delBack = new Set(actualizado.imagenes.map(({ id }) => id));
        dispatch(
          cambiarProductoEnCache(productoId, (producto) => ({
            ...producto,
            imagenes: [...actualizado.imagenes, ...producto.imagenes.filter(({ id }) => !delBack.has(id))],
          }))
        );
      },
    }),

    /** Borra el producto y, en el back, también todas sus fotos de Cloudinary */
    borrarProducto: build.mutation<void, string>({
      query: (id) => ({ url: `/productos/${id}`, method: 'DELETE' }),
      // Recarga las listas, pero NO el detalle: así no muestra "ya no existe" en el momento en que vuelve
      invalidatesTags: [LISTA],
    }),

    /** Una foto por request. La usa la cola de subidas, no las pantallas */
    subirFoto: build.mutation<Imagen, { productoId: string; foto: FotoLocal }>({
      query: ({ productoId, foto }) => {
        const formulario = new FormData();
        // Expo reemplaza el fetch de React Native por expo/fetch, que NO acepta el { uri, name, type } clásico:
        // falla antes de mandar nada y se ve como "sin conexión". Hay que pasarle un File de expo-file-system,
        // que trae el nombre y el tipo (image/jpeg) del archivo. Sin Content-Type a mano: fetch arma el multipart solo
        formulario.append('imagen', new File(foto.uri));
        return { url: `/productos/${productoId}/imagenes`, method: 'POST', body: formulario, timeout: TIMEOUT_FOTO_MS };
      },
      rawResponseSchema: imagenSchema,
    }),

    /** Borra una foto (del producto y de Cloudinary). Si era la portada, la siguiente pasa a serlo */
    borrarFoto: build.mutation<void, { productoId: string; imagenId: string }>({
      query: ({ productoId, imagenId }) => ({ url: `/productos/${productoId}/imagenes/${imagenId}`, method: 'DELETE' }),
      async onQueryStarted({ productoId, imagenId }, { dispatch, queryFulfilled }) {
        try {
          await queryFulfilled;
        } catch {
          return;
        }
        dispatch(
          cambiarProductoEnCache(productoId, (producto) => ({
            ...producto,
            imagenes: producto.imagenes.filter((imagen) => imagen.id !== imagenId),
          }))
        );
      },
    }),
  }),
});

/**
 * Cambia un producto en todas las cachés donde esté: su detalle y cada lista cargada, con cualquier filtro.
 * `cambiar` recibe el producto como está y devuelve cómo queda
 */
export function cambiarProductoEnCache(id: string, cambiar: (producto: Producto) => Producto) {
  return (dispatch: AppDispatch, getState: () => RootState) => {
    dispatch(productosApi.util.updateQueryData('obtenerProducto', id, (producto) => cambiar(current(producto))));
    for (const filtros of productosApi.util.selectCachedArgsForQuery(getState(), 'listarProductos')) {
      dispatch(
        productosApi.util.updateQueryData('listarProductos', filtros, ({ pages }) => {
          for (const pagina of pages) {
            const indice = pagina.productos.findIndex(({ _id }) => _id === id);
            if (indice !== -1) pagina.productos[indice] = cambiar(current(pagina.productos[indice]));
          }
        })
      );
    }
  };
}

export const {
  useListarProductosInfiniteQuery,
  useObtenerProductoQuery,
  useListarCategoriasQuery,
  useCrearProductoMutation,
  useEditarProductoMutation,
  useBorrarProductoMutation,
  useBorrarFotoMutation,
  useCambiarPortadaMutation,
} = productosApi;
```

### 4. La cola de fotos

```diff
--- a/src/features/productos/store/subidaFotosSlice.ts
+++ b/src/features/productos/store/subidaFotosSlice.ts
@@ -1,7 +1,7 @@
 import { createAsyncThunk, createSlice, type PayloadAction } from '@reduxjs/toolkit';
 import { mensajeDeError, type ApiError } from '@/services/api';
 import type { AppDispatch, RootState } from '@/store';
-import { productosApi } from '../api/productosApi';
+import { cambiarProductoEnCache, productosApi } from '../api/productosApi';
 import type { FotoLocal } from '../types';
 
 const SUBIDAS_A_LA_VEZ = 2;
@@ -75,11 +75,12 @@
     try {
       const imagen = await pedido.unwrap();
       dispatch(
-        productosApi.util.updateQueryData('listarProductos', undefined, (productos) => {
-          const producto = productos.find(({ _id }) => _id === productoId);
+        cambiarProductoEnCache(productoId, (producto) =>
           // Puede estar ya: la respuesta de un cambio de portada la pudo haber traído
-          if (producto && !producto.imagenes.some(({ id }) => id === imagen.id)) producto.imagenes.push(imagen);
-        })
+          producto.imagenes.some(({ id }) => id === imagen.id)
+            ? producto
+            : { ...producto, imagenes: [...producto.imagenes, imagen] }
+        )
       );
       dispatch(quitarFoto(foto.idLocal));
       return 'lista';
```

### 5. Hooks

`useCategorias.ts` (nuevo):

`src/features/productos/hooks/useCategorias.ts`

```ts
import { useMemo } from 'react';
import { useListarCategoriasQuery } from '../api/productosApi';

/** Los nombres de las categorías fijas del back, en orden. Vacío mientras cargan */
export function useCategorias(): string[] {
  const { data } = useListarCategoriasQuery();
  return useMemo(() => data?.map(({ nombre }) => nombre) ?? [], [data]);
}
```

`useProductoGuardado.ts` (nuevo):

`src/features/productos/hooks/useProductoGuardado.ts`

```ts
import { mensajeDeError } from '@/services/api';
import { useObtenerProductoQuery } from '../api/productosApi';

/**
 * Un producto del back, para el detalle y la edición. Si se abrió desde la lista, ya está en la caché
 * y no hace otro pedido; si se abrió de otra forma (un link), lo trae
 */
export function useProductoGuardado(id: string) {
  const consulta = useObtenerProductoQuery(id);
  const noExiste = consulta.error !== undefined && 'status' in consulta.error && consulta.error.status === 404;

  return {
    producto: noExiste ? undefined : consulta.data,
    cargando: consulta.isLoading,
    // Un 404 no es un error para mostrar: la pantalla dice "ya no existe"
    error: consulta.isError && !noExiste ? mensajeDeError(consulta.error) : null,
    refrescar: () => consulta.refetch(),
  };
}
```

`useProductos.ts` (completo):

`src/features/productos/hooks/useProductos.ts`

```ts
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'expo-router';
import { mensajeDeError } from '@/services/api';
import { useAppDispatch, useAppSelector } from '@/store';
import { productosApi, useListarProductosInfiniteQuery } from '../api/productosApi';
import { quitarFoto, reintentarFoto, type FotoEnCola } from '../store/subidaFotosSlice';
import type { EstadoProducto, Producto } from '../types';
import { useCategorias } from './useCategorias';

// Espera a que el dueño deje de escribir: no un pedido por letra
const ESPERA_BUSQUEDA_MS = 350;

/** La lista de productos del admin: de a páginas, con filtros y con las fotos que todavía se están subiendo */
export function useProductos() {
  const router = useRouter();
  const dispatch = useAppDispatch();
  const categorias = useCategorias();
  const fotosEnCola = useAppSelector((s) => s.subidaFotos.fotos);

  const [texto, setTexto] = useState('');
  const [buscar, setBuscar] = useState('');
  const [estado, setEstado] = useState<EstadoProducto | null>(null);
  const [categoria, setCategoria] = useState<string | null>(null);

  useEffect(() => {
    const espera = setTimeout(() => setBuscar(texto.trim()), ESPERA_BUSQUEDA_MS);
    return () => clearTimeout(espera);
  }, [texto]);

  // Los filtros vacíos van en undefined: no viajan y no arman otra caché
  const consulta = useListarProductosInfiniteQuery({
    buscar: buscar || undefined,
    categoria: categoria ?? undefined,
    estado: estado ?? undefined,
  });
  // currentData y no data: al cambiar de filtro no se ve la lista del filtro anterior mientras carga
  const paginas = consulta.currentData?.pages;
  const productos = useMemo(() => paginas?.flatMap((pagina) => pagina.productos) ?? [], [paginas]);

  const colaPorProducto = useMemo(() => {
    const porProducto: Record<string, FotoEnCola[]> = {};
    for (const foto of Object.values(fotosEnCola)) (porProducto[foto.productoId] ??= []).push(foto);
    return porProducto;
  }, [fotosEnCola]);

  const hayFiltros = Boolean(buscar || estado || categoria);

  return {
    productos,
    /** Cuántos hay con estos filtros, contando los que todavía no se cargaron */
    total: paginas?.[0]?.totalProductos ?? 0,
    cargando: !paginas && consulta.isFetching,
    error: consulta.isError && !paginas ? mensajeDeError(consulta.error) : null,
    reintentar: () => void consulta.refetch(),
    refrescar: async () => {
      await consulta.refetch();
    },

    hayMas: consulta.hasNextPage,
    cargandoMas: consulta.isFetchingNextPage,
    errorMas: consulta.isFetchNextPageError ? mensajeDeError(consulta.error) : null,
    /** Se llama al llegar al final de la lista: trae la página siguiente si hay y no está trayendo otra */
    cargarMas: () => {
      if (consulta.hasNextPage && !consulta.isFetching) void consulta.fetchNextPage();
    },

    filtros: {
      texto,
      setTexto,
      estado,
      setEstado,
      categoria,
      setCategoria,
      categorias,
      hayFiltros,
      limpiar: () => {
        setTexto('');
        setBuscar('');
        setEstado(null);
        setCategoria(null);
      },
    },

    /** Las fotos de un producto que todavía no están en el servidor */
    colaDe: (productoId: string): FotoEnCola[] => colaPorProducto[productoId] ?? [],
    reintentarFotos: (ids: string[]) => ids.forEach((id) => void dispatch(reintentarFoto(id))),
    descartarFotos: (ids: string[]) => ids.forEach((id) => dispatch(quitarFoto(id))),
    nuevo: () => router.push('/productos/nuevo'),
    abrir: (producto: Producto) => {
      // El detalle arranca con lo que ya trajo la lista: se ve al instante, sin otro pedido
      void dispatch(productosApi.util.upsertQueryData('obtenerProducto', producto._id, producto));
      router.push({ pathname: '/productos/[id]', params: { id: producto._id } });
    },
  };
}
```

`useProducto.ts`, `useEditarProducto.ts` y `useNuevoProducto.ts`:

```diff
--- a/src/features/productos/hooks/useProducto.ts
+++ b/src/features/productos/hooks/useProducto.ts
@@ -3,19 +3,21 @@
 import { useRouter } from 'expo-router';
 import { mensajeDeError } from '@/services/api';
 import { useAppDispatch, useAppSelector } from '@/store';
-import { useBorrarProductoMutation, useListarProductosQuery } from '../api/productosApi';
+import { useBorrarProductoMutation, useEditarProductoMutation } from '../api/productosApi';
 import { quitarFoto, quitarFotosDeProducto, reintentarFoto } from '../store/subidaFotosSlice';
+import { useProductoGuardado } from './useProductoGuardado';
 
-/** El detalle de un producto. Sale de la lista ya cargada: así no hace falta otro pedido al abrirlo */
+/** El detalle de un producto, con sus acciones: editar, pausar o activar y eliminar */
 export function useProducto(id: string) {
   const router = useRouter();
   const dispatch = useAppDispatch();
-  const consulta = useListarProductosQuery();
-  const producto = consulta.data?.find((p) => p._id === id);
+  const { producto, cargando, error, refrescar } = useProductoGuardado(id);
   const cola = useAppSelector((s) => s.subidaFotos.fotos);
   const enCola = useMemo(() => Object.values(cola).filter((foto) => foto.productoId === id), [cola, id]);
   const [borrarProducto, { isLoading: eliminando }] = useBorrarProductoMutation();
   const [errorEliminar, setErrorEliminar] = useState<string | null>(null);
+  const [editarProducto, { isLoading: cambiandoEstado }] = useEditarProductoMutation();
+  const [errorEstado, setErrorEstado] = useState<string | null>(null);
 
   const volver = () => (router.canGoBack() ? router.back() : router.replace('/productos'));
 
@@ -39,16 +41,30 @@
     ]);
   };
 
+  // Un toque: el pan dulce se pausa en enero y se activa en diciembre, sin entrar a editar
+  const alternarEstado = async () => {
+    if (!producto) return;
+    setErrorEstado(null);
+    try {
+      await editarProducto({ id, datos: { disponible: !producto.disponible } }).unwrap();
+    } catch (e) {
+      setErrorEstado(mensajeDeError(e));
+    }
+  };
+
   return {
     producto,
     enCola,
-    cargando: consulta.isLoading,
-    error: consulta.isError ? mensajeDeError(consulta.error) : null,
-    reintentar: () => void consulta.refetch(),
+    cargando,
+    error,
+    reintentar: () => void refrescar(),
     refrescar: async () => {
-      await consulta.refetch();
+      await refrescar();
     },
     editar: () => router.push({ pathname: '/productos/[id]/editar', params: { id } }),
+    alternarEstado: () => void alternarEstado(),
+    cambiandoEstado,
+    errorEstado,
     eliminar,
     eliminando,
     errorEliminar,
```

```diff
--- a/src/features/productos/hooks/useEditarProducto.ts
+++ b/src/features/productos/hooks/useEditarProducto.ts
@@ -3,16 +3,18 @@
 import { useForm } from 'react-hook-form';
 import { zodResolver } from '@hookform/resolvers/zod';
 import { mensajeDeError } from '@/services/api';
-import { useEditarProductoMutation, useListarProductosQuery } from '../api/productosApi';
+import { useEditarProductoMutation } from '../api/productosApi';
 import { aFormulario, cambiosDe, FORMULARIO_VACIO } from '../formulario';
 import { productoFormSchema } from '../schemas';
 import type { ProductoFormulario } from '../types';
+import { useCategorias } from './useCategorias';
 import { useFotosProducto } from './useFotosProducto';
+import { useProductoGuardado } from './useProductoGuardado';
 
 export function useEditarProducto(id: string) {
   const router = useRouter();
-  const consulta = useListarProductosQuery();
-  const producto = consulta.data?.find((p) => p._id === id);
+  const { producto, cargando } = useProductoGuardado(id);
+  const categorias = useCategorias();
   const [editarProducto] = useEditarProductoMutation();
   const fotos = useFotosProducto(producto);
   const [error, setError] = useState<string | null>(null);
@@ -48,7 +50,8 @@
 
   return {
     producto,
-    cargando: consulta.isLoading,
+    cargando,
+    categorias,
     control: form.control,
     enfocar: form.setFocus,
     enviar,
```

```diff
--- a/src/features/productos/hooks/useNuevoProducto.ts
+++ b/src/features/productos/hooks/useNuevoProducto.ts
@@ -9,6 +9,7 @@
 import { productoFormSchema } from '../schemas';
 import { subirFotos } from '../store/subidaFotosSlice';
 import type { ProductoFormulario } from '../types';
+import { useCategorias } from './useCategorias';
 import { useFotosElegidas } from './useFotosElegidas';
 
 export function useNuevoProducto() {
@@ -16,6 +17,7 @@
   const dispatch = useAppDispatch();
   const [crearProducto] = useCrearProductoMutation();
   const fotos = useFotosElegidas();
+  const categorias = useCategorias();
   const [error, setError] = useState<string | null>(null);
   const form = useForm<ProductoFormulario>({
     resolver: zodResolver(productoFormSchema),
@@ -38,6 +40,7 @@
   });
 
   return {
+    categorias,
     control: form.control,
     enfocar: form.setFocus,
     enviar,
```

### 6. Componentes

`ChipsCategorias.tsx` (nuevo). Hoy lo usa solo `productos`. Cuando lo use el catálogo, por la regla de promoción, pasa a `shared/ui/atoms/`.

`src/features/productos/components/ChipsCategorias.tsx`

```tsx
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '@/shared/ui/atoms';
import { useStyles, type Theme } from '@/theme';

interface ChipsCategoriasProps {
  categorias: string[];
  /** La elegida; null = ninguna (o "Todas", si está) */
  valor: string | null;
  alCambiar: (categoria: string | null) => void;
  /** Suma un chip "Todas" al principio: para filtrar */
  conTodas?: boolean;
  /** En una fila que se desliza (filtro) o en varias filas (formulario) */
  enFila?: boolean;
  accessibilityLabel: string;
}

/** Elegir una categoría de la lista fija del back. Se comporta como un grupo de radios */
export function ChipsCategorias({
  categorias,
  valor,
  alCambiar,
  conTodas = false,
  enFila = false,
  accessibilityLabel,
}: ChipsCategoriasProps) {
  const styles = useStyles(createStyles);
  const opciones: { clave: string; label: string; valor: string | null }[] = [
    ...(conTodas ? [{ clave: '__todas', label: 'Todas', valor: null }] : []),
    ...categorias.map((categoria) => ({ clave: categoria, label: categoria, valor: categoria })),
  ];

  const chips = opciones.map((opcion) => {
    const activa = opcion.valor === valor;
    return (
      <Pressable
        key={opcion.clave}
        onPress={() => alCambiar(opcion.valor)}
        accessibilityRole="radio"
        accessibilityState={{ checked: activa }}
        accessibilityLabel={opcion.label}
        style={({ pressed }) => [styles.chip, activa && styles.activa, pressed && styles.presionada]}
      >
        <Text variant="label" color={activa ? 'onPrimary' : 'text'} numberOfLines={1}>
          {opcion.label}
        </Text>
      </Pressable>
    );
  });

  return enFila ? (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.fila}
      accessibilityRole="radiogroup"
      accessibilityLabel={accessibilityLabel}
    >
      {chips}
    </ScrollView>
  ) : (
    <View style={styles.grilla} accessibilityRole="radiogroup" accessibilityLabel={accessibilityLabel}>
      {chips}
    </View>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    fila: { gap: theme.spacing.sm },
    grilla: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm },
    chip: {
      minHeight: theme.sizes.touchMin,
      justifyContent: 'center',
      paddingHorizontal: theme.spacing.lg,
      borderRadius: theme.radius.full,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
    },
    activa: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
    presionada: { opacity: theme.opacity.pressed },
  });
```

```diff
--- a/src/features/productos/components/CamposProducto.tsx
+++ b/src/features/productos/components/CamposProducto.tsx
@@ -2,22 +2,23 @@
 import { Controller, type Control, type UseFormSetFocus } from 'react-hook-form';
 import { CampoTexto, Segmentado, Text, type OpcionSegmentado } from '@/shared/ui/atoms';
 import { useStyles, type Theme } from '@/theme';
-import type { ProductoFormulario } from '../types';
+import type { EstadoProducto, ProductoFormulario } from '../types';
+import { ChipsCategorias } from './ChipsCategorias';
 
-type Disponibilidad = 'si' | 'no';
-
-const DISPONIBILIDAD: OpcionSegmentado<Disponibilidad>[] = [
-  { valor: 'si', label: 'Disponible' },
-  { valor: 'no', label: 'No disponible' },
+const ESTADOS: OpcionSegmentado<EstadoProducto>[] = [
+  { valor: 'activo', label: 'Activo' },
+  { valor: 'pausado', label: 'Pausado' },
 ];
 
 interface CamposProductoProps {
   control: Control<ProductoFormulario>;
   enfocar: UseFormSetFocus<ProductoFormulario>;
+  /** La lista fija del back (useCategorias) */
+  categorias: string[];
 }
 
 /** Los datos del producto: los mismos en el alta y en la edición */
-export function CamposProducto({ control, enfocar }: CamposProductoProps) {
+export function CamposProducto({ control, enfocar, categorias }: CamposProductoProps) {
   const styles = useStyles(createStyles);
 
   return (
@@ -41,7 +42,7 @@
         keyboardType="number-pad"
         returnKeyType="next"
         submitBehavior="submit"
-        onSubmitEditing={() => enfocar('categoria')}
+        onSubmitEditing={() => enfocar('pesoGramos')}
       />
 
       <Controller
@@ -49,31 +50,49 @@
         name="disponible"
         render={({ field: { value, onChange } }) => (
           <View style={styles.campo}>
-            <Text variant="label">Disponibilidad</Text>
+            <Text variant="label">Estado</Text>
             <Segmentado
-              opciones={DISPONIBILIDAD}
-              valor={value ? 'si' : 'no'}
-              alCambiar={(opcion) => onChange(opcion === 'si')}
-              accessibilityLabel="Disponibilidad"
+              opciones={ESTADOS}
+              valor={value ? 'activo' : 'pausado'}
+              alCambiar={(estado) => onChange(estado === 'activo')}
+              accessibilityLabel="Estado"
             />
             <Text variant="caption" color="textMuted">
-              {value ? 'Se ve en el catálogo.' : 'No aparece en el catálogo hasta que lo vuelvas a habilitar.'}
+              {value
+                ? 'Se ve en el catálogo y se puede pedir.'
+                : 'No se ve en el catálogo ni se puede pedir, pero guarda sus datos y fotos. Para productos de temporada, como el pan dulce.'}
             </Text>
           </View>
         )}
       />
 
-      <CampoTexto
+      <Controller
         control={control}
         name="categoria"
-        label="Categoría"
-        placeholder="Facturas"
-        helper="Opcional."
-        autoCapitalize="sentences"
-        returnKeyType="next"
-        submitBehavior="submit"
-        onSubmitEditing={() => enfocar('pesoGramos')}
+        render={({ field: { value, onChange }, fieldState: { error } }) => (
+          <View style={styles.campo}>
+            <Text variant="label">Categoría</Text>
+            {categorias.length > 0 ? (
+              <ChipsCategorias
+                categorias={categorias}
+                valor={value || null}
+                alCambiar={(categoria) => onChange(categoria ?? '')}
+                accessibilityLabel="Categoría"
+              />
+            ) : (
+              <Text variant="caption" color="textMuted">
+                Cargando categorías…
+              </Text>
+            )}
+            {error?.message ? (
+              <Text variant="caption" color="danger">
+                {error.message}
+              </Text>
+            ) : null}
+          </View>
+        )}
       />
+
       <CampoTexto
         control={control}
         name="pesoGramos"
```

```diff
--- a/src/features/productos/components/TarjetaProducto.tsx
+++ b/src/features/productos/components/TarjetaProducto.tsx
@@ -59,7 +59,7 @@
             </Text>
           ) : null}
           <View style={styles.etiquetas}>
-            {!producto.disponible && <Badge tone="neutral" label="No disponible" />}
+            {!producto.disponible && <Badge tone="neutral" label="Pausado" />}
             <Text variant="caption" color="textMuted">
               {cantidadDeFotos(producto.imagenes.length)}
             </Text>
```

`ScreenContainer` suma una prop opcional. Las pantallas que no la usan quedan igual:

```diff
--- a/src/shared/ui/atoms/ScreenContainer/ScreenContainer.tsx
+++ b/src/shared/ui/atoms/ScreenContainer/ScreenContainer.tsx
@@ -11,6 +11,8 @@
   centered?: boolean;
   /** El `control` de `useRefrescar`, en pantallas con datos de la API */
   refreshControl?: ScrollViewProps['refreshControl'];
+  /** Se llama cuando el scroll se acerca al final: para traer la página siguiente de una lista */
+  alLlegarAlFinal?: () => void;
   edges?: Edge[];
 }
 
@@ -21,10 +23,16 @@
   width = 'content',
   centered = false,
   refreshControl,
+  alLlegarAlFinal,
   edges = BORDES_POR_DEFECTO,
 }: ScreenContainerProps) {
   const styles = useStyles(createStyles);
 
+  // Avisa cuando falta menos de media pantalla para el final: la página siguiente llega antes de que se note
+  const alDesplazar: ScrollViewProps['onScroll'] = ({ nativeEvent: { layoutMeasurement, contentOffset, contentSize } }) => {
+    if (contentOffset.y + layoutMeasurement.height * 1.5 >= contentSize.height) alLlegarAlFinal?.();
+  };
+
   return (
     <SafeAreaView edges={edges} style={styles.fondo}>
       {/* También en Android: con edge-to-edge (SDK 54+) el adjustResize ya no achica la ventana y el teclado tapaba los inputs */}
@@ -34,6 +42,8 @@
           contentContainerStyle={[styles.scroll, width === 'form' && styles.scrollForm, centered && styles.centrado]}
           keyboardShouldPersistTaps="handled"
           refreshControl={refreshControl}
+          onScroll={alLlegarAlFinal && alDesplazar}
+          scrollEventThrottle={alLlegarAlFinal && 200}
         >
           <View style={[styles.contenido, width === 'form' ? styles.anchoForm : styles.anchoContenido]}>
             {children}
```

### 7. Pantallas

`ProductosScreen.tsx` (completo):

`src/features/productos/screens/ProductosScreen.tsx`

```tsx
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Croissant, Plus, Search } from 'lucide-react-native';
import { useRefrescar } from '@/shared/hooks';
import { Alert, Button, Icon, Input, ScreenContainer, Segmentado, Text, type OpcionSegmentado } from '@/shared/ui/atoms';
import { useStyles, useTheme, type Theme } from '@/theme';
import { ChipsCategorias } from '../components/ChipsCategorias';
import { TarjetaProducto } from '../components/TarjetaProducto';
import { useProductos } from '../hooks/useProductos';
import type { EstadoProducto } from '../types';

const ESTADOS: OpcionSegmentado<EstadoProducto | 'todos'>[] = [
  { valor: 'todos', label: 'Todos' },
  { valor: 'activo', label: 'Activos' },
  { valor: 'pausado', label: 'Pausados' },
];

const cantidad = (total: number) => (total === 1 ? '1 producto' : `${total} productos`);

export function ProductosScreen() {
  const theme = useTheme();
  const styles = useStyles(createStyles);
  const productos = useProductos();
  const { filtros } = productos;
  const refresco = useRefrescar(productos.refrescar);
  const vacio = !productos.cargando && !productos.error && productos.productos.length === 0;

  return (
    <ScreenContainer refreshControl={refresco.control} alLlegarAlFinal={productos.cargarMas}>
      <View style={styles.contenido}>
        <View style={styles.encabezado}>
          <Text variant="heading">Productos</Text>
          <Button icon={Plus} label="Nuevo" onPress={productos.nuevo} />
        </View>

        <View style={styles.filtros}>
          <Input
            icon={Search}
            value={filtros.texto}
            onChangeText={filtros.setTexto}
            placeholder="Buscar por nombre"
            accessibilityLabel="Buscar por nombre"
            autoCorrect={false}
            returnKeyType="search"
          />
          <Segmentado
            opciones={ESTADOS}
            valor={filtros.estado ?? 'todos'}
            alCambiar={(estado) => filtros.setEstado(estado === 'todos' ? null : estado)}
            accessibilityLabel="Estado"
          />
          {filtros.categorias.length > 0 && (
            <ChipsCategorias
              categorias={filtros.categorias}
              valor={filtros.categoria}
              alCambiar={filtros.setCategoria}
              conTodas
              enFila
              accessibilityLabel="Categoría"
            />
          )}
          {!productos.cargando && !productos.error && productos.total > 0 && (
            <Text variant="caption" color="textMuted">
              {cantidad(productos.total)}
            </Text>
          )}
        </View>

        {productos.cargando && !refresco.refrescando && (
          <ActivityIndicator color={theme.colors.primary} style={styles.cargando} />
        )}

        {productos.error && (
          <View style={styles.error}>
            <Alert tone="danger" message={productos.error} />
            <Button variant="secondary" label="Reintentar" onPress={productos.reintentar} />
          </View>
        )}

        {vacio &&
          (filtros.hayFiltros ? (
            <View style={styles.vacio}>
              <Icon icon={Search} size="xl" color="textMuted" />
              <Text variant="subtitle" align="center">
                Ningún producto coincide
              </Text>
              <Button variant="secondary" label="Quitar filtros" onPress={filtros.limpiar} />
            </View>
          ) : (
            <View style={styles.vacio}>
              <Icon icon={Croissant} size="xl" color="textMuted" />
              <Text variant="subtitle" align="center">
                Todavía no cargaste productos
              </Text>
              <Text color="textMuted" align="center">
                Tocá «Nuevo» para cargar el primero, con sus fotos.
              </Text>
            </View>
          ))}

        {productos.productos.map((producto) => (
          <TarjetaProducto
            key={producto._id}
            producto={producto}
            enCola={productos.colaDe(producto._id)}
            onPress={() => productos.abrir(producto)}
            onReintentar={productos.reintentarFotos}
            onDescartar={productos.descartarFotos}
          />
        ))}

        {/* El final de la lista: cargando la página siguiente, su error, o el botón por si el scroll no alcanza */}
        {productos.cargandoMas ? (
          <ActivityIndicator color={theme.colors.primary} style={styles.mas} />
        ) : productos.errorMas ? (
          <View style={styles.error}>
            <Alert tone="danger" message={productos.errorMas} />
            <Button variant="secondary" label="Reintentar" onPress={productos.cargarMas} />
          </View>
        ) : productos.hayMas ? (
          <Button variant="ghost" label="Ver más productos" onPress={productos.cargarMas} fullWidth />
        ) : null}
      </View>
    </ScreenContainer>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    contenido: { gap: theme.spacing.md },
    encabezado: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: theme.spacing.md,
      marginBottom: theme.spacing.sm,
    },
    filtros: { gap: theme.spacing.sm, marginBottom: theme.spacing.sm },
    cargando: { paddingVertical: theme.spacing.xxl },
    mas: { paddingVertical: theme.spacing.lg },
    error: { gap: theme.spacing.sm, alignItems: 'flex-start' },
    vacio: { alignItems: 'center', gap: theme.spacing.sm, paddingVertical: theme.spacing.xxl },
  });
```

```diff
--- a/src/features/productos/screens/DetalleProductoScreen.tsx
+++ b/src/features/productos/screens/DetalleProductoScreen.tsx
@@ -1,6 +1,6 @@
 import { ActivityIndicator, StyleSheet, View } from 'react-native';
 import { useLocalSearchParams } from 'expo-router';
-import { ArrowLeft, Pencil, Trash2 } from 'lucide-react-native';
+import { ArrowLeft, Pause, Pencil, Play, Trash2 } from 'lucide-react-native';
 import { useRefrescar } from '@/shared/hooks';
 import { Alert, Badge, Button, ScreenContainer, Text } from '@/shared/ui/atoms';
 import { formatearPrecio } from '@/shared/utils';
@@ -53,10 +53,7 @@
         />
 
         <View style={styles.bloque}>
-          <Badge
-            tone={producto.disponible ? 'success' : 'neutral'}
-            label={producto.disponible ? 'Disponible' : 'No disponible'}
-          />
+          <Badge tone={producto.disponible ? 'success' : 'neutral'} label={producto.disponible ? 'Activo' : 'Pausado'} />
           <Text variant="title">{producto.nombre}</Text>
           <Text variant="subtitle" color="primary" style={styles.precio}>
             {formatearPrecio(producto.precio)}
@@ -73,11 +70,25 @@
           </View>
         )}
 
+        {detalle.errorEstado && <Alert tone="danger" message={detalle.errorEstado} />}
         {detalle.errorEliminar && <Alert tone="danger" message={detalle.errorEliminar} />}
 
         <View style={styles.acciones}>
           <Button icon={Pencil} label="Editar" onPress={detalle.editar} fullWidth />
           <Button
+            variant="secondary"
+            icon={producto.disponible ? Pause : Play}
+            label={producto.disponible ? 'Pausar' : 'Activar'}
+            onPress={detalle.alternarEstado}
+            loading={detalle.cambiandoEstado}
+            fullWidth
+          />
+          {!producto.disponible && (
+            <Text variant="caption" color="textMuted" align="center">
+              Pausado: no se ve en el catálogo ni se puede pedir.
+            </Text>
+          )}
+          <Button
             variant="danger"
             icon={Trash2}
             label="Eliminar producto"
```

```diff
--- a/src/features/productos/screens/NuevoProductoScreen.tsx
+++ b/src/features/productos/screens/NuevoProductoScreen.tsx
@@ -8,7 +8,7 @@
 // Formulario: no lleva el gesto de refrescar. El título lo pone el header del Stack
 export function NuevoProductoScreen() {
   const styles = useStyles(createStyles);
-  const { control, enfocar, enviar, enviando, error, fotos } = useNuevoProducto();
+  const { categorias, control, enfocar, enviar, enviando, error, fotos } = useNuevoProducto();
 
   return (
     <ScreenContainer width="form" edges={['bottom', 'left', 'right']}>
@@ -32,7 +32,7 @@
           onTocar={fotos.hacerPortada}
         />
 
-        <CamposProducto control={control} enfocar={enfocar} />
+        <CamposProducto control={control} enfocar={enfocar} categorias={categorias} />
 
         <View style={styles.acciones}>
           <Button label="Guardar producto" onPress={enviar} loading={enviando} disabled={fotos.procesando} fullWidth />
```

```diff
--- a/src/features/productos/screens/EditarProductoScreen.tsx
+++ b/src/features/productos/screens/EditarProductoScreen.tsx
@@ -11,7 +11,7 @@
   const theme = useTheme();
   const styles = useStyles(createStyles);
   const { id } = useLocalSearchParams<{ id: string }>();
-  const { producto, cargando, control, enfocar, enviar, enviando, error, fotos } = useEditarProducto(id);
+  const { producto, cargando, categorias, control, enfocar, enviar, enviando, error, fotos } = useEditarProducto(id);
 
   if (!producto) {
     return (
@@ -43,7 +43,7 @@
           onTocar={fotos.tocar}
         />
 
-        <CamposProducto control={control} enfocar={enfocar} />
+        <CamposProducto control={control} enfocar={enfocar} categorias={categorias} />
 
         <Button label="Guardar cambios" onPress={enviar} loading={enviando} fullWidth />
       </View>
```

## Catálogo público (para cuando se arme la web)

Hoy `CatalogoScreen` es un placeholder. Cuando traiga productos:

- **Lista:** `GET /api/catalogo` con `buscar`, `categoria`, `pagina` y `limite`, sin `estado`. Cada producto trae `portada` y `cantidadImagenes`, sin el array de fotos.
- **Detalle:** `GET /api/catalogo/:id`, con todas las fotos. Responde `404` si el producto está pausado.
- **Categorías:** `useListarCategoriasQuery()`, el mismo endpoint, mostrando solo las de `cantidad > 0`.

`src/features/catalogo/schemas.ts`

```ts
import { z } from 'zod';
import { productoSchema } from '@/features/productos/schemas';

/** Cada producto de GET /api/catalogo: sin el array de fotos, con la portada en miniatura */
export const productoCatalogoSchema = productoSchema.omit({ imagenes: true }).extend({
  portada: z.url().nullable(),
  cantidadImagenes: z.number().int(),
});

/** GET /api/catalogo: una página (solo productos activos) */
export const paginaCatalogoSchema = z.object({
  productos: z.array(productoCatalogoSchema),
  pagina: z.number().int(),
  limite: z.number().int(),
  totalProductos: z.number().int(),
  totalPaginas: z.number().int(),
});

export type ProductoCatalogo = z.infer<typeof productoCatalogoSchema>;
export type PaginaCatalogo = z.infer<typeof paginaCatalogoSchema>;
```

`src/features/catalogo/api/catalogoApi.ts`

```ts
import { productoSchema } from '@/features/productos/schemas';
import type { Producto } from '@/features/productos/types';
import { baseApi } from '@/services/api';
import { paginaCatalogoSchema, type PaginaCatalogo } from '../schemas';

/** Los filtros del catálogo: no hay estado, el back siempre muestra solo los activos */
export interface FiltrosCatalogo {
  buscar?: string;
  categoria?: string;
}

export const catalogoApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    listarCatalogo: build.infiniteQuery<PaginaCatalogo, FiltrosCatalogo, number>({
      infiniteQueryOptions: {
        initialPageParam: 1,
        getNextPageParam: (ultima) => (ultima.pagina < ultima.totalPaginas ? ultima.pagina + 1 : undefined),
      },
      query: ({ queryArg, pageParam }) => ({ url: '/catalogo', params: { ...queryArg, pagina: pageParam, limite: 20 } }),
      rawResponseSchema: paginaCatalogoSchema,
    }),

    /** El detalle público: 404 si el producto está pausado o no existe */
    obtenerDelCatalogo: build.query<Producto, string>({
      query: (id) => `/catalogo/${id}`,
      rawResponseSchema: productoSchema,
    }),
  }),
});

export const { useListarCatalogoInfiniteQuery, useObtenerDelCatalogoQuery } = catalogoApi;
```

## Probarlo a mano

```bash
TOKEN=<el token del login>
# Segunda página de 5, solo pausados
curl -H "Authorization: Bearer $TOKEN" "http://localhost:3000/api/productos?estado=pausado&limite=5&pagina=2"
# Buscar sin acentos ni mayúsculas
curl -H "Authorization: Bearer $TOKEN" "http://localhost:3000/api/productos?buscar=SANDWICH"
# Gustos (público)
curl http://localhost:3000/api/catalogo/categorias
# Pausar el pan dulce
curl -X PUT -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"disponible": false}' http://localhost:3000/api/productos/<id>
# Gusto inválido → 400 con la lista
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"nombre": "Medialuna", "precio": 500, "categoria": "Dulse"}' http://localhost:3000/api/productos
```

## Checklist para el front

- [ ] Schemas, tipos y formulario con la categoría obligatoria.
- [ ] `listarProductos` como infinite query, más `obtenerProducto`, `listarCategorias` y `cambiarProductoEnCache`.
- [ ] La cola de fotos usa `cambiarProductoEnCache`.
- [ ] La lista tiene búsqueda, Todos/Activos/Pausados, chips de categoría, el contador, scroll infinito y "Ver más productos".
- [ ] El detalle y la edición usan `useProductoGuardado`, y abren al instante desde la lista.
- [ ] El formulario muestra Activo/Pausado y la categoría con chips ("Elegí una categoría" si falta).
- [ ] El detalle tiene el botón **Pausar / Activar**.
- [ ] En el celular:
  - [ ] Crear un producto con fotos y ver que aparece en su categoría.
  - [ ] Pausarlo desde el detalle.
  - [ ] Filtrar "Pausados".
  - [ ] Bajar hasta cargar la segunda página.
  - [ ] Buscar "sandwich".
- [ ] `npx tsc --noEmit`.
