// Edición de los datos de un jugador desde el panel.
//
// Aquí vive SOLO la parte que no toca la red: limpiar lo que escribió
// el equipo y decidir si vale. Por eso se puede probar sola, que es lo
// que importa cuando lo que está en juego es la cédula a la que se le
// paga a alguien.
//
// Criterio general: **limpiar antes que rechazar**. Quien corrige una
// ficha suele pegar el dato de un WhatsApp o de una captura, con
// puntos, guiones, espacios o el prefijo +58. Rechazarle eso es
// hacerle perder el tiempo con algo que la máquina sabe arreglar.
// Solo se rechaza lo que de verdad no se puede interpretar.

/** Campos que el panel puede editar */
export interface PerfilEditable {
  first_name?: string | null;
  last_name?: string | null;
  cedula?: string | null;
  whatsapp?: string | null;
  email?: string | null;
  payout_name?: string | null;
  payout_bank?: string | null;
  payout_cedula?: string | null;
  payout_phone?: string | null;
}

/** Cómo se llama cada campo cuando hay que explicárselo a una persona */
export const ETIQUETA: Record<keyof PerfilEditable | 'username', string> = {
  first_name: 'el nombre',
  last_name: 'el apellido',
  cedula: 'la cédula',
  whatsapp: 'el WhatsApp',
  email: 'el correo',
  payout_name: 'el titular de la cuenta',
  payout_bank: 'el banco para cobrar',
  payout_cedula: 'la cédula para cobrar',
  payout_phone: 'el teléfono para cobrar',
  username: 'el nombre visible',
};

const vacio = (v: unknown) => v === null || v === undefined || String(v).trim() === '';

/** Espacios de sobra fuera, y un solo espacio entre palabras */
const limpiarTexto = (v: string, max: number) =>
  v.replace(/\s+/g, ' ').trim().slice(0, max);

/**
 * Cédula venezolana: solo los dígitos. Se le quitan el prefijo V/E, los
 * puntos y los guiones, que es como la escribe todo el mundo
 * («V-28.730.098»).
 */
export function limpiarCedula(v: string): string {
  return v.replace(/^[VvEeJjGg][-\s]?/, '').replace(/\D/g, '');
}

/**
 * Teléfono venezolano en su forma larga: 04121234567.
 * Acepta lo que llega de verdad — `+58 412 123 4567`, `0412-1234567`,
 * `412 1234567` — y lo deja todo igual.
 */
export function limpiarTelefono(v: string): string {
  let d = v.replace(/\D/g, '');
  if (d.startsWith('58') && d.length >= 12) d = d.slice(2); // +58…
  if (d.length === 10 && !d.startsWith('0')) d = '0' + d; // sin el cero
  return d;
}

export type Revision =
  | { ok: true; valor: string | null }
  | { ok: false; error: string };

export function revisarCedula(v: string | null): Revision {
  if (vacio(v)) return { ok: true, valor: null };
  const d = limpiarCedula(String(v));
  if (d.length < 6 || d.length > 9) {
    return { ok: false, error: `La cédula debe tener entre 6 y 9 dígitos (llegaron ${d.length}).` };
  }
  return { ok: true, valor: d };
}

export function revisarTelefono(v: string | null, campo: string): Revision {
  if (vacio(v)) return { ok: true, valor: null };
  const d = limpiarTelefono(String(v));
  if (d.length !== 11 || !d.startsWith('0')) {
    return {
      ok: false,
      error: `${campo} debe ser un número venezolano de 11 dígitos, como 04121234567 (llegó "${d}").`,
    };
  }
  return { ok: true, valor: d };
}

export function revisarCorreo(v: string | null): Revision {
  if (vacio(v)) return { ok: false, error: 'El correo no puede quedar vacío: es con lo que inicia sesión.' };
  const e = String(v).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(e)) {
    return { ok: false, error: `"${e}" no parece un correo válido.` };
  }
  return { ok: true, valor: e };
}

export function revisarNombre(v: string | null, campo: string): Revision {
  if (vacio(v)) return { ok: true, valor: null };
  const t = limpiarTexto(String(v), 40);
  if (t.length < 2) return { ok: false, error: `${campo} es demasiado corto.` };
  if (/\d/.test(t)) return { ok: false, error: `${campo} no debería llevar números.` };
  return { ok: true, valor: t };
}

/**
 * Revisa el paquete entero. Devuelve SOLO los campos que venían en la
 * petición (los que no vienen no se tocan: así el formulario puede
 * mandar un cambio suelto sin borrar el resto).
 */
export function revisarPerfil(
  entrada: PerfilEditable
): { ok: true; datos: PerfilEditable } | { ok: false; error: string } {
  const datos: PerfilEditable = {};
  const pon = (k: keyof PerfilEditable, r: Revision): string | null => {
    if (!r.ok) return r.error;
    datos[k] = r.valor;
    return null;
  };

  const fallos: (string | null)[] = [];
  if ('first_name' in entrada) fallos.push(pon('first_name', revisarNombre(entrada.first_name ?? null, 'El nombre')));
  if ('last_name' in entrada) fallos.push(pon('last_name', revisarNombre(entrada.last_name ?? null, 'El apellido')));
  if ('cedula' in entrada) fallos.push(pon('cedula', revisarCedula(entrada.cedula ?? null)));
  if ('whatsapp' in entrada) fallos.push(pon('whatsapp', revisarTelefono(entrada.whatsapp ?? null, 'El WhatsApp')));
  if ('email' in entrada) fallos.push(pon('email', revisarCorreo(entrada.email ?? null)));
  if ('payout_name' in entrada) fallos.push(pon('payout_name', revisarNombre(entrada.payout_name ?? null, 'El titular')));
  if ('payout_cedula' in entrada) fallos.push(pon('payout_cedula', revisarCedula(entrada.payout_cedula ?? null)));
  if ('payout_phone' in entrada) fallos.push(pon('payout_phone', revisarTelefono(entrada.payout_phone ?? null, 'El teléfono para cobrar')));
  if ('payout_bank' in entrada) {
    const b = entrada.payout_bank;
    datos.payout_bank = vacio(b) ? null : limpiarTexto(String(b), 60);
  }

  const error = fallos.find(Boolean);
  if (error) return { ok: false, error };
  return { ok: true, datos };
}

/**
 * El nombre visible se arma con nombre + apellido. Se mantiene al día
 * solo: si el equipo corrige el apellido y el nombre visible se
 * quedara con el viejo, el jugador aparecería con dos nombres
 * distintos según la tabla del panel que mires.
 */
export function nombreVisible(
  nuevo: PerfilEditable,
  actual: { first_name?: string | null; last_name?: string | null; username?: string | null }
): string | null {
  const first = 'first_name' in nuevo ? nuevo.first_name : actual.first_name;
  const last = 'last_name' in nuevo ? nuevo.last_name : actual.last_name;
  const compuesto = [first, last].filter(Boolean).join(' ').trim();
  if (!compuesto) return null; // sin nombre ni apellido, se deja el que hubiera
  return compuesto === actual.username ? null : compuesto;
}

/**
 * Qué cambió de verdad, comparando contra lo que había. Sirve para dos
 * cosas: no escribir en la base si no cambió nada, y dejar la bitácora
 * (quién tocó qué, y cuál era el valor anterior).
 */
export function diferencias(
  nuevo: PerfilEditable,
  actual: Record<string, unknown>
): { campo: string; antes: string | null; despues: string | null }[] {
  const cambios: { campo: string; antes: string | null; despues: string | null }[] = [];
  for (const [campo, valor] of Object.entries(nuevo)) {
    const antes = actual[campo] === null || actual[campo] === undefined ? null : String(actual[campo]);
    const despues = valor === null || valor === undefined ? null : String(valor);
    if (antes !== despues) cambios.push({ campo, antes, despues });
  }
  return cambios;
}
