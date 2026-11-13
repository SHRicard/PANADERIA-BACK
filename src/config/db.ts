import mongoose from 'mongoose';
import { crearIndices, guardarLogs } from './entorno';

export async function conectarDB() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('Falta MONGODB_URI en el archivo .env');
  // Los índices y las colecciones que falten se crean solo en Render: desde la compu no se toca la base real (entorno.ts)
  await mongoose.connect(uri, { autoIndex: crearIndices, autoCreate: crearIndices });
  console.log(`MongoDB conectado${crearIndices ? '' : ' (sin crear índices)'}${guardarLogs ? '' : ' · los logs no se guardan (solo en la terminal)'}`);
}
