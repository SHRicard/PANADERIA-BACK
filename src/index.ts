import 'dotenv/config';
import express, { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import mongoose from 'mongoose';
import multer from 'multer';
import { comprobarMarca, problemasDeConfiguracion } from './config/cloudinary';
import { conectarDB } from './config/db';
import { mensajeDeMulter } from './middleware/upload';
import ajustesRoutes from './routes/ajustes';
import almacenamientoRoutes from './routes/almacenamiento';
import authRoutes from './routes/auth';
import carritoRoutes from './routes/carrito';
import catalogoRoutes from './routes/catalogo';
import clientesRoutes from './routes/clientes';
import datosPagoRoutes from './routes/datosPago';
import insumosRoutes from './routes/insumos';
import metricasRoutes from './routes/metricas';
import pedidosRoutes from './routes/pedidos';
import productosRoutes from './routes/productos';
import promosRoutes from './routes/promos';
import { ErrorHttp } from './utils/errores';

const app = express();

// Render (y otros hosts) usan un proxy delante de la app
app.set('trust proxy', 1);

app.use(helmet());

// La web en desarrollo (Vite) y en Vercel van fijas; CORS_ORIGINS suma otros sin tener que redeployar
const origenesPermitidos = [
  'http://localhost:5173',
  'https://panaderia-front-psi.vercel.app',
  ...(process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
];

app.use(
  cors({
    origin: (origin, cb) => {
      // Sin "origin" = app móvil (APK) o herramientas como curl: se permite
      if (!origin || origenesPermitidos.includes(origin)) return cb(null, true);
      cb(new ErrorHttp(403, 'Origen no permitido por CORS'));
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

// Van antes del express.json() global: traen su propio parser con límite de 10kb para las rutas públicas
app.use('/api/pedidos', pedidosRoutes);
app.use('/api/carrito', carritoRoutes);
app.use('/api/catalogo', catalogoRoutes);

app.use(express.json());

// Endpoint liviano para el ping que mantiene despierto el backend en Render
app.get('/health', (_req, res) => res.send('ok'));

app.use('/api/auth', authRoutes);
app.use('/api/productos', productosRoutes);
app.use('/api/promos', promosRoutes);
app.use('/api/clientes', clientesRoutes);
app.use('/api/ajustes', ajustesRoutes);
app.use('/api/datos-pago', datosPagoRoutes);
app.use('/api/insumos', insumosRoutes);
app.use('/api/almacenamiento', almacenamientoRoutes);
app.use('/api/metricas', metricasRoutes);

// Manejo de errores (incluye errores de multer, de Cloudinary, de Mongoose y del parser de JSON)
app.use((err: Error & { status?: number; type?: string }, _req: Request, res: Response, _next: NextFunction) => {
  // Errores esperados que tiran los servicios: no son fallas del servidor, no se loguean
  if (err instanceof ErrorHttp) {
    return res.status(err.status).json({ error: err.message });
  }
  // Errores del parser de JSON (body roto o demasiado grande): no se loguean porque traen el body crudo,
  // y ahí viajan nombres y teléfonos de clientes
  if (err.type && err.status && err.status < 500) {
    const mensaje =
      err.status === 413 ? 'El cuerpo de la petición es demasiado grande' : 'El cuerpo de la petición no es un JSON válido';
    return res.status(err.status).json({ error: mensaje });
  }
  // Datos que no cumplen el esquema (precio negativo, número inválido) o imagen rechazada por Multer
  // (más de 5 MB): son errores de la petición, no del servidor
  if (err instanceof mongoose.Error.ValidationError || err instanceof mongoose.Error.CastError) {
    return res.status(400).json({ error: err.message });
  }
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: mensajeDeMulter(err) });
  }
  // Cualquier otra cosa es una falla del servidor (la base no responde, Cloudinary rechazó la subida…).
  // Se loguea entera, pero al cliente le llega un mensaje genérico: el técnico puede traer datos internos
  console.error(err);
  res.status(500).json({ error: 'Algo falló en el servidor. Probá de nuevo en unos minutos.' });
});

// Express 5 pasa los errores de las rutas async al manejador de arriba; esto es una red de seguridad
process.on('unhandledRejection', (e) => console.error('unhandledRejection', e));

const puerto = Number(process.env.PORT) || 3000;

if (!process.env.JWT_SECRET) {
  console.error('Falta JWT_SECRET en el .env');
  process.exit(1);
}

// Sin Cloudinary no se pueden subir fotos: se corta acá y no en la primera subida
const problemasCloudinary = problemasDeConfiguracion();
if (problemasCloudinary.length) {
  problemasCloudinary.forEach((problema) => console.error(problema));
  process.exit(1);
}

conectarDB()
  .then(() => {
    // 0.0.0.0: todas las interfaces, como pide Render para detectar el puerto
    app.listen(puerto, '0.0.0.0', () => console.log(`API escuchando en el puerto ${puerto}`));
    // No se espera: en Render cada segundo de arranque cuenta, y si falta el logo solo avisa
    comprobarMarca();
  })
  .catch((e) => {
    console.error('No se pudo conectar a MongoDB:', e.message);
    process.exit(1);
  });
