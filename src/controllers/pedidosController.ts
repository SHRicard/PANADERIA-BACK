import { Request, Response } from 'express';
import { isValidObjectId } from 'mongoose';
import { ESTADOS_PEDIDO, EstadoPedido } from '../models/Pedido';
import * as pedidosService from '../services/pedidosService';
import { leerPaginado } from '../utils/paginado';
import { normalizarTelefono } from '../utils/telefono';
import { leerItems } from './carritoController';

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

function esEstado(valor: unknown): valor is EstadoPedido {
  return typeof valor === 'string' && (ESTADOS_PEDIDO as readonly string[]).includes(valor);
}

// Devuelve los datos listos para el servicio, o el mensaje de error
function leerPedido(body: unknown): pedidosService.DatosPedido | string {
  if (!esObjeto(body) || !esObjeto(body.cliente)) return 'Faltan los datos del cliente';

  const nombre = typeof body.cliente.nombre === 'string' ? body.cliente.nombre.trim() : '';
  if (nombre.length < 2 || nombre.length > 60) return 'El nombre tiene que tener entre 2 y 60 caracteres';

  const telefonoCrudo = body.cliente.telefono;
  const telefono =
    typeof telefonoCrudo === 'string' && telefonoCrudo.length <= 30 ? normalizarTelefono(telefonoCrudo) : null;
  if (!telefono) return 'El teléfono no es válido';

  let nota: string | undefined;
  if (body.nota !== undefined && body.nota !== null) {
    if (typeof body.nota !== 'string' || body.nota.trim().length > 300) return 'La nota puede tener hasta 300 caracteres';
    nota = body.nota.trim() || undefined;
  }

  // Los productos repetidos se juntan en un solo item sumando las cantidades (las mismas reglas que el carrito)
  const cantidades = leerItems(body.items, { minimo: 1, fueraDeRango: 'El pedido tiene que tener entre 1 y 30 productos' });
  if (typeof cantidades === 'string') return cantidades;

  return { nombre, telefono, cantidades, nota };
}

// POST /api/pedidos  { cliente: { nombre, telefono }, items: [{ productoId, cantidad }], nota? }  (pública)
export async function crear(req: Request, res: Response) {
  const datos = leerPedido(req.body);
  if (typeof datos === 'string') return res.status(400).json({ error: datos });

  const resultado = await pedidosService.crear(datos);
  if (resultado.noDisponibles) {
    return res.status(400).json({
      error: 'Hay productos que no existen o no están disponibles',
      productosNoDisponibles: resultado.noDisponibles,
    });
  }

  // Solo lo de este pedido: ningún dato del cliente ni de otros pedidos
  const { pedido } = resultado;
  res.status(201).json({
    id: pedido.id,
    items: pedido.items,
    total: pedido.total,
    estado: pedido.estado,
    createdAt: pedido.createdAt,
  });
}

const MONTO_SENA_INVALIDO = 'El monto de la seña tiene que ser un número mayor que 0';

const esMontoValido = (monto: unknown): monto is number =>
  typeof monto === 'number' && Number.isFinite(monto) && monto > 0;

// POST /api/pedidos/manuales  { cliente: { nombre, telefono }, items: [{ productoId, cantidad }], nota?, sena?: { monto } }
// El dueño carga un pedido que le hicieron por fuera de la web. Responde 201 con el detalle
export async function crearManual(req: Request, res: Response) {
  const datos = leerPedido(req.body);
  if (typeof datos === 'string') return res.status(400).json({ error: datos });

  // Sin sena (o null): entra pendiente. Con sena: el cliente ya la transfirió y entra confirmado
  const sena: unknown = esObjeto(req.body) ? req.body.sena : undefined;
  let montoSena: number | undefined;
  if (sena !== undefined && sena !== null) {
    if (!esObjeto(sena) || !esMontoValido(sena.monto)) return res.status(400).json({ error: MONTO_SENA_INVALIDO });
    montoSena = Math.round(sena.monto * 100) / 100;
  }

  const resultado = await pedidosService.crearManual({ ...datos, montoSena });
  if (resultado.noDisponibles) {
    return res.status(400).json({
      error: 'Hay productos que no existen',
      productosNoDisponibles: resultado.noDisponibles,
    });
  }
  res.status(201).json(resultado.pedido);
}

// GET /api/pedidos?estado=pendiente&pagina=1&limite=20
export async function listar(req: Request, res: Response) {
  const { estado } = req.query;
  if (estado !== undefined && !esEstado(estado)) {
    return res.status(400).json({ error: `estado tiene que ser uno de: ${ESTADOS_PEDIDO.join(', ')}` });
  }
  res.json(await pedidosService.listar(estado, leerPaginado(req.query)));
}

// GET /api/pedidos/:id  (con los datos del cliente y cuántos pedidos tiene)
export async function detalle(req: Request<{ id: string }>, res: Response) {
  if (!isValidObjectId(req.params.id)) return res.status(404).json({ error: 'No encontrado' });
  res.json(await pedidosService.obtener(req.params.id));
}

// PUT /api/pedidos/:id/sena  { monto }  Confirma la seña o corrige su monto
export async function registrarSena(req: Request<{ id: string }>, res: Response) {
  if (!isValidObjectId(req.params.id)) return res.status(404).json({ error: 'No encontrado' });

  const monto: unknown = esObjeto(req.body) ? req.body.monto : undefined;
  if (!esMontoValido(monto)) return res.status(400).json({ error: MONTO_SENA_INVALIDO });
  res.json(await pedidosService.registrarSena(req.params.id, Math.round(monto * 100) / 100));
}

// Las demás acciones no llevan body: el id y el método alcanzan
function accion(hacer: (id: string) => ReturnType<typeof pedidosService.obtener>) {
  return async (req: Request<{ id: string }>, res: Response) => {
    if (!isValidObjectId(req.params.id)) return res.status(404).json({ error: 'No encontrado' });
    res.json(await hacer(req.params.id));
  };
}

// DELETE /api/pedidos/:id/sena  (vuelve a pendiente)
export const quitarSena = accion(pedidosService.quitarSena);
// PUT /api/pedidos/:id/entrega
export const registrarEntrega = accion(pedidosService.registrarEntrega);
// DELETE /api/pedidos/:id/entrega  (vuelve a confirmado o pendiente)
export const quitarEntrega = accion(pedidosService.quitarEntrega);
// PUT /api/pedidos/:id/cancelacion
export const cancelar = accion(pedidosService.cancelar);
// DELETE /api/pedidos/:id/cancelacion  (vuelve a confirmado o pendiente)
export const quitarCancelacion = accion(pedidosService.quitarCancelacion);
