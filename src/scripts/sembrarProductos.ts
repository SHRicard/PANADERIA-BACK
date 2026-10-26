import 'dotenv/config';
import mongoose from 'mongoose';
import { credencialesFaltantes } from '../config/cloudinary';
import { conectarDB } from '../config/db';
import { borrarDeCloudinary, copiarEnCloudinary } from '../middleware/upload';
import { IProducto, Producto, SIN_MAYUSCULAS_NI_ACENTOS } from '../models/Producto';

// Carga productos de ejemplo para probar el catálogo público: npm run sembrar
// Las fotos son copias de las que ya tienen los productos cargados: cada producto necesita las suyas,
// porque al eliminarlo se borran sus fotos de Cloudinary. Si un nombre ya existe, lo saltea: se puede
// correr más de una vez sin duplicar nada

// Sin tipo: los tipos los arma el dueño en cada base
type Semilla = Omit<IProducto, 'tipo' | 'imagenes' | 'recomendaciones' | 'puntajePromedio' | 'cantidadRecomendaciones'> & {
  fotos: number;
};

// Variados a propósito: todos los gustos, uno con 10 fotos (el máximo), uno sin fotos, uno pausado,
// con y sin descripción ni peso, y uno sin anticipación (se pide en el momento)
const SEMILLAS: Semilla[] = [
  {
    nombre: 'TARTA DE FRUTILLA',
    categoria: 'Dulce',
    precio: 12000,
    anticipacionHoras: 48,
    pesoGramos: 900,
    descripcion: 'Masa sablé, crema pastelera y frutillas frescas. Rinde 8 porciones.',
    ingredientes: ['harina', 'manteca', 'azúcar', 'huevos', 'leche', 'frutillas'],
    disponible: true,
    fotos: 10,
  },
  {
    nombre: 'TARTA DE COCO',
    categoria: 'Dulce',
    precio: 9500,
    anticipacionHoras: 48,
    pesoGramos: 800,
    descripcion: 'Base de masa dulce con dulce de leche y coco tostado.',
    ingredientes: ['harina', 'manteca', 'coco rallado', 'dulce de leche', 'huevos'],
    disponible: true,
    fotos: 3,
  },
  {
    nombre: 'TARTA MIXTA',
    categoria: 'Dulce',
    precio: 10500,
    anticipacionHoras: 48,
    ingredientes: ['harina', 'manteca', 'dulce de leche', 'coco rallado', 'merengue'],
    disponible: true,
    fotos: 1,
  },
  {
    nombre: 'TARTA DE FRUTA DE ESTACIÓN',
    categoria: 'Agridulce',
    precio: 11500,
    anticipacionHoras: 48,
    pesoGramos: 850,
    descripcion: 'Con la fruta que esté en temporada: preguntá cuál hay hoy.',
    ingredientes: ['harina', 'manteca', 'crema pastelera', 'frutas de estación'],
    disponible: true,
    fotos: 2,
  },
  {
    nombre: 'LEMON PIE',
    categoria: 'Ácido',
    precio: 11000,
    anticipacionHoras: 24,
    pesoGramos: 750,
    descripcion: 'Crema de limón y merengue italiano gratinado.',
    ingredientes: ['harina', 'manteca', 'limón', 'huevos', 'azúcar'],
    disponible: true,
    fotos: 2,
  },
  {
    nombre: 'CHIPS CON SEMILLA',
    categoria: 'Salado',
    precio: 4500,
    anticipacionHoras: 24,
    pesoGramos: 400,
    descripcion: 'Docena de chips con semillas de sésamo y amapola.',
    ingredientes: ['harina', 'leche', 'manteca', 'levadura', 'sésamo', 'amapola'],
    disponible: true,
    fotos: 2,
  },
  {
    nombre: 'CHIPS SIMPLE',
    categoria: 'Salado',
    precio: 4000,
    anticipacionHoras: 24,
    pesoGramos: 380,
    descripcion: 'Docena de chips, ideales para sándwiches.',
    ingredientes: ['harina', 'leche', 'manteca', 'levadura'],
    disponible: true,
    fotos: 0,
  },
  {
    nombre: 'BROWNIE AMARGO',
    categoria: 'Amargo',
    precio: 7000,
    anticipacionHoras: 24,
    pesoGramos: 500,
    ingredientes: ['chocolate 70%', 'manteca', 'azúcar', 'huevos', 'nueces'],
    disponible: true,
    fotos: 1,
  },
  {
    nombre: 'CHIPÁ PICANTE',
    categoria: 'Picante',
    precio: 5000,
    anticipacionHoras: 0,
    pesoGramos: 300,
    descripcion: 'Docena de chipá con queso y ají molido.',
    ingredientes: ['almidón de mandioca', 'queso', 'huevo', 'ají molido'],
    disponible: true,
    fotos: 1,
  },
  {
    nombre: 'PAN DULCE CON FRUTAS',
    categoria: 'Dulce',
    precio: 14000,
    anticipacionHoras: 72,
    pesoGramos: 1000,
    descripcion: 'Pan dulce artesanal con frutas abrillantadas y nueces. Solo en Navidad.',
    ingredientes: ['harina', 'manteca', 'azúcar', 'huevos', 'frutas abrillantadas', 'nueces'],
    disponible: false,
    fotos: 2,
  },
];

async function main() {
  const faltan = credencialesFaltantes();
  if (faltan.length) throw new Error(faltan.join('\n'));

  await conectarDB();
  await Producto.init(); // el índice de nombre único, por si la base es nueva

  const origenes = (await Producto.find({ 'imagenes.0': { $exists: true } }).select('imagenes')).flatMap((producto) =>
    producto.imagenes.map((imagen) => imagen.url)
  );
  if (!origenes.length) throw new Error('No hay fotos para copiar: cargá primero un producto con fotos desde la app');

  let siguiente = 0;
  let creados = 0;
  for (const { fotos, ...datos } of SEMILLAS) {
    if (await Producto.exists({ nombre: datos.nombre }).collation(SIN_MAYUSCULAS_NI_ACENTOS)) {
      console.log(`· ${datos.nombre}: ya existe, lo salteo`);
      continue;
    }

    // Va rotando entre las fotos que hay, para que no todos tengan la misma portada
    const copias = await Promise.allSettled(
      Array.from({ length: fotos }, () => copiarEnCloudinary(origenes[siguiente++ % origenes.length], 'productos'))
    );
    const imagenes = copias.flatMap((copia) => (copia.status === 'fulfilled' ? [copia.value] : []));
    try {
      const fallida = copias.find((copia) => copia.status === 'rejected');
      if (fallida) throw fallida.reason;
      await Producto.create({ ...datos, imagenes });
    } catch (e) {
      // Que no queden fotos huérfanas de un producto que no se creó
      await Promise.all(imagenes.map((imagen) => borrarDeCloudinary(imagen.publicId)));
      throw e;
    }
    creados++;
    console.log(`✓ ${datos.nombre} (${datos.categoria}${datos.disponible ? '' : ', pausado'}): ${fotos === 1 ? '1 foto' : `${fotos} fotos`}`);
  }

  console.log(`\nListo: ${creados} productos nuevos de ${SEMILLAS.length}`);
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
