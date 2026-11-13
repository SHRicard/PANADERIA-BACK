export const ZONA_ARGENTINA = 'America/Argentina/Buenos_Aires';

// en-CA formatea como AAAA-MM-DD. Con la zona de Argentina: Render corre en UTC y a las 21 hs ya sería mañana
const formatoDia = new Intl.DateTimeFormat('en-CA', { timeZone: ZONA_ARGENTINA });

// El día de hoy en Argentina, como AAAA-MM-DD
export function hoyEnArgentina(): string {
  return formatoDia.format(new Date());
}

// El día en Argentina de un momento guardado: entregado el 25 a las 22 hs es el 25 (en UTC ya sería el 26)
export function diaEnArgentina(fecha: Date): string {
  return formatoDia.format(fecha);
}

const DIA_MS = 24 * 60 * 60 * 1000;

// Las cuentas de días (AAAA-MM-DD) van en UTC a propósito: son días de calendario, sin hora ni zona
export function sumarDias(dia: string, dias: number): string {
  return new Date(Date.parse(`${dia}T00:00:00Z`) + dias * DIA_MS).toISOString().slice(0, 10);
}

// Cuántos días van de un día al otro: del 23/11 al 30/11, 7
export function diasEntre(desde: string, hasta: string): number {
  return Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / DIA_MS);
}

// El último día del mes de ese día: 2026-11-12 → 2026-11-30
export function finDeMes(dia: string): string {
  const [anio, mes] = dia.split('-').map(Number);
  // El día 0 del mes siguiente es el último de este (mes ya viene contado desde 1)
  return new Date(Date.UTC(anio, mes, 0)).toISOString().slice(0, 10);
}

// Para los mensajes: 2026-11-25 → 25/11
export function fechaCorta(dia: string): string {
  const [, mes, numero] = dia.split('-');
  return `${numero}/${mes}`;
}

// Un día de calendario AAAA-MM-DD que existe: "2026-02-30" no pasa
export function esFechaValida(texto: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(texto)) return false;
  const fecha = new Date(`${texto}T00:00:00Z`);
  return !Number.isNaN(fecha.getTime()) && fecha.toISOString().slice(0, 10) === texto;
}
