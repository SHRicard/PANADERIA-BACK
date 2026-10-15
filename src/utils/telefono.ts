import { parsePhoneNumberFromString } from 'libphonenumber-js/max';

// Devuelve el teléfono en E.164 (ej. +5491155551234) o null si no es un número válido. País por defecto: Argentina.
export function normalizarTelefono(valor: string): string | null {
  const numero = parsePhoneNumberFromString(valor, 'AR');
  if (!numero?.isValid()) return null;
  if (numero.country !== 'AR') return numero.number;

  // En Argentina el mismo celular se escribe con 9, con 15 o sin nada, y "11 5555-1234" parsea como fijo.
  // Como el teléfono identifica al cliente, todas las formas se guardan como celular (+549...).
  const celular = parsePhoneNumberFromString(`+549${numero.nationalNumber.replace(/^9/, '')}`);
  return celular?.isValid() ? celular.number : numero.number;
}
