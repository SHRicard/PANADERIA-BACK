import 'dotenv/config';
import mongoose from 'mongoose';
import { conectarDB } from '../config/db';
import { EstadoPedido, Pedido } from '../models/Pedido';
import { Producto } from '../models/Producto';
import { fechaDeUnPedidoViejo } from '../services/agendaService';

// Les pone fecha de entrega a los pedidos de antes de la agenda: npm run migrar-fecha-entrega
// Entregado → el día que se entregó · confirmado → el día de la seña · cancelado → el día que se hizo · pendiente → el
// día que se hizo más 1 o 2 días según el producto que más demora (fechaDeUnPedidoViejo; las fechas, en Argentina).
// Solo toca los que no la tienen: se puede correr más de una vez. Va en las dos bases (la del .env y, con MONGODB_URI
// en el comando, la de producción) DESPUÉS de que la web y la app manden la fecha, y ANTES de volverla obligatoria

// Un producto que ya no existe: se cuenta como de 24 hs
const HORAS_SI_NO_EXISTE = 24;

async function main() {
  await conectarDB();
  console.log(`Base: ${mongoose.connection.name}`);

  const pedidos = await Pedido.find({ fechaEntrega: { $exists: false } })
    .select('estado createdAt entregadoEn sena items.producto')
    .lean();
  if (pedidos.length === 0) {
    console.log('No hay pedidos sin fecha de entrega');
    return mongoose.disconnect();
  }

  const ids = [...new Set(pedidos.flatMap((pedido) => pedido.items.map((item) => String(item.producto))))];
  const productos = await Producto.find({ _id: { $in: ids } }).select('anticipacionHoras').lean();
  const horasDe = new Map(productos.map((producto) => [String(producto._id), producto.anticipacionHoras]));

  const porEstado = new Map<EstadoPedido, number>();
  // Los que no tienen el dato que pide su estado (de antes del 17/10, cuando el estado se cambiaba directo)
  let sinDato = 0;
  const abiertos: string[] = [];

  const operaciones = pedidos.map((pedido) => {
    const horas = Math.max(0, ...pedido.items.map((item) => horasDe.get(String(item.producto)) ?? HORAS_SI_NO_EXISTE));
    const fechaEntrega = fechaDeUnPedidoViejo(pedido, horas);

    porEstado.set(pedido.estado, (porEstado.get(pedido.estado) ?? 0) + 1);
    if ((pedido.estado === 'entregado' && !pedido.entregadoEn) || (pedido.estado === 'confirmado' && !pedido.sena)) sinDato++;
    if (pedido.estado === 'pendiente' || pedido.estado === 'confirmado') abiertos.push(`${pedido._id} → ${fechaEntrega}`);

    return {
      updateOne: {
        // Otra vez la condición: si entre la lectura y la escritura alguien le puso fecha, no se pisa
        filter: { _id: pedido._id, fechaEntrega: { $exists: false } },
        update: { $set: { fechaEntrega } },
      },
    };
  });

  // No es una edición del dueño: no les cambia la fecha de modificación
  const { modifiedCount } = await Pedido.bulkWrite(operaciones, { timestamps: false });

  console.log(`${modifiedCount} pedidos quedaron con fecha de entrega`);
  for (const [estado, cantidad] of porEstado) console.log(`  ${estado}: ${cantidad}`);
  if (sinDato > 0) console.log(`  ${sinDato} sin el dato de su estado: van con la regla del pendiente`);
  if (abiertos.length > 0) {
    // Solo ids: nada de nombres ni teléfonos en los logs
    console.log(`\nSiguen abiertos (el dueño puede cambiarles la fecha desde la app):`);
    abiertos.forEach((linea) => console.log(`  ${linea}`));
  }
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
