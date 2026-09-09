/**
 * Cuándo buscar por dígitos sueltos.
 *
 * La gente escribe la cédula de muchas formas ("V-6.436.499",
 * "6.436.499", "6436499") y el teléfono también ("0412-7855651"), pero
 * en la base están en dígitos. Por eso el buscador saca los dígitos de
 * lo escrito y los busca dentro de cédulas y teléfonos.
 *
 * El problema es que casi todo tiene dígitos. Buscar el correo
 * `elena.1973saa@gmail.com` sacaba «1973» y devolvía a cualquiera cuya
 * cédula o teléfono contuviera 1973 — Diego Ruiz aparecía primero al
 * buscar a Elena (20/08/2026). Con una lista de retiros por pagar
 * delante, abrir la ficha equivocada no es un detalle.
 *
 * La regla: los dígitos solo se persiguen cuando lo escrito ES un
 * número. Un correo o un nombre con números dentro se busca tal cual.
 */

/** true si lo escrito es una cédula o un teléfono, no un nombre ni un correo */
export function esBusquedaNumerica(termino: string): boolean {
  const t = termino.trim();
  if (!t || t.includes('@')) return false;
  // Se admite el prefijo de cédula venezolana y los separadores
  // habituales: V-6.436.499, +58 412 7855651, (0412) 785-5651
  return /^[vej]?[\s.\-()+\d]+$/i.test(t);
}

/**
 * Los dígitos con los que buscar en cédulas y teléfonos, o null si lo
 * escrito no es un número. Menos de 4 dígitos no se persigue: devuelve
 * media base.
 */
export function digitosDeBusqueda(termino: string): string | null {
  if (!esBusquedaNumerica(termino)) return null;
  const digitos = termino.replace(/\D/g, '');
  return digitos.length >= 4 ? digitos : null;
}
