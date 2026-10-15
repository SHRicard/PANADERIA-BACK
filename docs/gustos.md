# gustos: la categoría del producto pasa a ser su gusto

Para quien implemente en el front (`PANADERIA-FRONT`) el cambio de categorías a gustos, y para quien arme más adelante los pedidos y las métricas.

## Qué cambió en el back

- **La categoría ahora es el gusto.** La lista fija pasó a ser, en este orden: **Dulce · Salado · Agridulce · Ácido · Amargo · Picante**. Antes era Panes, Facturas, Tortas, etc.
  - El campo de la API sigue llamándose `categoria`, sigue siendo obligatorio y el back lo sigue normalizando (`acido` se guarda como "Ácido").
  - Cualquier otro valor, incluidas las categorías viejas como "Facturas", responde `400` con el mensaje "La categoría tiene que ser una de: Dulce, Salado, Agridulce, Ácido, Amargo, Picante".
- **Los productos que había se migraron.** Los 2 que estaban en "Facturas" quedaron en "Dulce".
- **Cada ítem de un pedido guarda el gusto** del producto al momento de la venta (`categoria`), para las métricas de qué gusto se vende más. Ver [Pedidos](#pedidos-el-gusto-de-cada-ítem).
- El resto del contrato (paginado, filtros, activo/pausado, `GET /api/catalogo/categorias`) sigue igual: está en [paginado-productos.md](paginado-productos.md).

## Qué pasa hoy en la app, sin tocar nada

**Ya anda.** El front pide la lista al back (`useCategorias`) y valida `categoria` con `z.string()`, no con un enum. Por eso:

- los chips del filtro y del formulario ya muestran los 6 gustos;
- los productos ya se ven con su gusto;
- no hay errores de Zod.

**Lo único que queda viejo son los textos de la pantalla:** el formulario dice "Categoría", el filtro empieza con "Todas" y el error dice "Elegí una categoría".

## Lo que hay que cambiar: solo textos

| Dónde | Hoy | Queda |
|---|---|---|
| Formulario: título del campo | Categoría | **Gusto** |
| Formulario: mientras carga | Cargando categorías… | **Cargando gustos…** |
| Formulario: error si falta | Elegí una categoría | **Elegí un gusto** |
| Filtro de la lista: primer chip | Todas | **Todos** (y la prop `conTodas` pasa a `conTodos`) |
| Lector de pantalla (filtro y formulario) | Categoría | **Gusto** |

Los nombres del código (`categoria`, `ChipsCategorias`, `useCategorias`) quedan como están, porque siguen al campo de la API. También cambian algunos comentarios, que van incluidos en los diffs.

Los diffs son contra el front actual (`a/` es el actual y `b/` cómo queda):

```diff
--- a/src/features/productos/schemas.ts
+++ b/src/features/productos/schemas.ts
@@ -16,7 +16,7 @@
   descripcion: z.string().optional(),
   ingredientes: z.array(z.string()),
   pesoGramos: z.number().positive().optional(),
-  // z.string() y no un enum: si el back suma una categoría, la app no se rompe
+  // El gusto. z.string() y no un enum: si el back suma un gusto, la app no se rompe
   categoria: z.string(),
   /** false = pausado: no sale en el catálogo ni se puede pedir */
   disponible: z.boolean(),
@@ -34,7 +34,7 @@
   totalPaginas: z.number().int(),
 });
 
-/** GET /api/catalogo/categorias: la lista fija del back, en orden, con cuántos productos activos tiene cada una */
+/** GET /api/catalogo/categorias: los gustos (lista fija del back), en orden, con cuántos productos activos tiene cada uno */
 export const categoriasSchema = z.array(z.object({ nombre: z.string(), cantidad: z.number().int() }));
 
 // ── Formulario ────────────────────────────────────────────────────────────────
@@ -55,7 +55,7 @@
     .regex(entero, 'Solo números, sin puntos ni comas')
     .refine((valor) => Number(valor) > 0, 'El precio tiene que ser mayor que 0'),
   descripcion: z.string().trim(),
-  categoria: z.string().min(1, 'Elegí una categoría'),
+  categoria: z.string().min(1, 'Elegí un gusto'),
   pesoGramos: z
     .string()
     .trim()
```

```diff
--- a/src/features/productos/components/CamposProducto.tsx
+++ b/src/features/productos/components/CamposProducto.tsx
@@ -13,7 +13,7 @@
 interface CamposProductoProps {
   control: Control<ProductoFormulario>;
   enfocar: UseFormSetFocus<ProductoFormulario>;
-  /** La lista fija del back (useCategorias) */
+  /** Los gustos de la lista fija del back (useCategorias) */
   categorias: string[];
 }
 
@@ -71,17 +71,17 @@
         name="categoria"
         render={({ field: { value, onChange }, fieldState: { error } }) => (
           <View style={styles.campo}>
-            <Text variant="label">Categoría</Text>
+            <Text variant="label">Gusto</Text>
             {categorias.length > 0 ? (
               <ChipsCategorias
                 categorias={categorias}
                 valor={value || null}
                 alCambiar={(categoria) => onChange(categoria ?? '')}
-                accessibilityLabel="Categoría"
+                accessibilityLabel="Gusto"
               />
             ) : (
               <Text variant="caption" color="textMuted">
-                Cargando categorías…
+                Cargando gustos…
               </Text>
             )}
             {error?.message ? (
```

```diff
--- a/src/features/productos/components/ChipsCategorias.tsx
+++ b/src/features/productos/components/ChipsCategorias.tsx
@@ -4,28 +4,28 @@
 
 interface ChipsCategoriasProps {
   categorias: string[];
-  /** La elegida; null = ninguna (o "Todas", si está) */
+  /** El elegido; null = ninguno (o "Todos", si está) */
   valor: string | null;
   alCambiar: (categoria: string | null) => void;
-  /** Suma un chip "Todas" al principio: para filtrar */
-  conTodas?: boolean;
+  /** Suma un chip "Todos" al principio: para filtrar */
+  conTodos?: boolean;
   /** En una fila que se desliza (filtro) o en varias filas (formulario) */
   enFila?: boolean;
   accessibilityLabel: string;
 }
 
-/** Elegir una categoría de la lista fija del back. Se comporta como un grupo de radios */
+/** Elegir un gusto (la categoría) de la lista fija del back. Se comporta como un grupo de radios */
 export function ChipsCategorias({
   categorias,
   valor,
   alCambiar,
-  conTodas = false,
+  conTodos = false,
   enFila = false,
   accessibilityLabel,
 }: ChipsCategoriasProps) {
   const styles = useStyles(createStyles);
   const opciones: { clave: string; label: string; valor: string | null }[] = [
-    ...(conTodas ? [{ clave: '__todas', label: 'Todas', valor: null }] : []),
+    ...(conTodos ? [{ clave: '__todos', label: 'Todos', valor: null }] : []),
     ...categorias.map((categoria) => ({ clave: categoria, label: categoria, valor: categoria })),
   ];
```

```diff
--- a/src/features/productos/screens/ProductosScreen.tsx
+++ b/src/features/productos/screens/ProductosScreen.tsx
@@ -54,9 +54,9 @@
               categorias={filtros.categorias}
               valor={filtros.categoria}
               alCambiar={filtros.setCategoria}
-              conTodas
+              conTodos
               enFila
-              accessibilityLabel="Categoría"
+              accessibilityLabel="Gusto"
             />
           )}
           {!productos.cargando && !productos.error && productos.total > 0 && (
```

Solo comentarios:

```diff
--- a/src/features/productos/types.ts
+++ b/src/features/productos/types.ts
@@ -20,6 +20,7 @@
 export interface FiltrosProductos {
   /** Una parte del nombre: el back no distingue mayúsculas ni acentos */
   buscar?: string;
+  /** El gusto: Dulce, Salado… */
   categoria?: string;
   estado?: EstadoProducto;
 }
```

```diff
--- a/src/features/productos/hooks/useCategorias.ts
+++ b/src/features/productos/hooks/useCategorias.ts
@@ -1,7 +1,7 @@
 import { useMemo } from 'react';
 import { useListarCategoriasQuery } from '../api/productosApi';
 
-/** Los nombres de las categorías fijas del back, en orden. Vacío mientras cargan */
+/** Los gustos (las categorías fijas del back: Dulce, Salado…), en orden. Vacío mientras cargan */
 export function useCategorias(): string[] {
   const { data } = useListarCategoriasQuery();
   return useMemo(() => data?.map(({ nombre }) => nombre) ?? [], [data]);
```

```diff
--- a/src/features/productos/api/productosApi.ts
+++ b/src/features/productos/api/productosApi.ts
@@ -48,7 +48,7 @@
       providesTags: (_resultado, _error, id) => [{ type: 'Producto', id }],
     }),
 
-    /** Las categorías fijas del back, en orden. Solo cambian con un deploy del back: se piden una vez */
+    /** Los gustos (las categorías fijas del back), en orden. Solo cambian con un deploy del back: se piden una vez */
     listarCategorias: build.query<Categoria[], void>({
       query: () => '/catalogo/categorias',
       rawResponseSchema: categoriasSchema,
@@ -59,7 +59,7 @@
     crearProducto: build.mutation<Producto, DatosProducto>({
       query: (datos) => ({ url: '/productos', method: 'POST', body: datos }),
       rawResponseSchema: productoSchema,
-      // Recarga las listas: el nuevo aparece en su lugar (por categoría y nombre)
+      // Recarga las listas: el nuevo aparece en su lugar (por gusto y nombre)
       invalidatesTags: [LISTA],
     }),
 
@@ -68,7 +68,7 @@
       query: ({ id, datos }) => ({ url: `/productos/${id}`, method: 'PUT', body: datos }),
       rawResponseSchema: productoSchema,
       // Se reemplaza en las cachés en vez de recargar: así no pisa las fotos que se están subiendo.
-      // Si cambió el estado o la categoría, queda donde estaba en la lista hasta que se refresque: no salta
+      // Si cambió el estado o el gusto, queda donde estaba en la lista hasta que se refresque: no salta
       async onQueryStarted({ id }, { dispatch, queryFulfilled }) {
         let editado: Producto;
         try {
```

La pantalla **Diseño del sistema** (`DisenoScreen`, solo en desarrollo) tiene un ejemplo con "Categoría: Facturas". No afecta a nada: si quieren, lo cambian por "Gusto: Dulce".

## Pedidos: el gusto de cada ítem

Cada ítem de un pedido trae ahora `categoria`, con el gusto que tenía el producto cuando se vendió:

```json
{
  "id": "…",
  "items": [
    { "producto": "…", "nombre": "Medialuna", "precio": 550, "categoria": "Dulce", "cantidad": 2 },
    { "producto": "…", "nombre": "Brownie amargo", "precio": 900, "categoria": "Amargo", "cantidad": 1 }
  ],
  "total": 2000,
  "estado": "pendiente",
  "createdAt": "…"
}
```

- **Sale de la base, como el nombre y el precio.** Si el cliente manda una `categoria`, se ignora.
- **Es una copia del momento.** Si después el producto cambia de gusto o se elimina, el pedido no cambia. Así, las métricas cuentan cada venta con el gusto que tenía cuando se vendió.
- **Viene en todas las respuestas de pedidos:** el `POST /api/pedidos` público y, del lado privado, `GET /api/pedidos` y `GET /api/pedidos/:id`.
- **El front todavía no tiene pedidos** (`PedidosScreen` es un placeholder). Cuando los arme, el schema del ítem va así:

```ts
export const itemPedidoSchema = z.object({
  producto: z.string(),
  nombre: z.string(),
  precio: z.number(),
  /** El gusto al momento de la venta. z.string(): si la lista de gustos cambia, los pedidos viejos siguen valiendo */
  categoria: z.string(),
  cantidad: z.number().int(),
});
```

## Métricas (a futuro)

Todavía no hay un endpoint de métricas. Cuando se haga, la idea es:

- **sumar cantidades e importes por `items.categoria`**, para ver qué gusto se vende más;
- **sumar también por `items.producto`**, para ver qué producto se vende más;
- **contar solo los pedidos `entregado`**, entre dos fechas.

Con eso, el dueño ve qué tipo de cliente tiene (más dulce o más salado) y puede decidir qué productos nuevos sumar. Como cada pedido guarda el gusto desde ahora, cuando se haga el endpoint los datos ya van a estar completos.

## Probarlo a mano

```bash
# Los 6 gustos, con cuántos productos activos tiene cada uno (público)
curl http://localhost:3000/api/catalogo/categorias
# Un gusto viejo ya no vale → 400 con la lista
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"nombre": "Medialuna", "precio": 500, "categoria": "Facturas"}' http://localhost:3000/api/productos
```

## Checklist para el front

- [ ] Los textos de la tabla: "Gusto", "Cargando gustos…", "Elegí un gusto" y "Todos".
- [ ] En el celular:
  - [ ] Crear un producto eligiendo un gusto.
  - [ ] Filtrar por "Salado".
  - [ ] Ver que "Todos" quita el filtro.
- [ ] Cuando se armen los pedidos: `categoria` en el schema del ítem.
- [ ] `npx tsc --noEmit`.
