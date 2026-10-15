import { Request } from 'express';

const POR_PAGINA = 20;
const MAXIMO_POR_PAGINA = 100;

export interface Paginado {
  pagina: number;
  limite: number;
}

function enteroPositivo(valor: unknown): number | undefined {
  const n = typeof valor === 'string' ? Number(valor) : NaN;
  return Number.isInteger(n) && n >= 1 ? n : undefined;
}

// ?pagina=1&limite=20 (hasta 100). Un valor que no es un entero positivo usa el de por defecto
export function leerPaginado(query: Request['query']): Paginado {
  return {
    pagina: enteroPositivo(query.pagina) ?? 1,
    limite: Math.min(enteroPositivo(query.limite) ?? POR_PAGINA, MAXIMO_POR_PAGINA),
  };
}
