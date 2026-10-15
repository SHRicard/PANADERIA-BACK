import express, { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { Types, isValidObjectId } from 'mongoose';
import { requiereAdmin } from '../middleware/auth';
import { Cliente, ICliente } from '../models/Cliente';
import { ESTADOS_PEDIDO, EstadoPedido, IItemPedido, Pedido } from '../models/Pedido';
import { Producto } from '../models/Producto';
import { leerPaginado } from '../utils/paginado';
import { normalizarTelefono } from '../utils/telefono';

// POST / es PÚBLICA (la web, sin login). Las demás son PRIVADAS: requiereAdmin ruta por ruta
const router = Router();

// Parser propio con límite chico. Funciona porque index.ts monta este router antes del express.json() global
const leerJson = express.json({ limit: '10kb' });

const limitarPedidos = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Hiciste demasiados pedidos. Probá de nuevo en un rato.' },
});

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

function esEstado(valor: unknown): valor is EstadoPedido {
  return typeof valor === 'string' && (ESTADOS_PEDIDO as readonly string[]).includes(valor);
}

// POST /api/pedidos  { cliente: { nombre, telefono }, items: [{ productoId, cantidad }], nota? }
router.post('/', limitarPedidos, leerJson, async (req, res) => {
  const body: unknown = req.body;
  if (!esObjeto(body) || !esObjeto(body.cliente)) {
    return res.status(400).json({ error: 'Faltan los datos del cliente' });
  }

  const nombre = typeof body.cliente.nombre === 'string' ? body.cliente.nombre.trim() : '';
  if (nombre.length < 2 || nombre.length > 60) {
    return res.status(400).json({ error: 'El nombre tiene que tener entre 2 y 60 caracteres' });
  }

  const telefonoCrudo = body.cliente.telefono;
  const telefono =
    typeof telefonoCrudo === 'string' && telefonoCrudo.length <= 30 ? normalizarTelefono(telefonoCrudo) : null;
  if (!telefono) return res.status(400).json({ error: 'El teléfono no es válido' });

  let nota: string | undefined;
  if (body.nota !== undefined && body.nota !== null) {
    if (typeof body.nota !== 'string' || body.nota.trim().length > 300) {
      return res.status(400).json({ error: 'La nota puede tener hasta 300 caracteres' });
    }
    nota = body.nota.trim() || undefined;
  }

  if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 30) {
    return res.status(400).json({ error: 'El pedido tiene que tener entre 1 y 30 productos' });
  }

  // Los productos repetidos se juntan en un solo item sumando las cantidades
  const cantidades = new Map<string, number>();
  for (const item of body.items as unknown[]) {
    if (!esObjeto(item) || typeof item.productoId !== 'string' || !isValidObjectId(item.productoId)) {
      return res.status(400).json({ error: 'Hay un producto con un id inválido' });
    }
    const cantidad = item.cantidad;
    if (typeof cantidad !== 'number' || !Number.isInteger(cantidad) || cantidad < 1 || cantidad > 50) {
      return res.status(400).json({ error: 'La cantidad de cada producto tiene que ser un entero entre 1 y 50' });
    }
    const id = new Types.ObjectId(item.productoId).toString();
    cantidades.set(id, (cantidades.get(id) ?? 0) + cantidad);
  }
  if ([...cantidades.values()].some((c) => c > 50)) {
    return res.status(400).json({ error: 'No se pueden pedir más de 50 unidades de un mismo producto' });
  }

  const ids = [...cantidades.keys()];
  const productos = await Producto.find({ _id: { $in: ids }, disponible: true }).select('nombre precio categoria');
  const porId = new Map(productos.map((p) => [p.id as string, p]));

  const noDisponibles = ids.filter((id) => !porId.has(id));
  if (noDisponibles.length > 0) {
    return res.status(400).json({
      error: 'Hay productos que no existen o no están disponibles',
      productosNoDisponibles: noDisponibles,
    });
  }

  // Nombre, precio, categoría y total salen de la base: nunca se confía en lo que manda el cliente
  const items: IItemPedido[] = [];
  for (const [id, cantidad] of cantidades) {
    const producto = porId.get(id);
    if (producto) {
      const { nombre, precio, categoria } = producto;
      items.push({ producto: producto._id, nombre, precio, categoria, cantidad });
    }
  }
  const total = Math.round(items.reduce((suma, i) => suma + i.precio * i.cantidad, 0) * 100) / 100;

  const cliente = await Cliente.findOneAndUpdate(
    { telefono },
    { nombre },
    { upsert: true, returnDocument: 'after', runValidators: true }
  );
  if (!cliente) throw new Error('No se pudo registrar el cliente');

  const pedido = await Pedido.create({
    cliente: cliente._id,
    clienteNombre: nombre,
    clienteTelefono: telefono,
    items,
    total,
    nota,
  });

  // Solo lo de este pedido: ningún dato del cliente ni de otros pedidos
  res.status(201).json({
    id: pedido.id,
    items: pedido.items,
    total: pedido.total,
    estado: pedido.estado,
    createdAt: pedido.createdAt,
  });
});

// GET /api/pedidos?estado=pendiente&pagina=1&limite=20
router.get('/', requiereAdmin, async (req, res) => {
  const filtro: Record<string, unknown> = {};
  if (req.query.estado !== undefined) {
    if (!esEstado(req.query.estado)) {
      return res.status(400).json({ error: `estado tiene que ser uno de: ${ESTADOS_PEDIDO.join(', ')}` });
    }
    filtro.estado = req.query.estado;
  }

  const { pagina, limite } = leerPaginado(req.query);

  const [pedidos, totalPedidos] = await Promise.all([
    Pedido.find(filtro)
      .sort({ createdAt: -1 })
      .skip((pagina - 1) * limite)
      .limit(limite),
    Pedido.countDocuments(filtro),
  ]);
  res.json({ pedidos, pagina, limite, totalPedidos, totalPaginas: Math.ceil(totalPedidos / limite) });
});

// GET /api/pedidos/:id  (con los datos del cliente y cuántos pedidos tiene)
router.get('/:id', requiereAdmin, async (req, res) => {
  if (!isValidObjectId(req.params.id)) return res.status(404).json({ error: 'No encontrado' });

  const pedido = await Pedido.findById(req.params.id)
    .populate<{ cliente: (ICliente & { _id: Types.ObjectId; createdAt: Date }) | null }>(
      'cliente',
      'nombre telefono createdAt'
    )
    .lean();
  if (!pedido) return res.status(404).json({ error: 'No encontrado' });

  const cliente = pedido.cliente
    ? { ...pedido.cliente, cantidadPedidos: await Pedido.countDocuments({ cliente: pedido.cliente._id }) }
    : null;
  res.json({ ...pedido, cliente });
});

// PATCH /api/pedidos/:id/estado  { estado }
router.patch('/:id/estado', requiereAdmin, leerJson, async (req, res) => {
  if (!isValidObjectId(req.params.id)) return res.status(404).json({ error: 'No encontrado' });

  const estado: unknown = req.body?.estado;
  if (!esEstado(estado)) {
    return res.status(400).json({ error: `estado tiene que ser uno de: ${ESTADOS_PEDIDO.join(', ')}` });
  }

  const pedido = await Pedido.findByIdAndUpdate(
    req.params.id,
    { estado },
    { returnDocument: 'after', runValidators: true }
  );
  if (!pedido) return res.status(404).json({ error: 'No encontrado' });
  res.json(pedido);
});

export default router;
