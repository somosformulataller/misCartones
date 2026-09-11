'use client';

import { useEffect, useRef, useState } from 'react';

interface AudioRecorderProps {
  disabled?: boolean;
  /** Recibe la nota de voz lista para subir */
  onRecorded: (file: File) => void;
  onError: (message: string) => void;
}

const MAX_SECONDS = 120; // 2 minutos: al llegar se corta y se envía

function pickMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  for (const t of ['audio/webm', 'audio/mp4', 'audio/ogg']) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return '';
}

// Botón 🎤 para grabar una nota de voz (máx. 2 min). Mientras graba
// muestra un punto rojo, el tiempo y botones de descartar/enviar.
// Si el dispositivo no puede grabar, el botón no aparece.
export default function AudioRecorder({ disabled, onRecorded, onError }: AudioRecorderProps) {
  const [supported, setSupported] = useState(false);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const discardRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- detección de capacidad del dispositivo
    setSupported(
      typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia
    );
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        discardRef.current = true;
        recorderRef.current.stop();
      }
    };
  }, []);

  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = pickMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      discardRef.current = false;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        if (timerRef.current) clearInterval(timerRef.current);
        setRecording(false);
        setSeconds(0);
        if (discardRef.current || chunksRef.current.length === 0) return;
        const type = recorder.mimeType || mimeType || 'audio/webm';
        const ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
        const blob = new Blob(chunksRef.current, { type });
        onRecorded(new File([blob], `nota-de-voz.${ext}`, { type }));
      };

      recorderRef.current = recorder;
      recorder.start();
      setRecording(true);
      setSeconds(0);
      timerRef.current = setInterval(() => {
        setSeconds((s) => {
          if (s + 1 >= MAX_SECONDS) {
            recorderRef.current?.stop(); // tope: se corta y se envía
            return s + 1;
          }
          return s + 1;
        });
      }, 1000);
    } catch (e) {
      // Distinguir "el usuario dijo que no" de "no hay micrófono" ayuda
      // a no mandar a nadie a buscar un permiso que ya tenía dado.
      const nombre = e instanceof DOMException ? e.name : '';
      if (nombre === 'NotFoundError' || nombre === 'OverconstrainedError') {
        onError('Este dispositivo no tiene micrófono disponible.');
      } else if (nombre === 'NotReadableError') {
        onError('Otra aplicación está usando el micrófono. Ciérrala e inténtalo de nuevo.');
      } else {
        onError('No pudimos usar el micrófono. Revisa que le hayas dado permiso.');
      }
    }
  };

  const stop = (discard: boolean) => {
    discardRef.current = discard;
    recorderRef.current?.stop();
  };

  if (!supported) return null;

  if (recording) {
    const mm = String(Math.floor(seconds / 60));
    const ss = String(seconds % 60).padStart(2, '0');
    return (
      <span className="chat-rec">
        <span className="chat-rec-dot" aria-hidden />
        <span className="chat-rec-time">
          {mm}:{ss}
        </span>
        <button
          type="button"
          className="chat-icon-btn"
          onClick={() => stop(true)}
          aria-label="Descartar nota de voz"
        >
          ✕
        </button>
        <button
          type="button"
          className="chat-icon-btn chat-icon-send"
          onClick={() => stop(false)}
          aria-label="Enviar nota de voz"
        >
          ➤
        </button>
      </span>
    );
  }

  return (
    <button
      type="button"
      className="chat-icon-btn"
      onClick={start}
      disabled={disabled}
      aria-label="Grabar nota de voz"
    >
      🎤
    </button>
  );
}
