'use client';

/**
 * Compartir la invitación con el enlace de afiliado.
 *
 * En La Llave Correcta esto manda un VIDEO promocional: WhatsApp lo recibe
 * como video con el enlace de leyenda, que es lo que hace que la invitación
 * se abra. Mis Cartones todavía no tiene ese video, y mandar el de otro juego
 * sería peor que no mandar ninguno — así que por ahora va texto y enlace, con
 * el hueco del video marcado para cuando exista.
 *
 * Nunca lanza: que el jugador cancele el compartir no es un error.
 */

export function textoInvitacion(link: string): string {
  return link
    ? `Recoge la basura y gana. Juega Mis Cartones con mi enlace: ${link}`
    : '¡Juega Mis Cartones y gana!';
}

export type ResultadoCompartir = 'compartido' | 'copiado' | 'nada';

export async function compartirInvitacion(link: string): Promise<ResultadoCompartir> {
  const texto = textoInvitacion(link);

  // 1) El compartir del sistema (móvil): abre WhatsApp, Telegram, lo que sea.
  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share({ text: texto, ...(link ? { url: link } : {}) });
      return 'compartido';
    } catch {
      // Cancelar es lo normal. Se sigue al portapapeles para que el toque
      // no se quede en nada si lo que falló fue el compartir, no el jugador.
    }
  }

  // 2) Escritorio o navegador sin compartir: al portapapeles.
  try {
    await navigator.clipboard.writeText(texto);
    return 'copiado';
  } catch {
    return 'nada';
  }
}
