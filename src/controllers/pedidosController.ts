import { Request, Response } from 'express';
import { isValidObjectId } from 'mongoose';
import { ESTADOS_PEDIDO, EstadoPedido, FECHA_ENTREGA_INVALIDA } from '../models/Pedido';
import * as pedidosService from '../services/pedidosService';
import { esFechaValida } from '../utils/fecha';
import { leerPaginado } from '../utils/paginado';
import { normalizarTelefono } from '../utils/telefono';
import { leerItems } from './carritoController';

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

function esEstado(valor: unknown): valor is EstadoPedido {
  return typeof valor === 'string' && (ESTADOS_PEDIDO as readonly string[]).includes(valor);
}

const esFechaEntrega = (valor: unknown): valor is string => typeof valor === 'string' && esFechaValida(valor);

const ITEMS_FUERA_DE_RANGO = 'El pedido tiene que tener entre 1 y 30 productos';

// Devuelve los datos listos para el servicio, o el mensaje de error
const FORMATO_INTENTO = /^[A-Za-z0-9-]{16,64}$/;
const INTENTO_INVALIDO = 'intento tiene que ser una clave de 16 a 64 letras, números o guiones';

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

  // Opcional: sin el campo (o null), lo pasa a retirar. Así la web de antes sigue pudiendo mandar pedidos
  const conEnvio = body.conEnvio ?? false;
  if (typeof conEnvio !== 'boolean') return 'conEnvio tiene que ser true (con envío) o false (lo pasa a retirar)';

  // ⚠️ Transición: opcional mientras la web y la app de antes no la mandan. Cuando las dos estén actualizadas (y se
  // haya corrido migrar-fecha-entrega), sin fecha pasa a ser un 400. Las reglas del cliente las revisa el servicio
  const fechaEntrega = body.fechaEntrega ?? undefined;
  if (fechaEntrega !== undefined && !esFechaEntrega(fechaEntrega)) return FECHA_ENTREGA_INVALIDA;

  // Los productos repetidos se juntan en un solo item sumando las cantidades (las mismas reglas que el carrito)
  const cantidades = leerItems(body.items, { minimo: 1, fueraDeRango: ITEMS_FUERA_DE_RANGO });
  if (typeof cantidades === 'string') return cantidades;

  // Opcional: la clave de este intento de la web, para no crear dos veces el mismo pedido (pedidosService.crear)
  const intento = body.intento ?? undefined;
  if (intento !== undefined && (typeof intento !== 'string' || !FORMATO_INTENTO.test(intento))) return INTENTO_INVALIDO;

  return { nombre, telefono, cantidades, nota, conEnvio, fechaEntrega, intento };
}

// POST /api/pedidos  { cliente: { nombre, telefono }, items: [{ productoId, cantidad }], fechaEntrega, nota?, conEnvio?,
// intento? }  (pública). Con el mismo `intento` dos veces, responde el pedido que ya se había creado (201 igual)
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
    conEnvio: pedido.conEnvio,
    fechaEntrega: pedido.fechaEntrega ?? null,
    createdAt: pedido.createdAt,
  });
}

const MONTO_SENA_INVALIDO = 'El monto de la seña tiene que ser un número, 0 o más';

// 0 = el dueño lo confirma sin seña (botón «Sin seña» de la app)
const esMontoValido = (monto: unknown): monto is number =>
  typeof monto === 'number' && Number.isFinite(monto) && monto >= 0;

// POST /api/pedidos/manuales  { cliente: { nombre, telefono }, items: [{ productoId, cantidad }], fechaEntrega, nota?,
// conEnvio?, sena?: { monto } }  El dueño carga un pedido que le hicieron por fuera de la web (cualquier día, sin las
// reglas de la agenda). Responde 201 con el detalle
export async function crearManual(req: Request, res: Response) {
  const datos = leerPedido(req.body);
  if (typeof datos === 'string') return res.status(400).json({ error: datos });

  // Sin sena (o null): entra pendiente. Con sena: el cliente ya la transfirió (o 0: sin seña) y entra confirmado
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

// GET /api/pedidos?estado=pendiente&fechaEntrega=2026-11-25&pagina=1&limite=20
export async function listar(req: Request, res: Response) {
  const { estado, fechaEntrega } = req.query;
  if (estado !== undefined && !esEstado(estado)) {
    return res.status(400).json({ error: `estado tiene que ser uno de: ${ESTADOS_PEDIDO.join(', ')}` });
  }
  if (fechaEntrega !== undefined && !esFechaEntrega(fechaEntrega)) {
    return res.status(400).json({ error: FECHA_ENTREGA_INVALIDA });
  }
  res.json(await pedidosService.listar({ estado, fechaEntrega }, leerPaginado(req.query)));
}

// GET /api/pedidos/:id  (con los datos del cliente y cuántos pedidos tiene)
export async function detalle(req: Request<{ id: string }>, res: Response) {
  if (!isValidObjectId(req.params.id)) return res.status(404).json({ error: 'No encontrado' });
  res.json(await pedidosService.obtener(req.params.id));
}

// PUT /api/pedidos/:id/sena  { monto }  Confirma la seña (0 = sin seña) o corrige su monto
export async function registrarSena(req: Request<{ id: string }>, res: Response) {
  if (!isValidObjectId(req.params.id)) return res.status(404).json({ error: 'No encontrado' });

  const monto: unknown = esObjeto(req.body) ? req.body.monto : undefined;
  if (!esMontoValido(monto)) return res.status(400).json({ error: MONTO_SENA_INVALIDO });
  res.json(await pedidosService.registrarSena(req.params.id, Math.round(monto * 100) / 100));
}

// PUT /api/pedidos/:id/fecha-entrega  { fechaEntrega }  El cliente le pidió otro día al dueño (sin reglas: cualquier día)
export async function cambiarFechaEntrega(req: Request<{ id: string }>, res: Response) {
  if (!isValidObjectId(req.params.id)) return res.status(404).json({ error: 'No encontrado' });

  const fechaEntrega: unknown = esObjeto(req.body) ? req.body.fechaEntrega : undefined;
  if (!esFechaEntrega(fechaEntrega)) return res.status(400).json({ error: FECHA_ENTREGA_INVALIDA });
  res.json(await pedidosService.cambiarFechaEntrega(req.params.id, fechaEntrega));
}

// PUT /api/pedidos/:id/items  { items: [{ productoId, cantidad }] }
// La lista completa de productos (suma, saca o cambia cantidades): reemplaza la del pedido. Responde el detalle
export async function editarItems(req: Request<{ id: string }>, res: Response) {
  if (!isValidObjectId(req.params.id)) return res.status(404).json({ error: 'No encontrado' });

  const items: unknown = esObjeto(req.body) ? req.body.items : undefined;
  const cantidades = leerItems(items, { minimo: 1, fueraDeRango: ITEMS_FUERA_DE_RANGO });
  if (typeof cantidades === 'string') return res.status(400).json({ error: cantidades });

  const resultado = await pedidosService.editarItems(req.params.id, cantidades);
  if (resultado.noDisponibles) {
    return res.status(400).json({
      error: 'Hay productos que no existen',
      productosNoDisponibles: resultado.noDisponibles,
    });
  }
  res.json(resultado.pedido);
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
// PUT /api/pedidos/:id/visto  (el dueño ya lo vio: deja de ser nuevo)
export const marcarVisto = accion((id) => pedidosService.marcarVisto(id, true));
// DELETE /api/pedidos/:id/visto  (vuelve a nuevo, por si lo marcó sin querer)
export const quitarVisto = accion((id) => pedidosService.marcarVisto(id, false));
// PUT /api/pedidos/:id/envio  (el cliente quiere que se lo manden)
export const marcarEnvio = accion((id) => pedidosService.cambiarEnvio(id, true));
// DELETE /api/pedidos/:id/envio  (lo pasa a retirar)
export const quitarEnvio = accion((id) => pedidosService.cambiarEnvio(id, false));
