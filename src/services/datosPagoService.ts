import { DatosPago, ID_DATOS_PAGO, IDatosPago } from '../models/DatosPago';
import { ErrorHttp } from '../utils/errores';

const NO_CARGADOS = 'Todavía no hay datos de pago cargados';

// Solo los datos: sin _id, __v ni fechas
const datos = ({ nombreCompleto, alias, cbu, billetera }: IDatosPago): IDatosPago => ({
  nombreCompleto,
  alias,
  cbu,
  billetera,
});

export async function obtener(): Promise<IDatosPago> {
  const guardados = await DatosPago.findById(ID_DATOS_PAGO);
  if (!guardados) throw new ErrorHttp(404, NO_CARGADOS);
  return datos(guardados);
}

// La primera vez los crea y después los reemplaza: siempre vienen los cuatro
export async function guardar(nuevos: IDatosPago): Promise<IDatosPago> {
  const guardados = await DatosPago.findOneAndUpdate(
    { _id: ID_DATOS_PAGO },
    { $set: nuevos },
    { upsert: true, returnDocument: 'after', runValidators: true }
  );
  if (!guardados) throw new Error('No se pudieron guardar los datos de pago');
  return datos(guardados);
}

// La web deja de mostrarlos
export async function borrar() {
  const { deletedCount } = await DatosPago.deleteOne({ _id: ID_DATOS_PAGO });
  if (deletedCount === 0) throw new ErrorHttp(404, NO_CARGADOS);
}
