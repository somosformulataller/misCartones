'use client';

import { useRouter } from 'next/navigation';
import BuyTicketsModal from '@/components/payments/BuyTicketsModal';

// Comprar tickets. Es el mismo flujo completo que abre el modal desde la
// barra amarilla —tasa del BCV, Pago Móvil, comprobante, validación contra
// el banco—, con su propia dirección para poder mandarla por WhatsApp.
// Al cerrar vuelve al juego, que es de donde vino.
export default function ComprarPage() {
  const router = useRouter();
  return (
    <main>
      <BuyTicketsModal open onClose={() => router.push('/juego')} />
    </main>
  );
}
