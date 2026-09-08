'use client';

import { useEffect, useRef, useState } from 'react';

interface Props {
  saldo: number;
  bolsasEntregadas: number;
  totalBolsas: number;
  cargando: boolean;
  muted: boolean;
  demo: boolean;
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
  demo,
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
            className="pointer-events-auto rounded-lg border border-white/15 bg-black/45 px-3 py-2 text-sm font-semibold text-white/85 backdrop-blur transition hover:bg-black/65"
          >
            ← Salir
          </button>
          {demo && (
            <span className="rounded-lg border border-amber-400/40 bg-amber-400/15 px-2.5 py-2 text-[11px] font-bold uppercase tracking-wider text-amber-200 backdrop-blur">
              Demo · sin Supabase
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={onToggleMute}
            aria-label={muted ? 'Activar sonido' : 'Silenciar'}
            className="pointer-events-auto rounded-lg border border-white/15 bg-black/45 px-3 py-2 text-sm text-white/85 backdrop-blur transition hover:bg-black/65"
          >
            {muted ? '🔇' : '🔊'}
          </button>
          {/* El `key` remonta el nodo con cada entrega, así la animación de
              pulso se reproduce otra vez. Es más barato y más fiable que
              encender y apagar un estado con un temporizador. */}
          <div
            key={bolsasEntregadas}
            className="pulso-contador rounded-lg border border-amber-300/25 bg-black/55 px-3.5 py-2 text-right backdrop-blur"
          >
            <div className="text-[10px] font-bold uppercase tracking-widest text-amber-200/70">
              Recogido
            </div>
            <div className="font-mono text-2xl font-black leading-none text-amber-200 tabular-nums">
              ${mostrado.toFixed(2)}
            </div>
          </div>
        </div>
      </div>

      {/* Bolsas restantes: puntos, no un número. Se lee de un vistazo. */}
      <div className="absolute left-1/2 top-3 flex -translate-x-1/2 gap-1.5">
        {Array.from({ length: totalBolsas }, (_, i) => (
          <span
            key={i}
            className={`h-2.5 w-2.5 rounded-full border transition-all duration-300 ${
              i < bolsasEntregadas
                ? 'border-amber-300 bg-amber-300'
                : 'border-white/35 bg-white/10'
            }`}
          />
        ))}
      </div>

      {cargando && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 rounded-full border border-amber-300/25 bg-black/55 px-4 py-2 text-sm font-semibold text-amber-100 backdrop-blur">
          Llévala a la carretilla
        </div>
      )}
    </div>
  );
}
