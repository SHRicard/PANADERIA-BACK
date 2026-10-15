import { Router } from 'express';
import { isValidObjectId } from 'mongoose';
import { Producto } from '../models/Producto';

// Rutas PÚBLICAS: es lo que ve el cliente en el link que manda el jefe por WhatsApp
const router = Router();

// GET /api/catalogo?categoria=Panes
router.get('/', async (req, res) => {
  const filtro: Record<string, unknown> = { disponible: true };
  if (typeof req.query.categoria === 'string') filtro.categoria = req.query.categoria;

  const productos = await Producto.find(filtro)
    .select('-imagenes.publicId')
    .sort({ categoria: 1, nombre: 1 });
  res.json(productos);
});

// GET /api/catalogo/:id
router.get('/:id', async (req, res) => {
  if (!isValidObjectId(req.params.id)) return res.status(404).json({ error: 'No encontrado' });

  const producto = await Producto.findOne({ _id: req.params.id, disponible: true }).select(
    '-imagenes.publicId'
  );
  if (!producto) return res.status(404).json({ error: 'No encontrado' });
  res.json(producto);
});

export default router;
