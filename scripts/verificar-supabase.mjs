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

  // ── RLS: el navegador solo ve lo suyo, y sin sesión no ve nada ──
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
