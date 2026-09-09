'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { usePlayer } from '@/components/providers/PlayerProvider';
import {
  MAX_PROOF_SIZE,
  MAX_TICKETS_PER_PURCHASE,
  PAYMENT_DESTINATION,
  PROOF_NOT_IMAGE_MSG,
  PROOF_REQUIRED_MSG,
  PROOF_TOO_BIG_MSG,
  TICKET_PRICE_USD,
} from '@/lib/payments/constants';
import { estaDesactualizada } from '@/lib/app/version';
import { prepararImagen } from '@/lib/images/preparar';

interface BuyTicketsModalProps {
  open: boolean;
  onClose: () => void;
  /** Se llama cuando una compra queda aprobada (tickets acreditados) */
  onApproved?: () => void;
}

type Phase = 'form' | 'sending' | 'aprobado' | 'pendiente' | 'error';

/** En qué punto va la lectura del comprobante.
 *  - `sin-foto`     todavía no ha adjuntado nada
 *  - `analizando`   el OCR está leyendo (2,6 s de mediana)
 *  - `leido`        se sacó la referencia: ya puede enviar
 *  - `ilegible`     la foto no se puede leer: que suba otra
 *  - `error`        el servicio no contestó: que reintente
 *
 *  El botón de enviar SOLO se habilita en `leido`. */
type Lectura = 'sin-foto' | 'analizando' | 'leido' | 'ilegible' | 'error';

const fmtBs = (n: number) =>
  `Bs. ${n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Modal "Comprar Tickets": cantidad, total en USD y Bs (tasa BCV en
// vivo), datos del Pago Móvil y referencia. Al enviar, el servidor
// valida el pago contra el banco: si coincide se aprueba al instante;
// si no, queda en revisión y se reintenta solo.
export default function BuyTicketsModal({ open, onClose, onApproved }: BuyTicketsModalProps) {
  const { refresh } = usePlayer();
  const [qty, setQty] = useState(1);
  const [rate, setRate] = useState<number | null>(null);
  const [phase, setPhase] = useState<Phase>('form');
  const [message, setMessage] = useState<string | null>(null);
  // Captura del pago (OBLIGATORIA): se sube tras registrar la compra
  const [proofFile, setProofFile] = useState<File | null>(null);
  const proofInputRef = useRef<HTMLInputElement>(null);
  // La referencia ya no se escribe: la lee el OCR de la captura
  const [lectura, setLectura] = useState<Lectura>('sin-foto');
  const [refLeida, setRefLeida] = useState<string | null>(null);
  // Cada análisis lleva su número: si el jugador cambia de foto mientras
  // el anterior sigue en el aire, la respuesta que llegue tarde se
  // ignora. Sin esto podría acabar enviando la referencia de una imagen
  // que ya no está adjunta.
  const analisisRef = useRef(0);

  const totalUsd = qty * TICKET_PRICE_USD;
  const totalVes = rate ? totalUsd * rate : null;

  // Al ABRIR es el único momento en que recargar no le cuesta nada a
  // nadie: no hay referencia tecleada ni comprobante elegido. Si la
  // pestaña quedó atrás de un deploy, se actualiza aquí y no cuando ya
  // esté escribiendo (que es cuando VersionReload no puede hacerlo).
  useEffect(() => {
    if (!open) return;
    let vivo = true;
    estaDesactualizada().then((vieja) => {
      if (vivo && vieja) window.location.reload();
    });
    return () => {
      vivo = false;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    fetch('/api/exchange-rate', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => setRate(d.rate ?? null))
      .catch(() => setRate(null));
    // Una compra a la vez: si ya hay una en verificación, el modal
    // muestra esa pantalla en vez del formulario (el servidor también
    // lo bloquea por su cuenta).
    fetch('/api/purchases', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        const pending = ((d.purchases ?? []) as { status?: string }[]).some(
          (p) => p.status === 'pendiente' || p.status === 'validando'
        );
        if (pending) {
          setPhase('pendiente');
          setMessage('Ya tienes una compra en proceso de verificación.');
        }
      })
      .catch(() => {});
  }, [open]);

  const reset = useCallback(() => {
    setPhase('form');
    setMessage(null);
    setQty(1);
    setProofFile(null);
    setLectura('sin-foto');
    setRefLeida(null);
    analisisRef.current++;
  }, []);

  /**
   * Manda la captura a leer EN CUANTO se adjunta, no al enviar. El
   * análisis (2,6 s de mediana) corre mientras la persona sigue en la
   * pantalla, así que normalmente al llegar al botón ya está listo.
   *
   * Lo importante: si la foto no se lee, se entera aquí y solo tiene
   * que elegir otra. Si esto pasara al enviar, tendría que rehacer la
   * compra entera.
   */
  const analizar = useCallback(async (f: File) => {
    const mio = ++analisisRef.current;
    setLectura('analizando');
    setRefLeida(null);
    setMessage(null);
    try {
      const imagen = await prepararImagen(f);
      const fd = new FormData();
      fd.append('file', imagen);
      const res = await fetch('/api/purchases/ocr', { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({}));
      // Llegó tarde: ya hay otra foto en juego
      if (mio !== analisisRef.current) return;

      if (data.estado === 'leido' && data.reference) {
        setRefLeida(String(data.reference));
        setLectura('leido');
        return;
      }
      setLectura(data.estado === 'ilegible' ? 'ilegible' : 'error');
      setMessage(data.error ?? 'No pudimos leer tu comprobante, adjunta uno más legible.');
    } catch {
      if (mio !== analisisRef.current) return;
      setLectura('error');
      setMessage('No pudimos leer tu comprobante ahora mismo. Inténtalo de nuevo.');
    }
  }, []);

  /** Quita la foto y todo lo que se sacó de ella */
  const quitarFoto = useCallback(() => {
    analisisRef.current++;
    setProofFile(null);
    setRefLeida(null);
    setLectura('sin-foto');
    setMessage(null);
    if (proofInputRef.current) proofInputRef.current.value = '';
  }, []);

  const handleClose = useCallback(() => {
    onClose();
    // Al reabrir siempre empieza limpio
    setTimeout(reset, 300);
  }, [onClose, reset]);

  const handleSubmit = async () => {
    if (!proofFile) {
      setMessage(PROOF_REQUIRED_MSG);
      return;
    }
    // El botón está deshabilitado fuera de 'leido', pero se comprueba
    // igual: el estado puede cambiar entre el clic y este momento.
    if (lectura !== 'leido') return;

    setPhase('sending');
    setMessage(null);
    try {
      // La compra y su comprobante viajan JUNTOS: si la imagen no se
      // puede guardar, el servidor no registra la compra y el jugador
      // ve el error (antes se subía aparte y podía perderse en silencio).
      //
      // Se manda la MISMA imagen que se analizó (prepararImagen es
      // determinista), así el servidor la reconoce y reutiliza la
      // lectura ya hecha en vez de pagar otra al servicio de OCR.
      const imagen = await prepararImagen(proofFile);
      if (imagen.size > MAX_PROOF_SIZE) {
        setPhase('form');
        setMessage(PROOF_TOO_BIG_MSG);
        return;
      }
      const fd = new FormData();
      fd.append('quantity', String(qty));
      fd.append('file', imagen);

      const res = await fetch('/api/purchases', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) {
        // El servidor dice que esta pestaña es de una versión vieja: se
        // recarga sola. Ya no hay referencia que guardar — la lee el
        // OCR de la captura, así que solo tendrá que volver a adjuntarla.
        if (data.stale) {
          setPhase('sending');
          setMessage(
            'Tu app estaba desactualizada. La estamos actualizando; solo tendrás que volver a adjuntar la captura.'
          );
          setTimeout(() => window.location.reload(), 2500);
          return;
        }
        // El servidor tampoco pudo leer la captura: se vuelve al
        // formulario con la foto quitada, que es lo único que puede
        // arreglar la persona.
        if (data.ilegible) {
          setPhase('form');
          quitarFoto();
          setLectura('ilegible');
          setMessage(data.error);
          return;
        }
        setPhase('error');
        setMessage(data.error || 'No se pudo enviar la solicitud. Intenta de nuevo.');
        return;
      }
      // Pagó de menos: se le dice ahora, con el número exacto, en vez
      // de que lo descubra el equipo días después.
      const aviso =
        typeof data.faltan_bs === 'number' && data.faltan_bs > 0
          ? `Ojo: tu comprobante dice ${fmtBs(data.amount_ves - data.faltan_bs)} y la compra es de ${fmtBs(data.amount_ves)}. Faltan ${fmtBs(data.faltan_bs)}.`
          : null;

      if (data.status === 'aprobado') {
        setPhase('aprobado');
        setMessage(aviso);
        refresh();
        onApproved?.();
      } else {
        setPhase('pendiente');
        setMessage(aviso ?? data.reason ?? null);
      }
    } catch {
      setPhase('error');
      setMessage('No se pudo enviar la solicitud. Intenta de nuevo.');
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="modal-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={handleClose}
        >
          <motion.div
            className="modal-card buy-modal"
            initial={{ scale: 0.85, opacity: 0, y: 30 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.9, opacity: 0 }}
            onClick={(e) => e.stopPropagation()}
          >
            {phase === 'form' && (
              <>
                <h2 className="modal-title buy-title">🎟️ Comprar Tickets</h2>

                {/* Cantidad */}
                <div className="qty-row">
                  <button
                    className="qty-btn"
                    onClick={() => setQty((q) => Math.max(1, q - 1))}
                    aria-label="Menos tickets"
                  >
                    −
                  </button>
                  <div className="qty-value">
                    <span className="qty-number">{qty}</span>
                    <span className="qty-label">ticket{qty > 1 ? 's' : ''}</span>
                  </div>
                  <button
                    className="qty-btn"
                    onClick={() => setQty((q) => Math.min(MAX_TICKETS_PER_PURCHASE, q + 1))}
                    aria-label="Más tickets"
                  >
                    +
                  </button>
                </div>

                {/* Desglose */}
                <div className="price-box">
                  <div className="price-line">
                    <span>Precio unitario</span>
                    <span>
                      ${TICKET_PRICE_USD.toFixed(2)}
                      {rate ? ` (${fmtBs(TICKET_PRICE_USD * rate)})` : ''}
                    </span>
                  </div>
                  <div className="price-line price-total">
                    <span>Total</span>
                    <span>
                      ${totalUsd.toFixed(2)}
                      {totalVes !== null ? ` (${fmtBs(totalVes)})` : ''}
                    </span>
                  </div>
                  {rate ? (
                    <p className="rate-note">Tasa BCV: Bs. {rate.toFixed(2)} / USD</p>
                  ) : (
                    <p className="rate-note">Sin tasa BCV disponible ahora mismo</p>
                  )}
                </div>

                {/* Datos del pago */}
                <div className="pay-data">
                  <p className="pay-data-title">Datos para el Pago Móvil</p>
                  <div className="pay-data-grid">
                    <span>Banco</span>
                    <strong>{PAYMENT_DESTINATION.banco}</strong>
                    <span>Teléfono</span>
                    <strong>{PAYMENT_DESTINATION.telefono}</strong>
                    <span>C.I.</span>
                    <strong>{PAYMENT_DESTINATION.cedula}</strong>
                    <span>Concepto</span>
                    <strong>{PAYMENT_DESTINATION.concepto}</strong>
                  </div>
                  <p className="pay-instruction">
                    Transfiere <strong>${totalUsd.toFixed(2)}</strong>
                    {totalVes !== null ? (
                      <>
                        {' '}
                        (<strong>{fmtBs(totalVes)}</strong>)
                      </>
                    ) : null}{' '}
                    y adjunta la captura del pago:
                  </p>
                </div>

                {/* Captura del pago (obligatoria). Es lo ÚNICO que se
                    pide: la referencia se lee de la propia imagen. */}
                <input
                  ref={proofInputRef}
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0] ?? null;
                    // Se avisa al elegirla, no al enviar
                    if (f && !f.type.startsWith('image/')) {
                      setMessage(PROOF_NOT_IMAGE_MSG);
                      setProofFile(null);
                      setLectura('sin-foto');
                      e.target.value = '';
                      return;
                    }
                    setProofFile(f);
                    if (f) analizar(f);
                    else {
                      setLectura('sin-foto');
                      setMessage(null);
                    }
                  }}
                />
                {proofFile ? (
                  <div className="proof-row">
                    <span className="proof-name">📎 {proofFile.name}</span>
                    <button className="proof-remove" onClick={quitarFoto} aria-label="Quitar imagen">
                      ✕
                    </button>
                  </div>
                ) : (
                  <button
                    className="proof-attach"
                    type="button"
                    onClick={() => proofInputRef.current?.click()}
                  >
                    📎 Adjuntar captura del pago (obligatorio)
                  </button>
                )}

                {/* Cómo va la lectura del comprobante */}
                <div className="ocr-estado" aria-live="polite">
                  {lectura === 'sin-foto' && (
                    <p className="ref-hint">
                      💡 Ya no hace falta escribir la referencia: la leemos de tu comprobante.
                      Asegúrate de que se vea bien el número.
                    </p>
                  )}
                  {lectura === 'analizando' && (
                    <p className="ocr-leyendo">
                      ⏳ Estamos analizando tu comprobante, espera unos segundos…
                    </p>
                  )}
                  {lectura === 'leido' && refLeida && (
                    <p className="ocr-ok">
                      ✓ Referencia detectada: <strong>{refLeida}</strong>
                    </p>
                  )}
                  {(lectura === 'ilegible' || lectura === 'error') && message && (
                    <p className="buy-error" role="alert">
                      ⚠️ {message}
                    </p>
                  )}
                </div>

                {/* Errores que no son de la lectura (formato, tamaño…) */}
                {message && lectura !== 'ilegible' && lectura !== 'error' && (
                  <p className="buy-error" role="alert">
                    ⚠️ {message}
                  </p>
                )}

                {lectura === 'error' && proofFile && (
                  <button
                    className="btn-ghost"
                    type="button"
                    onClick={() => proofFile && analizar(proofFile)}
                  >
                    Reintentar lectura
                  </button>
                )}

                <button
                  className="btn-primary buy-submit"
                  onClick={handleSubmit}
                  disabled={lectura !== 'leido'}
                >
                  {lectura === 'analizando' ? 'Analizando comprobante…' : 'Enviar solicitud de pago'}
                </button>
                <button className="btn-ghost" onClick={handleClose}>
                  Cancelar
                </button>
              </>
            )}

            {phase === 'sending' && (
              <div className="buy-status">
                <div className="modal-icon">⏳</div>
                <h2 className="modal-title">Enviando tu pago</h2>
                <p className="modal-subtitle">
                  Estamos registrando tu pago y subiendo tu comprobante… No cierres esta ventana.
                </p>
              </div>
            )}

            {phase === 'aprobado' && (
              <div className="buy-status">
                <div className="modal-icon">🎉</div>
                <h2 className="modal-title win-title">¡Pago aprobado!</h2>
                <p className="modal-subtitle">
                  Se sumaron {qty} ticket{qty > 1 ? 's' : ''} a tu cuenta. ¡Mucha suerte!
                </p>
                <button className="btn-primary" onClick={handleClose}>
                  ▶ Jugar ahora
                </button>
              </div>
            )}

            {phase === 'pendiente' && (
              <div className="buy-status">
                <div className="modal-icon">🕒</div>
                <h2 className="modal-title">Verificando tu pago</h2>
                <p className="modal-subtitle">
                  {message ?? 'Tu pago se está verificando.'} Apenas se confirme te llegará una
                  notificación 🔔 y tus tickets se sumarán automáticamente. Puedes cerrar esta
                  ventana con tranquilidad.
                </p>
                <button className="btn-primary" onClick={handleClose}>
                  Listo
                </button>
              </div>
            )}

            {phase === 'error' && (
              <div className="buy-status">
                <div className="modal-icon">⚠️</div>
                <h2 className="modal-title">No se pudo procesar</h2>
                <p className="modal-subtitle">{message}</p>
                <button className="btn-primary" onClick={() => setPhase('form')}>
                  Volver
                </button>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
