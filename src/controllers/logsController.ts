import { isIP } from 'node:net';
import { Request, Response } from 'express';
import { LARGO_NOMBRE_IP, NOMBRE_IP_INVALIDO } from '../models/IpConocida';
import { DIAS_LOGS, DiasLogs, NIVELES_LOG, NivelLog } from '../models/Log';
import * as logsService from '../services/logsService';
import { ErrorHttp } from '../utils/errores';
import { leerPaginado } from '../utils/paginado';

// ?sospechosos=true|false. Sin el parámetro, todos
function leerBooleano(query: Request['query'], nombre: string): boolean | undefined {
  const valor = query[nombre];
  if (valor === undefined || valor === '') return undefined;
  if (valor === 'true') return true;
  if (valor === 'false') return false;
  throw new ErrorHttp(400, `${nombre} tiene que ser true o false`);
}

function leerIp(texto: unknown): string {
  if (typeof texto !== 'string' || !isIP(texto)) throw new ErrorHttp(400, 'Esa no es una IP válida');
  return logsService.normalizarIp(texto);
}

// GET /api/logs?nivel=&ip=&sospechosos=&admin=&pagina=&limite=
export async function listar(req: Request, res: Response) {
  const { nivel, ip } = req.query;
  if (nivel !== undefined && nivel !== '' && !(NIVELES_LOG as readonly unknown[]).includes(nivel)) {
    return res.status(400).json({ error: `El nivel tiene que ser uno de: ${NIVELES_LOG.join(', ')}` });
  }

  res.json(
    await logsService.listar(
      {
        nivel: nivel ? (nivel as NivelLog) : undefined,
        ip: ip !== undefined && ip !== '' ? leerIp(ip) : undefined,
        sospechosos: leerBooleano(req.query, 'sospechosos'),
        admin: leerBooleano(req.query, 'admin'),
      },
      leerPaginado(req.query)
    )
  );
}

// GET /api/logs/resumen
export async function resumen(_req: Request, res: Response) {
  res.json(await logsService.resumen());
}

// GET /api/logs/ips?sospechosas=&pagina=&limite=
export async function ips(req: Request, res: Response) {
  res.json(await logsService.ips({ sospechosas: leerBooleano(req.query, 'sospechosas') }, leerPaginado(req.query)));
}

// GET /api/logs/visitas?ip=&sospechosas=&pagina=&limite=
export async function visitas(req: Request, res: Response) {
  const { ip } = req.query;
  res.json(
    await logsService.visitas(
      {
        ip: ip !== undefined && ip !== '' ? leerIp(ip) : undefined,
        sospechosas: leerBooleano(req.query, 'sospechosas'),
      },
      leerPaginado(req.query)
    )
  );
}

// PUT /api/logs/ips/:ip  { nombre }
export async function nombrarIp(req: Request<{ ip: string }>, res: Response) {
  const ip = leerIp(req.params.ip);
  const { nombre } = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as Record<string, unknown>;
  if (typeof nombre !== 'string' || !nombre.trim()) return res.status(400).json({ error: 'Falta el nombre' });
  const limpio = nombre.trim().replace(/\s+/g, ' ');
  if (limpio.length < LARGO_NOMBRE_IP.min || limpio.length > LARGO_NOMBRE_IP.max) {
    return res.status(400).json({ error: NOMBRE_IP_INVALIDO });
  }

  res.json(await logsService.nombrarIp(ip, limpio));
}

// DELETE /api/logs/ips/:ip
export async function olvidarIp(req: Request<{ ip: string }>, res: Response) {
  await logsService.olvidarIp(leerIp(req.params.ip));
  res.status(204).end();
}

// GET /api/logs/borrado-automatico
export async function obtenerDias(_req: Request, res: Response) {
  res.json(await logsService.obtenerDias());
}

// PUT /api/logs/borrado-automatico  { diasLogs: 7 | 15 | 30 | null }
export async function cambiarDias(req: Request, res: Response) {
  const { diasLogs } = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as Record<string, unknown>;
  if (diasLogs !== null && !(DIAS_LOGS as readonly unknown[]).includes(diasLogs)) {
    return res.status(400).json({ error: `diasLogs tiene que ser uno de: ${DIAS_LOGS.join(', ')} o null (solo a mano)` });
  }

  res.json(await logsService.cambiarDias(diasLogs as DiasLogs | null));
}

// DELETE /api/logs  (borra todos los logs; los nombres de las IP quedan)
export async function borrarTodo(_req: Request, res: Response) {
  await logsService.borrarTodo();
  res.status(204).end();
}
