# Productos y fotos: qué se hizo

Resumen de lo que se armó en el back para que el dueño de la panadería cargue sus productos con fotos desde la app. El detalle técnico de cada parte está en los documentos del final.

## En pocas palabras

- El dueño puede **crear, ver, editar, pausar y eliminar** productos desde la app.
- Cada producto puede tener **hasta 10 fotos**, que se guardan en **Cloudinary** con la **marca de agua de la panadería**.
- Las fotos se suben **en segundo plano**: el dueño guarda el producto y sigue usando la app mientras suben.
- La lista de productos viene **de a páginas**, con **búsqueda por nombre** y **filtros**.

## Productos

### Qué datos tiene un producto

| Campo | Cómo es |
|---|---|
| Nombre | Obligatorio y **único**: no puede haber dos productos con el mismo nombre, aunque cambien las mayúsculas, los acentos o los espacios |
| Precio | Obligatorio, **mayor que 0** |
| Gusto | Obligatorio, de una lista fija: Dulce, Salado, Agridulce, Ácido, Amargo o Picante |
| Estado | **Activo** (se ve en la web y se puede pedir) o **Pausado** |
| Descripción | Opcional |
| Ingredientes | Opcional, una lista |
| Peso en gramos | Opcional, **mayor que 0** |
| Fotos | De 0 a 10. La primera es la **portada** |

### Cómo se crea un producto

1. El dueño completa el formulario y elige las fotos (de la galería o con la cámara).
2. Al tocar **Guardar**, la app crea el producto **solo con los datos**. Es instantáneo.
3. Las fotos se suben **después, en segundo plano**: primero la portada y después el resto, **de a 2**. Si una falla, se reintenta, y si no sube, queda marcada para reintentarla o descartarla.
4. El dueño vuelve a la lista y puede seguir trabajando. Cada foto aparece en el producto apenas termina de subir.

### Lo que se puede hacer con un producto

- **Ver el detalle**, aunque esté pausado.
- **Editar** solo lo que cambió. La descripción y el peso se pueden borrar.
- **Fotos:** agregar más (hasta 10), borrar una o elegir otra de portada.
- **Pausar o activar** con un toque. Es para los productos de temporada, como el pan dulce: uno pausado no se ve en la web ni se puede pedir, pero conserva sus datos y sus fotos.
- **Eliminar:** borra el producto **y todas sus fotos** de Cloudinary. No tiene vuelta atrás, por eso conviene pausar.

### La lista

- Viene **de a 20 productos**, y la app trae los siguientes al bajar.
- Se puede **buscar por nombre** sin importar mayúsculas ni acentos: "sandwich" encuentra "Sándwich de miga".
- Se puede **filtrar** por estado (todos, activos o pausados) y por gusto.
- Sale ordenada por gusto y, dentro de cada gusto, por nombre.

### Pensado para las métricas

Cada pedido guarda el **nombre, el precio y el gusto** de cada producto **al momento de la venta**. Así, más adelante se va a poder ver qué producto y qué gusto se venden más, aunque un producto cambie o se elimine. Por eso el nombre es único y el gusto sale de una lista fija.

## Fotos con Cloudinary

### Límites

| Límite | Valor |
|---|---|
| Fotos por producto | **Hasta 10.** Se respeta aunque lleguen varias a la vez: si se mandan 12 juntas, entran 10 |
| Peso de cada foto | Hasta **10 MB** |
| Tipo de archivo | Solo imágenes |

### Qué pasa con cada foto

- **Se achica a 1200 px como máximo** y se comprime en calidad automática. Así carga rápido en el celular.
- **Lleva la marca de agua grabada.** El logo de la panadería se pega al subirla, y Cloudinary guarda **solo esa versión**. Como el original no se guarda, nadie puede bajar la foto sin la marca.
- **La API devuelve cada foto en dos tamaños:**
  - `url`, la foto optimizada para verla grande;
  - `miniatura`, de 400 px, para las listas.
- **La primera foto es la portada**, la que se ve en el catálogo. Se puede elegir otra.

### Nunca quedan fotos sueltas

Cloudinary no se llena de fotos que no usa nadie:

- **Si algo falla al guardar** (por ejemplo, un dato inválido o un nombre repetido), las fotos recién subidas se borran.
- **Al borrar una foto o un producto**, también se borra de Cloudinary.
- **Si Cloudinary falla al borrar**, la operación sigue y queda anotado en el log qué foto hay que borrar a mano.

### La marca de agua

- **El logo se sube una sola vez** con `npm run subir-marca`, y también cuando cambia.
- **Productos:** la posición (centro o esquina), el tamaño y la transparencia se configuran con las variables `WATERMARK_POSICION`, `WATERMARK_ANCHO` y `WATERMARK_OPACIDAD`. Están en `.env.example`.
- **Promos:** usan el mismo logo, siempre en la esquina y más chico.

## Rutas de la API

Todas las de productos son **privadas**: piden el token del dueño.

| Para qué | Ruta |
|---|---|
| Listar (con páginas y filtros) | `GET /api/productos` |
| Ver uno | `GET /api/productos/:id` |
| Crear | `POST /api/productos` |
| Editar | `PUT /api/productos/:id` |
| Eliminar (con sus fotos) | `DELETE /api/productos/:id` |
| Agregar una foto | `POST /api/productos/:id/imagenes` |
| Borrar una foto | `DELETE /api/productos/:id/imagenes/:imagenId` |
| Cambiar la portada | `PUT /api/productos/:id/portada` |

Del lado **público**, lo que ve el cliente en la web: `GET /api/catalogo` (solo productos activos, con la portada), `GET /api/catalogo/:id` y `GET /api/catalogo/categorias` (los gustos).

## Configuración

Hacen falta las credenciales de Cloudinary (`CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY` y `CLOUDINARY_API_SECRET`). Sin ellas, el servidor **no arranca** y avisa qué falta. `./run.sh` revisa todo antes de levantar, incluido que el logo de la marca esté subido.

## Cómo se probó

- **Contra Cloudinary real:**
  - se revisó a ojo la marca de agua en productos y promos;
  - se probó el circuito completo (crear, subir, cambiar la portada, borrar) y se comprobó que no quedaran fotos sueltas.
- **Contra una base de datos de prueba:**
  - el CRUD completo;
  - el tope de 10 fotos con subidas simultáneas;
  - el nombre único con altas simultáneas;
  - el paginado, los filtros y los gustos.

## Más detalle

- [producto.md](producto.md): el CRUD de productos.
- [up-cloudinary.md](up-cloudinary.md): las fotos y la subida en segundo plano.
- [paginado-productos.md](paginado-productos.md): la lista paginada, los filtros y el estado activo/pausado.
- [gustos.md](gustos.md): los gustos y cómo los guardan los pedidos.
- [nombre-unico.md](nombre-unico.md): el nombre único.
