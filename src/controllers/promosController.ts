import { Request, Response } from 'express';
import { isValidObjectId } from 'mongoose';
import { MB_POR_IMAGEN } from '../middleware/upload';
import { LARGO_TITULO_PROMO, MAX_TEXTO_PROMO, TEXTO_PROMO_INVALIDO, TITULO_PROMO_INVALIDO } from '../models/Promo';
import * as promosService from '../services/promosService';

// Un opcional se borra mandándolo vacío: null (JSON) o "" (multipart, donde todo es texto)
const estaVacio = (valor: unknown) => valor === null || (typeof valor === 'string' && valor.trim() === '');

// Devuelve los datos listos para el servicio, o el mensaje de error. Al crear, el título es obligatorio;
// al editar, solo se valida lo que vino. Un texto vacío queda en null: al crear no se guarda, y al editar se borra
function leerDatos(body: unknown, parcial: boolean): promosService.CambiosPromo | string {
  const campos = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  const datos: promosService.CambiosPromo = {};

  if (!parcial || campos.titulo !== undefined) {
    if (typeof campos.titulo !== 'string' || !campos.titulo.trim()) return 'Falta el título';
    // Los espacios de más no cuentan: "2x1  EN MEDIALUNAS" es "2x1 EN MEDIALUNAS"
    const titulo = campos.titulo.trim().replace(/\s+/g, ' ');
    if (titulo.length < LARGO_TITULO_PROMO.min || titulo.length > LARGO_TITULO_PROMO.max) return TITULO_PROMO_INVALIDO;
    datos.titulo = titulo;
  }

  if (campos.texto !== undefined) {
    if (estaVacio(campos.texto)) {
      datos.texto = null;
    } else {
      if (typeof campos.texto !== 'string') return 'El texto tiene que ser un texto';
      // Solo los bordes: los saltos de línea del medio son parte de cómo se ve en el estado.
      // multipart los manda como \r\n (así lo pide el estándar de FormData): se guardan como \n
      const texto = campos.texto.replace(/\r\n?/g, '\n').trim();
      if (texto.length > MAX_TEXTO_PROMO) return TEXTO_PROMO_INVALIDO;
      datos.texto = texto;
    }
  }

  if (parcial && Object.keys(datos).length === 0) return 'No hay ningún cambio para guardar';
  return datos;
}

// GET /api/promos  (toda la biblioteca, la más nueva primero)
export async function listar(_req: Request, res: Response) {
  res.json(await promosService.listar());
}

// POST /api/promos  (multipart/form-data: titulo, texto opcional y "archivo": una foto o un video)
export async function crear(req: Request, res: Response) {
  const datos = leerDatos(req.body, false);
  if (typeof datos === 'string') return res.status(400).json({ error: datos });
  if (!req.file) return res.status(400).json({ error: 'Falta el archivo (una foto o un video)' });

  // Multer ya filtró: es una foto o un video. Su límite es el del video; el de la foto se revisa acá
  const tipo = req.file.mimetype.startsWith('video/') ? 'video' : 'imagen';
  if (tipo === 'imagen' && req.file.size > MB_POR_IMAGEN * 1024 * 1024) {
    return res.status(400).json({ error: `Una foto puede pesar hasta ${MB_POR_IMAGEN} MB` });
  }

  const promo = await promosService.crear(
    { titulo: datos.titulo as string, texto: datos.texto ?? undefined },
    tipo,
    req.file.buffer
  );
  res.status(201).json(promo);
}

// PATCH /api/promos/:id  { titulo?, texto? }  (sin volver a subir el archivo; texto null o "" lo borra)
export async function editar(req: Request<{ id: string }>, res: Response) {
  if (!isValidObjectId(req.params.id)) return res.status(404).json({ error: 'No encontrado' });
  const cambios = leerDatos(req.body, true);
  if (typeof cambios === 'string') return res.status(400).json({ error: cambios });
  res.json(await promosService.editar(req.params.id, cambios));
}

// POST /api/promos/:id/publicaciones  (el dueño tocó Compartir: suma una a vecesPublicada y guarda la fecha)
export async function registrarPublicacion(req: Request<{ id: string }>, res: Response) {
  if (!isValidObjectId(req.params.id)) return res.status(404).json({ error: 'No encontrado' });
  res.json(await promosService.registrarPublicacion(req.params.id));
}

// DELETE /api/promos/:id  (borra también el archivo de Cloudinary)
export async function borrar(req: Request<{ id: string }>, res: Response) {
  if (!isValidObjectId(req.params.id)) return res.status(404).json({ error: 'No encontrado' });
  await promosService.borrar(req.params.id);
  res.status(204).end();
}
