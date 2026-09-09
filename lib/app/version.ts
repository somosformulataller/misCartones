/**
 * Qué versión de la app está corriendo en esta pestaña.
 *
 * Tras un deploy, una pestaña abierta se queda con el código de ese
 * día. `VersionReload` lo vigila y recarga cuando puede hacerlo sin
 * molestar — pero espera a que no haya texto a medio escribir ni una
 * partida en curso, y esas dos condiciones se cumplen justo en el peor
 * momento: alguien con el modal de comprar abierto y la referencia ya
 * tecleada nunca se actualiza.
 *
 * Pasó el fin de semana del 23/08/2026: una persona adjuntaba su
 * comprobante, la app se lo mostraba adjunto, y al enviar le decía que
 * no lo había adjuntado. Su pestaña era anterior al 18/08, cuando la
 * compra pasó a viajar como FormData con la imagen dentro; mandaba JSON
 * a secas y el servidor la rechazaba con un mensaje que hablaba de un
 * botón que ella sí veía.
 *
 * De ahí estas dos piezas: saber si la pestaña está vieja, y poder
 * preguntarlo en el momento en que recargar no cuesta nada (al abrir
 * un formulario, antes de que escriba una sola letra).
 */

/** La versión que vio esta pestaña la primera vez que miró */
let cargada: string | null = null;

/** La versión publicada ahora mismo, o null si no se pudo saber */
export async function versionPublicada(): Promise<string | null> {
  try {
    const res = await fetch('/api/version', { cache: 'no-store' });
    if (!res.ok) return null;
    const { id } = (await res.json()) as { id?: string };
    return id ?? null;
  } catch {
    return null;
  }
}

/** La primera lectura fija la referencia; las siguientes no la mueven */
export function fijarVersion(id: string): void {
  if (!cargada) cargada = id;
}

export function versionDeEstaPestana(): string | null {
  return cargada;
}

/**
 * ¿Esta pestaña quedó atrás? Solo dice true cuando hay certeza: sin
 * referencia previa o sin respuesta del servidor, se responde que no
 * para no recargarle la página a nadie por una duda.
 */
export async function estaDesactualizada(): Promise<boolean> {
  const publicada = await versionPublicada();
  if (!publicada) return false;
  if (!cargada) {
    cargada = publicada;
    return false;
  }
  return publicada !== cargada;
}
