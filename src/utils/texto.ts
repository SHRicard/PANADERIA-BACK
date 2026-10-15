// "Sándwiches" → "sandwiches": para comparar sin importar mayúsculas ni acentos
export function sinAcentos(texto: string) {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

const VARIANTES: Record<string, string> = { a: 'aáÁ', e: 'eéÉ', i: 'iíÍ', o: 'oóÓ', u: 'uúüÚÜ', n: 'nñÑ' };

// Para buscar por una parte del texto sin importar mayúsculas ni acentos:
// "sandwich" encuentra "Sándwich de miga" y "PAN" encuentra "Pan dulce"
export function regexSinAcentos(texto: string) {
  const patron = [...sinAcentos(texto)]
    .map((letra) => (VARIANTES[letra] ? `[${VARIANTES[letra]}]` : letra.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    .join('');
  return new RegExp(patron, 'i');
}
