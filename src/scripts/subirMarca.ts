import 'dotenv/config';
import { existsSync } from 'node:fs';
import path from 'node:path';
import cloudinary, { credencialesFaltantes, describirErrorCloudinary, ID_MARCA_POR_DEFECTO } from '../config/cloudinary';

// Sube (o reemplaza) el logo que se graba como marca de agua en las fotos: npm run subir-marca [ruta-al-png]
const RUTA_POR_DEFECTO = 'assets/marca-blanca-sin-flor-sombra.png';

async function main() {
  const faltan = credencialesFaltantes();
  if (faltan.length) throw new Error(faltan.join('\n'));

  const ruta = path.resolve(process.argv[2] ?? RUTA_POR_DEFECTO);
  if (!existsSync(ruta)) throw new Error(`No existe el archivo ${ruta}`);

  const idEnElEnv = process.env.CLOUDINARY_WATERMARK_ID?.trim();
  const resultado = await cloudinary.uploader.upload(ruta, {
    public_id: idEnElEnv || ID_MARCA_POR_DEFECTO,
    resource_type: 'image',
    overwrite: true,
    // Borra de la CDN el logo anterior, si había
    invalidate: true,
  });

  console.log(`Logo subido a Cloudinary con el id "${resultado.public_id}"`);
  if (!idEnElEnv) {
    console.log(`Para que se grabe en las fotos, agregá CLOUDINARY_WATERMARK_ID=${resultado.public_id} al .env`);
  }
}

main().catch((e) => {
  // Nunca el error entero: los de Cloudinary traen las claves
  console.error(e instanceof Error && !('http_code' in e) ? e.message : `Cloudinary: ${describirErrorCloudinary(e)}`);
  process.exit(1);
});
