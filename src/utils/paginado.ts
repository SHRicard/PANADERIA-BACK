import { Request } from 'express';
import { ErrorHttp } from './errores';

const POR_PAGINA = 20;
const MAXIMO_POR_PAGINA = 100;

export interface Paginado {
  pagina: number;
  limite: number;
}

// Sin el parámetro (o vacío) va el de por defecto. Si viene, tiene que ser un entero desde 1 (y el límite, hasta 100):
// si no, 400, igual que el resto de los parámetros inválidos. Antes se corregía solo y un error del front pasaba sin
// que nadie se enterara. El 400 lo responde el manejador central de index.ts (ErrorHttp)
function leerEntero(query: Request['query'], nombre: 'pagina' | 'limite', porDefecto: number, maximo?: number): number {
  const valor = query[nombre];
  if (valor === undefined || valor === '') return porDefecto;
  const n = typeof valor === 'string' && /^\d+$/.test(valor) ? Number(valor) : NaN;
  if (!Number.isSafeInteger(n) || n < 1) {
    throw new ErrorHttp(400, `${nombre} tiene que ser un número entero desde 1`);
  }
  if (maximo !== undefined && n > maximo) {
    throw new ErrorHttp(400, `${nombre} puede ser como mucho ${maximo}`);
  }
  return n;
}

// ?pagina=1&limite=20 (hasta 100). Un valor que no es un entero desde 1, o un límite de más de 100, da 400
export function leerPaginado(query: Request['query']): Paginado {
  return {
    pagina: leerEntero(query, 'pagina', 1),
    limite: leerEntero(query, 'limite', POR_PAGINA, MAXIMO_POR_PAGINA),
  };
}
