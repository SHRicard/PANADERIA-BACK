import 'dotenv/config';
import mongoose from 'mongoose';
import cloudinary, { describirErrorCloudinary } from '../config/cloudinary';
import { conectarDB } from '../config/db';
import { Producto } from '../models/Producto';

// Pasa a NUESTRO Cloudinary (el del .env) las fotos de productos que apuntan a otra cuenta: npm run copiar-fotos
// Es para la demo, después de traer el catálogo de producción (que usa el Cloudinary del cliente): sin esto, la demo
// mostraría y gastaría las fotos del cliente, y no serían suyas para borrar. Cada foto se sube por su URL pública
// (no hacen falta las credenciales del cliente) y sin transformación, porque ya trae la marca grabada; después se
// guardan la url y el publicId nuevos. Solo toca las fotos que siguen siendo de otra cuenta: si algo falla, se vuelve
// a correr. ❌ No corre en producción: ahí movería las fotos del cliente a la cuenta del .env.

const BASE_DE_PRODUCCION = 'panaderia-producion';

async function main() {
  await conectarDB();
  const base = mongoose.connection.name;
  if (base === BASE_DE_PRODUCCION) throw new Error(`«${base}» es la base de producción: este script es para la demo`);
  console.log(`Base: ${base}`);

  const nuestra = `https://res.cloudinary.com/${cloudinary.config().cloud_name}/`;
  const productos = await Producto.find({ 'imagenes.0': { $exists: true } })
    .select('nombre imagenes')
    .sort({ nombre: 1 })
    .lean();

  let copiadas = 0;
  let yaEran = 0;
  let fallaron = 0;

  for (const producto of productos) {
    const deOtra = producto.imagenes.filter((foto) => !foto.url.startsWith(nuestra));
    yaEran += producto.imagenes.length - deOtra.length;
    if (deOtra.length === 0) continue;

    let deEste = 0;
    for (const foto of deOtra) {
      try {
        const copia = await cloudinary.uploader.upload(foto.url, { folder: 'panaderia/productos', resource_type: 'image' });
        // Condicionado a la url de antes: si la foto se borró o ya se copió mientras tanto, no se pisa
        const { modifiedCount } = await Producto.updateOne(
          { _id: producto._id, 'imagenes.url': foto.url },
          { $set: { 'imagenes.$.url': copia.secure_url, 'imagenes.$.publicId': copia.public_id } },
          { timestamps: false }
        );
        if (modifiedCount === 0) {
          // La copia no quedó en ningún producto: se borra para que no quede huérfana
          await cloudinary.uploader.destroy(copia.public_id, { resource_type: 'image' });
          continue;
        }
        deEste++;
      } catch (e) {
        fallaron++;
        console.error(`  ✖ «${producto.nombre}», ${foto.url}: ${describirErrorCloudinary(e)}`);
      }
    }
    copiadas += deEste;
    console.log(`  ✔ «${producto.nombre}»: ${deEste} de ${deOtra.length} fotos copiadas`);
  }

  // La cuenta final sale de la base, no de lo que se hizo: es lo que va a ver la app
  const quedan = (await Producto.find({ 'imagenes.0': { $exists: true } }).select('imagenes.url').lean())
    .flatMap((producto) => producto.imagenes)
    .filter((foto) => !foto.url.startsWith(nuestra)).length;

  console.log(`\n${copiadas} fotos copiadas a tu Cloudinary · ${yaEran} ya eran tuyas · ${fallaron} fallaron`);
  if (quedan > 0) {
    console.error(`Quedan ${quedan} fotos apuntando a otra cuenta: volvé a correr npm run copiar-fotos`);
    process.exitCode = 1;
  } else {
    console.log('Ninguna foto apunta a otra cuenta de Cloudinary');
  }
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
