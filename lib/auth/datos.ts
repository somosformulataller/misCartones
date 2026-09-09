/**
 * Normalización de los dos datos con los que una persona se identifica:
 * la cédula y el teléfono.
 *
 * Existe porque el mismo dato se escribe de muchas formas y todas son la
 * MISMA persona: "V-12.345.678" y "12345678"; "+584121234567" y
 * "04121234567". Comparar el texto crudo deja entrar dos cuentas a nombre
 * de un solo humano, que es justo lo que el "una cédula, una cuenta"
 * intenta impedir.
 */

/** Cédula sin el prefijo de nacionalidad ni puntos ni guiones. */
export function limpiarCedula(v: string): string {
  return String(v ?? '')
    .replace(/^[VvEeJjGg][-\s]?/, '')
    .replace(/\D/g, '');
}

/** Teléfono venezolano en su forma local de 11 dígitos (0412…). */
export function limpiarTelefono(v: string): string {
  let d = String(v ?? '').replace(/\D/g, '');
  if (d.startsWith('58') && d.length >= 12) d = d.slice(2); // vino con +58
  if (d.length === 10 && !d.startsWith('0')) d = '0' + d; // vino sin el cero
  return d;
}
