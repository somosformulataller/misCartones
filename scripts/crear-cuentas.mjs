/**
 * Crea (o rehace) las dos cuentas de prueba: un administrador y un jugador.
 *
 *   node scripts/crear-cuentas.mjs "ClaveAdmin" "ClaveJugador"
 *
 * Lee `.env.local` y usa la clave de servicio, así que crea las cuentas con el
 * correo YA confirmado: entran directo, sin pasar por el enlace de
 * verificación. Por eso mismo esto no vive dentro de la app ni en una ruta:
 * es una herramienta de escritorio, y la clave que usa se salta RLS entera.
 *
 * Las contraseñas se pasan como argumentos y no se guardan aquí: un fichero
 * del repositorio con la clave del administrador dentro es exactamente lo que
 * no queremos. Quedan anotadas en `credenciales.md`, que no se versiona.
 */
import fs from 'fs';

const [, , claveAdmin, claveJugador] = process.argv;
if (!claveAdmin || !claveJugador) {
  console.error('Uso: node scripts/crear-cuentas.mjs "ClaveAdmin" "ClaveJugador"');
  process.exit(1);
}

const env = Object.fromEntries(
  fs
    .readFileSync('.env.local', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
);
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SECRET_KEY;
if (!URL_ || !KEY) {
  console.error('Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SECRET_KEY en .env.local');
  process.exit(1);
}
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

async function crear(email, password, meta) {
  const r = await fetch(`${URL_}/auth/v1/admin/users`, {
    method: 'POST',
    headers: H,
    body: JSON.stringify({ email, password, email_confirm: true, user_metadata: meta }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`${email}: HTTP ${r.status} ${JSON.stringify(j)}`);
  return j.id;
}

/** El disparador `handle_new_user` ya creó la fila en `players`; esto solo
 *  ajusta lo que no se puede decir al registrarse (el rol, los tickets). */
async function ajustar(id, campos) {
  const r = await fetch(`${URL_}/rest/v1/players?id=eq.${id}`, {
    method: 'PATCH',
    headers: { ...H, Prefer: 'return=representation' },
    body: JSON.stringify(campos),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`ajustar ${id}: HTTP ${r.status} ${t}`);
  return JSON.parse(t)[0];
}

const admin = await crear('somosformulataller@gmail.com', claveAdmin, {
  first_name: 'Estefanía',
  last_name: 'Admin',
  whatsapp: '04120000000',
  cedula: '00000001',
  accepted_terms: 'true',
});
// `panel_areas` en NULL en un admin = lo ve todo. La lista solo sirve para
// recortar, y quien recorta es el panel, no esto.
await ajustar(admin, { role: 'admin', panel_areas: null });
console.log(`admin    somosformulataller@gmail.com   ${admin}`);

const jugador = await crear('jugador.prueba@miscartones.test', claveJugador, {
  first_name: 'Jugador',
  last_name: 'De Prueba',
  whatsapp: '04140000001',
  cedula: '00000002',
  accepted_terms: 'true',
});
// Tickets y saldo de arranque: mientras el cobro automático no esté
// configurado, sin esto la cuenta no puede jugar ni una partida.
await ajustar(jugador, { tickets: 50, balance: 25 });
console.log(`jugador  jugador.prueba@miscartones.test  ${jugador}`);
