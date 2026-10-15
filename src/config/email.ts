import nodemailer from 'nodemailer';

// SMTP para mandar el código de recuperación de contraseña (con Gmail: contraseña de aplicación).
// Es opcional: sin estas variables la API anda igual, solo no se puede recuperar la contraseña por email.
const host = process.env.SMTP_HOST;
const usuario = process.env.SMTP_USER;
const clave = process.env.SMTP_PASS;
const puerto = Number(process.env.SMTP_PORT) || 465;

const transporte =
  host && usuario && clave
    ? nodemailer.createTransport({ host, port: puerto, secure: puerto === 465, auth: { user: usuario, pass: clave } })
    : null;

export function emailConfigurado(): boolean {
  return transporte !== null;
}

export async function enviarCodigoRecuperacion(destino: string, codigo: string, minutos: number): Promise<void> {
  if (!transporte) throw new Error('El envío de emails no está configurado');

  await transporte.sendMail({
    from: process.env.EMAIL_FROM || usuario,
    to: destino,
    subject: `${codigo} es tu código de Panadería Digital`,
    text: [
      `Tu código para restablecer la contraseña de Panadería Digital es: ${codigo}`,
      '',
      `Vence en ${minutos} minutos y sirve una sola vez.`,
      'Si no lo pediste, ignorá este email: tu contraseña no cambia.',
    ].join('\n'),
  });
}
