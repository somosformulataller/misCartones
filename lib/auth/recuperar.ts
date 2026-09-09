import { limpiarCedula, limpiarTelefono } from '@/lib/auth/datos';

// Recuperar la contraseña con tres datos: correo, cédula y teléfono.
//
// Aquí vive SOLO lo que no toca la red: limpiar lo que escribió la
// persona y decidir si cuadra con su cuenta. Se prueba sola, que es lo
// que importa cuando de esto depende quién entra a una cuenta con
// dinero dentro.
//
// Dos criterios, y conviene entender por qué se contradicen a medias:
//
//  · **Limpiar antes que rechazar** al leer lo que escriben. Nadie
//    teclea «04121234567»: teclean «+58 412 123 4567» o «0412-1234567»,
//    y copian la cédula de su carnet con puntos. Rechazarles eso es
//    dejarlos fuera de su cuenta por un guion. Se reutiliza la misma
//    limpieza del panel (`playerProfile`), ya probada.
//
//  · **Comparar sin ninguna manga ancha.** Después de limpiar, o es
//    idéntico o no vale. Nada de «se parece», nada de comparar solo los
//    últimos dígitos: eso convertiría un dato de 8 cifras en uno de 4.

/** Horas sin poder retirar tras recuperar la cuenta.
 *  Está también en la migración 023 (request_withdrawal): si cambia
 *  aquí, hay que cambiarlo allí. */
export const HORAS_FRENO_RETIRO = 24;

/** Intentos por correo y por IP en una hora antes de cortar */
export const LIMITE_POR_CORREO = 5;
export const LIMITE_POR_IP = 10;

/** Minutos que vale el permiso entre «tus datos cuadran» y la nueva contraseña */
export const MINUTOS_PERMISO = 10;

/** Lo mínimo que Supabase acepta como contraseña */
export const CLAVE_MINIMA = 6;

/**
 * El mismo mensaje para todo fallo de identidad.
 *
 * No se dice NUNCA cuál de los tres datos falló, ni siquiera si existe
 * una cuenta con ese correo. Decirlo convierte una adivinanza de tres
 * datos a la vez en tres adivinanzas por separado, que es un problema
 * muchísimo más fácil.
 */
export const NO_CUADRA =
  'Esos datos no coinciden con ninguna cuenta. Revisa que el correo, la cédula y el ' +
  'teléfono sean los que registraste. Si no lo consigues, escríbenos y te ayudamos.';

export interface DatosDeIdentidad {
  correo: string;
  cedula: string;
  telefono: string;
}

/** Lo que la cuenta tiene guardado, para comparar */
export interface CuentaGuardada {
  cedula?: string | null;
  whatsapp?: string | null;
  payout_cedula?: string | null;
  payout_phone?: string | null;
}

const vacio = (v: unknown) => v === null || v === undefined || String(v).trim() === '';

/** El correo, en minúsculas y sin espacios alrededor */
export const limpiarCorreo = (v: string) => String(v ?? '').trim().toLowerCase();

/**
 * Deja los tres datos como se van a comparar. Devuelve `null` en el
 * campo que ni siquiera tiene forma de dato (vacío, o cuatro dígitos
 * sueltos): eso no llega a compararse.
 */
export function limpiarDatos(entrada: DatosDeIdentidad) {
  const cedula = limpiarCedula(String(entrada.cedula ?? ''));
  const telefono = limpiarTelefono(String(entrada.telefono ?? ''));
  return {
    correo: limpiarCorreo(entrada.correo) || null,
    cedula: cedula.length >= 6 && cedula.length <= 9 ? cedula : null,
    telefono: telefono.length === 11 ? telefono : null,
  };
}

/** ¿Están los tres campos con pinta de dato? (antes de mirar la cuenta) */
export function faltaAlgo(entrada: DatosDeIdentidad): boolean {
  const d = limpiarDatos(entrada);
  return !d.correo || !d.cedula || !d.telefono;
}

/**
 * ¿La cédula escrita es la de esta cuenta?
 *
 * Se compara con la del REGISTRO, que es la que fija la identidad. La
 * de cobro solo entra si la de registro está vacía: hay dos cuentas
 * viejas así, y dejarlas fuera de la recuperación por un hueco nuestro
 * no tendría sentido. Nunca al revés: quien tenga cédula de registro se
 * compara con ESA, aunque su cédula de cobro sea otra.
 */
export function cedulaCuadra(escrita: string | null, cuenta: CuentaGuardada): boolean {
  if (!escrita) return false;
  const guardada = !vacio(cuenta.cedula) ? cuenta.cedula : cuenta.payout_cedula;
  if (vacio(guardada)) return false;
  return limpiarCedula(String(guardada)) === escrita;
}

/** Igual con el teléfono: el del registro manda; el de cobro es el respaldo */
export function telefonoCuadra(escrito: string | null, cuenta: CuentaGuardada): boolean {
  if (!escrito) return false;
  const guardado = !vacio(cuenta.whatsapp) ? cuenta.whatsapp : cuenta.payout_phone;
  if (vacio(guardado)) return false;
  return limpiarTelefono(String(guardado)) === escrito;
}

/**
 * El veredicto: ¿esta persona es la dueña de esta cuenta?
 *
 * Todo o nada. No se devuelve qué falló —quien llama solo sabe sí o
 * no— para que no haya forma de que ese detalle se escape a la
 * pantalla por descuido.
 */
export function esLaDuena(entrada: DatosDeIdentidad, cuenta: CuentaGuardada): boolean {
  const d = limpiarDatos(entrada);
  if (!d.correo || !d.cedula || !d.telefono) return false;
  return cedulaCuadra(d.cedula, cuenta) && telefonoCuadra(d.telefono, cuenta);
}

/** ¿Vale esta contraseña nueva? */
export function revisarClaveNueva(
  clave: string,
  repetida: string
): { ok: true } | { ok: false; error: string } {
  if (!clave || clave.length < CLAVE_MINIMA) {
    return { ok: false, error: `La contraseña debe tener al menos ${CLAVE_MINIMA} caracteres.` };
  }
  if (clave !== repetida) return { ok: false, error: 'Las dos contraseñas no son iguales.' };
  return { ok: true };
}

/** Cuándo queda libre el retiro tras recuperar la cuenta */
export const retiroLibreDesde = (recuperadaEn: string | Date) =>
  new Date(new Date(recuperadaEn).getTime() + HORAS_FRENO_RETIRO * 3_600_000);

/** ¿Sigue frenado el retiro de esta cuenta? */
export function retiroFrenado(
  recuperadaEn: string | null | undefined,
  ahora: Date = new Date()
): boolean {
  if (!recuperadaEn) return false;
  return retiroLibreDesde(recuperadaEn).getTime() > ahora.getTime();
}
