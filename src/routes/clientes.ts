import { Router } from 'express';
import { isValidObjectId } from 'mongoose';
import { requiereAdmin } from '../middleware/auth';
import { Cliente } from '../models/Cliente';
import { Pedido } from '../models/Pedido';

// Rutas PRIVADAS: los datos de los clientes solo los ve el dueño
const router = Router();
router.use(requiereAdmin);

// GET /api/clientes  (la cantidad de pedidos y el último se calculan al vuelo, no se guardan contadores)
router.get('/', async (_req, res) => {
  const clientes = await Cliente.aggregate([
    {
      $lookup: {
        from: Pedido.collection.name,
        localField: '_id',
        foreignField: 'cliente',
        pipeline: [{ $group: { _id: null, cantidad: { $sum: 1 }, ultimo: { $max: '$createdAt' } } }],
        as: 'resumen',
      },
    },
    { $unwind: { path: '$resumen', preserveNullAndEmptyArrays: true } },
    {
      $project: {
        nombre: 1,
        telefono: 1,
        createdAt: 1,
        updatedAt: 1,
        cantidadPedidos: { $ifNull: ['$resumen.cantidad', 0] },
        ultimoPedido: { $ifNull: ['$resumen.ultimo', null] },
      },
    },
    { $sort: { ultimoPedido: -1, nombre: 1 } },
  ]);
  res.json(clientes);
});

// GET /api/clientes/:id  (el cliente y sus últimos 20 pedidos)
router.get('/:id', async (req, res) => {
  if (!isValidObjectId(req.params.id)) return res.status(404).json({ error: 'No encontrado' });

  const cliente = await Cliente.findById(req.params.id);
  if (!cliente) return res.status(404).json({ error: 'No encontrado' });

  const [pedidos, cantidadPedidos] = await Promise.all([
    Pedido.find({ cliente: cliente._id }).sort({ createdAt: -1 }).limit(20),
    Pedido.countDocuments({ cliente: cliente._id }),
  ]);
  res.json({ ...cliente.toJSON(), cantidadPedidos, pedidos });
});

export default router;
