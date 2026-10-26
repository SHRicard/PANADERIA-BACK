import 'dotenv/config';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { conectarDB } from '../config/db';
import { Admin } from '../models/Admin';

// Crea (o actualiza la contraseña y el email de) un admin: npm run crear-admin. La app tiene dos: el del .env y el
// otro, pasando ADMIN_USER, ADMIN_PASSWORD y ADMIN_EMAIL en el comando (dotenv no pisa lo que ya viene en el entorno)
async function main() {
  const usuario = process.env.ADMIN_USER;
  const password = process.env.ADMIN_PASSWORD;
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  if (!usuario || !password) throw new Error('Definí ADMIN_USER y ADMIN_PASSWORD en el .env');

  await conectarDB();
  const passwordHash = await bcrypt.hash(password, 12);
  await Admin.findOneAndUpdate({ usuario }, { usuario, passwordHash, ...(email && { email }) }, { upsert: true });
  console.log(`Usuario "${usuario}" listo`);
  if (!email) console.log('Sin ADMIN_EMAIL en el .env: no va a poder recuperar la contraseña por email');
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
