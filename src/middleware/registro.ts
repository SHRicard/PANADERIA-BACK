import { NextFunction, Request, Response } from 'express';
import { ZONA_ARGENTINA } from '../utils/fecha';

// Una línea por petición en la terminal (y en los logs de Render), para ver qué se usa y qué falla:
//   12:04:31 ✔ 200 GET    /api/productos 38 ms
//   12:04:40 ✖ 400 POST   /api/pedidos 12 ms → Elegí el día de entrega
// ❌ Sin body, sin query y sin headers: ahí viajan nombres y teléfonos de clientes, el token y las contraseñas.

const conColor = Boolean(process.stdout.isTTY);
const pintar = (codigo: number, texto: string) => (conColor ? `\x1b[${codigo}m${texto}\x1b[0m` : texto);
const VERDE = 32;
const AMARILLO = 33;
const ROJO = 31;
const GRIS = 90;

// En Render el reloj está en UTC: la hora sale siempre en la de Argentina
const hora = new Intl.DateTimeFormat('es-AR', {
  timeZone: ZONA_ARGENTINA,
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

const anotados = new WeakMap<Response, string>();

// Para el manejador de errores de index.ts, cuando lo que se respondió no sirve en el log (el 500 genérico)
// o no se puede loguear (el mensaje de un error de Mongoose trae los valores, que pueden ser de un cliente)
export function anotarError(res: Response, motivo: string) {
  anotados.set(res, motivo);
}

function errorDelCuerpo(cuerpo: unknown): string | undefined {
  if (cuerpo && typeof cuerpo === 'object' && 'error' in cuerpo && typeof cuerpo.error === 'string') {
    return cuerpo.error;
  }
  return undefined;
}

export function registrarPeticiones(req: Request, res: Response, next: NextFunction) {
  const inicio = performance.now();
  let respondido: string | undefined;

  // Todas las respuestas de error son { error: mensaje } (también las de rate limit): se guarda el mensaje
  const json = res.json.bind(res);
  res.json = (cuerpo?: unknown) => {
    if (res.statusCode >= 400) respondido = errorDelCuerpo(cuerpo);
    return json(cuerpo);
  };

  // 'close' llega siempre; 'finish' no, si el cliente corta antes (por ejemplo, una foto que no terminó de subir)
  res.on('close', () => {
    const ruta = req.originalUrl.split('?')[0];
    const cortada = !res.writableFinished;
    const codigo = res.statusCode;
    // El ping de mantenimiento y el preflight del navegador llenarían la terminal: solo si fallan
    if (!cortada && codigo < 400 && (ruta === '/health' || req.method === 'OPTIONS')) return;

    const color = cortada ? AMARILLO : codigo >= 500 ? ROJO : codigo >= 400 ? AMARILLO : VERDE;
    const marca = cortada ? '⚠' : codigo >= 400 ? '✖' : '✔';
    const motivo = cortada
      ? 'se cortó antes de responder'
      : codigo >= 400
        ? (anotados.get(res) ?? respondido ?? (codigo === 404 ? 'esa ruta no existe' : undefined))
        : undefined;

    const partes = [
      pintar(GRIS, hora.format(new Date())),
      pintar(color, `${marca} ${cortada ? '---' : codigo}`),
      req.method.padEnd(6),
      ruta,
      pintar(GRIS, `${Math.round(performance.now() - inicio)} ms`),
    ];
    if (motivo) partes.push(pintar(color, `→ ${motivo}`));
    console.log(partes.join(' '));
  });

  next();
}
