import 'dotenv/config';
import mongoose, { Types } from 'mongoose';
import { conectarDB } from '../config/db';
import { Cliente, ICliente } from '../models/Cliente';
import { CAMPOS_INSUMO, IInsumo, ILogInsumo, Insumo, UnidadInsumo } from '../models/Insumo';
import { EstadoPedido, IItemPedido, IPedido, ISena, OrigenPedido, Pedido } from '../models/Pedido';
import { IProducto, Producto, SIN_MAYUSCULAS_NI_ACENTOS } from '../models/Producto';
import { hoyEnArgentina } from '../utils/fecha';
import { normalizarTelefono } from '../utils/telefono';

// Carga clientes, pedidos (con señas, entregas y cancelaciones) e insumos con sus compras, para probar el inicio, la
// lista de pedidos y las métricas: npm run sembrar-pedidos. Los pedidos van de hace 60 días hasta hoy, con los
// productos que ya están cargados y su precio de hoy. No toca los clientes ni los pedidos que ya había.
// Los clientes de ejemplo se reconocen por el teléfono (11 5555-0001 en adelante: de mentira, no les escribas). Si ya
// están, no hace nada; con --rehacer (npm run sembrar-pedidos -- --rehacer) borra esos clientes y sus pedidos y los
// vuelve a sembrar con las fechas corridas a hoy. Los insumos que ya existen se saltean: --rehacer no los toca

// La de Render: los datos de ejemplo van solo en la de pruebas
const BASE_DE_PRODUCCION = 'panaderia-producion';

const DIAS = 60;
const UNA_HORA = 3_600_000;
const UN_MINUTO = 60_000;

// ── Azar con semilla ────────────────────────────────────────────────────────────────────────────────

// Con semilla fija (mulberry32): cada corrida arma los mismos pedidos, corridos a la fecha de hoy
let semilla = 20261026;
function azar() {
  semilla = (semilla + 0x6d2b79f5) | 0;
  let t = Math.imul(semilla ^ (semilla >>> 15), 1 | semilla);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const entre = (min: number, max: number) => min + Math.floor(azar() * (max - min + 1));
const alguno = <T>(lista: readonly T[]): T => lista[Math.floor(azar() * lista.length)];
const conProbabilidad = (probabilidad: number) => azar() < probabilidad;

// ── Fechas ──────────────────────────────────────────────────────────────────────────────────────────

const dosCifras = (n: number) => String(n).padStart(2, '0');
// Argentina no tiene horario de verano desde 2009: siempre es -03:00
const enArgentina = (dia: string, hora: number, minuto: number) =>
  new Date(`${dia}T${dosCifras(hora)}:${dosCifras(minuto)}:00-03:00`);
// Cuenta días de calendario (AAAA-MM-DD), sin pasar por la zona horaria
function diaHace(hoy: string, dias: number) {
  const [anio, mes, dia] = hoy.split('-').map(Number);
  return new Date(Date.UTC(anio, mes - 1, dia - dias)).toISOString().slice(0, 10);
}
const despues = (fecha: Date, horas: number) => new Date(fecha.getTime() + horas * UNA_HORA);
const antesDe = (fecha: Date, tope: Date) => (fecha < tope ? fecha : tope);

// ── Clientes ────────────────────────────────────────────────────────────────────────────────────────

const NOMBRES = [
  'María Gómez',
  'Sofía Fernández',
  'Lucía Romero',
  'Martín Pérez',
  'Valentina Díaz',
  'Juan Ignacio López',
  'Camila Sosa',
  'Florencia Álvarez',
  'Agustín Torres',
  'Carolina Ruiz',
  'Paula Benítez',
  'Diego Acosta',
  'Julieta Medina',
  'Nicolás Herrera',
  'Micaela Castro',
  'Gabriela Suárez',
  'Federico Molina',
  'Romina Ortiz',
  'Laura Giménez',
  'Santiago Rojas',
];
// Los primeros cinco piden seguido: así las métricas tienen clientes que vuelven
const FRECUENTES = 5;
const PESO_FRECUENTE = 6;

const telefonoDeEjemplo = (indice: number) => `11 5555-${String(indice + 1).padStart(4, '0')}`;

// ── Pedidos ─────────────────────────────────────────────────────────────────────────────────────────

// Cuántos pedidos por día, de domingo a sábado: el fin de semana se vende más
const PEDIDOS_POR_DIA = [2, 1, 1, 2, 2, 3, 4];
// Hoy siempre hay unos cuantos, para ver el resumen del inicio
const PEDIDOS_DE_HOY = 4;

const NOTAS = [
  'Retiro después de las 18',
  'Es para un cumpleaños: ¿le pueden poner una vela?',
  'Paso a buscarlo el sábado a la mañana',
  'Lo retira mi hermana',
  'Si se puede, en caja',
];

type ProductoDeEjemplo = Pick<IProducto, 'nombre' | 'precio' | 'categoria' | 'disponible'> & { _id: Types.ObjectId };

// Los de hace días ya se entregaron casi todos; los de hoy y los de los últimos días siguen abiertos
function estadoSegunEdad(edad: number): EstadoPedido {
  const r = azar();
  if (edad === 0) return r < 0.45 ? 'pendiente' : r < 0.85 ? 'confirmado' : 'cancelado';
  if (edad <= 3) return r < 0.25 ? 'pendiente' : r < 0.6 ? 'confirmado' : r < 0.9 ? 'entregado' : 'cancelado';
  return r < 0.02 ? 'pendiente' : r < 0.05 ? 'confirmado' : r < 0.9 ? 'entregado' : 'cancelado';
}

// Sin repetir producto, como leerItems. Nombre, precio y gusto son copia del producto, como en un pedido de verdad
function itemsAlAzar(productos: ProductoDeEjemplo[]): IItemPedido[] {
  const cuantos = Math.min(alguno([1, 1, 1, 2, 2, 3]), productos.length);
  const elegidos = new Set<ProductoDeEjemplo>();
  while (elegidos.size < cuantos) elegidos.add(alguno(productos));
  return [...elegidos].map((producto) => ({
    producto: producto._id,
    nombre: producto.nombre,
    precio: producto.precio,
    categoria: producto.categoria,
    cantidad: alguno([1, 1, 1, 2, 2, 3]),
  }));
}

// La seña: la mitad (lo que pide la web), redondeada al peso de arriba. A veces pagan todo
const montoSena = (total: number) => (conProbabilidad(0.2) ? total : Math.ceil(total / 2));

interface PedidoArmado {
  indiceCliente: number;
  pedido: Omit<IPedido, 'cliente' | 'clienteNombre' | 'clienteTelefono'>;
}

function armarPedido(dia: string, edad: number, ahora: Date, productos: ProductoDeEjemplo[], indiceCliente: number) {
  const inicioDelDia = enArgentina(dia, 0, 0);
  let creado = enArgentina(dia, entre(8, 21), entre(0, 59));
  // Hoy, nunca después de ahora (ni antes de que empiece el día)
  if (creado > ahora) creado = new Date(Math.max(inicioDelDia.getTime(), ahora.getTime() - entre(5, 120) * UN_MINUTO));

  const origen: OrigenPedido = conProbabilidad(0.25) ? 'manual' : 'web';
  // La web solo deja pedir lo activo; el dueño puede anotar un pausado
  const items = itemsAlAzar(origen === 'web' ? productos.filter((producto) => producto.disponible) : productos);
  const total = Math.round(items.reduce((suma, item) => suma + item.precio * item.cantidad, 0) * 100) / 100;
  const estado = estadoSegunEdad(edad);

  const conSena =
    estado === 'confirmado' ||
    (estado === 'entregado' && conProbabilidad(0.7)) ||
    (estado === 'cancelado' && conProbabilidad(0.3));
  // Un pedido manual con seña se carga ya confirmado; uno de la web, cuando el dueño ve la transferencia
  const sena: ISena | undefined = conSena
    ? { monto: montoSena(total), pagadaEn: origen === 'manual' ? creado : antesDe(despues(creado, entre(1, 20)), ahora) }
    : undefined;
  const ultimoPago = sena?.pagadaEn ?? creado;
  const entregadoEn = estado === 'entregado' ? antesDe(despues(ultimoPago, entre(12, 60)), ahora) : undefined;
  const canceladoEn = estado === 'cancelado' ? antesDe(despues(ultimoPago, entre(2, 30)), ahora) : undefined;

  const pedido: PedidoArmado['pedido'] = {
    items,
    total,
    estado,
    origen,
    ...(conProbabilidad(0.2) && { nota: alguno(NOTAS) }),
    ...(sena && { sena }),
    ...(entregadoEn && { entregadoEn }),
    ...(canceladoEn && { canceladoEn }),
    createdAt: creado,
    updatedAt: entregadoEn ?? canceladoEn ?? ultimoPago,
  };
  return { indiceCliente, pedido };
}

// ── Insumos ─────────────────────────────────────────────────────────────────────────────────────────

interface InsumoDeEjemplo {
  nombre: string;
  unidad: UnidadInsumo;
  /** Cuánto viene y cuánto cuesta en la primera compra */
  cantidad: number;
  precio: number;
  /** Cada cuántos días se compra */
  cadaDias: number;
  /** Desde la segunda compra, a veces viene en otro tamaño (con su precio): así la variación se compara por unidad */
  otroTamano?: { cantidad: number; factorPrecio: number };
}

// Harina y manteca no: son las que se cargan a mano en la base de pruebas
const INSUMOS: InsumoDeEjemplo[] = [
  { nombre: 'Azúcar', unidad: 'kg', cantidad: 10, precio: 12000, cadaDias: 15 },
  { nombre: 'Huevos', unidad: 'unidad', cantidad: 180, precio: 36000, cadaDias: 7 },
  { nombre: 'Leche', unidad: 'l', cantidad: 12, precio: 14400, cadaDias: 10 },
  {
    nombre: 'Dulce de leche repostero',
    unidad: 'kg',
    cantidad: 10,
    precio: 38000,
    cadaDias: 20,
    otroTamano: { cantidad: 5, factorPrecio: 0.55 },
  },
  { nombre: 'Crema de leche', unidad: 'l', cantidad: 5, precio: 22000, cadaDias: 14 },
  { nombre: 'Levadura fresca', unidad: 'kg', cantidad: 0.5, precio: 2500, cadaDias: 12 },
];

type Compra = Pick<ILogInsumo, 'nombre' | 'precio' | 'fecha' | 'cantidad' | 'unidad'>;

// Como lo deja insumosService: el alta es la primera compra y cada compra nueva es una actualización que cambia la
// fecha (y el precio, y a veces el tamaño). El historial va de la más nueva a la más vieja
function armarInsumo(semillaInsumo: InsumoDeEjemplo, hoy: string, ahora: Date): IInsumo & { createdAt: Date; updatedAt: Date } {
  const { nombre, unidad, cadaDias, otroTamano } = semillaInsumo;
  const compras: Compra[] = [];
  let precio = semillaInsumo.precio;
  for (let edad = DIAS - entre(0, cadaDias - 1); edad >= 0; edad -= cadaDias) {
    const tamanoDistinto = compras.length > 0 && otroTamano && conProbabilidad(0.4);
    const cantidad = tamanoDistinto ? otroTamano.cantidad : semillaInsumo.cantidad;
    const precioCompra = tamanoDistinto ? Math.round((precio * otroTamano.factorPrecio) / 100) * 100 : precio;
    compras.push({ nombre, precio: precioCompra, fecha: diaHace(hoy, edad), cantidad, unidad });
    // Entre compra y compra sube un poco (y a veces nada)
    precio = Math.round((precio * (1 + entre(0, 6) / 100)) / 100) * 100;
  }

  const logs: ILogInsumo[] = compras.map((compra, indice) => {
    const anterior = compras[indice - 1];
    return {
      ...compra,
      accion: indice === 0 ? 'creacion' : 'actualizacion',
      cambios: anterior ? CAMPOS_INSUMO.filter((campo) => compra[campo] !== anterior[campo]) : [],
      registradoEn: antesDe(enArgentina(compra.fecha, entre(9, 19), entre(0, 59)), ahora),
    };
  });
  const ultima = compras[compras.length - 1];
  return {
    ...ultima,
    logs: logs.reverse(),
    createdAt: logs[logs.length - 1].registradoEn,
    updatedAt: logs[0].registradoEn,
  };
}

// ── Siembra ─────────────────────────────────────────────────────────────────────────────────────────

async function main() {
  const rehacer = process.argv.includes('--rehacer');
  await conectarDB();
  const base = mongoose.connection.name;
  if (base === BASE_DE_PRODUCCION) throw new Error(`«${base}» es la base de producción: los datos de ejemplo van en la de pruebas`);
  console.log(`Base: ${base}`);

  const telefonos = NOMBRES.map((_, indice) => {
    const telefono = normalizarTelefono(telefonoDeEjemplo(indice));
    if (!telefono) throw new Error(`El teléfono de ejemplo ${telefonoDeEjemplo(indice)} no es válido`);
    return telefono;
  });

  const yaSembrados = await Cliente.find({ telefono: { $in: telefonos } }).select('_id').lean();
  if (yaSembrados.length > 0) {
    if (!rehacer) {
      console.log('Los pedidos de ejemplo ya están cargados. Para volver a sembrarlos con fechas de hoy: npm run sembrar-pedidos -- --rehacer');
      return mongoose.disconnect();
    }
    const ids = yaSembrados.map((cliente) => cliente._id);
    const { deletedCount } = await Pedido.deleteMany({ cliente: { $in: ids } });
    await Cliente.deleteMany({ _id: { $in: ids } });
    console.log(`Borré los ${ids.length} clientes de ejemplo y sus ${deletedCount} pedidos`);
  }

  const productos = await Producto.find().select('nombre precio categoria disponible').lean<ProductoDeEjemplo[]>();
  if (!productos.some((producto) => producto.disponible)) {
    throw new Error('No hay productos activos: corré primero npm run sembrar o cargalos desde la app');
  }

  const hoy = hoyEnArgentina();
  const ahora = new Date();
  const bolsaDeClientes = NOMBRES.flatMap((_, indice) => Array<number>(indice < FRECUENTES ? PESO_FRECUENTE : 1).fill(indice));

  const armados: PedidoArmado[] = [];
  for (let edad = DIAS; edad >= 0; edad--) {
    const dia = diaHace(hoy, edad);
    const diaDeLaSemana = new Date(`${dia}T12:00:00Z`).getUTCDay();
    const cantidad = edad === 0 ? PEDIDOS_DE_HOY : Math.max(0, PEDIDOS_POR_DIA[diaDeLaSemana] + entre(-1, 1));
    for (let i = 0; i < cantidad; i++) {
      armados.push(armarPedido(dia, edad, ahora, productos, alguno(bolsaDeClientes)));
    }
  }
  armados.sort((a, b) => a.pedido.createdAt.getTime() - b.pedido.createdAt.getTime());

  // Solo los que pidieron algo: un cliente se crea al hacer su primer pedido
  const clientes = new Map<number, ICliente & { _id: Types.ObjectId; createdAt: Date; updatedAt: Date }>();
  for (const { indiceCliente, pedido } of armados) {
    const cliente = clientes.get(indiceCliente);
    if (cliente) cliente.updatedAt = pedido.createdAt;
    else {
      clientes.set(indiceCliente, {
        _id: new Types.ObjectId(),
        telefono: telefonos[indiceCliente],
        nombre: NOMBRES[indiceCliente],
        createdAt: pedido.createdAt,
        updatedAt: pedido.createdAt,
      });
    }
  }

  // timestamps: false para que queden las fechas armadas (los pedidos de hace días se hicieron hace días)
  await Cliente.insertMany([...clientes.values()], { timestamps: false });
  const pedidos = await Pedido.insertMany(
    armados.map(({ indiceCliente, pedido }) => {
      const cliente = clientes.get(indiceCliente);
      if (!cliente) throw new Error('Falta el cliente del pedido');
      return { ...pedido, cliente: cliente._id, clienteNombre: cliente.nombre, clienteTelefono: cliente.telefono };
    }),
    { timestamps: false }
  );

  let insumosNuevos = 0;
  for (const semillaInsumo of INSUMOS) {
    if (await Insumo.exists({ nombre: semillaInsumo.nombre }).collation(SIN_MAYUSCULAS_NI_ACENTOS)) {
      console.log(`· ${semillaInsumo.nombre}: ya existe, lo salteo`);
      continue;
    }
    await Insumo.insertMany([armarInsumo(semillaInsumo, hoy, ahora)], { timestamps: false });
    insumosNuevos++;
  }

  const porEstado = (estado: EstadoPedido) => pedidos.filter((pedido) => pedido.estado === estado).length;
  const ventas = pedidos.filter((pedido) => pedido.estado !== 'cancelado');
  const deHoy = ventas.filter((pedido) => pedido.createdAt >= enArgentina(hoy, 0, 0));
  const pesos = (monto: number) => `$${monto.toLocaleString('es-AR')}`;
  console.log(`\nListo: ${clientes.size} clientes y ${pedidos.length} pedidos de ${diaHace(hoy, DIAS)} a ${hoy}`);
  console.log(
    `  ${porEstado('pendiente')} esperando la seña · ${porEstado('confirmado')} con la seña pagada · ` +
      `${porEstado('entregado')} entregados · ${porEstado('cancelado')} cancelados`
  );
  console.log(`  ${pedidos.filter((pedido) => pedido.sena).length} con seña · ${pedidos.filter((pedido) => pedido.origen === 'manual').length} cargados a mano`);
  console.log(`  Vendido: ${pesos(ventas.reduce((suma, pedido) => suma + pedido.total, 0))} (hoy: ${deHoy.length} pedidos)`);
  console.log(`  Insumos: ${insumosNuevos} nuevos con sus compras`);
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
