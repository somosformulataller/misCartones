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
 *
 * Dos filas, y nada flotando por su cuenta. Los puntos de las bolsas iban
 * centrados con posición absoluta en la MISMA franja que los botones, y en un
 * teléfono de 360-390 px el botón del sonido les caía encima (medido: se
 * pisaban en los dos anchos). Ahora cada pieza tiene su hueco: arriba salir,
 * sonido y lo recogido; debajo, las bolsas.
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
    <div className="hud">
      <div className="hud-fila">
        <div className="hud-grupo">
          <button type="button" onClick={onSalir} className="btn-secondary hud-boton">
            ← Salir
          </button>
          <button
            type="button"
            onClick={onToggleMute}
            aria-label={muted ? 'Activar sonido' : 'Silenciar'}
            className="btn-secondary hud-boton hud-boton-icono"
          >
            {muted ? '🔇' : '🔊'}
          </button>
        </div>

        {/* El `key` remonta el nodo con cada entrega, así la animación de
            pulso se reproduce otra vez. Es más barato y más fiable que
            encender y apagar un estado con un temporizador. */}
        <div key={bolsasEntregadas} className="hud-recogido pulso-contador" data-hud>
          <span className="hud-recogido-rotulo">Recogido</span>
          <span className="hud-recogido-cifra">${mostrado.toFixed(2)}</span>
        </div>
      </div>

      {/* Bolsas: casillas, no un número. Se leen de un vistazo. */}
      <div
        className="hud-bolsas"
        data-hud
        role="img"
        aria-label={`${bolsasEntregadas} de ${totalBolsas} bolsas entregadas`}
      >
        {Array.from({ length: totalBolsas }, (_, i) => (
          <span key={i} className={`hud-bolsa${i < bolsasEntregadas ? ' hud-bolsa-llena' : ''}`} />
        ))}
      </div>

      {cargando && <div className="hud-aviso">Llévala a la carretilla 🛒</div>}
    </div>
  );
}
