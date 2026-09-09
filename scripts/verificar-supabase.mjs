// Verificación de las tres migraciones contra el Supabase real.
//
// No se conforma con "existe el objeto": EJERCE cada garantía. Un índice único
// que existe pero no cubre lo que debía cubrir se ve igual desde el catálogo y
// distinto desde un INSERT duplicado.
//
// Crea un usuario de prueba y lo borra al final; el ON DELETE CASCADE de
// players -> game_runs -> game_history se lleva todo lo demás.
import fs from 'fs';

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
);
const URL = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SECRET_KEY;
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const svc = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
const anon = { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json' };

let fallos = 0;
const ok = (bien, etiqueta, detalle = '') => {
  if (!bien) fallos++;
  console.log(`  ${bien ? '✓' : '✗'} ${etiqueta}${detalle ? `\n      ${detalle}` : ''}`);
};

const rest = async (ruta, opts = {}, cab = svc) => {
  const r = await fetch(`${URL}/rest/v1/${ruta}`, { ...opts, headers: { ...cab, ...(opts.headers || {}) } });
  const txt = await r.text();
  let json = null;
  try { json = txt ? JSON.parse(txt) : null; } catch { /* respuesta vacía */ }
  return { status: r.status, ok: r.ok, txt, json };
};
const rpc = (fn, args, cab = svc) =>
  rest(`rpc/${fn}`, { method: 'POST', body: JSON.stringify(args) }, cab);

const correo = `verificacion-${Date.now()}@mis-cartones.test`;
let uid = null;

try {
  // ── 001: tablas ──
  console.log('\n001 — Tablas y disparador');
  for (const t of ['players', 'game_runs', 'game_history', 'app_events']) {
    const r = await rest(`${t}?select=*&limit=0`);
    ok(r.ok, `tabla ${t}`, r.ok ? '' : `HTTP ${r.status} ${r.txt.slice(0, 140)}`);
  }

  // El disparador handle_new_user: al crear la cuenta de auth debe aparecer
  // sola la fila de players. Si no, el jugador entra y no existe para el juego.
  const alta = await fetch(`${URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: svc,
    body: JSON.stringify({ email: correo, password: `Pv-${Date.now()}-xQ`, email_confirm: true }),
  });
  const altaJson = await alta.json();
  uid = altaJson.id ?? null;
  ok(!!uid, 'se crea una cuenta de auth', uid ? `id ${uid}` : JSON.stringify(altaJson).slice(0, 200));
  if (!uid) throw new Error('sin usuario no se puede seguir');

  const fila = await rest(`players?id=eq.${uid}&select=id,tickets,balance,role,blocked`);
  ok(
    fila.json?.length === 1,
    'handle_new_user crea sola la fila de players',
    fila.json?.length === 1 ? JSON.stringify(fila.json[0]) : `devuelve ${fila.json?.length ?? 0} filas`
  );

  // ── 002: los RPC de dinero ──
  console.log('\n002 — RPC de dinero');

  const sinTickets = await rpc('spend_ticket', { p_player: uid });
  ok(
    sinTickets.txt.includes('SIN_TICKETS'),
    'spend_ticket rechaza jugar sin tickets',
    sinTickets.txt.slice(0, 140)
  );

  await rest(`players?id=eq.${uid}`, { method: 'PATCH', body: JSON.stringify({ tickets: 2 }) });
  const gasta = await rpc('spend_ticket', { p_player: uid });
  ok(gasta.json === 1, 'spend_ticket descuenta 1 ticket y devuelve los que quedan', `devuelve ${gasta.txt}`);

  const tras = (await rest(`players?id=eq.${uid}&select=tickets,total_wagered`)).json?.[0];
  ok(
    tras?.tickets === 1 && Number(tras?.total_wagered) === 2,
    'spend_ticket apunta los $2 apostados',
    JSON.stringify(tras)
  );

  const desconocido = await rpc('spend_ticket', { p_player: '00000000-0000-0000-0000-000000000000' });
  ok(desconocido.txt.includes('Jugador no encontrado'), 'spend_ticket rechaza un jugador que no existe');

  const premio = await rpc('credit_prize', { p_player: uid, p_payout: 7.25 });
  const saldo = (await rest(`players?id=eq.${uid}&select=balance,total_won`)).json?.[0];
  ok(
    premio.ok && Number(saldo?.balance) === 7.25 && Number(saldo?.total_won) === 7.25,
    'credit_prize acredita el premio al saldo y al acumulado',
    JSON.stringify(saldo)
  );

  const negativo = await rpc('credit_prize', { p_player: uid, p_payout: -5 });
  ok(negativo.txt.includes('Premio inválido'), 'credit_prize rechaza un premio negativo');

  await rest(`players?id=eq.${uid}`, { method: 'PATCH', body: JSON.stringify({ blocked: true }) });
  const bloqueado = await rpc('credit_prize', { p_player: uid, p_payout: 1 });
  ok(bloqueado.txt.includes('CUENTA_BLOQUEADA'), 'una cuenta bloqueada no puede cobrar');
  await rest(`players?id=eq.${uid}`, { method: 'PATCH', body: JSON.stringify({ blocked: false }) });

  const admin = await rpc('is_admin', {});
  ok(admin.status === 200, 'is_admin responde', `HTTP ${admin.status}`);

  // ── 003: los índices de integridad ──
  console.log('\n003 — Integridad');

  const run1 = await rest('game_runs', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ player_id: uid, target_payout: 3.5, world_seed: 123456 }),
  });
  const runId = run1.json?.[0]?.id;
  ok(!!runId, 'se puede abrir una partida', runId ?? run1.txt.slice(0, 140));

  const run2 = await rest('game_runs', {
    method: 'POST',
    body: JSON.stringify({ player_id: uid, target_payout: 9.9, world_seed: 654321 }),
  });
  ok(
    run2.status === 409 || run2.txt.includes('game_runs_una_activa'),
    'la BASE DE DATOS impide una segunda partida activa del mismo jugador',
    `HTTP ${run2.status} ${run2.txt.slice(0, 140)}`
  );

  const h1 = await rest('game_history', {
    method: 'POST',
    body: JSON.stringify({ player_id: uid, run_id: runId, payout: 3.5, bags_count: 5 }),
  });
  ok(h1.ok || h1.status === 201, 'se registra la partida en el historial', `HTTP ${h1.status}`);

  const h2 = await rest('game_history', {
    method: 'POST',
    body: JSON.stringify({ player_id: uid, run_id: runId, payout: 3.5, bags_count: 5 }),
  });
  ok(
    h2.status === 409 || h2.txt.includes('game_history_run_unico'),
    'la BASE DE DATOS impide cobrar dos veces la misma partida',
    `HTTP ${h2.status} ${h2.txt.slice(0, 140)}`
  );

  // ── 004: cuentas, pagos, billetera y referidos ──
  console.log('\n004 — Cuentas, pagos, billetera y referidos');

  for (const t of [
    'ticket_purchases', 'withdrawals', 'referral_claims', 'blocked_references',
    'rate_limit_hits', 'player_payment_origins', 'player_tags', 'cron_pasadas',
    'password_reset_attempts', 'password_reset_grants',
  ]) {
    const r = await rest(`${t}?select=*&limit=0`);
    ok(r.ok, `tabla ${t}`, r.ok ? '' : `HTTP ${r.status} ${r.txt.slice(0, 140)}`);
  }

  // El código de invitación se pone SOLO al darse de alta. Si no, el jugador
  // entra a Referidos y no tiene nada que compartir.
  const perfil = (await rest(
    `players?id=eq.${uid}&select=referral_code,accepted_terms_at,password_reset_at`
  )).json?.[0];
  ok(
    typeof perfil?.referral_code === 'string' && perfil.referral_code.length === 6,
    'handle_new_user pone el código de invitación',
    JSON.stringify(perfil)
  );
  // Ni O ni 0 ni I ni 1 ni L: el código se dicta por WhatsApp, y uno que el
  // invitado teclea mal es un referido perdido.
  ok(
    /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/.test(perfil?.referral_code ?? ''),
    'el código no lleva caracteres que se confundan al dictarlos',
    perfil?.referral_code
  );

  // ── Los RPC del jugador exigen sesión ELLOS, no la ruta ──
  // Se llaman aquí con la clave de servicio, que no tiene auth.uid(): tienen
  // que negarse igual. Es la prueba de que la puerta está en la base y no en
  // el formulario, que cualquiera puede saltarse.
  for (const fn of [
    ['redeem_tickets', { p_qty: 1 }],
    ['request_withdrawal', { p_amount: 1 }],
    ['claim_referral', { p_referred: uid }],
    ['my_referrals', {}],
  ]) {
    const r = await rpc(fn[0], fn[1]);
    ok(
      r.txt.includes('No autorizado'),
      `${fn[0]} se niega sin sesión, aunque llame el servidor`,
      `HTTP ${r.status} ${r.txt.slice(0, 120)}`
    );
  }

  // ── Un solo retiro pendiente por jugador ──
  await rest(`players?id=eq.${uid}`, { method: 'PATCH', body: JSON.stringify({ balance: 50 }) });
  const w1 = await rest('withdrawals', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ player_id: uid, amount_usd: 5 }),
  });
  ok(!!w1.json?.[0]?.id, 'se puede abrir un retiro', w1.txt.slice(0, 140));
  const w2 = await rest('withdrawals', {
    method: 'POST',
    body: JSON.stringify({ player_id: uid, amount_usd: 7 }),
  });
  ok(
    w2.status === 409 || w2.txt.includes('withdrawals_uno_pendiente'),
    'la BASE DE DATOS impide dos retiros pendientes del mismo jugador',
    `HTTP ${w2.status} ${w2.txt.slice(0, 140)}`
  );

  // ── Cada tramo de referido se cobra UNA vez ──
  // Es el candado que en el juego hermano faltó y dejó cobrar la misma
  // partida veinte veces. Aquí se comprueba a nivel de índice: da igual lo
  // que haga el código de arriba.
  const c1 = await rest('referral_claims', {
    method: 'POST',
    body: JSON.stringify({ referrer_id: uid, referred_id: uid, amount_usd: 1, partidas: 10, tramo: 1 }),
  });
  ok(c1.ok || c1.status === 201, 'se registra el cobro de un tramo', `HTTP ${c1.status}`);
  const c2 = await rest('referral_claims', {
    method: 'POST',
    body: JSON.stringify({ referrer_id: uid, referred_id: uid, amount_usd: 1, partidas: 20, tramo: 1 }),
  });
  ok(
    c2.status === 409 || c2.txt.includes('referral_claims_tramo_unico'),
    'la BASE DE DATOS impide cobrar dos veces el mismo tramo',
    `HTTP ${c2.status} ${c2.txt.slice(0, 140)}`
  );

  // ── Aprobar una compra es idempotente ──
  // La conciliación REINTENTA por diseño. Sin esto, un reintento entrega los
  // tickets otra vez y el juego regala dinero sin que nadie se entere.
  const compra = await rest('ticket_purchases', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      player_id: uid, quantity: 3, amount_usd: 6, reference: '9987654321',
    }),
  });
  const compraId = compra.json?.[0]?.id;
  ok(!!compraId, 'se registra una compra', compra.txt.slice(0, 140));
  ok(
    compra.json?.[0]?.reference_norm === '654321',
    'la referencia se guarda normalizada a sus últimos 6 dígitos',
    compra.json?.[0]?.reference_norm
  );

  // Sin compra no hay nada que aprobar, y "los tickets no cambiaron" sería un
  // verde que sale de que no ocurrió NADA. Eso miente peor que un rojo, así
  // que se declara no comprobado.
  if (!compraId) {
    ok(false, 'aprobar entrega los tickets de la compra', 'sin compra: no se pudo comprobar');
    ok(false, 'aprobar DOS veces no entrega los tickets dos veces', 'sin compra: no se pudo comprobar');
    ok(false, 'rechazar una compra aprobada devuelve sus tickets', 'sin compra: no se pudo comprobar');
  } else {
    const tickets = async () =>
      Number((await rest(`players?id=eq.${uid}&select=tickets`)).json?.[0]?.tickets ?? 0);
    const antes = await tickets();
    await rpc('approve_purchase', { p_purchase: compraId, p_origin: 'manual' });
    const tras1 = await tickets();
    ok(tras1 === antes + 3, 'aprobar entrega los tickets de la compra', `${antes} → ${tras1}`);

    await rpc('approve_purchase', { p_purchase: compraId, p_origin: 'manual' });
    const tras2 = await tickets();
    ok(tras2 === tras1, 'aprobar DOS veces no entrega los tickets dos veces', `${tras1} → ${tras2}`);

    // Y rechazar una que ya estaba aprobada los devuelve.
    await rpc('reject_purchase', { p_purchase: compraId, p_note: 'prueba de verificación' });
    const tras3 = await tickets();
    ok(tras3 === antes, 'rechazar una compra aprobada devuelve sus tickets', `${tras2} → ${tras3}`);
  }

  // ── Los almacenes ──
  const bk = await fetch(`${URL}/storage/v1/bucket`, { headers: svc });
  const bkJson = await bk.json().catch(() => []);
  const nombres = Array.isArray(bkJson) ? bkJson.map((b) => b.id) : [];
  ok(
    nombres.includes('payment-proofs'),
    'existe el bucket de comprobantes',
    nombres.length ? nombres.join(', ') : `la API de storage respondió ${bk.status}`
  );
  ok(
    nombres.includes('avatars'),
    'existe el bucket de fotos de perfil',
    nombres.length ? nombres.join(', ') : `la API de storage respondió ${bk.status}`
  );
  const proofs = Array.isArray(bkJson) ? bkJson.find((b) => b.id === 'payment-proofs') : null;
  ok(
    proofs?.public === false,
    'el bucket de comprobantes es PRIVADO: lleva el nombre, el banco y la cuenta de una persona',
    JSON.stringify(proofs?.public)
  );

  // ── Las tablas de defensa no las lee NADIE desde el navegador ──
  for (const t of ['blocked_references', 'rate_limit_hits', 'player_payment_origins', 'player_tags', 'password_reset_grants']) {
    // Primero que la tabla EXISTA. Sin esto, una tabla que falta da 404 con
    // cero filas y pasaría por "el navegador no la ve", que es justo lo
    // contrario de lo que se quiere demostrar.
    const conServicio = await rest(`${t}?select=*&limit=0`);
    const r = await rest(`${t}?select=*`, {}, anon);
    const filas = Array.isArray(r.json) ? r.json.length : null;
    ok(
      conServicio.ok && (filas === 0 || r.status === 401 || r.status === 403),
      `con la clave anon, ${t} no devuelve nada`,
      conServicio.ok
        ? `HTTP ${r.status}, ${filas} filas`
        : 'la tabla no existe: no se pudo comprobar'
    );
  }

  // ── RLS: el navegador solo ve lo suyo, y sin sesión no ve nada ──

  // ── 005: lo que sostiene el panel de administración ──
  console.log('\n005 — Panel de administración');

  for (const t of ['ticket_redemptions', 'manual_adjustments', 'player_data_changes']) {
    const r = await rest(`${t}?select=*&limit=0`);
    ok(r.ok, `tabla ${t}`, r.ok ? '' : `HTTP ${r.status} ${r.txt.slice(0, 140)}`);
  }

  // Las firmas: sin estas columnas, dentro de un mes nadie sabe quién aprobó
  // qué. Se comprueba escribiendo, no mirando el catálogo.
  const firmaCompra = await rest(`ticket_purchases?id=eq.${compraId ?? '00000000-0000-0000-0000-000000000000'}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ handled_by: uid }),
  });
  ok(
    compraId ? firmaCompra.ok && firmaCompra.json?.[0]?.handled_by === uid : false,
    'una compra puede guardar quién del equipo la atendió',
    compraId ? `HTTP ${firmaCompra.status} ${firmaCompra.txt.slice(0, 120)}` : 'sin compra: no se pudo comprobar'
  );
  const retiroId = w1.json?.[0]?.id;
  const firmaRetiro = await rest(`withdrawals?id=eq.${retiroId ?? '00000000-0000-0000-0000-000000000000'}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ handled_by: uid }),
  });
  ok(
    retiroId ? firmaRetiro.ok && firmaRetiro.json?.[0]?.handled_by === uid : false,
    'un retiro puede guardar quién del equipo lo pagó',
    retiroId ? `HTTP ${firmaRetiro.status} ${firmaRetiro.txt.slice(0, 120)}` : 'sin retiro: no se pudo comprobar'
  );

  // ── La misma etiqueta, una sola vez ──
  const et1 = await rest('player_tags', {
    method: 'POST',
    body: JSON.stringify({ player_id: uid, label: 'Testimonio pedido', color: 'gold' }),
  });
  ok(et1.ok || et1.status === 201, 'se le puede poner una etiqueta a un jugador', `HTTP ${et1.status}`);
  // Distinta caja, misma etiqueta: para quien la lee es la misma cosa.
  const et2 = await rest('player_tags', {
    method: 'POST',
    body: JSON.stringify({ player_id: uid, label: 'testimonio PEDIDO' }),
  });
  ok(
    et2.status === 409 || et2.txt.includes('player_tags_unica'),
    'la misma etiqueta no se repite aunque cambie de mayúsculas',
    `HTTP ${et2.status} ${et2.txt.slice(0, 140)}`
  );

  // ── El canje deja rastro ──
  // Se llama con la clave de servicio, que no tiene auth.uid(): tiene que
  // negarse. Lo que importa aquí es que la función SIGA existiendo con su
  // guardia después de reescribirla en la 005.
  const canje = await rpc('redeem_tickets', { p_qty: 1 });
  ok(
    canje.txt.includes('No autorizado'),
    'redeem_tickets sigue exigiendo sesión después de reescribirla',
    `HTTP ${canje.status} ${canje.txt.slice(0, 120)}`
  );
  // Y que la bitácora acepta filas (es donde escribirá la función).
  const canjeLog = await rest('ticket_redemptions', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ player_id: uid, quantity: 1, amount_usd: 2 }),
  });
  ok(!!canjeLog.json?.[0]?.id, 'la bitácora de canjes acepta un movimiento', canjeLog.txt.slice(0, 140));

  // ── Los tres agregados del panel ──
  const totales = await rpc('get_admin_totals', {});
  ok(
    totales.ok && typeof totales.json?.jugadores === 'number',
    'get_admin_totals suma sobre la base entera',
    `HTTP ${totales.status} ${totales.txt.slice(0, 160)}`
  );
  const inter = await rpc('get_interaction_stats', {});
  ok(
    inter.ok && Array.isArray(inter.json),
    'get_interaction_stats devuelve la interacción por jugador',
    `HTTP ${inter.status} ${inter.txt.slice(0, 160)}`
  );
  const refPanel = await rpc('admin_referral_overview', {});
  ok(
    refPanel.ok && refPanel.json?.summary && refPanel.json?.stats,
    'admin_referral_overview arma el tablero de referidos entero',
    `HTTP ${refPanel.status} ${refPanel.txt.slice(0, 160)}`
  );
  ok(
    Array.isArray(refPanel.json?.stats?.chart) && refPanel.json.stats.chart.length === 7,
    'la gráfica de afiliados trae los 7 días, hayan tenido o no registros',
    `${refPanel.json?.stats?.chart?.length ?? '?'} días`
  );

  // Los tres saltan RLS y leen la base ENTERA. Si el navegador pudiera
  // llamarlos, cualquier jugador sacaría el saldo y el teléfono de todos.
  //
  // Primero que la función EXISTA. Sin eso, una función que falta responde
  // 404 y pasaría por «el navegador no puede llamarla», que es justo lo
  // contrario de lo que se quiere demostrar.
  const existe = { get_admin_totals: totales.ok, get_interaction_stats: inter.ok, admin_referral_overview: refPanel.ok };
  for (const fn of ['get_admin_totals', 'get_interaction_stats', 'admin_referral_overview']) {
    const r = await rpc(fn, {}, anon);
    ok(
      existe[fn] && !r.ok,
      `con la clave anon, ${fn} NO se puede ejecutar`,
      existe[fn]
        ? `HTTP ${r.status} ${r.txt.slice(0, 120)}`
        : 'la función no existe: no se pudo comprobar'
    );
  }

  // ── Y las bitácoras tampoco se leen desde el navegador ──
  for (const t of ['ticket_redemptions', 'manual_adjustments', 'player_data_changes']) {
    const conServicio = await rest(`${t}?select=*&limit=0`);
    const r = await rest(`${t}?select=*`, {}, anon);
    const filas = Array.isArray(r.json) ? r.json.length : null;
    ok(
      conServicio.ok && (filas === 0 || r.status === 401 || r.status === 403),
      `con la clave anon, ${t} no devuelve nada`,
      conServicio.ok
        ? `HTTP ${r.status}, ${filas} filas`
        : 'la tabla no existe: no se pudo comprobar'
    );
  }

  console.log('\nRLS — lo que ve el navegador');
  for (const t of ['players', 'game_runs', 'game_history', 'app_events']) {
    const r = await rest(`${t}?select=*`, {}, anon);
    const filas = Array.isArray(r.json) ? r.json.length : null;
    ok(filas === 0, `con la clave anon y sin sesión, ${t} no devuelve nada`, `HTTP ${r.status}, ${filas} filas`);
  }
  const escribe = await rest('players', {
    method: 'POST',
    body: JSON.stringify({ id: uid, balance: 999999 }),
  }, anon);
  ok(!escribe.ok, 'la clave anon no puede escribir en players', `HTTP ${escribe.status}`);
} finally {
  if (uid) {
    const borrado = await fetch(`${URL}/auth/v1/admin/users/${uid}`, { method: 'DELETE', headers: svc });
    const queda = await rest(`players?id=eq.${uid}&select=id`);
    console.log('\nLimpieza');
    ok(
      borrado.ok && queda.json?.length === 0,
      'el usuario de prueba y todo lo suyo quedan borrados',
      `DELETE ${borrado.status}, quedan ${queda.json?.length ?? '?'} filas en players`
    );
  }
}

console.log(fallos === 0 ? '\n✅ Las tres migraciones están aplicadas y sus garantías funcionan.' : `\n❌ ${fallos} comprobación(es) fallaron.`);
process.exit(fallos === 0 ? 0 : 1);
