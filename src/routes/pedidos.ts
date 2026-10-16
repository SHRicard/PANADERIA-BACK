import express, { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { Types, isValidObjectId } from 'mongoose';
import { leerItems } from '../controllers/carritoController';
import { requiereAdmin } from '../middleware/auth';
import { Cliente, ICliente } from '../models/Cliente';
import { ESTADOS_PEDIDO, EstadoPedido, IItemPedido, Pedido } from '../models/Pedido';
import * as carritoService from '../services/carritoService';
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

  // Los productos repetidos se juntan en un solo item sumando las cantidades (las mismas reglas que el carrito)
  const cantidades = leerItems(body.items, { minimo: 1, fueraDeRango: 'El pedido tiene que tener entre 1 y 30 productos' });
  if (typeof cantidades === 'string') return res.status(400).json({ error: cantidades });

  // Nombre, precio, categoría y total salen de la base, con la misma cuenta que el carrito
  const cotizacion = await carritoService.cotizar(cantidades);
  if (cotizacion.noDisponibles.length > 0) {
    return res.status(400).json({
      error: 'Hay productos que no existen o no están disponibles',
      productosNoDisponibles: cotizacion.noDisponibles,
    });
  }
  const items: IItemPedido[] = cotizacion.items.map(({ producto, nombre, precio, categoria, cantidad }) => ({
    producto,
    nombre,
    precio,
    categoria,
    cantidad,
  }));
  const { total } = cotizacion;

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
