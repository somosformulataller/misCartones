// ============================================================================
// Reparto del premio en las 5 bolsas. Portado de La Llave Correcta
// (lib/game/prizeSplit.ts, actualización 12 del 14/08/2026); solo cambian los
// nombres: llave → bolsa.
//
// NO TOCA LA ECONOMÍA. El premio de la partida lo sigue sorteando
// drawPayoutTier + el corta-rachas de buy-ticket. Aquí solo se decide CÓMO se
// parte ese premio entre las 5 bolsas. Las 5 partes suman EXACTO el premio,
// así que el RTP (98,03 %) queda intacto.
//
// ⚠️ EL RTP DEPENDE DE QUE LAS 5 BOLSAS SIEMPRE SE ENTREGUEN.
// Si algún día se añade un reloj que pueda dejar bolsas sin entregar, o
// obstáculos que hagan perder una bolsa, el jugador cobrará menos del 100 %
// de lo sorteado y el RTP real caerá por debajo del 98 % de forma
// impredecible y no auditable. Ver PLAN.md §6.3 antes de cambiar nada.
//
// Reglas:
//  · Al menos una bolsa de $1,00+ en toda partida que no sea la consolación.
//  · La bolsa MAYOR sale en la 1ª, 2ª o 3ª entrega.
//  · La última entrega se queda la SEGUNDA más grande, para que el cierre no
//    sea la moneda más pobre.
//  · Montos en pasos de $0,05 con un piso por banda.
//
// Es determinista por partida: el servidor lo recalcula en cada entrega a
// partir del id de la sesión, sin guardar nada en la base de datos.
// ============================================================================

const CONSOLACION = 50; // centavos

/** PRNG sembrado con una cadena (FNV-1a + mulberry32) */
function seedRand(seed: string): () => number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return () => {
    h = (h + 0x6d2b79f5) >>> 0;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Múltiplo de 5 centavos al azar dentro de [a, b] */
function pick5(a: number, b: number, rnd: () => number): number {
  const lo = Math.ceil(a / 5);
  const hi = Math.floor(b / 5);
  if (hi <= lo) return Math.max(lo, hi) * 5;
  return (lo + Math.floor(rnd() * (hi - lo + 1))) * 5;
}

/** Reparte `total` en `n` partes múltiplo de 5c, cada una >= `piso` */
function repartir(total: number, n: number, piso: number, rnd: () => number): number[] {
  const partes = new Array(n).fill(Math.floor(piso / 5));
  let extra = Math.floor(total / 5) - partes.reduce((s: number, p: number) => s + p, 0);
  // Las sobras caen de a trozos en cubos al azar: reparto irregular, que es
  // justo lo que se busca (nada de cuatro montos iguales).
  let guarda = 0;
  while (extra > 0 && guarda++ < 500) {
    const trozo = Math.min(extra, Math.max(1, Math.round(extra * (0.15 + rnd() * 0.5))));
    partes[Math.floor(rnd() * n)] += trozo;
    extra -= trozo;
  }
  return partes.map((p: number) => p * 5);
}

interface Banda {
  /** Cuántas bolsas de $1,00 o más lleva la partida */
  grandes: number;
  min: number;
  max: number;
  /** Piso de las bolsas chicas */
  piso: number;
}

// El techo del 80 % es un tope: el límite real lo recorta la garantía de las
// otras bolsas de $1+ y los pisos.
function banda(P: number): Banda {
  const r5 = (x: number) => Math.round(x / 5) * 5;
  if (P <= 300) return { grandes: 1, min: 100, max: r5(P * 0.8), piso: 10 };
  if (P <= 430) return { grandes: 2, min: 120, max: r5(P * 0.8), piso: 15 };
  if (P <= 700) return { grandes: 3, min: 150, max: r5(P * 0.8), piso: r5(P * 0.045) };
  if (P <= 1000) return { grandes: 3, min: 250, max: r5(P * 0.8), piso: r5(P * 0.045) };
  return { grandes: 4, min: r5(P * 0.22), max: r5(P * 0.6), piso: r5(P * 0.03) };
}

/**
 * Los 5 montos de la partida, en dólares y en ORDEN DE ENTREGA
 * (índice 4 = la última bolsa que se vacía en la carretilla).
 * Suman EXACTO `payout`.
 */
export function bagSplit(payout: number, sessionId: string): number[] {
  const P = Math.round(payout * 100);
  if (!Number.isFinite(P) || P <= 0) return [0, 0, 0, 0, 0];

  // Premios diminutos (no existen en la tabla, pero que no reviente).
  if (P < 25) {
    const base = Math.floor(P / 5);
    const montos = [base, 0, 0, 0, 0];
    montos[0] += P - base;
    return montos.map((c) => c / 100);
  }

  const rnd = seedRand(sessionId);
  const suelto = P % 5; // los premios de la tabla son múltiplos de $0,10
  const objetivo = P - suelto;
  let montos: number[];

  if (objetivo <= CONSOLACION) {
    // Consolación: sin bolsa grande, pero la destacada varía entre $0,15 y
    // $0,30 y el resto se reparte distinto cada partida.
    const top = pick5(15, Math.min(30, objetivo - 4 * 5), rnd);
    montos = [top, ...repartir(objetivo - top, 4, 5, rnd)];
  } else {
    const b = banda(objetivo);
    const chicas = 5 - b.grandes;
    const grandes: number[] = [];
    let resto = objetivo;
    // La mayor primero; el techo se recorta con lo que hay que dejar para las
    // otras bolsas grandes y para los pisos.
    const techo = Math.min(b.max, objetivo - (b.grandes - 1) * 100 - chicas * b.piso);
    const mayor = pick5(Math.min(b.min, techo), techo, rnd);
    grandes.push(mayor);
    resto -= mayor;
    for (let i = 1; i < b.grandes; i++) {
      const pend = b.grandes - 1 - i;
      const tope = Math.min(grandes[i - 1], resto - pend * 100 - chicas * b.piso);
      const v = pick5(Math.min(100, tope), tope, rnd);
      grandes.push(v);
      resto -= v;
    }
    montos = [...grandes, ...repartir(resto, chicas, b.piso, rnd)];
  }

  // Red de seguridad: pase lo que pase, la suma es el premio EXACTO. Sin esto
  // un redondeo raro movería el RTP.
  const suma = montos.reduce((s, c) => s + c, 0);
  const mayorIdx = montos.indexOf(Math.max(...montos));
  montos[mayorIdx] += P - suma;

  // Colocación: la MAYOR entre las 3 primeras entregas, la SEGUNDA en la
  // última, y las otras tres barajadas en los puestos que sobran.
  const orden = [...montos].sort((a, b2) => b2 - a);
  const mayorMonto = orden.shift() as number;
  const ultima = orden.shift() as number;
  for (let i = orden.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [orden[i], orden[j]] = [orden[j], orden[i]];
  }
  orden.splice(Math.floor(rnd() * 3), 0, mayorMonto);
  return [...orden, ultima].map((c) => c / 100);
}
