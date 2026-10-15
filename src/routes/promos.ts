import { Router } from 'express';
import { isValidObjectId } from 'mongoose';
import { Promo } from '../models/Promo';
import { requiereAdmin } from '../middleware/auth';
import { borrarDeCloudinary, enviarACloudinary, subirImagen } from '../middleware/upload';

const router = Router();

// GET /api/promos  (pública: la app del jefe la usa para listar y compartir en WhatsApp)
// Cada promo sale con imagenUrl optimizada y miniatura (ver el toJSON del modelo)
router.get('/', async (_req, res) => {
  const promos = await Promo.find().select('-imagenPublicId').sort({ createdAt: -1 });
  res.json(promos);
});

// POST /api/promos  (multipart/form-data: titulo, texto opcional, imagen obligatoria)
router.post('/', requiereAdmin, subirImagen, async (req, res) => {
  const { titulo, texto } = req.body ?? {};
  if (!titulo || !req.file) {
    return res.status(400).json({ error: 'titulo e imagen son obligatorios' });
  }

  const { url, publicId } = await enviarACloudinary(req.file.buffer, 'promos');
  try {
    const promo = await Promo.create({ titulo, texto, imagenUrl: url, imagenPublicId: publicId });
    res.status(201).json(promo);
  } catch (e) {
    // Si no se pudo guardar, la foto recién subida quedaría huérfana
    await borrarDeCloudinary(publicId);
    throw e;
  }
});

// DELETE /api/promos/:id
router.delete('/:id', requiereAdmin, async (req, res) => {
  if (!isValidObjectId(req.params.id)) return res.status(404).json({ error: 'No encontrado' });

  const promo = await Promo.findByIdAndDelete(req.params.id);
  if (!promo) return res.status(404).json({ error: 'No encontrado' });

  await borrarDeCloudinary(promo.imagenPublicId);
  res.status(204).end();
});

export default router;
