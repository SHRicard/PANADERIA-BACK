# nombre-unico: no puede haber dos productos con el mismo nombre

Para quien implemente en el front (`PANADERIA-FRONT`) el aviso de nombre repetido en el alta y la edición de productos.

## Por qué

Las métricas por producto ("cuántas TARTA DE FRUTILLA se vendieron") se leen por nombre. Si hubiera un "Tarta de frutilla" y un "TARTA DE FRUTILLA", las ventas se partirían en dos. Por eso el back ya no deja que dos productos se llamen igual.

## Qué hace el back

- **Compara sin importar mayúsculas, acentos ni espacios de más.** Para el back, todos estos son el mismo nombre:
  - `TARTA DE FRUTILLA`
  - `Tarta de frutilla`
  - `TÁRTA DE FRUTÍLLA`
  - `  TARTA   DE  FRUTILLA  `
- **La ñ sigue siendo distinta de la n:** "Caña" y "Cana" pueden convivir.
- **Al guardar, limpia los espacios de más.** "  CHIPS   CON SEMILLA " se guarda como "CHIPS CON SEMILLA".
- **Vale para crear y para renombrar.** Cambiarle solo las mayúsculas a su propio nombre ("Tarta de frutilla" → "TARTA DE FRUTILLA") está permitido.
- **No se cuela nada.** Lo garantiza un índice único en la base: aunque dos altas con el mismo nombre lleguen a la vez, entra una sola.
- **Si es repetido, no sube ninguna foto.** La subida de las fotos que vienen en el mismo pedido se frena antes de empezar.

### La respuesta

`409 Conflict`, con el nombre tal como está guardado:

```json
{ "error": "Ya existe un producto con ese nombre: «TARTA DE FRUTILLA»." }
```

Si el que ya existe está **pausado**, el mensaje lo dice:

```json
{ "error": "Ya existe un producto con ese nombre: «PAN DULCE». Está pausado: activalo en vez de crear otro." }
```

Es el caso típico: en diciembre el dueño quiere cargar el pan dulce, no lo ve en "Activos" y no se acuerda de que lo tenía pausado.

Si dos altas llegan exactamente a la vez, la que pierde recibe la versión corta: "Ya existe un producto con ese nombre".

## Qué pasa hoy en la app, sin tocar nada

**Ya anda.** El alta y la edición muestran arriba del formulario el mensaje de cualquier error (`mensajeDeError`), así que el `409` ya se ve con su texto.

## Lo que conviene cambiar: el error en el campo Nombre

Con un `409`, el error queda mejor **abajo del campo Nombre**, que es lo que el dueño tiene que corregir, y con el foco puesto ahí. `CampoTexto` ya muestra los errores de React Hook Form, así que alcanza con `form.setError`. Cuando el dueño cambia el nombre, el error se va solo.

Los diffs son contra el front actual (`a/` es el actual y `b/` cómo queda). Compilan con `tsc`:

```diff
--- a/src/features/productos/hooks/useNuevoProducto.ts
+++ b/src/features/productos/hooks/useNuevoProducto.ts
@@ -2,7 +2,7 @@
 import { useRouter } from 'expo-router';
 import { useForm } from 'react-hook-form';
 import { zodResolver } from '@hookform/resolvers/zod';
-import { mensajeDeError } from '@/services/api';
+import { mensajeDeError, type ApiError } from '@/services/api';
 import { useAppDispatch } from '@/store';
 import { useCrearProductoMutation } from '../api/productosApi';
 import { aDatosProducto, FORMULARIO_VACIO } from '../formulario';
@@ -35,6 +35,11 @@
       if (fotos.fotos.length > 0) void dispatch(subirFotos({ productoId: producto._id, fotos: fotos.fotos }));
       volver();
     } catch (e) {
+      // 409: ya hay un producto con ese nombre. Se marca en el campo, que es lo que el dueño tiene que cambiar
+      if ((e as Partial<ApiError>).status === 409) {
+        form.setError('nombre', { type: 'server', message: mensajeDeError(e) }, { shouldFocus: true });
+        return;
+      }
       setError(mensajeDeError(e));
     }
   });
```

```diff
--- a/src/features/productos/hooks/useEditarProducto.ts
+++ b/src/features/productos/hooks/useEditarProducto.ts
@@ -2,7 +2,7 @@
 import { useRouter } from 'expo-router';
 import { useForm } from 'react-hook-form';
 import { zodResolver } from '@hookform/resolvers/zod';
-import { mensajeDeError } from '@/services/api';
+import { mensajeDeError, type ApiError } from '@/services/api';
 import { useEditarProductoMutation } from '../api/productosApi';
 import { aFormulario, cambiosDe, FORMULARIO_VACIO } from '../formulario';
 import { productoFormSchema } from '../schemas';
@@ -44,6 +44,11 @@
       await editarProducto({ id, datos: cambios }).unwrap();
       volver();
     } catch (e) {
+      // 409: ya hay un producto con ese nombre. Se marca en el campo, que es lo que el dueño tiene que cambiar
+      if ((e as Partial<ApiError>).status === 409) {
+        form.setError('nombre', { type: 'server', message: mensajeDeError(e) }, { shouldFocus: true });
+        return;
+      }
       setError(mensajeDeError(e));
     }
   });
```

## Probarlo a mano

```bash
TOKEN=<el token del login>
# El primero entra…
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"nombre": "TARTA DE FRUTILLA", "precio": 9000, "categoria": "Dulce"}' http://localhost:3000/api/productos
# …y el mismo nombre en minúsculas → 409
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"nombre": "tarta de frutilla", "precio": 9000, "categoria": "Dulce"}' http://localhost:3000/api/productos
```

## Checklist para el front

- [ ] El `409` marca el error en el campo Nombre, en el alta y en la edición.
- [ ] En el celular:
  - [ ] Crear "TARTA DE FRUTILLA".
  - [ ] Intentar crear "tarta de frutilla": el error aparece en el campo.
  - [ ] Pausar uno, intentar crearlo de nuevo y leer el aviso de que está pausado.
- [ ] `npx tsc --noEmit`.
