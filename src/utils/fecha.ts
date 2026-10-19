export const ZONA_ARGENTINA = 'America/Argentina/Buenos_Aires';

// en-CA formatea como AAAA-MM-DD. Con la zona de Argentina: Render corre en UTC y a las 21 hs ya sería mañana
const formatoDia = new Intl.DateTimeFormat('en-CA', { timeZone: ZONA_ARGENTINA });

// El día de hoy en Argentina, como AAAA-MM-DD
export function hoyEnArgentina(): string {
  return formatoDia.format(new Date());
}

// Un día de calendario AAAA-MM-DD que existe: "2026-02-30" no pasa
export function esFechaValida(texto: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(texto)) return false;
  const fecha = new Date(`${texto}T00:00:00Z`);
  return !Number.isNaN(fecha.getTime()) && fecha.toISOString().slice(0, 10) === texto;
}
