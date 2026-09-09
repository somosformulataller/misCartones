'use client';

import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

interface ProofModalProps {
  /** null = cerrado */
  purchaseId: string | null;
  /** Referencia del pago: se muestra en el título y nombra la descarga */
  reference?: string | null;
  onClose: () => void;
}

// Comprobante del pago EN GRANDE. Antes se abría en una pestaña nueva:
// en el teléfono eso saca al admin de la app (y muchas veces el
// navegador bloquea la emergente). Aquí se ve encima del panel, se
// puede ampliar tocándolo, descargar y cerrar sin perder el sitio.
export default function ProofModal({ purchaseId, reference, onClose }: ProofModalProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(false);

  // La URL firmada (1 h) se pide al abrir, nunca en la carga de la lista
  useEffect(() => {
    // Se limpia lo del comprobante ANTERIOR antes de pedir el nuevo. Sin
    // esto, al abrir el segundo se vería un instante la imagen del primero
    // —el comprobante de otra persona— mientras llega la firma.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUrl(null);
    setError(null);
    setZoom(false);
    if (!purchaseId) return;
    let vivo = true;
    fetch(`/api/admin/payments?proof=${purchaseId}`, { cache: 'no-store' })
      .then(async (r) => {
        const json = await r.json();
        if (!r.ok || !json.url) throw new Error(json.error || 'Sin comprobante');
        return json as { url: string; name?: string };
      })
      .then((json) => {
        if (!vivo) return;
        setUrl(json.url);
        setFileName(json.name ?? null);
      })
      .catch((e: Error) => vivo && setError(e.message));
    return () => {
      vivo = false;
    };
  }, [purchaseId]);

  // Escape cierra · el fondo no se desplaza mientras está abierto.
  // El listener va en fase de CAPTURA y corta el evento: si el
  // comprobante se abrió desde la ficha del jugador, Escape debe
  // cerrar solo el comprobante y dejar la ficha abierta.
  useEffect(() => {
    if (!purchaseId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    const previo = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = previo;
    };
  }, [purchaseId, onClose]);

  // El navegador ignora `download` en enlaces de otro dominio, así que
  // se le pide al propio storage que lo mande como descarga.
  const ext = (fileName?.match(/\.[a-z0-9]+$/i)?.[0] ?? '.jpg').toLowerCase();
  const nombreDescarga = `comprobante-${(reference || purchaseId || 'pago').replace(/\W+/g, '')}${ext}`;
  const urlDescarga = url
    ? `${url}${url.includes('?') ? '&' : '?'}download=${encodeURIComponent(nombreDescarga)}`
    : null;

  return (
    <AnimatePresence>
      {purchaseId && (
        <motion.div
          className="modal-overlay proof-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onClick={onClose}
        >
          <motion.div
            className="modal-card proof-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Comprobante del pago"
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="proof-modal-head">
              <span className="proof-modal-title">
                📎 Comprobante{reference ? ` · Ref ${reference}` : ''}
              </span>
              <div className="proof-modal-tools">
                {urlDescarga && (
                  <a
                    className="proof-modal-btn"
                    href={urlDescarga}
                    download={nombreDescarga}
                    rel="noopener"
                  >
                    ⬇ Descargar
                  </a>
                )}
                <button
                  className="proof-modal-btn proof-modal-x"
                  onClick={onClose}
                  aria-label="Cerrar comprobante"
                >
                  ✕
                </button>
              </div>
            </div>

            <div className={`proof-modal-body${zoom ? ' proof-modal-zoom' : ''}`}>
              {error ? (
                <p className="proof-modal-msg">⚠️ {error}</p>
              ) : !url ? (
                <p className="proof-modal-msg">Cargando comprobante…</p>
              ) : (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={url}
                  alt={`Comprobante del pago${reference ? ` con referencia ${reference}` : ''}`}
                  onClick={() => setZoom((z) => !z)}
                />
              )}
            </div>

            {url && (
              <p className="proof-modal-hint">
                {zoom ? 'Toca la imagen para ajustarla' : 'Toca la imagen para verla más grande'}
              </p>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
