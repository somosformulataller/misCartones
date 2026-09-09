import { NextResponse } from 'next/server';
import { fetchExchangeRateSafe } from '@/lib/payments/exchangeRate';

// Tasa BCV para el modal de compra (USD → Bs). Si dolarapi falla,
// rate llega null y la UI no muestra el equivalente en Bs.
export async function GET() {
  const rate = await fetchExchangeRateSafe();
  return NextResponse.json({
    rate: rate?.rate ?? null,
    fetchedAt: rate?.fetchedAt ?? null,
  });
}
