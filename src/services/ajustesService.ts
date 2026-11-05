import { AJUSTES_POR_DEFECTO, Ajustes, ID_AJUSTES, IAjustes } from '../models/Ajustes';

// Solo los ajustes: sin _id, __v ni fechas
const datos = ({ estiloCatalogo, cerrado, mensajeCerrado }: IAjustes): IAjustes => ({
  estiloCatalogo,
  cerrado,
  mensajeCerrado,
});

export async function obtener(): Promise<IAjustes> {
  const ajustes = await Ajustes.findById(ID_AJUSTES);
  return ajustes ? datos(ajustes) : AJUSTES_POR_DEFECTO;
}

// El primer cambio crea el documento, con los valores por defecto en lo que no viene
export async function actualizar(cambios: Partial<IAjustes>): Promise<IAjustes> {
  const ajustes = await Ajustes.findOneAndUpdate(
    { _id: ID_AJUSTES },
    { $set: cambios },
    { upsert: true, returnDocument: 'after', runValidators: true, setDefaultsOnInsert: true }
  );
  return ajustes ? datos(ajustes) : AJUSTES_POR_DEFECTO;
}

// Si el dueño cerró el negocio por un tiempo: la web no toma pedidos
export async function estaCerrado(): Promise<boolean> {
  return (await obtener()).cerrado;
}
