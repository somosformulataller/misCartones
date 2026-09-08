// ============================================================================
// Pruebas de la economía y del generador de escenarios.
//
// Son los CRITERIOS DE ACEPTACIÓN de la Fase 2 del plan, y van al repositorio
// a propósito: son la red que impide que un cambio "inofensivo" mueva el RTP
// o genere una partida imposible de terminar.
//
//   npm test
//
// Compila lib/game a .pruebas-build/ y corre contra el JavaScript de verdad,
// no contra una copia: si el código de producción cambia, estas pruebas
// cambian con él.
// ============================================================================

import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const raiz = path.join(aqui, '..');

console.log('Compilando lib/game…');
execSync(`npx tsc -p "${path.join(aqui, 'tsconfig.pruebas.json')}"`, {
  cwd: raiz,
  stdio: 'inherit',
});

const require = createRequire(import.meta.url);
const salida = path.join(raiz, '.pruebas-build', 'lib', 'game');
const { drawPayoutTier, drawSessionTier, drawWorldSeed } = require(path.join(salida, 'rng.js'));
const { bagSplit } = require(path.join(salida, 'bagSplit.js'));
const { buildWorld, PLAY, CITIZEN_RADIUS, BAG_RADIUS } = require(path.join(salida, 'world.js'));
const { PAYOUT_TABLE, TOTAL_BAGS } = require(path.join(salida, 'constants.js'));

let fallos = 0;
const ok = (cond, msg, detalle = '') => {
  if (cond) {
    console.log(`  ✓ ${msg}`);
  } else {
    fallos++;
    console.log(`  ✗ ${msg}${detalle ? `\n      ${detalle}` : ''}`);
  }
};

// ── 1. RTP ─────────────────────────────────────────────────────────────────
// El número que sostiene todo el negocio. Si esto se mueve, la caja se mueve.
console.log('\n1. RTP (1.000.000 de partidas)');
{
  const N = 1_000_000;

  // 1a. La tabla desnuda, sin corta-rachas. Se mide SOLO para dejar por
  // escrito cuánto aporta la regla: no es el RTP de producción.
  let crudo = 0;
  for (let i = 0; i < N; i++) crudo += drawPayoutTier().payout;
  const rtpCrudo = (crudo / (N * 2)) * 100;
  console.log(`     Tabla sola, sin corta-rachas: ${rtpCrudo.toFixed(3)} %`);

  // 1b. EL DE VERDAD. Se simula la SECUENCIA de partidas de un jugador, que
  // es lo que hace buy-ticket: el corta-rachas necesita los dos premios
  // anteriores, así que no se puede medir sorteando tiradas sueltas.
  let dentro = 0;
  let fuera = 0;
  let ultimos = [];
  const cuenta = new Map();
  let tresSeguidas = 0;

  for (let i = 0; i < N; i++) {
    const t = drawSessionTier(ultimos);
    dentro += 2;
    fuera += t.payout;
    cuenta.set(t.payout, (cuenta.get(t.payout) ?? 0) + 1);

    if (ultimos.length === 2 && ultimos.every((p) => p <= 0.5) && t.payout <= 0.5) {
      tresSeguidas++;
    }
    ultimos = [t.payout, ...ultimos].slice(0, 2);
  }

  const rtp = (fuera / dentro) * 100;
  console.log(`     RTP de producción (con corta-rachas): ${rtp.toFixed(3)} %`);
  console.log(`     Aporte del corta-rachas: +${(rtp - rtpCrudo).toFixed(3)} puntos`);
  ok(Math.abs(rtp - 98.03) < 0.1, 'RTP de producción = 98,03 % ± 0,1', `medido ${rtp.toFixed(3)} %`);

  // La promesa al jugador. Si esto se rompe, el corta-rachas dejó de aplicarse.
  ok(tresSeguidas === 0, 'NUNCA hay 3 consolaciones seguidas', `${tresSeguidas} casos`);

  const consolacion = ((cuenta.get(0.5) ?? 0) / N) * 100;
  console.log(`     Consolación efectiva: ${consolacion.toFixed(2)} % de las partidas`);
  ok(consolacion > 23 && consolacion < 28, 'Consolación efectiva entre el 23 % y el 28 %');

  const masDelTicket = [...cuenta.entries()]
    .filter(([p]) => p > 2)
    .reduce((s, [, c]) => s + c, 0);
  const pct = (masDelTicket / N) * 100;
  console.log(`     Gana más de $2: ${pct.toFixed(2)} % de las partidas`);
  ok(pct > 70, 'Más del 70 % de las partidas pagan por encima del ticket');
}

// ── 2. bagSplit ────────────────────────────────────────────────────────────
// Si las 5 partes no suman EXACTO el premio, el RTP se va — por arriba o por
// abajo. Es la propiedad más importante de todo el archivo.
console.log('\n2. Reparto en las 5 bolsas');
{
  let malSuma = 0;
  let malMayor = 0;
  let malUltima = 0;
  let negativos = 0;
  const N = 60_000;

  for (let i = 0; i < N; i++) {
    const tier = PAYOUT_TABLE[i % PAYOUT_TABLE.length];
    const sid = `prueba-${i}-${(i * 2654435761) >>> 0}`;
    const partes = bagSplit(tier.payout, sid);

    if (partes.length !== TOTAL_BAGS) malSuma++;
    const suma = Math.round(partes.reduce((s, v) => s + v, 0) * 100);
    if (suma !== Math.round(tier.payout * 100)) malSuma++;
    if (partes.some((v) => v < 0)) negativos++;

    const max = Math.max(...partes);
    // La bolsa MAYOR sale en una de las tres primeras entregas.
    if (partes.indexOf(max) > 2) malMayor++;

    // La última entrega se queda la SEGUNDA más grande: el cierre no puede
    // ser la moneda más pobre.
    const ordenado = [...partes].sort((a, b) => b - a);
    if (Math.abs(partes[4] - ordenado[1]) > 0.001) malUltima++;
  }

  ok(malSuma === 0, `Las 5 partes suman EXACTO el premio (${N} repartos)`, `${malSuma} fallos`);
  ok(negativos === 0, 'Ninguna parte es negativa', `${negativos} fallos`);
  ok(malMayor === 0, 'La bolsa mayor cae en las 3 primeras entregas', `${malMayor} fallos`);
  ok(malUltima === 0, 'La última entrega se lleva la segunda mayor', `${malUltima} fallos`);
}

// ── 3. Determinismo ────────────────────────────────────────────────────────
// El servidor recalcula el reparto en CADA entrega sin guardar nada. Si no
// fuera determinista, el jugador cobraría montos distintos por la misma bolsa.
console.log('\n3. Determinismo');
{
  let distintos = 0;
  for (let i = 0; i < 5000; i++) {
    const sid = `det-${i}`;
    const a = bagSplit(4.3, sid).join(',');
    const b = bagSplit(4.3, sid).join(',');
    if (a !== b) distintos++;
  }
  ok(distintos === 0, 'Mismo id de partida → mismo reparto, siempre');

  let mundosDistintos = 0;
  for (let i = 0; i < 2000; i++) {
    const s = (i * 7919) >>> 0;
    const a = JSON.stringify(buildWorld(s));
    const b = JSON.stringify(buildWorld(s));
    if (a !== b) mundosDistintos++;
  }
  ok(mundosDistintos === 0, 'Misma semilla → mismo escenario, siempre');
}

// ── 4. Generador de escenarios ─────────────────────────────────────────────
// En pantalla fija, UNA bolsa mal colocada arruina la partida entera: el
// jugador no puede terminar y no hay forma de que cobre lo que ya se sorteó.
console.log('\n4. Colocación del escenario (10.000 semillas)');
{
  const N = 10_000;
  let malCantidad = 0;
  let fueraDelArea = 0;
  let encimaDeObstaculo = 0;
  let demasiadoJuntas = 0;
  let aisladas = 0;
  let malDistanciaCarretilla = 0;

  const CELL = 20;
  const distRect = (px, py, r) => {
    const dx = Math.max(r.x - px, 0, px - (r.x + r.w));
    const dy = Math.max(r.y - py, 0, py - (r.y + r.h));
    return Math.hypot(dx, dy);
  };

  // Inundación independiente de la del código de producción: si las dos
  // coincidieran por copiar el mismo error, la prueba no valdría nada.
  const alcanzables = (w) => {
    const cols = Math.ceil(PLAY.w / CELL);
    const rows = Math.ceil(PLAY.h / CELL);
    const bloq = new Uint8Array(cols * rows);
    for (const o of w.obstacles) {
      if (!o.solid) continue;
      for (let gy = 0; gy < rows; gy++) {
        for (let gx = 0; gx < cols; gx++) {
          const cx = PLAY.x + gx * CELL + CELL / 2;
          const cy = PLAY.y + gy * CELL + CELL / 2;
          if (distRect(cx, cy, o) < CITIZEN_RADIUS) bloq[gy * cols + gx] = 1;
        }
      }
    }
    const idx = (x, y) => {
      const gx = Math.min(cols - 1, Math.max(0, Math.floor((x - PLAY.x) / CELL)));
      const gy = Math.min(rows - 1, Math.max(0, Math.floor((y - PLAY.y) / CELL)));
      return gy * cols + gx;
    };
    const vistos = new Uint8Array(cols * rows);
    const pila = [idx(w.cart.x, w.cart.y)];
    vistos[pila[0]] = 1;
    while (pila.length) {
      const c = pila.pop();
      const cx = c % cols;
      const cy = (c / cols) | 0;
      for (const n of [
        cx > 0 ? c - 1 : -1,
        cx < cols - 1 ? c + 1 : -1,
        cy > 0 ? c - cols : -1,
        cy < rows - 1 ? c + cols : -1,
      ]) {
        if (n < 0 || vistos[n] || bloq[n]) continue;
        vistos[n] = 1;
        pila.push(n);
      }
    }
    return w.bags.every((b) => vistos[idx(b.x, b.y)] === 1);
  };

  for (let i = 0; i < N; i++) {
    const w = buildWorld(drawWorldSeed());

    if (w.bags.length !== TOTAL_BAGS) malCantidad++;

    for (const b of w.bags) {
      if (
        b.x < PLAY.x ||
        b.x > PLAY.x + PLAY.w ||
        b.y < PLAY.y ||
        b.y > PLAY.y + PLAY.h
      ) {
        fueraDelArea++;
      }
      for (const o of w.obstacles) {
        if (distRect(b.x, b.y, o) < BAG_RADIUS * 0.5) encimaDeObstaculo++;
      }
      const d = Math.hypot(b.x - w.cart.x, b.y - w.cart.y);
      if (d < 100 || d > 700) malDistanciaCarretilla++;
    }

    for (let a = 0; a < w.bags.length; a++) {
      for (let b = a + 1; b < w.bags.length; b++) {
        if (Math.hypot(w.bags[a].x - w.bags[b].x, w.bags[a].y - w.bags[b].y) < 80) {
          demasiadoJuntas++;
        }
      }
    }

    if (!alcanzables(w)) aisladas++;
  }

  ok(malCantidad === 0, `Siempre ${TOTAL_BAGS} bolsas`, `${malCantidad} fallos`);
  ok(fueraDelArea === 0, 'Ninguna bolsa fuera del área jugable', `${fueraDelArea} fallos`);
  ok(encimaDeObstaculo === 0, 'Ninguna bolsa encima de un obstáculo', `${encimaDeObstaculo} fallos`);
  ok(demasiadoJuntas === 0, 'Ninguna pareja de bolsas amontonada', `${demasiadoJuntas} fallos`);
  ok(malDistanciaCarretilla === 0, 'Todas a distancia jugable de la carretilla', `${malDistanciaCarretilla} fallos`);
  ok(aisladas === 0, 'TODAS las bolsas tienen camino hasta la carretilla', `${aisladas} escenarios rotos`);
}

// ── 5. Encuadre de la cámara ───────────────────────────────────────────────
// El juego tiene camara FIJA y area de juego FIJA: si la camara no se coloca
// bien, o se sale medio terreno de la pantalla o sobra la mitad. Y la
// distancia correcta depende de la FORMA de la pantalla, asi que fijarla a ojo
// funciona en un telefono y se rompe en todos los demas.
//
// `lib/three/encuadre.ts` es puro (sin DOM) justamente para poder comprobarlo
// aqui, en 14 proporciones reales, sin abrir un navegador.
console.log('\n5. Encuadre de la cámara en pantallas reales');
{
  const { PerspectiveCamera } = require('three');
  const {
    distanciaQueEncuadra,
    cabeTodo,
    PUNTOS_A_ENCUADRAR,
    colocarCamara,
  } = require(path.join(raiz, '.pruebas-build', 'lib', 'three', 'encuadre.js'));

  const pantallas = [
    ['iPhone SE', 375, 667],
    ['iPhone 14', 390, 844],
    ['iPhone 14 Pro Max', 430, 932],
    ['Galaxy S8 (muy estrecho)', 360, 740],
    ['Android gama baja', 360, 640],
    ['Pixel 7', 412, 915],
    ['iPad vertical', 810, 1080],
    ['iPad horizontal', 1080, 810],
    ['Portátil 16:9', 1366, 768],
    ['Escritorio 1080p', 1920, 1080],
    ['Ultrapanorámico 21:9', 2560, 1080],
    ['Ventana casi cuadrada', 800, 780],
    ['Ventana muy baja', 1200, 380],
    ['Móvil girado', 844, 390],
  ];

  let malos = 0;
  let distMin = Infinity;
  let distMax = 0;

  for (const [nombre, w, h] of pantallas) {
    const cam = new PerspectiveCamera(42, w / h, 0.5, 120);
    const d = distanciaQueEncuadra(cam);
    distMin = Math.min(distMin, d);
    distMax = Math.max(distMax, d);

    // ¿Caben de verdad TODOS los puntos del terreno a esa distancia?
    colocarCamara(cam, d);
    let dentro = true;
    for (const p of PUNTOS_A_ENCUADRAR) {
      const v = p.clone().project(cam);
      if (Math.abs(v.x) > 1 || Math.abs(v.y) > 1) dentro = false;
    }
    // Y que no se pase del plano lejano, o el terreno se recortaría.
    const lejos = d + 30 > cam.far;

    if (!dentro || lejos) {
      malos++;
      console.log(`     ✗ ${nombre} (${w}×${h}) dist ${d.toFixed(1)}${lejos ? ' — se pasa del plano lejano' : ' — se sale del encuadre'}`);
    }
  }

  console.log(`     Distancia de cámara entre ${distMin.toFixed(1)} y ${distMax.toFixed(1)} unidades`);
  ok(malos === 0, `El terreno cabe entero en las ${pantallas.length} pantallas`, `${malos} fallan`);

  // La distancia TIENE que cambiar con la forma de la pantalla. Si saliera
  // siempre la misma, el ajuste no estaría haciendo nada.
  ok(distMax - distMin > 1, 'El encuadre se adapta a la forma de la pantalla');

  // Una pantalla más estrecha nunca puede necesitar MENOS distancia que una
  // ancha con la misma altura: seria señal de que la búsqueda va al revés.
  const estrecha = distanciaQueEncuadra(new PerspectiveCamera(42, 360 / 800, 0.5, 120));
  const ancha = distanciaQueEncuadra(new PerspectiveCamera(42, 900 / 800, 0.5, 120));
  ok(estrecha >= ancha, 'Una pantalla estrecha aleja la cámara, no la acerca');
}

console.log(
  fallos === 0
    ? '\n✅ Todo en orden.\n'
    : `\n❌ ${fallos} comprobación(es) fallaron.\n`
);
process.exit(fallos === 0 ? 0 : 1);
