/**
 * Guarda dos fondos sacados de un fotograma REAL del motor 3D:
 *
 *   · `public/escena-fondo.jpg`  — nítido, para el registro y el inicio de
 *     sesión, donde la tarjeta es de cristal y desenfoca ella misma.
 *   · `public/escena-difusa.jpg` — ya desenfocado, para las pantallas de
 *     dentro, donde el desenfoque por tarjeta saldría carísimo.
 *
 *   npm run dev                       # en otra terminal
 *   node scripts/foto-escena.mjs correo@ejemplo.com "la-clave" [http://localhost:3000]
 *
 * Antes ese fondo era la calle dibujada a mano en CSS —cuatro degradados y
 * unas cajas— y se notaba: era una aproximación de la escena, no la escena.
 * Vuelve a correrse cuando la calle cambie de aspecto.
 *
 * La cuenta se pasa por argumento y NO se escribe aquí: este repositorio es
 * público. Las de prueba están en `credenciales.md`, que no se versiona.
 *
 * OJO: arranca una partida de verdad, así que **gasta un ticket** de esa
 * cuenta. Úsala con el jugador de prueba, no con una de alguien.
 *
 * Playwright ya está en devDependencies; el navegador se baja aparte y una
 * sola vez:
 *   npx playwright install chromium
 */
import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';

const args = process.argv.slice(2);
/** Rehace SOLO la versión desenfocada, a partir de la nítida que ya está
 *  guardada. Sirve para afinar el desenfoque y el brillo sin volver a
 *  arrancar una partida —y sin gastar otro ticket—:
 *    node scripts/foto-escena.mjs --solo-difusa */
const soloDifusa = args.includes('--solo-difusa');
const [correo, clave, base = 'http://localhost:3000'] = args.filter((a) => a !== '--solo-difusa');
if (!soloDifusa && (!correo || !clave)) {
  console.error('Uso: node scripts/foto-escena.mjs correo@ejemplo.com "la-clave" [url]');
  console.error('  o: node scripts/foto-escena.mjs --solo-difusa');
  process.exit(1);
}

/** El acabado de la versión desenfocada. Detrás van tarjetas translúcidas y
 *  claras, así que NO se oscurece: un fondo apagado deja las tarjetas
 *  flotando sobre un gris y se pierde la calle, que es lo que se quería
 *  enseñar. Lo que sí se sube es el color, que el desenfoque se come. */
const ACABADO = 'blur(18px) brightness(1.02) saturate(1.25)';
const SALIDA = path.join(process.cwd(), 'public', 'escena-fondo.jpg');
/** La misma calle desenfocada, para el fondo de las pantallas de dentro. */
const DIFUSA = path.join(process.cwd(), 'public', 'escena-difusa.jpg');

const navegador = await chromium.launch({
  // El motor necesita WebGL, y el Chromium sin cabeza no lo trae de serie.
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
// Vertical y grande: es el fondo de una pantalla de teléfono.
const ctx = await navegador.newContext({
  viewport: { width: 460, height: 900 },
  deviceScaleFactor: 2,
});
const pag = soloDifusa ? null : await ctx.newPage();

if (!soloDifusa) {
await pag.goto(`${base}/auth/login`, { waitUntil: 'networkidle', timeout: 60000 });
await pag.fill('input[type="email"]', correo);
await pag.fill('input[type="password"]', clave);
await pag.click('.btn-submit');
await pag.waitForURL(/\/juego/, { timeout: 60000 });
await pag.waitForTimeout(2500);

// El vestíbulo ya no tiene botón propio: se arranca por la barra amarilla.
await pag.locator('.play-bar-btn').first().click({ timeout: 20000 });
await pag.waitForSelector('canvas', { timeout: 40000 });
// El motor monta la escena, coloca el mundo y encuadra la cámara. Sin esta
// espera se fotografía una calle a medio poblar.
await pag.waitForTimeout(6000);

// Fuera el HUD y el distintivo de desarrollo: la foto es de la CALLE, no de
// la pantalla de juego con sus botones.
await pag.addStyleTag({
  content:
    '.hud, .play-bar, .juego-aviso-oro, .monedas-capa, .juego-apagado, .juego-apagado-pista { display: none !important }' +
    'nextjs-portal { display: none !important }',
});
await pag.waitForTimeout(600);

// Solo el lienzo: así no entra nada del DOM aunque quedara algo visible.
await pag.locator('canvas').first().screenshot({ path: SALIDA, type: 'jpeg', quality: 78 });
console.log('escena-fondo.jpg guardada');
}

// ── La segunda: la misma calle, ya desenfocada ──
//
// Las pantallas de dentro (billetera, compra, referidos, perfil) llevan
// tarjetas translúcidas sobre este fondo. Desenfocar POR TARJETA con
// backdrop-filter es de lo más caro que se le puede pedir a un teléfono de
// gama baja, y ahí hay listas que se desplazan. Así que el desenfoque se
// hace UNA vez, aquí, y queda cocido en el archivo: las tarjetas solo tienen
// que ser translúcidas, que no cuesta nada.
//
// Sale pequeña a propósito: una imagen desenfocada no tiene detalle que
// perder y pesa una décima parte. El navegador la estira sin que se note.
const difusa = await ctx.newPage();
await difusa.setViewportSize({ width: 320, height: 620 });
const datos = fs.readFileSync(SALIDA).toString('base64');
await difusa.setContent(
  '<style>html,body{margin:0;height:100%;overflow:hidden;background:#1b2420}' +
  'img{width:112%;height:112%;margin:-6% 0 0 -6%;object-fit:cover;' +
  // El zoom del 112 % es para que el desenfoque no deje los bordes
  // transparentes: al difuminar, la imagen "se encoge" contra su marco.
  'filter:' + ACABADO + '}</style>' +
  '<img src="data:image/jpeg;base64,' + datos + '">'
);
await difusa.waitForTimeout(500);
await difusa.screenshot({ path: DIFUSA, type: 'jpeg', quality: 70 });
console.log('escena-difusa.jpg guardada');

await navegador.close();
