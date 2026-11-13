// Guarda en memoria el resultado de una consulta que se lee mucho y cambia poco (la carta, los filtros, los ajustes),
// así la web no va a Mongo en cada visita. Quien escribe esos datos llama a olvidar() después de guardar.
// - Se guarda la promesa: dos pedidos a la vez comparten la misma consulta.
// - Un error no se guarda: el próximo pedido vuelve a consultar.
// - `duracionMs` es la red de seguridad para lo que cambia por fuera de la API (un script, Atlas a mano).
// - Vale porque Render corre UNA sola instancia: con dos, cada una tendría su copia y una no se enteraría del cambio.
export function cacheEnMemoria<T>({ duracionMs, maxClaves = 100 }: { duracionMs: number; maxClaves?: number }) {
  const guardados = new Map<string, { vence: number; valor: Promise<T> }>();

  return {
    obtener(clave: string, calcular: () => Promise<T>): Promise<T> {
      const ahora = Date.now();
      const guardado = guardados.get(clave);
      if (guardado && guardado.vence > ahora) return guardado.valor;

      // Que no crezca sin límite con combinaciones de filtros raras
      if (guardados.size >= maxClaves) guardados.clear();
      // Promise.resolve: una consulta de Mongoose no es una promesa, y cada .then/.catch la volvería a ejecutar
      // ("Query was already executed"). Así se ejecuta una sola vez y lo que se guarda es una promesa de verdad
      const entrada = { vence: ahora + duracionMs, valor: Promise.resolve(calcular()) };
      guardados.set(clave, entrada);
      entrada.valor.catch(() => {
        if (guardados.get(clave) === entrada) guardados.delete(clave);
      });
      return entrada.valor;
    },

    // Después de guardar (no antes): una consulta que arrancó durante la escritura no queda guardada con lo viejo
    olvidar() {
      guardados.clear();
    },
  };
}
