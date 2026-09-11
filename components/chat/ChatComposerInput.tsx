'use client';

import { useLayoutEffect, useRef } from 'react';

// Caja de escritura del chat (la del jugador y la del panel).
//
// Antes era un <input> de una sola línea donde Enter enviaba: no había
// forma de separar párrafos y las respuestas largas de atención al
// cliente llegaban como un ladrillo de texto.
//
// Ahora es un <textarea> que se estira solo según lo que escribes,
// como WhatsApp: ENTER baja de línea y para enviar está el botón de al
// lado (o Ctrl+Enter / ⌘+Enter, para quien escribe con teclado). Los
// saltos de línea ya se pintaban bien en las burbujas (white-space:
// pre-wrap), así que el mensaje se ve tal como se escribió.

/** Tope de crecimiento (~6 líneas): a partir de ahí, scroll dentro */
const MAX_ALTO = 140;

interface ChatComposerInputProps {
  value: string;
  onChange: (value: string) => void;
  /** Enviar con Ctrl+Enter (el botón de enviar llama a lo mismo) */
  onSend: () => void;
  placeholder?: string;
  maxLength?: number;
  disabled?: boolean;
  /**
   * Enviar con Enter a secas cuando lo escrito cumpla esta condición.
   * Sirve para los atajos de respuesta rápida del panel (/41): un atajo
   * solo nunca es un mensaje de varias líneas, así que en desktop debe
   * dispararse con Enter y no obligar a Ctrl+Enter. El resto de mensajes
   * sigue con Enter = salto de línea.
   */
  sendOnEnterWhen?: (value: string) => boolean;
}

export default function ChatComposerInput({
  value,
  onChange,
  onSend,
  placeholder,
  maxLength = 2000,
  disabled,
  sendOnEnterWhen,
}: ChatComposerInputProps) {
  const ref = useRef<HTMLTextAreaElement>(null);

  // Alto = el del contenido (hasta el tope). Se recalcula en cada
  // cambio, así que al enviar y quedar vacío vuelve a su tamaño.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    // +2 por los bordes: sin ellos aparece una barra de scroll de 1 línea
    el.style.height = `${Math.min(el.scrollHeight + 2, MAX_ALTO)}px`;
  }, [value]);

  return (
    <textarea
      ref={ref}
      className="chat-input chat-input-area"
      rows={1}
      value={value}
      maxLength={maxLength}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' || e.shiftKey) return;
        // Ctrl/⌘+Enter envía siempre; Enter a secas solo cuando lo
        // escrito es un atajo (p. ej. "/41") y quien llama lo permite.
        const enviarConEnterSolo =
          !e.ctrlKey && !e.metaKey && (sendOnEnterWhen?.(value) ?? false);
        if ((e.ctrlKey || e.metaKey) || enviarConEnterSolo) {
          e.preventDefault();
          onSend();
        }
      }}
    />
  );
}
