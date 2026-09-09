import { NextResponse } from 'next/server';
import { createAdminClient, isAdminClientConfigured } from '@/lib/supabase/admin';
import { requireStaff } from '@/lib/admin/guard';
import { diaCaracas } from '@/lib/payments/constants';
import { leerTodo } from '@/lib/admin/tandas';

interface FilaCompra {
  amount_usd: number | string | null;
  created_at: string;
  validated_at: string | null;
}
interface FilaRetiro {
  amount_usd: number | string | null;
  status: string;
  created_at: string;
  paid_at: string | null;
}

/**
 * Caja de los últimos 30 días, un renglón por día.
 *
 * Es la cuenta más simple que hay y la que nadie tenía delante: cuánto
 * entró, cuánto salió y qué quedó. Sin RTP, sin partidas, sin
 * jugadores — dinero que entra y dinero que sale.
 *
 * Qué cuenta como cada cosa:
 *  · ENTRÓ: las recargas APROBADAS, el día en que se aprobaron (que es
 *    cuando aceptamos el dinero). Las rechazadas no entraron nunca.
 *  · SALIÓ: los retiros PAGADOS, el día en que se pagaron. Un retiro
 *    pendiente aún no ha salido de la cuenta: se informa aparte, para
 *    que se sepa lo que está comprometido sin mezclarlo con lo real.
 *
 * Los días son días de Venezuela (diaCaracas), como el resto del panel.
 */

const DIAS = 30;

interface DiaCaja {
  /** YYYY-MM-DD, día de Venezuela */
  dia: string;
  depositos: number;
  retiros: number;
  /** depositos − retiros */
  ganancia: number;
  /** ganancia sobre lo depositado, en % (null si no entró nada) */
  porcentaje: number | null;
  /** Cuántas recargas y cuántos retiros hubo */
  nDepositos: number;
  nRetiros: number;
}

export async function GET() {
  try {
    const { error } = await requireStaff('caja');
    if (error) return error;
    if (!isAdminClientConfigured()) {
      return NextResponse.json({ error: 'Falta SUPABASE_SECRET_KEY en el servidor' }, { status: 503 });
    }
    const admin = createAdminClient();

    // Desde el principio del día de Venezuela de hace 29 días, para
    // que el trigésimo renglón sea HOY completo.
    const desde = new Date(Date.now() - (DIAS - 1) * 24 * 60 * 60 * 1000);
    desde.setUTCHours(0, 0, 0, 0);
    const desdeISO = desde.toISOString();

    // Por tandas, no con `.limit(5000)`: el tope del servidor son 1.000
    // filas y se aplica igual, sin avisar. En 30 días ya hay más de mil
    // recargas.
    const [compras, retiros] = await Promise.all([
      leerTodo<FilaCompra>(admin, 'ticket_purchases', 'id, amount_usd, created_at, validated_at', (q) =>
        q.eq('status', 'aprobado').gte('created_at', desdeISO)
      ),
      leerTodo<FilaRetiro>(admin, 'withdrawals', 'id, amount_usd, status, created_at, paid_at', (q) =>
        q.gte('created_at', desdeISO)
      ),
    ]);

    // Los 30 renglones existen aunque no haya pasado nada: un día sin
    // movimiento es información, no un hueco en la lista.
    const dias = new Map<string, DiaCaja>();
    for (let i = DIAS - 1; i >= 0; i--) {
      const d = diaCaracas(Date.now() - i * 24 * 60 * 60 * 1000);
      dias.set(d, {
        dia: d, depositos: 0, retiros: 0, ganancia: 0,
        porcentaje: null, nDepositos: 0, nRetiros: 0,
      });
    }

    for (const c of compras) {
      // El día en que se aprobó; si la base no guardó validated_at
      // (compras viejas), el día en que se registró.
      const dia = diaCaracas((c.validated_at as string) || (c.created_at as string));
      const fila = dias.get(dia);
      if (!fila) continue;
      fila.depositos += Number(c.amount_usd);
      fila.nDepositos++;
    }

    let pendiente = 0;
    let nPendientes = 0;
    for (const r of retiros) {
      const estado = r.status as string;
      if (estado === 'pendiente') {
        pendiente += Number(r.amount_usd);
        nPendientes++;
        continue;
      }
      if (estado !== 'pagado') continue; // cancelado / rechazado: no salió
      const dia = diaCaracas((r.paid_at as string) || (r.created_at as string));
      const fila = dias.get(dia);
      if (!fila) continue;
      fila.retiros += Number(r.amount_usd);
      fila.nRetiros++;
    }

    const r2 = (n: number) => Math.round(n * 100) / 100;
    const lista = [...dias.values()].map((f) => {
      const depositos = r2(f.depositos);
      const salidas = r2(f.retiros);
      const ganancia = r2(depositos - salidas);
      return {
        ...f,
        depositos,
        retiros: salidas,
        ganancia,
        // Sobre lo que entró: "de cada $100 que entraron, nos quedaron
        // $X". Sin entradas no hay porcentaje que calcular.
        porcentaje: depositos > 0 ? r2((ganancia / depositos) * 100) : null,
      };
    });

    const totalDep = r2(lista.reduce((a, d) => a + d.depositos, 0));
    const totalRet = r2(lista.reduce((a, d) => a + d.retiros, 0));
    const ganancia = r2(totalDep - totalRet);

    return NextResponse.json({
      dias: lista.reverse(), // el más reciente arriba
      total: {
        depositos: totalDep,
        retiros: totalRet,
        ganancia,
        porcentaje: totalDep > 0 ? r2((ganancia / totalDep) * 100) : null,
        // Comprometido pero aún sin pagar: no está en la ganancia
        pendiente: r2(pendiente),
        nPendientes,
      },
    });
  } catch {
    return NextResponse.json({ error: 'Error del servidor' }, { status: 500 });
  }
}
