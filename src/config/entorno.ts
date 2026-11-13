// Dónde corre la API: en Render (producción) o en la compu de quien desarrolla.
// Render define RENDER=true en todos sus servicios, así que no hace falta configurar nada allá.
//
// Por qué importa: el .env local apunta a la MISMA base que producción. Sin este corte, cada petición de una prueba
// local se guardaba en `logs` (y aparecía en Más → Logs de la app como si fuera un cliente), una prueba con errores
// podía mandarles a los admins el aviso de IP sospechosa por email, y al arrancar Mongoose creaba en la base real los
// índices que encontrara en el código.

/** true en Render (producción); false en la compu */
export const enProduccion = process.env.RENDER === 'true';

/**
 * Si las peticiones se guardan en `logs` (y disparan el aviso de IP sospechosa). En Render, sí; en la compu, no.
 * GUARDAR_LOGS=true o false en el .env lo fuerza (por ejemplo, para probar Más → Logs en local)
 */
export const guardarLogs = process.env.GUARDAR_LOGS ? process.env.GUARDAR_LOGS === 'true' : enProduccion;

/**
 * Si Mongoose crea los índices y las colecciones que falten al conectarse. Solo en Render: desde la compu no se
 * tocan los índices de la base real. CREAR_INDICES=true en el .env lo fuerza
 */
export const crearIndices = process.env.CREAR_INDICES ? process.env.CREAR_INDICES === 'true' : enProduccion;
