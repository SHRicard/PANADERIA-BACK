import 'dotenv/config';
import mongoose from 'mongoose';
import { conectarDB } from '../config/db';
import { Producto } from '../models/Producto';

// Les pone 24 hs de anticipación a los productos cargados antes de que existiera el campo: npm run migrar-anticipacion
// Sin esto no se pueden editar (la anticipación es obligatoria y se valida el producto entero al guardarlo).
// Solo toca los que no la tienen: se puede correr más de una vez
const HORAS_POR_DEFECTO = 24;

async function main() {
  await conectarDB();
  const { modifiedCount } = await Producto.updateMany(
    { anticipacionHoras: { $exists: false } },
    { $set: { anticipacionHoras: HORAS_POR_DEFECTO } },
    // No es una edición del dueño: no le cambia la fecha de modificación
    { timestamps: false }
  );
  console.log(`${modifiedCount} productos quedaron con ${HORAS_POR_DEFECTO} hs de anticipación`);
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
