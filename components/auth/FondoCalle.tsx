'use client';

/**
 * El fondo de las pantallas de acceso: la misma calle de mediodía que hay
 * dentro del juego, vista de lejos y quieta.
 *
 * No es decoración. Quien llega aquí viene de un enlace de WhatsApp y todavía
 * no ha visto nada: si el registro tuviera el aspecto de un formulario
 * cualquiera y el juego otro, la primera pantalla no contaría de qué va esto.
 * Los colores salen de la escena real — el cielo de LUZ.fondo, el asfalto
 * cálido oscuro, la doble raya amarilla del centro.
 *
 * Todo es CSS: son cuatro degradados y unas cuantas cajas. Cargar aquí el
 * three.js entero costaría un segundo de espera antes de poder escribir el
 * correo, y a cambio se vería lo mismo.
 */
export default function FondoCalle() {
  return (
    <div className="fondo-calle" aria-hidden>
      {/* Cielo y sol */}
      <div className="fc-cielo" />
      <div className="fc-sol" />
      <div className="fc-nube fc-nube-1" />
      <div className="fc-nube fc-nube-2" />

      {/* La calzada, en fuga hacia el horizonte */}
      <div className="fc-calzada">
        <div className="fc-linea fc-linea-izq" />
        <div className="fc-linea fc-linea-der" />
      </div>

      {/* Las dos aceras con su bordillo */}
      <div className="fc-acera fc-acera-izq" />
      <div className="fc-acera fc-acera-der" />

      {/* Velo: sin él, el formulario se lee sobre el amarillo de la raya */}
      <div className="fc-velo" />
    </div>
  );
}
