/**
 * Guarda un fotograma REAL del motor 3D en `public/escena-fondo.jpg`. Es el
 * fondo del registro y del inicio de sesión.
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
 * Necesita Playwright y su Chromium, que no son dependencias del proyecto:
 *   npm i -D playwright && npx playwright install chromium
 */
import path from 'path';
import { chromium } from 'playwright';

const [, , correo, clave, base = 'http://localhost:3000'] = process.argv;
if (!correo || !clave) {
  console.error('Uso: node scripts/foto-escena.mjs correo@ejemplo.com "la-clave" [url]');
  process.exit(1);
}
const SALIDA = path.join(process.cwd(), 'public', 'escena-fondo.jpg');

const navegador = await chromium.launch({
  // El motor necesita WebGL, y el Chromium sin cabeza no lo trae de serie.
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
// Vertical y grande: es el fondo de una pantalla de teléfono.
const ctx = await navegador.newContext({
  viewport: { width: 460, height: 900 },
  deviceScaleFactor: 2,
});
const pag = await ctx.newPage();

await pag.goto(`${base}/auth/login`, { waitUntil: 'networkidle', timeout: 60000 });
await pag.fill('input[type="email"]', correo);
await pag.fill('input[type="password"]', clave);
await pag.click('.btn-submit');
await pag.waitForURL(/\/juego/, { timeout: 60000 });
await pag.waitForTimeout(2500);

await pag.locator('.mc-boton, .play-bar-btn').first().click({ timeout: 20000 });
await pag.waitForSelector('canvas', { timeout: 40000 });
// El motor monta la escena, coloca el mundo y encuadra la cámara. Sin esta
// espera se fotografía una calle a medio poblar.
await pag.waitForTimeout(6000);

// Fuera el HUD y el distintivo de desarrollo: la foto es de la CALLE, no de
// la pantalla de juego con sus botones.
await pag.addStyleTag({
  content:
    'div.pointer-events-none.absolute.inset-0 { display: none !important }' +
    'nextjs-portal { display: none !important }',
});
await pag.waitForTimeout(600);

// Solo el lienzo: así no entra nada del DOM aunque quedara algo visible.
await pag.locator('canvas').first().screenshot({ path: SALIDA, type: 'jpeg', quality: 78 });
console.log('escena-fondo.jpg guardada');
await navegador.close();
