import { isIP } from 'node:net';
import { Types } from 'mongoose';
import { emailConfigurado, enviarAviso } from '../config/email';
import { Admin } from '../models/Admin';
import { Ajustes, ID_AJUSTES } from '../models/Ajustes';
import { IpConocida } from '../models/IpConocida';
import { DiasLogs, ILog, Log, MotivoSospechoso, NivelLog } from '../models/Log';
import { Pedido } from '../models/Pedido';
import { Paginado } from '../utils/paginado';

const MS_POR_DIA = 24 * 60 * 60 * 1000;
const MAX_RUTA = 200;
const MAX_MENSAJE = 200;

// ─── Guardar ────────────────────────────────────────────────────────────────

/** Lo que manda middleware/registro.ts de cada petición */
export interface Peticion {
  ip: string | undefined;
  metodo: string;
  ruta: string;
  /** null si el cliente cortó antes de la respuesta */
  codigo: number | null;
  mensaje?: string;
  ms: number;
  admin: boolean;
  /** 404 de una ruta que no existe (no el de un producto o pedido que no está) */
  rutaInexistente: boolean;
  pedido?: string;
}

// Con trust proxy, Express da la IP del cliente; en IPv4 a veces llega como ::ffff:1.2.3.4
export const normalizarIp = (ip: string | undefined): string => (ip ?? 'desconocida').replace(/^::ffff:/, '');

// /api/catalogo/6730f…/recomendaciones → /api/catalogo/:id/recomendaciones, para agrupar por apartado
export function apartadoDe(ruta: string): string {
  return ruta
    .split('/')
    .map((parte) => {
      if (/^[a-f0-9]{24}$/i.test(parte)) return ':id';
      if (/^\d{4}-\d{2}-\d{2}$/.test(parte)) return ':fecha';
      if (/^\d{4}-\d{2}$/.test(parte)) return ':mes';
      let decodificada = parte;
      try {
        decodificada = decodeURIComponent(parte);
      } catch {
        // Un % suelto: queda como vino
      }
      return isIP(decodificada) ? ':ip' : parte;
    })
    .join('/');
}

// Lo que hace un atacante y no un cliente: probar contraseñas o códigos, chocar con un límite, entrar sin token a lo
// privado, buscar rutas que no existen (/.env, /wp-admin) o llamar desde una web que no es la nuestra
export function motivoSospechoso(p: Pick<Peticion, 'metodo' | 'ruta' | 'codigo' | 'rutaInexistente'>): MotivoSospechoso | undefined {
  const { codigo, ruta } = p;
  if (codigo === null || codigo < 400) return undefined;
  if (codigo === 429) return 'limite-superado';
  if (ruta === '/api/auth/login' && codigo === 401) return 'login-fallido';
  if ((ruta === '/api/auth/recuperar' || ruta === '/api/auth/restablecer') && codigo < 500) return 'recuperacion-fallida';
  if (codigo === 401) return 'sin-autorizacion';
  if (codigo === 403) return 'origen-no-permitido';
  if (codigo === 404 && p.rutaInexistente) return 'ruta-inexistente';
  return undefined;
}

function nivelDe(codigo: number | null): NivelLog {
  if (codigo === null) return 'aviso'; // el cliente cortó antes de la respuesta
  if (codigo < 400) return 'exito';
  return codigo < 500 ? 'aviso' : 'error';
}

// Cada cuántos días se borran solos. Se lee una vez y queda en memoria: así guardar un log no consulta la base
let diasGuardados: Promise<number | null> | null = null;

function diasDeLogs(): Promise<number | null> {
  diasGuardados ??= Ajustes.findById(ID_AJUSTES)
    .select('diasLogs')
    .lean()
    .then((ajustes) => ajustes?.diasLogs ?? null)
    .catch((e: unknown) => {
      diasGuardados = null;
      throw e;
    });
  return diasGuardados;
}

// No se espera desde el middleware: si la base falla, la petición ya se respondió y solo queda avisar en la terminal
export async function registrar(p: Peticion): Promise<void> {
  const ip = normalizarIp(p.ip);
  const ruta = p.ruta.slice(0, MAX_RUTA);
  const sospechoso = motivoSospechoso(p);
  const dias = await diasDeLogs();

  await Log.create({
    ip,
    metodo: p.metodo,
    ruta,
    apartado: apartadoDe(ruta),
    codigo: p.codigo,
    nivel: nivelDe(p.codigo),
    mensaje: p.mensaje?.slice(0, MAX_MENSAJE),
    ms: Math.max(0, Math.round(p.ms)),
    admin: p.admin,
    sospechoso,
    pedido: p.pedido && Types.ObjectId.isValid(p.pedido) ? p.pedido : undefined,
    expiraEn: dias ? new Date(Date.now() + dias * MS_POR_DIA) : undefined,
  });

  if (sospechoso) vigilar(ip, sospechoso, `${p.metodo} ${ruta}`);
}

// ─── Avisar ─────────────────────────────────────────────────────────────────
// En memoria: un reinicio de Render la vacía, y está bien (un ataque que sigue vuelve a juntar las peticiones enseguida)

/** Cuántas peticiones sospechosas de una misma IP en VENTANA_MS mandan el email */
export const UMBRAL_AVISO = 10;
const VENTANA_MS = 10 * 60 * 1000;
/** Después de avisar por una IP, no se vuelve a avisar por ella hasta pasada una hora */
const SILENCIO_MS = 60 * 60 * 1000;
/** Tope de emails por hora entre todas las IP: un ataque desde muchas no llena la casilla */
const MAX_AVISOS_POR_HORA = 6;

interface Vigilada {
  eventos: { en: number; motivo: MotivoSospechoso; peticion: string }[];
  callarHasta: number;
}

const vigiladas = new Map<string, Vigilada>();
let avisosEnviados: number[] = [];

function vigilar(ip: string, motivo: MotivoSospechoso, peticion: string) {
  const ahora = Date.now();
  // Que el mapa no crezca sin límite con IP que pasaron una vez
  if (vigiladas.size > 1000) {
    for (const [otra, v] of vigiladas) {
      if (v.callarHasta < ahora && v.eventos.every((e) => e.en < ahora - VENTANA_MS)) vigiladas.delete(otra);
    }
  }

  const vigilada = vigiladas.get(ip) ?? { eventos: [], callarHasta: 0 };
  vigilada.eventos = vigilada.eventos.filter((e) => e.en >= ahora - VENTANA_MS);
  vigilada.eventos.push({ en: ahora, motivo, peticion });
  vigiladas.set(ip, vigilada);

  if (vigilada.eventos.length < UMBRAL_AVISO || vigilada.callarHasta > ahora) return;

  avisosEnviados = avisosEnviados.filter((en) => en >= ahora - 60 * 60 * 1000);
  vigilada.callarHasta = ahora + SILENCIO_MS;
  const eventos = vigilada.eventos;
  vigilada.eventos = [];

  if (avisosEnviados.length >= MAX_AVISOS_POR_HORA) {
    console.warn(`⚠ IP sospechosa ${ip}: ${eventos.length} peticiones (sin email: ya se mandaron ${MAX_AVISOS_POR_HORA} esta hora)`);
    return;
  }
  avisosEnviados.push(ahora);
  avisar(ip, eventos).catch((e: unknown) =>
    // El error de nodemailer puede traer datos del servidor SMTP: solo el mensaje
    console.error('No se pudo mandar el aviso de IP sospechosa:', e instanceof Error ? e.message : e)
  );
}

const DESCRIPCION_MOTIVO: Record<MotivoSospechoso, string> = {
  'login-fallido': 'contraseña incorrecta en el login',
  'recuperacion-fallida': 'intentos con la recuperación de contraseña',
  'limite-superado': 'chocó con un límite de frecuencia',
  'sin-autorizacion': 'quiso entrar a rutas privadas sin sesión',
  'ruta-inexistente': 'buscó rutas que no existen',
  'origen-no-permitido': 'llamó desde una web que no es la nuestra',
};

async function avisar(ip: string, eventos: Vigilada['eventos']) {
  console.warn(`⚠ IP sospechosa ${ip}: ${eventos.length} peticiones en ${VENTANA_MS / 60000} minutos`);
  if (!emailConfigurado()) return;

  const [admins, conocida] = await Promise.all([
    Admin.find({ email: { $exists: true, $ne: '' } }).select('email').lean(),
    IpConocida.findOne({ ip }).lean(),
  ]);
  const destinos = admins.map((a) => a.email).filter((e): e is string => Boolean(e));
  if (!destinos.length) return;

  const porMotivo = new Map<MotivoSospechoso, number>();
  for (const e of eventos) porMotivo.set(e.motivo, (porMotivo.get(e.motivo) ?? 0) + 1);

  await enviarAviso(destinos, `⚠ Actividad sospechosa en Panadería Digital (${ip})`, [
    `La IP ${ip}${conocida ? ` (la anotaste como «${conocida.nombre}»)` : ''} hizo ${eventos.length} peticiones sospechosas en ${VENTANA_MS / 60000} minutos:`,
    '',
    ...[...porMotivo].map(([motivo, cantidad]) => `• ${cantidad} × ${DESCRIPCION_MOTIVO[motivo]}`),
    '',
    'Las últimas:',
    ...eventos.slice(-5).map((e) => `  ${e.peticion}`),
    '',
    'Mirá el detalle en la app, en Logs. Por esta IP no te vamos a avisar de nuevo durante una hora.',
  ]);
}

// ─── Leer ───────────────────────────────────────────────────────────────────

export interface FiltrosLogs {
  nivel?: NivelLog;
  ip?: string;
  sospechosos?: boolean;
  admin?: boolean;
}

async function nombresDeIps(ips: string[]): Promise<Map<string, string>> {
  const conocidas = await IpConocida.find({ ip: { $in: ips } }).lean();
  return new Map(conocidas.map((c) => [c.ip, c.nombre]));
}

async function clientesDePedidos(ids: Types.ObjectId[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const pedidos = await Pedido.find({ _id: { $in: ids } }).select('clienteNombre').lean();
  return new Map(pedidos.map((p) => [String(p._id), p.clienteNombre]));
}

// GET /api/logs: del más nuevo al más viejo
export async function listar(filtros: FiltrosLogs, { pagina, limite }: Paginado) {
  const filtro: Record<string, unknown> = {};
  if (filtros.nivel) filtro.nivel = filtros.nivel;
  if (filtros.ip) filtro.ip = filtros.ip;
  if (filtros.sospechosos !== undefined) filtro.sospechoso = { $exists: filtros.sospechosos };
  if (filtros.admin !== undefined) filtro.admin = filtros.admin;

  const [logs, totalLogs] = await Promise.all([
    Log.find(filtro)
      .sort({ createdAt: -1, _id: -1 })
      .skip((pagina - 1) * limite)
      .limit(limite)
      .lean<(ILog & { _id: Types.ObjectId })[]>(),
    Log.countDocuments(filtro),
  ]);

  const [nombres, clientes] = await Promise.all([
    nombresDeIps([...new Set(logs.map((l) => l.ip))]),
    clientesDePedidos(logs.flatMap((l) => (l.pedido ? [l.pedido] : []))),
  ]);

  return {
    logs: logs.map((l) => ({
      id: String(l._id),
      fecha: l.createdAt,
      ip: l.ip,
      nombreIp: nombres.get(l.ip) ?? null,
      metodo: l.metodo,
      ruta: l.ruta,
      apartado: l.apartado,
      codigo: l.codigo,
      nivel: l.nivel,
      mensaje: l.mensaje ?? null,
      ms: l.ms,
      admin: l.admin,
      sospechoso: l.sospechoso ?? null,
      // El pedido puede ya no existir: sale el id con el nombre en null
      pedido: l.pedido ? { id: String(l.pedido), clienteNombre: clientes.get(String(l.pedido)) ?? null } : null,
    })),
    pagina,
    limite,
    totalLogs,
    totalPaginas: Math.ceil(totalLogs / limite),
  };
}

const MAX_APARTADOS_RESUMEN = 10;

// GET /api/logs/resumen: sobre todo lo guardado (desde el último borrado)
export async function resumen() {
  const [resultado] = await Log.aggregate<{
    total: { cantidad: number }[];
    primero: { fecha: Date }[];
    niveles: { _id: NivelLog; cantidad: number }[];
    visitantes: { cantidad: number }[];
    sospechosos: { cantidad: number }[];
    apartados: { _id: { metodo: string; apartado: string }; cantidad: number; ips: string[] }[];
  }>([
    {
      $facet: {
        total: [{ $count: 'cantidad' }],
        primero: [{ $sort: { createdAt: 1 } }, { $limit: 1 }, { $project: { _id: 0, fecha: '$createdAt' } }],
        niveles: [{ $group: { _id: '$nivel', cantidad: { $sum: 1 } } }],
        visitantes: [{ $match: { admin: false } }, { $group: { _id: '$ip' } }, { $count: 'cantidad' }],
        sospechosos: [{ $match: { sospechoso: { $exists: true } } }, { $count: 'cantidad' }],
        apartados: [
          { $match: { admin: false, sospechoso: { $exists: false } } },
          { $group: { _id: { metodo: '$metodo', apartado: '$apartado' }, cantidad: { $sum: 1 }, ips: { $addToSet: '$ip' } } },
          { $sort: { cantidad: -1, '_id.apartado': 1 } },
          { $limit: MAX_APARTADOS_RESUMEN },
        ],
      },
    },
  ]);

  const porNivel = { exito: 0, aviso: 0, error: 0 };
  for (const n of resultado.niveles) porNivel[n._id] = n.cantidad;

  return {
    desde: resultado.primero[0]?.fecha ?? null,
    total: resultado.total[0]?.cantidad ?? 0,
    porNivel,
    visitantes: resultado.visitantes[0]?.cantidad ?? 0,
    sospechosos: resultado.sospechosos[0]?.cantidad ?? 0,
    apartados: resultado.apartados.map((a) => ({
      metodo: a._id.metodo,
      apartado: a._id.apartado,
      peticiones: a.cantidad,
      ips: a.ips.length,
    })),
    diasLogs: await diasDeLogs(),
  };
}

const MAX_APARTADOS_POR_IP = 5;

// GET /api/logs/ips: cada IP con lo que hizo, la que se vio último primero
export async function ips({ sospechosas }: { sospechosas?: boolean }, { pagina, limite }: Paginado) {
  const [resultado] = await Log.aggregate<{
    ips: {
      _id: string;
      peticiones: number;
      exito: number;
      aviso: number;
      error: number;
      sospechosos: number;
      admin: boolean;
      primera: Date;
      ultima: Date;
      pedidos: Types.ObjectId[];
      apartados: { metodo: string; apartado: string; peticiones: number }[];
    }[];
    total: { cantidad: number }[];
  }>([
    {
      $group: {
        _id: { ip: '$ip', metodo: '$metodo', apartado: '$apartado' },
        peticiones: { $sum: 1 },
        exito: { $sum: { $cond: [{ $eq: ['$nivel', 'exito'] }, 1, 0] } },
        aviso: { $sum: { $cond: [{ $eq: ['$nivel', 'aviso'] }, 1, 0] } },
        error: { $sum: { $cond: [{ $eq: ['$nivel', 'error'] }, 1, 0] } },
        sospechosos: { $sum: { $cond: [{ $ifNull: ['$sospechoso', false] }, 1, 0] } },
        admin: { $max: '$admin' },
        primera: { $min: '$createdAt' },
        ultima: { $max: '$createdAt' },
        pedidos: { $addToSet: '$pedido' },
      },
    },
    { $sort: { peticiones: -1 } },
    {
      $group: {
        _id: '$_id.ip',
        peticiones: { $sum: '$peticiones' },
        exito: { $sum: '$exito' },
        aviso: { $sum: '$aviso' },
        error: { $sum: '$error' },
        sospechosos: { $sum: '$sospechosos' },
        admin: { $max: '$admin' },
        primera: { $min: '$primera' },
        ultima: { $max: '$ultima' },
        pedidos: { $push: '$pedidos' },
        apartados: { $push: { metodo: '$_id.metodo', apartado: '$_id.apartado', peticiones: '$peticiones' } },
      },
    },
    {
      $set: {
        // $addToSet de un campo que falta no suma nada; se aplanan los de cada apartado
        pedidos: { $reduce: { input: '$pedidos', initialValue: [], in: { $setUnion: ['$$value', '$$this'] } } },
        apartados: { $slice: ['$apartados', MAX_APARTADOS_POR_IP] },
      },
    },
    ...(sospechosas === undefined ? [] : [{ $match: { sospechosos: sospechosas ? { $gt: 0 } : 0 } }]),
    {
      $facet: {
        ips: [{ $sort: { ultima: -1, _id: 1 } }, { $skip: (pagina - 1) * limite }, { $limit: limite }],
        total: [{ $count: 'cantidad' }],
      },
    },
  ]).allowDiskUse(true);

  const lista = resultado.ips;
  const [nombres, clientes] = await Promise.all([
    nombresDeIps(lista.map((i) => i._id)),
    clientesDePedidos(lista.flatMap((i) => i.pedidos)),
  ]);
  const totalIps = resultado.total[0]?.cantidad ?? 0;

  return {
    ips: lista.map((i) => ({
      ip: i._id,
      nombre: nombres.get(i._id) ?? null,
      // Los que hicieron un pedido desde esta IP: la pista de quién es
      clientes: [...new Set(i.pedidos.map((id) => clientes.get(String(id))).filter((n): n is string => Boolean(n)))],
      peticiones: i.peticiones,
      porNivel: { exito: i.exito, aviso: i.aviso, error: i.error },
      sospechosos: i.sospechosos,
      admin: i.admin,
      primera: i.primera,
      ultima: i.ultima,
      apartados: i.apartados,
    })),
    pagina,
    limite,
    totalIps,
    totalPaginas: Math.ceil(totalIps / limite),
  };
}

/** Una visita termina cuando la IP pasa este tiempo sin hacer nada (el corte de siempre en las analíticas web) */
export const MINUTOS_ENTRE_VISITAS = 30;
/** Las primeras peticiones de cada visita que vienen en la respuesta: un ataque puede hacer miles */
export const MAX_PETICIONES_POR_VISITA = 50;

// GET /api/logs/visitas: las peticiones de cada IP juntas en visitas (lo pidió el dueño el 2026-11-13: abrir la web
// son 3 peticiones a la vez y en la lista parecían 3 personas). La más reciente primero. Se calcula al leer, sin guardar
// nada: cambiar el corte no obliga a migrar
export async function visitas({ ip, sospechosas }: { ip?: string; sospechosas?: boolean }, { pagina, limite }: Paginado) {
  const [resultado] = await Log.aggregate<{
    visitas: {
      _id: { ip: string; numero: number };
      inicio: Date;
      fin: Date;
      cantidad: number;
      exito: number;
      aviso: number;
      error: number;
      sospechosos: number;
      pedidos: Types.ObjectId[];
      peticiones: {
        id: Types.ObjectId;
        fecha: Date;
        metodo: string;
        ruta: string;
        apartado: string;
        codigo: number | null;
        nivel: NivelLog;
        mensaje?: string;
        ms: number;
        sospechoso?: MotivoSospechoso;
        pedido?: Types.ObjectId;
      }[];
    }[];
    total: { cantidad: number }[];
  }>([
    ...(ip ? [{ $match: { ip } }] : []),
    // Cada petición mira la anterior de su IP: si pasó más del corte (o es la primera), arranca una visita nueva
    {
      $setWindowFields: {
        partitionBy: '$ip',
        sortBy: { createdAt: 1 },
        output: { anterior: { $shift: { output: '$createdAt', by: -1 } } },
      },
    },
    {
      $set: {
        nueva: {
          $cond: [
            {
              $or: [
                { $eq: ['$anterior', null] },
                { $gt: [{ $subtract: ['$createdAt', '$anterior'] }, MINUTOS_ENTRE_VISITAS * 60 * 1000] },
              ],
            },
            1,
            0,
          ],
        },
      },
    },
    // El número de visita de la IP es cuántas arrancaron hasta esta petición
    {
      $setWindowFields: {
        partitionBy: '$ip',
        sortBy: { createdAt: 1 },
        output: { numero: { $sum: '$nueva', window: { documents: ['unbounded', 'current'] } } },
      },
    },
    // Para que las peticiones de cada visita queden en orden
    { $sort: { createdAt: 1, _id: 1 } },
    {
      $group: {
        _id: { ip: '$ip', numero: '$numero' },
        inicio: { $min: '$createdAt' },
        fin: { $max: '$createdAt' },
        cantidad: { $sum: 1 },
        exito: { $sum: { $cond: [{ $eq: ['$nivel', 'exito'] }, 1, 0] } },
        aviso: { $sum: { $cond: [{ $eq: ['$nivel', 'aviso'] }, 1, 0] } },
        error: { $sum: { $cond: [{ $eq: ['$nivel', 'error'] }, 1, 0] } },
        sospechosos: { $sum: { $cond: [{ $ifNull: ['$sospechoso', false] }, 1, 0] } },
        pedidos: { $addToSet: '$pedido' },
        // $firstN y no $push: con miles de peticiones, la visita no junta un array sin tope
        peticiones: {
          $firstN: {
            n: MAX_PETICIONES_POR_VISITA,
            input: {
              id: '$_id',
              fecha: '$createdAt',
              metodo: '$metodo',
              ruta: '$ruta',
              apartado: '$apartado',
              codigo: '$codigo',
              nivel: '$nivel',
              mensaje: '$mensaje',
              ms: '$ms',
              sospechoso: '$sospechoso',
              pedido: '$pedido',
            },
          },
        },
      },
    },
    ...(sospechosas === undefined ? [] : [{ $match: { sospechosos: sospechosas ? { $gt: 0 } : 0 } }]),
    {
      $facet: {
        visitas: [{ $sort: { fin: -1, '_id.ip': 1 } }, { $skip: (pagina - 1) * limite }, { $limit: limite }],
        total: [{ $count: 'cantidad' }],
      },
    },
  ]).allowDiskUse(true);

  const lista = resultado.visitas;
  const [nombres, clientes] = await Promise.all([
    nombresDeIps([...new Set(lista.map((v) => v._id.ip))]),
    clientesDePedidos(lista.flatMap((v) => v.pedidos)),
  ]);
  const totalVisitas = resultado.total[0]?.cantidad ?? 0;

  return {
    visitas: lista.map((v) => ({
      ip: v._id.ip,
      nombreIp: nombres.get(v._id.ip) ?? null,
      // Los que hicieron un pedido en esta visita
      clientes: [...new Set(v.pedidos.map((id) => clientes.get(String(id))).filter((n): n is string => Boolean(n)))],
      inicio: v.inicio,
      fin: v.fin,
      duracionSegundos: Math.round((v.fin.getTime() - v.inicio.getTime()) / 1000),
      totalPeticiones: v.cantidad,
      porNivel: { exito: v.exito, aviso: v.aviso, error: v.error },
      sospechosos: v.sospechosos,
      peticiones: v.peticiones.map((p) => ({
        id: String(p.id),
        fecha: p.fecha,
        metodo: p.metodo,
        ruta: p.ruta,
        apartado: p.apartado,
        codigo: p.codigo,
        nivel: p.nivel,
        mensaje: p.mensaje ?? null,
        ms: p.ms,
        sospechoso: p.sospechoso ?? null,
        pedido: p.pedido ? { id: String(p.pedido), clienteNombre: clientes.get(String(p.pedido)) ?? null } : null,
      })),
    })),
    pagina,
    limite,
    totalVisitas,
    totalPaginas: Math.ceil(totalVisitas / limite),
  };
}

// ─── Cambiar ────────────────────────────────────────────────────────────────

export async function nombrarIp(ip: string, nombre: string) {
  const conocida = await IpConocida.findOneAndUpdate(
    { ip },
    { $set: { nombre } },
    { upsert: true, returnDocument: 'after', runValidators: true }
  ).lean();
  return { ip, nombre: conocida?.nombre ?? nombre };
}

// Repetirlo no es un error
export async function olvidarIp(ip: string): Promise<void> {
  await IpConocida.deleteOne({ ip });
}

// Cambia también los logs que ya están: con 7 días, lo de hace más de 7 se borra enseguida (Mongo pasa una vez por minuto)
export async function cambiarDias(dias: DiasLogs | null): Promise<{ diasLogs: number | null }> {
  await Ajustes.updateOne({ _id: ID_AJUSTES }, { $set: { diasLogs: dias } }, { upsert: true, runValidators: true, setDefaultsOnInsert: true });
  diasGuardados = Promise.resolve(dias);

  if (dias === null) {
    await Log.updateMany({}, { $unset: { expiraEn: 1 } });
  } else {
    await Log.updateMany({}, [{ $set: { expiraEn: { $add: ['$createdAt', dias * MS_POR_DIA] } } }], { updatePipeline: true });
  }
  return { diasLogs: dias };
}

export async function obtenerDias(): Promise<{ diasLogs: number | null }> {
  return { diasLogs: await diasDeLogs() };
}

// DELETE /api/logs (lo pidió el dueño: vaciar todo cuando quiera). Los nombres de las IP quedan
export async function borrarTodo(): Promise<number> {
  const { deletedCount } = await Log.deleteMany({});
  return deletedCount;
}
