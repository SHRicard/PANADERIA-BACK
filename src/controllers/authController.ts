import { Request, Response } from 'express';
import * as authService from '../services/authService';

const PASSWORD_MIN = 8;
// bcrypt ignora lo que pase de 72 bytes
const PASSWORD_MAX = 72;

function leerEmail(valor: unknown): string | undefined {
  if (typeof valor !== 'string') return undefined;
  const email = valor.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : undefined;
}

// POST /api/auth/login  { usuario, password }  →  { token }
export async function login(req: Request, res: Response) {
  const { usuario, password } = req.body ?? {};
  if (typeof usuario !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Usuario y contraseña requeridos' });
  }

  res.json({ token: await authService.iniciarSesion(usuario, password) });
}

// POST /api/auth/recuperar  { email }
// Responde siempre lo mismo, exista o no el email, para no revelar cuál está registrado
export async function recuperar(req: Request, res: Response) {
  const email = leerEmail(req.body?.email);
  if (!email) {
    return res.status(400).json({ error: 'Ingresá un email válido' });
  }

  await authService.solicitarRecuperacion(email);
  res.json({ mensaje: 'Si el email está registrado, te mandamos un código para restablecer la contraseña' });
}

// POST /api/auth/restablecer  { email, codigo, password }  →  { token }
export async function restablecer(req: Request, res: Response) {
  const email = leerEmail(req.body?.email);
  const { codigo, password } = req.body ?? {};
  if (!email || typeof codigo !== 'string' || !/^\d{6}$/.test(codigo)) {
    return res.status(400).json({ error: 'Código inválido o vencido' });
  }
  if (typeof password !== 'string' || password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
    return res
      .status(400)
      .json({ error: `La contraseña tiene que tener entre ${PASSWORD_MIN} y ${PASSWORD_MAX} caracteres` });
  }

  res.json({ token: await authService.restablecerPassword(email, codigo, password) });
}
