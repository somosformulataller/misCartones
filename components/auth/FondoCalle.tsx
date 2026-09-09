'use client';

/**
 * El fondo de las pantallas de acceso: un fotograma REAL del juego.
 *
 * Antes era la calle dibujada a mano en CSS —cuatro degradados y unas cajas—
 * y se notaba: era una aproximación de la escena, no la escena. Ahora es una
 * foto de una partida de verdad, tomada del propio motor
 * (`scripts/foto-escena.mjs` la vuelve a hacer si la calle cambia), así que
 * quien llega por un enlace de WhatsApp ve exactamente el juego al que va a
 * entrar antes de escribir su correo.
 *
 * Encima va un velo oscuro. No es estética: el formulario es de cristal y
 * detrás hay una calle llena de basura de colores. Sin el velo, el texto cae
 * sobre una botella roja y deja de leerse.
 */
export default function FondoCalle() {
  return (
    <div className="fondo-escena" aria-hidden>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/escena-fondo.jpg" alt="" className="fondo-escena-foto" />
      <div className="fondo-escena-velo" />
    </div>
  );
}
