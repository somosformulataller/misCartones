// El WhatsApp venezolano tiene 11 dígitos: un prefijo de móvil (0412…)
// más 7 dígitos. Exigir esa forma exacta evita los números incompletos
// o los fijos, con los que después no se puede escribir al jugador.
// 0422 es el código nuevo de Digitel y está MUY vivo: 29 de las cuentas
// registradas lo usan, todas de agosto de 2026 en adelante. Dejarlo
// fuera habría bloqueado a los jugadores que se registran hoy.
export const WHATSAPP_PREFIXES = ['0412', '0414', '0416', '0422', '0424', '0426'] as const;
export const WHATSAPP_LOCAL_DIGITS = 7;
export const WHATSAPP_DIGITS = 11;

export const WHATSAPP_MSG =
  'El teléfono debe ser un móvil venezolano: prefijo 0412, 0414, 0416, 0424 o 0426 y 7 dígitos (ejemplo: 04121234567).';

/**
 * Deja el número en su forma de 11 dígitos. Si viene con el prefijo del
 * país ("+584121234567") lo cambia por el 0 inicial, porque es el mismo
 * número; cualquier otra cosa se devuelve como dígitos pelados para que
 * la validación la rechace.
 */
export function normalizeWhatsapp(value: string): string {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (digits.length === WHATSAPP_DIGITS + 1 && digits.startsWith('58')) {
    return `0${digits.slice(2)}`;
  }
  return digits;
}

export function isWhatsappValid(value: string): boolean {
  const norm = normalizeWhatsapp(value);
  return (
    norm.length === WHATSAPP_DIGITS &&
    (WHATSAPP_PREFIXES as readonly string[]).includes(norm.slice(0, 4))
  );
}

/**
 * Parte un número en {prefijo, resto} para rellenar el select y el input
 * del formulario. Si no reconoce el prefijo devuelve el primero de la
 * lista y el número entero como resto, para que el jugador lo corrija.
 */
export function splitWhatsapp(value: string): { prefix: string; rest: string } {
  const norm = normalizeWhatsapp(value);
  const prefix = norm.slice(0, 4);
  if ((WHATSAPP_PREFIXES as readonly string[]).includes(prefix)) {
    return { prefix, rest: norm.slice(4, 4 + WHATSAPP_LOCAL_DIGITS) };
  }
  return { prefix: WHATSAPP_PREFIXES[0], rest: norm.slice(0, WHATSAPP_LOCAL_DIGITS) };
}
