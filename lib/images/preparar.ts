/**
 * Dejar una foto lista para enviarla: encogida y en un formato que se
 * pueda VER después.
 *
 * Dos problemas distintos, el mismo arreglo:
 *
 *  · Peso. La foto de la galería de un teléfono pesa varios MB y no
 *    llega al servidor (el límite de la petición ronda los 4,5 MB).
 *
 *  · Formato. Los iPhone guardan en HEIC, y NINGÚN navegador de
 *    escritorio sabe dibujarlo. El 24/08/2026 alguien mandó por el chat
 *    la foto de su cédula desde un iPhone (20260824_143345.heic) y en
 *    el panel salía el icono de imagen rota: el archivo estaba bien,
 *    pero no había forma de mirarlo.
 *
 * La conversión pasa por el propio navegador de quien envía, que es
 * justo el que SÍ sabe leer su formato: un iPhone decodifica HEIC sin
 * problema y aquí sale un JPEG que ve todo el mundo.
 *
 * Si el navegador no sabe dibujarlo, se manda tal cual: mejor un
 * adjunto que haya que descargar que ningún adjunto.
 */

const MAX_LADO = 1600;
const CALIDAD = 0.82;
const PESO_QUE_MERECE_ENCOGER = 700 * 1024;

/** Formatos que cualquier navegador dibuja sin ayuda */
const SE_VEN_SIEMPRE = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp'];

/** ¿Hay que convertirlo para que se pueda ver? (HEIC, HEIF, AVIF…) */
function hayQueConvertir(file: File): boolean {
  const tipo = (file.type || '').toLowerCase();
  const nombre = file.name.toLowerCase();
  // Algunos teléfonos mandan el HEIC con el tipo vacío: se mira también
  // la extensión.
  if (/\.(heic|heif)$/.test(nombre)) return true;
  if (!tipo) return false;
  return tipo.startsWith('image/') && !SE_VEN_SIEMPRE.includes(tipo);
}

export function esImagen(file: File): boolean {
  return (file.type || '').toLowerCase().startsWith('image/') || /\.(heic|heif)$/i.test(file.name);
}

/**
 * Devuelve la imagen lista para enviar. Si no hace falta tocarla —o no
 * se puede— devuelve la original.
 */
export async function prepararImagen(file: File): Promise<File> {
  if (!esImagen(file)) return file;
  const convertir = hayQueConvertir(file);
  if (!convertir && file.size <= PESO_QUE_MERECE_ENCOGER) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const escala = Math.min(1, MAX_LADO / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * escala);
    canvas.height = Math.round(bitmap.height * escala);
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', CALIDAD));
    bitmap.close();
    if (!blob) return file;
    // Si solo se buscaba encoger y el resultado no es más pequeño, no
    // se gana nada. Pero si era por FORMATO, el JPEG se queda aunque
    // pese más: sin él la imagen no se ve.
    if (!convertir && blob.size >= file.size) return file;
    return new File([blob], `${file.name.replace(/\.[^.]+$/, '')}.jpg`, { type: 'image/jpeg' });
  } catch {
    return file;
  }
}
