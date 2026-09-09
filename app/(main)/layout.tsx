'use client';

import Header from '@/components/layout/Header';
import FondoJuego from '@/components/layout/FondoJuego';
import BarraJugar from '@/components/layout/BarraJugar';
import { InviteModalProvider } from '@/components/referrals/InviteModalProvider';

/**
 * El armazón que comparten todas las pantallas de dentro: cabecera arriba,
 * contenido en medio, barra amarilla abajo.
 *
 * Vive en un layout y no en cada página para que NO se vuelva a montar al
 * navegar. Importa más de lo que parece: si la barra se re-montara, perdería
 * el estado de «estoy arrancando una partida» justo mientras se navega hacia
 * /juego, que es exactamente cuando hace falta.
 *
 * El proveedor de la invitación envuelve todo porque el modal sale en tres
 * momentos que ocurren en pantallas distintas —al registrarse, tras la
 * primera partida y tras el primer retiro— y quién lo ha visto ya se lleva
 * en un solo sitio.
 */
export default function MainLayout({ children }: { children: React.ReactNode }) {
  return (
    <InviteModalProvider>
      <div className="app-shell">
        <FondoJuego />
        <Header />
        <div className="app-content">{children}</div>
        <BarraJugar />
      </div>
    </InviteModalProvider>
  );
}
