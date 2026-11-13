import { NextFunction, Request, Response } from 'express';
import { verificarToken } from '../services/authService';
import { guardarLogs } from '../config/entorno';
import { registrar } from '../services/logsService';
import { ZONA_ARGENTINA } from '../utils/fecha';

// Una línea por petición en la terminal (y en los logs de Render), para ver qué se usa y qué falla:
//   12:04:31 ✔ 200 GET    /api/productos 38 ms
//   12:04:40 ✖ 400 POST   /api/pedidos 12 ms → Elegí el día de entrega
// Y la misma línea, con la IP, se guarda en la colección logs (logsService: el apartado Logs de la app y los avisos)
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

// Si viene con un token de admin válido (la app del dueño), en cualquier ruta, también en las públicas
function esAdmin(req: Request): boolean {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return false;
  try {
    verificarToken(header.slice(7));
    return true;
  } catch {
    return false;
  }
}

function idDelCuerpo(cuerpo: unknown): string | undefined {
  if (cuerpo && typeof cuerpo === 'object' && 'id' in cuerpo && typeof cuerpo.id === 'string') return cuerpo.id;
  return undefined;
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
  let pedido: string | undefined;
  const ruta = req.originalUrl.split('?')[0];

  // Todas las respuestas de error son { error: mensaje } (también las de rate limit): se guarda el mensaje.
  // Del pedido que hizo un cliente, solo el id: el log no copia su nombre (se busca al leer, logsService)
  const json = res.json.bind(res);
  res.json = (cuerpo?: unknown) => {
    if (res.statusCode >= 400) respondido = errorDelCuerpo(cuerpo);
    else if (req.method === 'POST' && ruta === '/api/pedidos') pedido = idDelCuerpo(cuerpo);
    return json(cuerpo);
  };

  // 'close' llega siempre; 'finish' no, si el cliente corta antes (por ejemplo, una foto que no terminó de subir)
  res.on('close', () => {
    const cortada = !res.writableFinished;
    const codigo = res.statusCode;
    // El ping de mantenimiento y el preflight del navegador llenarían la terminal: solo si fallan
    if (!cortada && codigo < 400 && (ruta === '/health' || req.method === 'OPTIONS')) return;

    const color = cortada ? AMARILLO : codigo >= 500 ? ROJO : codigo >= 400 ? AMARILLO : VERDE;
    const marca = cortada ? '⚠' : codigo >= 400 ? '✖' : '✔';
    // Un 404 sin { error } es el de Express: la ruta no existe (no un producto o un pedido que no está)
    const rutaInexistente = !cortada && codigo === 404 && !anotados.has(res) && respondido === undefined;
    const motivo = cortada
      ? 'se cortó antes de responder'
      : codigo >= 400
        ? (anotados.get(res) ?? respondido ?? (rutaInexistente ? 'esa ruta no existe' : undefined))
        : undefined;
    const ms = performance.now() - inicio;

    const partes = [
      pintar(GRIS, hora.format(new Date())),
      pintar(color, `${marca} ${cortada ? '---' : codigo}`),
      req.method.padEnd(6),
      ruta,
      pintar(GRIS, `${Math.round(ms)} ms`),
    ];
    if (motivo) partes.push(pintar(color, `→ ${motivo}`));
    console.log(partes.join(' '));

    // En la compu no se guarda nada: la base es la de producción y las pruebas aparecerían en Más → Logs, o mandarían
    // el aviso de IP sospechosa a los admins (config/entorno.ts). La línea de la terminal sí sale
    if (!guardarLogs) return;
    // Mirar los logs no suma logs (si falla, sí)
    if (ruta.startsWith('/api/logs') && !cortada && codigo < 400) return;
    // Lo que hace el dueño desde la app (con token de admin válido) no se guarda: los logs son para ver lo público.
    // Sin token sí, también en rutas privadas: un 401 ahí es justamente alguien de afuera probando
    if (esAdmin(req)) return;
    registrar({
      ip: req.ip,
      metodo: req.method,
      ruta,
      codigo: cortada ? null : codigo,
      mensaje: motivo,
      ms,
      admin: false,
      rutaInexistente,
      pedido,
    }).catch((e: unknown) => console.error('No se pudo guardar el log:', e instanceof Error ? e.message : e));
  });

  next();
}
