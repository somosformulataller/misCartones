'use client';

import { useEffect, useRef, useState } from 'react';

interface Props {
  /** El saldo del jugador. Durante la partida NO se mueve: sube al final,
   *  moneda a moneda, cuando vuelan desde la carretilla. */
  saldo: number;
  /** true mientras llegan monedas: el contador se enciende en verde. */
  subiendo: boolean;
  /** Sube con cada moneda que llega; cambiarlo relanza el pulso. */
  pulso: number;
  bolsasEntregadas: number;
  totalBolsas: number;
  /** Valor de cada bolsa ya cobrada, en orden de entrega: va debajo de su
   *  casilla. Antes flotaba sobre la carretilla y tapaba la calle. */
  montos: number[];
  cargando: boolean;
  muted: boolean;
  onToggleMute: () => void;
  onSalir: () => void;
}

/**
 * El HUD va en DOM encima del canvas, no dentro del motor: el texto del
 * navegador es más nítido, se escala solo con el sistema y no gasta texturas.
 *
 * El contador es el SALDO, como el «TU SALDO» de La Llave, y no lo recogido en
 * la partida. Durante la partida se queda quieto —el valor de cada bolsa sale
 * debajo de su casilla— y al vaciar la última suben las monedas y
 * cada llegada suma su parte. No salta: sube suavizado y se enciende mientras
 * llegan.
 *
 * Dos filas, y nada flotando por su cuenta. Los puntos de las bolsas iban
 * centrados con posición absoluta en la MISMA franja que los botones, y en un
 * teléfono de 360-390 px el botón del sonido les caía encima (medido: se
 * pisaban en los dos anchos). Ahora cada pieza tiene su hueco: arriba salir,
 * sonido y el saldo; debajo, las bolsas.
 */
export default function Hud({
  saldo,
  subiendo,
  pulso,
  bolsasEntregadas,
  totalBolsas,
  montos,
  cargando,
  muted,
  onToggleMute,
  onSalir,
}: Props) {
  // ¿Ya agarró alguna bolsa desde que se abrió la partida? Hasta entonces la
  // escena dice la meta. No depende de las entregadas: una partida REANUDADA
  // con bolsas ya entregadas también lo enseña al volver.
  const [haAgarrado, setHaAgarrado] = useState(cargando);
  if (cargando && !haAgarrado) setHaAgarrado(true);
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

        {/* El `key` remonta la pieza con cada moneda que llega, así el pulso
            se reproduce otra vez. Es más barato y más fiable que encender y
            apagar un estado con un temporizador. */}
        <div
          key={pulso}
          className={`hud-saldo${subiendo ? ' hud-saldo-sube' : ''}${pulso > 0 ? ' pulso-contador' : ''}`}
          data-hud
        >
          <span className="hud-saldo-rotulo">Tu saldo</span>
          {/* Aquí aterrizan las monedas del final. */}
          <span className="hud-saldo-cifra" data-destino-monedas>
            ${mostrado.toFixed(2)}
          </span>
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
          <span key={i} className="hud-bolsa-casilla">
            <span className={`hud-bolsa${i < bolsasEntregadas ? ' hud-bolsa-llena' : ''}`} />
            {/* El valor sale cuando el servidor confirma la bolsa, no antes. */}
            {i < bolsasEntregadas && montos[i] !== undefined && (
              <span className="hud-bolsa-valor">+${Number(montos[i]).toFixed(2)}</span>
            )}
          </span>
        ))}
      </div>

      {/* Al empezar, la meta; en cuanto recoge la primera, adónde llevarla. */}
      {!haAgarrado && (
        <div className="hud-aviso">
          {/* El número en la fuente de lectura: en la de píxeles el 5 parece una S. */}
          Lleva <span style={{ fontFamily: 'var(--font-lectura)', fontWeight: 800 }}>{totalBolsas}</span> bolsas a la carretilla
        </div>
      )}
      {cargando && <div className="hud-aviso">Llévala a la carretilla 🛒</div>}
    </div>
  );
}
