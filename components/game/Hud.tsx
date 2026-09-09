'use client';

import { useEffect, useRef, useState } from 'react';

interface Props {
  saldo: number;
  bolsasEntregadas: number;
  totalBolsas: number;
  cargando: boolean;
  muted: boolean;
  onToggleMute: () => void;
  onSalir: () => void;
}

/**
 * El HUD va en DOM encima del canvas, no dentro de Pixi: el texto del
 * navegador es más nítido, se escala solo con el sistema y no gasta texturas.
 *
 * El contador NO salta al monto final: sube suavizado, y da un pulso de escala
 * mientras sube. Es lo que hace que los cartones que vuelan hasta aquí se
 * sientan la causa del número, y no un adorno paralelo.
 */
export default function Hud({
  saldo,
  bolsasEntregadas,
  totalBolsas,
  cargando,
  muted,
  onToggleMute,
  onSalir,
}: Props) {
  const [mostrado, setMostrado] = useState(saldo);
  // El valor animado vive en una ref: el estado solo existe para pintar.
  const valor = useRef(saldo);

  useEffect(() => {
    let raf = 0;
    let anterior = performance.now();
    const paso = (t: number) => {
      const dt = Math.min(64, t - anterior) / 1000;
      anterior = t;
      const d = saldo - valor.current;
      if (Math.abs(d) < 0.005) {
        valor.current = saldo;
        setMostrado(saldo);
        return;
      }
      // Suavizado exponencial con delta real: la sensación no cambia con los
      // fps del dispositivo.
      valor.current += d * (1 - Math.exp(-9 * dt));
      setMostrado(valor.current);
      raf = requestAnimationFrame(paso);
    };
    raf = requestAnimationFrame(paso);
    return () => cancelAnimationFrame(raf);
  }, [saldo]);

  return (
    <div className="pointer-events-none absolute inset-0 select-none">
      <div className="flex items-start justify-between gap-3 p-3">
        <div className="flex items-center gap-2">
          <button
            onClick={onSalir}
            className="pointer-events-auto rounded-xl border-2 border-white/70 bg-white/70 px-3 py-2 text-sm font-bold text-emerald-900 shadow-sm backdrop-blur transition hover:bg-white/90"
          >
            ← Salir
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={onToggleMute}
            aria-label={muted ? 'Activar sonido' : 'Silenciar'}
            className="pointer-events-auto rounded-xl border-2 border-white/70 bg-white/70 px-3 py-2 text-sm shadow-sm backdrop-blur transition hover:bg-white/90"
          >
            {muted ? '🔇' : '🔊'}
          </button>
          {/* El `key` remonta el nodo con cada entrega, así la animación de
              pulso se reproduce otra vez. Es más barato y más fiable que
              encender y apagar un estado con un temporizador. */}
          <div
            key={bolsasEntregadas}
            className="pulso-contador rounded-xl border-2 border-amber-500/60 bg-amber-300/90 px-3.5 py-1.5 text-right shadow-md backdrop-blur"
          >
            <div className="text-[10px] font-black uppercase tracking-widest text-amber-900/80">
              Recogido
            </div>
            <div className="font-mono text-2xl font-black leading-none tabular-nums text-amber-950">
              ${mostrado.toFixed(2)}
            </div>
          </div>
        </div>
      </div>

      {/* Bolsas restantes: puntos, no un número. Se lee de un vistazo. */}
      <div className="absolute left-1/2 top-4 flex -translate-x-1/2 gap-2 rounded-full border-2 border-white/60 bg-white/45 px-3 py-2 shadow-sm backdrop-blur">
        {Array.from({ length: totalBolsas }, (_, i) => (
          <span
            key={i}
            className={`h-3 w-3 rounded-full border-2 transition-all duration-300 ${
              i < bolsasEntregadas
                ? 'scale-110 border-amber-600 bg-amber-400'
                : 'border-emerald-900/30 bg-white/60'
            }`}
          />
        ))}
      </div>

      {cargando && (
        <div className="absolute bottom-7 left-1/2 -translate-x-1/2 rounded-full border-2 border-amber-500/50 bg-amber-300/90 px-5 py-2 text-sm font-black text-amber-950 shadow-md backdrop-blur">
          Llévala a la carretilla 🛒
        </div>
      )}
    </div>
  );
}
