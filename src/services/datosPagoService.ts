import { DatosPago, ID_DATOS_PAGO, IDatosPago } from '../models/DatosPago';
import { ErrorHttp } from '../utils/errores';
import { cacheEnMemoria } from '../utils/memoria';

// La web los pide después de cada pedido y cambian muy poco. Se guarda también que no hay (null): si no, mientras no
// estén cargados, cada pedido iría a Mongo
const datosEnMemoria = cacheEnMemoria<IDatosPago | null>({ duracionMs: 5 * 60 * 1000 });

const NO_CARGADOS = 'Todavía no hay datos de pago cargados';

// Solo los datos: sin _id, __v ni fechas
const datos = ({ nombreCompleto, alias, cbu, billetera }: IDatosPago): IDatosPago => ({
  nombreCompleto,
  alias,
  cbu,
  billetera,
});

export async function obtener(): Promise<IDatosPago> {
  const guardados = await datosEnMemoria.obtener('datos', async () => {
    const encontrados = await DatosPago.findById(ID_DATOS_PAGO);
    return encontrados ? datos(encontrados) : null;
  });
  if (!guardados) throw new ErrorHttp(404, NO_CARGADOS);
  return guardados;
}

// La primera vez los crea y después los reemplaza: siempre vienen los cuatro
export async function guardar(nuevos: IDatosPago): Promise<IDatosPago> {
  const guardados = await DatosPago.findOneAndUpdate(
    { _id: ID_DATOS_PAGO },
    { $set: nuevos },
    { upsert: true, returnDocument: 'after', runValidators: true }
  );
  if (!guardados) throw new Error('No se pudieron guardar los datos de pago');
  datosEnMemoria.olvidar();
  return datos(guardados);
}

// La web deja de mostrarlos
export async function borrar() {
  const { deletedCount } = await DatosPago.deleteOne({ _id: ID_DATOS_PAGO });
  datosEnMemoria.olvidar();
  if (deletedCount === 0) throw new ErrorHttp(404, NO_CARGADOS);
}
