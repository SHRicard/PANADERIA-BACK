import { randomInt } from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { emailConfigurado, enviarCodigoRecuperacion } from '../config/email';
import { Admin } from '../models/Admin';
import { ErrorHttp } from '../utils/errores';

const MINUTOS_CODIGO = 15;
const INTENTOS_POR_CODIGO = 5;

function firmarToken(admin: { id: string; usuario: string }): string {
  return jwt.sign({ id: admin.id, usuario: admin.usuario }, process.env.JWT_SECRET as string, {
    expiresIn: '30d',
  });
}

// Tira si el token no es válido o ya venció
export function verificarToken(token: string): void {
  jwt.verify(token, process.env.JWT_SECRET as string);
}

export async function iniciarSesion(usuario: string, password: string): Promise<string> {
  const admin = await Admin.findOne({ usuario });
  const ok = admin ? await bcrypt.compare(password, admin.passwordHash) : false;
  if (!admin || !ok) {
    throw new ErrorHttp(401, 'Usuario o contraseña incorrectos');
  }
  return firmarToken(admin);
}

// Si el email no es del admin no hace nada y no avisa: así no se revela qué email está registrado
export async function solicitarRecuperacion(email: string): Promise<void> {
  if (!emailConfigurado()) {
    throw new ErrorHttp(503, 'La recuperación por email no está configurada');
  }

  const admin = await Admin.findOne({ email });
  if (!admin) return;

  const codigo = randomInt(0, 1_000_000).toString().padStart(6, '0');
  admin.recuperacion = {
    codigoHash: await bcrypt.hash(codigo, 10),
    venceEn: new Date(Date.now() + MINUTOS_CODIGO * 60 * 1000),
    intentos: 0,
  };
  await admin.save();

  try {
    await enviarCodigoRecuperacion(email, codigo, MINUTOS_CODIGO);
  } catch (e) {
    // El error de nodemailer puede traer datos del servidor SMTP: al cliente le llega un mensaje genérico
    console.error('No se pudo enviar el email de recuperación:', e instanceof Error ? e.message : e);
    throw new ErrorHttp(502, 'No se pudo enviar el email. Probá de nuevo en unos minutos.');
  }
}

// Canjea el código por una contraseña nueva y devuelve un token, así la app entra directo
export async function restablecerPassword(email: string, codigo: string, password: string): Promise<string> {
  // El intento se cuenta antes de comparar y de forma atómica: dos pedidos a la vez no se saltean el límite
  const admin = await Admin.findOneAndUpdate(
    {
      email,
      'recuperacion.venceEn': { $gt: new Date() },
      'recuperacion.intentos': { $lt: INTENTOS_POR_CODIGO },
    },
    { $inc: { 'recuperacion.intentos': 1 } },
    { returnDocument: 'after' }
  );
  const ok = admin?.recuperacion ? await bcrypt.compare(codigo, admin.recuperacion.codigoHash) : false;
  if (!admin || !ok) {
    throw new ErrorHttp(400, 'Código inválido o vencido');
  }

  admin.passwordHash = await bcrypt.hash(password, 12);
  admin.recuperacion = undefined;
  await admin.save();

  return firmarToken(admin);
}
