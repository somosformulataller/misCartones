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
import fs from 'node:fs';
import path from 'node:path';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const raiz = path.join(aqui, '..');

console.log('Compilando lib/game, lib/three y lib/admin…');
execSync(`npx tsc -p "${path.join(aqui, 'tsconfig.pruebas.json')}"`, {
  cwd: raiz,
  stdio: 'inherit',
});

const require = createRequire(import.meta.url);

// Los módulos portados de La Llave se importan entre sí con el alias "@/...".
// tsc lo entiende al comprobar tipos pero NO lo reescribe al emitir, así que
// en tiempo de ejecución Node no sabe qué es "@/lib/payments/constants". Se
// resuelve aquí, contra lo ya compilado, en vez de reescribir a mano decenas
// de imports en código que conviene mantener idéntico a su original.
const Module = require('node:module');
const resolverOriginal = Module._resolveFilename;
Module._resolveFilename = function (peticion, ...resto) {
  if (typeof peticion === 'string' && peticion.startsWith('@/')) {
    peticion = path.join(raiz, '.pruebas-build', peticion.slice(2));
  }
  return resolverOriginal.call(this, peticion, ...resto);
};
const salida = path.join(raiz, '.pruebas-build', 'lib', 'game');
const { drawPayoutTier, drawSessionTier, drawWorldSeed } = require(path.join(salida, 'rng.js'));
const { bagSplit } = require(path.join(salida, 'bagSplit.js'));
const { buildWorld, PLAY, CITIZEN_RADIUS, CITIZEN_BODY_RADIUS, CITIZEN_FEET_RADIUS, BAG_RADIUS, CART_RADIUS } =
  require(path.join(salida, 'world.js'));
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
  // Tolerancia de ±0,25 y no menos. NO es aflojar la prueba: esta simulación
  // es aleatoria de verdad y los premios grandes ($30) disparan la varianza,
  // así que con un millón de partidas el error de muestreo del RTP es de unos
  // ±0,064 puntos. Una banda de ±0,1 son 1,6 desviaciones: fallaría por puro
  // azar una de cada nueve ejecuciones, y una prueba que falla sola acaba
  // ignorándose. ±0,25 son ~4 desviaciones (falla por azar 1 de cada 15.000) y
  // sigue detectando de sobra lo que importa: quitar el corta-rachas mueve el
  // RTP 1,4 puntos, veinte veces la banda.
  ok(Math.abs(rtp - 98.03) < 0.25, 'RTP de producción = 98,03 % ± 0,25', `medido ${rtp.toFixed(3)} %`);

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
          if (distRect(cx, cy, o) < CITIZEN_BODY_RADIUS) bloq[gy * cols + gx] = 1;
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
// Las pantallas reales contra las que se comprueba el encuadre. Vive en el
// ámbito del módulo porque la sección 6 mide sobre las mismas.
const PANTALLAS = [
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

console.log('\n5. Encuadre de la cámara en pantallas reales');
{
  const { PerspectiveCamera } = require('three');
  const {
    distanciaQueEncuadra,
    cabeTodo,
    PUNTOS_A_ENCUADRAR,
    colocarCamara,
    distanciaMaximaAlTerreno,
  } = require(path.join(raiz, '.pruebas-build', 'lib', 'three', 'encuadre.js'));

  let malos = 0;
  let distMin = Infinity;
  let distMax = 0;

  for (const [nombre, w, h] of PANTALLAS) {
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
  ok(malos === 0, `El terreno cabe entero en las ${PANTALLAS.length} pantallas`, `${malos} fallan`);

  // ── Que NO se vea cielo ──
  // El suelo tiene que llenar la pantalla entera. Se lanza un rayo por las
  // cuatro esquinas y por el centro del BORDE SUPERIOR (que es el que más se
  // acerca al horizonte) y se comprueba que todos caen sobre el suelo, y
  // dentro de la losa lejana. Si alguno se fuera por encima del horizonte, o
  // más allá del borde de la losa, ahí es donde se cuela el azul.
  const { Vector3 } = require('three');
  const MEDIA_LOSA = 160; // la losa lejana mide 320×320
  let conCielo = 0;
  let peorAlcance = 0;

  for (const [nombre, w, h] of PANTALLAS) {
    const cam = new PerspectiveCamera(42, w / h, 0.5, 120);
    colocarCamara(cam, distanciaQueEncuadra(cam));

    // Esquinas superiores, inferiores y centro de arriba, en coordenadas de
    // pantalla normalizadas.
    const bordes = [
      [-1, 1], [0, 1], [1, 1],
      [-1, -1], [1, -1],
      [-1, 0], [1, 0],
    ];

    for (const [nx, ny] of bordes) {
      const dir = new Vector3(nx, ny, 0.5).unproject(cam).sub(cam.position).normalize();
      if (dir.y >= -0.0001) {
        conCielo++;
        console.log(`     ✗ ${nombre}: el rayo (${nx},${ny}) apunta al cielo`);
        continue;
      }
      const t = -cam.position.y / dir.y;
      const golpe = cam.position.clone().add(dir.multiplyScalar(t));
      peorAlcance = Math.max(peorAlcance, Math.abs(golpe.x), Math.abs(golpe.z));
      if (Math.abs(golpe.x) > MEDIA_LOSA || Math.abs(golpe.z) > MEDIA_LOSA) {
        conCielo++;
        console.log(`     ✗ ${nombre}: el rayo (${nx},${ny}) se sale de la losa`);
      }
    }
  }

  console.log(`     El suelo tiene que llegar hasta ${peorAlcance.toFixed(0)} unidades (la losa llega a ${MEDIA_LOSA})`);
  ok(conCielo === 0, 'El suelo cubre la pantalla entera: nunca se ve el fondo', `${conCielo} rayos fallan`);

  // ── Que la niebla no emborrone lo jugable ──
  let nieblaMal = 0;
  for (const [nombre, w, h] of PANTALLAS) {
    const cam = new PerspectiveCamera(42, w / h, 0.5, 120);
    colocarCamara(cam, distanciaQueEncuadra(cam));
    const lejos = distanciaMaximaAlTerreno(cam);
    const near = lejos * 1.04;
    if (near <= lejos) {
      nieblaMal++;
      console.log(`     ✗ ${nombre}: la niebla empieza dentro del área de juego`);
    }
  }
  ok(nieblaMal === 0, 'La niebla empieza siempre DETRÁS del terreno jugable');

  // La distancia TIENE que cambiar con la forma de la pantalla. Si saliera
  // siempre la misma, el ajuste no estaría haciendo nada.
  ok(distMax - distMin > 1, 'El encuadre se adapta a la forma de la pantalla');

  // Una pantalla más estrecha nunca puede necesitar MENOS distancia que una
  // ancha con la misma altura: seria señal de que la búsqueda va al revés.
  const estrecha = distanciaQueEncuadra(new PerspectiveCamera(42, 360 / 800, 0.5, 120));
  const ancha = distanciaQueEncuadra(new PerspectiveCamera(42, 900 / 800, 0.5, 120));
  ok(estrecha >= ancha, 'Una pantalla estrecha aleja la cámara, no la acerca');
}

// ── 6. La escena en 3D ─────────────────────────────────────────────────────
// Estas pruebas existen porque la escena es lo ÚNICO del proyecto que no se
// puede revisar leyendo: hay que verla. Así que se comprueba por medición todo
// lo que un vistazo detectaría — que nada tape la zona de juego, que lo que se
// ve mida lo que colisiona, y que el coste siga siendo de teléfono flojo.
console.log('\n6. La escena en 3D');
{
  const THREE = require('three');
  const { PerspectiveCamera } = THREE;
  const { distanciaQueEncuadra, CENTRO } = require(
    path.join(raiz, '.pruebas-build', 'lib', 'three', 'encuadre.js')
  );
  const esc = require(path.join(raiz, '.pruebas-build', 'lib', 'three', 'escena.js'));
  const { mulberry32 } = require(path.join(salida, 'world.js'));

  const world = buildWorld(987654321);
  const rnd = mulberry32(4242);
  const escena = new THREE.Group();
  const suelo = esc.crearSuelo(rnd);
  const ciudad = esc.crearCiudad(rnd);
  const veg = esc.crearVegetacion(rnd, world);
  escena.add(suelo, ciudad, veg.grupo, esc.crearObstaculos(world.obstacles));
  // CINCO bolsas, como en una partida de verdad. Con una sola, el recuento de
  // llamadas de dibujo miente por 48 y el presupuesto no vale para nada.
  let bolsa;
  for (const _ of world.bags) {
    bolsa = esc.crearBolsa();
    escena.add(bolsa.grupo);
  }
  const ciudadano = esc.crearCiudadano();
  const carretilla = esc.crearCarretilla();
  escena.add(ciudadano.grupo, carretilla.grupo);
  escena.updateMatrixWorld(true);

  // ── Nada roto ──
  // Un NaN en un vértice no revienta: hace desaparecer la malla entera en
  // silencio, que es la peor forma posible de fallar.
  let malos = 0;
  let sinColor = 0;
  let triangulos = 0;
  let llamadas = 0;
  escena.traverse((o) => {
    if (!o.isMesh) return;
    llamadas++;
    const g = o.geometry;
    const p = g.attributes.position;
    triangulos += (p.count / 3) * (o.isInstancedMesh ? o.count : 1);
    for (let i = 0; i < p.count * 3; i++) {
      if (!Number.isFinite(p.array[i])) { malos++; break; }
    }
    // Un material con vertexColors y una geometría sin atributo `color` se
    // dibuja NEGRA. Es un fallo mudo y muy fácil de introducir.
    const usaColorVertice = Array.isArray(o.material)
      ? o.material.some((m) => m.vertexColors)
      : o.material.vertexColors;
    if (usaColorVertice) {
      const c = g.attributes.color;
      if (!c || c.count !== p.count) sinColor++;
    }
  });
  ok(malos === 0, 'Ninguna geometría tiene vértices NaN o infinitos', `${malos} mallas`);
  ok(sinColor === 0, 'Toda malla con color por vértice trae su atributo color', `${sinColor} mallas`);

  // ── Presupuesto de un teléfono flojo ──
  console.log(`     ${llamadas} llamadas de dibujo, ${Math.round(triangulos / 1000)}k triángulos`);
  ok(llamadas <= 70, 'La escena cabe en 70 llamadas de dibujo', `son ${llamadas}`);
  ok(triangulos <= 120_000, 'La escena cabe en 120k triángulos', `son ${Math.round(triangulos)}`);

  // La carretilla está APARCADA EN DIAGONAL, así que hay que medirla en SU
  // eje, no en el del mundo. Una caja envolvente alineada con los ejes se
  // infla hasta la diagonal del objeto cuando este va girado: daría 3,09 de
  // radio donde hay 2,60, y una planta cuadrada donde hay un trapecio. Es el
  // mismo error que ya falseó la invasión de las copas de los árboles.
  //
  // Se mide la geometría en local y se multiplica por la escala del grupo.
  const escalaDe = (malla) => {
    malla.updateWorldMatrix(true, false);
    return new THREE.Vector3().setFromMatrixScale(malla.matrixWorld).x;
  };
  const medidaPropia = (malla) => {
    malla.geometry.computeBoundingBox();
    const t = malla.geometry.boundingBox.getSize(new THREE.Vector3());
    return t.multiplyScalar(escalaDe(malla));
  };

  // Ancho de la tolva a una profundidad dada de su propio eje, en fracción de
  // su largo (-1 = morro, +1 = trasera). Recorre los vértices reales: una caja
  // envolvente solo da el rectángulo que lo encierra todo y es ciega justo a
  // lo que aquí importa, que es la conicidad.
  const anchoTolvaEn = (malla, frac) => {
    const pos = malla.geometry.attributes.position;
    const b = malla.geometry.boundingBox;
    const zBuscado = (b.min.z + b.max.z) / 2 + (frac * (b.max.z - b.min.z)) / 2;
    let max = 0;
    for (let i = 0; i < pos.count; i++) {
      if (Math.abs(pos.getZ(i) - zBuscado) < 0.25) max = Math.max(max, Math.abs(pos.getX(i)));
    }
    return max * 2 * escalaDe(malla);
  };

  // ── Lo que se ve es lo que choca ──
  // Si el dibujo fuera más grande que el radio de la simulación, el jugador
  // vería atravesar cosas; si fuera más pequeño, recogería bolsas "desde
  // lejos". Las dos sensaciones se leen como que el juego está roto.
  const caja = new THREE.Box3();
  const tam = new THREE.Vector3();

  caja.setFromObject(bolsa.cuerpo).getSize(tam);
  const radioBolsa = Math.max(tam.x, tam.z) / 2;
  console.log(`     Bolsa: ${radioBolsa.toFixed(2)} de radio y ${tam.y.toFixed(2)} de alto`);
  ok(
    Math.abs(radioBolsa - BAG_RADIUS / 40) < 0.14,
    'La bolsa se dibuja del tamaño con el que colisiona',
    `dibujada ${radioBolsa.toFixed(2)}, colisiona ${(BAG_RADIUS / 40).toFixed(2)}`
  );
  ok(tam.y > 1.7, 'La bolsa es alta: se ve como una bolsa, no como un bulto', `${tam.y.toFixed(2)}`);

  // Sin la bolsa al hombro: cuelga por fuera del cuerpo y arranca OCULTA, pero
  // Box3 no mira la visibilidad, así que falsearía el ancho en un 40 %.
  ciudadano.bolsaHombro.removeFromParent();
  caja.setFromObject(ciudadano.grupo).getSize(tam);
  console.log(`     Ciudadano: ${tam.x.toFixed(2)} de ancho y ${tam.y.toFixed(2)} de alto`);
  ok(
    Math.abs(tam.x / 2 - CITIZEN_RADIUS / 40) < 0.12,
    'El ciudadano se dibuja del tamaño con el que colisiona',
    `dibujado ${(tam.x / 2).toFixed(2)}, colisiona ${(CITIZEN_RADIUS / 40).toFixed(2)}`
  );
  ok(tam.y > 2.1, 'El ciudadano es lo bastante grande para leerse desde la cámara');

  // Los tres radios del ciudadano tienen que estar ORDENADOS, y el de los pies
  // tiene que dejar la calle casi entera. Cuando el muñeco creció para que se
  // le viera la cara, su ancho dibujado se estaba usando también para apartarlo
  // del bordillo: se quedaba clavado a un palmo de la línea, con 48 px de calle
  // comidos por cada lado. Aquí eso ya no puede volver a pasar en silencio.
  const anchoAndable = (PLAY.w - 2 * CITIZEN_FEET_RADIUS) / PLAY.w;
  const largoAndable = (PLAY.h - 2 * CITIZEN_FEET_RADIUS) / PLAY.h;
  console.log(
    `     Radios del ciudadano: pies ${CITIZEN_FEET_RADIUS}, torso ${CITIZEN_BODY_RADIUS}, dibujado ${CITIZEN_RADIUS}` +
      ` -- se anda el ${(anchoAndable * 100).toFixed(0)} % del ancho de la calle y el ${(largoAndable * 100).toFixed(0)} % del largo`
  );
  ok(
    CITIZEN_FEET_RADIUS < CITIZEN_BODY_RADIUS && CITIZEN_BODY_RADIUS < CITIZEN_RADIUS,
    'Los pies frenan menos que el torso, y el torso menos que el ancho dibujado'
  );
  ok(anchoAndable > 0.9, 'La calle andable conserva más del 90 % de su ancho', `${(anchoAndable * 100).toFixed(0)} %`);
  ok(largoAndable > 0.94, 'La calle andable conserva más del 94 % de su largo', `${(largoAndable * 100).toFixed(0)} %`);

  // ¿Se le ve la CARA? Eso no lo decide el tamaño del muñeco sino el de su
  // cabeza, y en último término cuántos PÍXELES ocupa esa cabeza en el peor
  // teléfono de la lista, que es lo único que el jugador experimenta. Una
  // cabeza a escala anatómica sobre un cuerpo de 4 unidades se queda en cuatro
  // píxeles y no hay cara que valga; por eso el muñeco es cabezón.
  const altoCiudadano = tam.y;
  caja.setFromObject(ciudadano.cabeza).getSize(tam);
  const anchoCabeza = tam.x;

  // Se proyectan los dos extremos de la cabeza, a su altura real y en el
  // centro del terreno, y se mide cuántos píxeles hay entre ellos.
  let peorPx = Infinity;
  let peorPantalla = '';
  for (const [nombre, w, h] of PANTALLAS) {
    const cam = new PerspectiveCamera(42, w / h, 0.5, 120);
    distanciaQueEncuadra(cam);
    const y = altoCiudadano - anchoCabeza / 2;
    const izq = new THREE.Vector3(CENTRO.x - anchoCabeza / 2, y, CENTRO.z).project(cam);
    const der = new THREE.Vector3(CENTRO.x + anchoCabeza / 2, y, CENTRO.z).project(cam);
    const px = (Math.abs(der.x - izq.x) / 2) * w;
    if (px < peorPx) { peorPx = px; peorPantalla = nombre; }
  }
  console.log(
    `     Cabeza: ${anchoCabeza.toFixed(2)} de ancho, ${((anchoCabeza / altoCiudadano) * 100).toFixed(0)} % del alto, ${Math.round(peorPx)} px en ${peorPantalla}`
  );
  ok(
    anchoCabeza / altoCiudadano > 0.33,
    'La cabeza es de dibujo, no anatómica: es lo que permite ponerle cara',
    `${((anchoCabeza / altoCiudadano) * 100).toFixed(0)} %`
  );
  ok(peorPx >= 28, 'La cara se ve en la peor pantalla de la lista', `solo ${Math.round(peorPx)} px de cabeza en ${peorPantalla}`);

  // Y que la cara ESTÉ, además de caber. Los ojos van pegados POR FUERA del
  // cráneo a propósito: con caras planas y una sola luz, un ojo hundido recibe
  // la misma iluminación que la mejilla y se borra. Al agrandar el cráneo de
  // 0,36 a 0,40 los ojos se quedaron dentro y la cara desapareció ENTERA sin
  // que fallara nada -- ni un error, ni una malla perdida, ni un triángulo de
  // más. Solo un muñeco sin cara. Esto es lo que lo detecta.
  //
  // Se buscan los vértices por su color y se mide hasta dónde llegan HACIA
  // DELANTE. Antes se medía el radio, que valía mientras el cráneo era una
  // esfera; con una cabeza cuadrada el radio va a las esquinas y no dice nada
  // de la cara. Lo que significa "asomar" es alcance en Z, y eso vale para las
  // dos formas.
  const alcanceZ = (malla, hex) => {
    const g = malla.geometry;
    const col = g.attributes.color;
    const pos = g.attributes.position;
    const objetivo = new THREE.Color(hex);
    let max = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      const d =
        Math.abs(col.getX(i) - objetivo.r) +
        Math.abs(col.getY(i) - objetivo.g) +
        Math.abs(col.getZ(i) - objetivo.b);
      if (d < 0.01) max = Math.max(max, pos.getZ(i));
    }
    return max;
  };
  const craneo = ciudadano.cabeza.children[0];
  const zPiel = alcanceZ(craneo, esc.COL.piel);
  const zOjo = alcanceZ(craneo, esc.COL.ojo);
  const zBoca = alcanceZ(craneo, esc.COL.boca);
  console.log(`     Cara: la cara llega a z=${zPiel.toFixed(3)}, los ojos a ${zOjo.toFixed(3)}, la boca a ${zBoca.toFixed(3)}`);
  ok(zOjo > zPiel, 'Los ojos asoman de la cara, no están hundidos dentro', `ojos ${zOjo.toFixed(3)} contra cara ${zPiel.toFixed(3)}`);
  ok(zBoca > zPiel, 'La boca asoma de la cara', `boca ${zBoca.toFixed(3)} contra cara ${zPiel.toFixed(3)}`);

  // El pelo sustituye a la gorra, y puede volver a cometer su mismo pecado:
  // tapar la cara. La melena se abre en una ventana al frente y el flequillo
  // se corta justo encima de los ojos, pero eso son tres ángulos escritos a
  // mano en una esfera y basta cambiar uno para dejar al muñeco con el pelo
  // por delante de los ojos. Se comprueba que NINGÚN vértice de pelo cae
  // dentro del cono de la cara: 35° a cada lado del frente, desde la altura
  // de las cejas hacia abajo.
  const invadenLaCara = (malla, hexes) => {
    const g = malla.geometry;
    const col = g.attributes.color;
    const pos = g.attributes.position;
    const objetivos = hexes.map((h) => new THREE.Color(h));
    let n = 0;
    for (let i = 0; i < pos.count; i++) {
      const esPelo = objetivos.some(
        (o) =>
          Math.abs(col.getX(i) - o.r) + Math.abs(col.getY(i) - o.g) + Math.abs(col.getZ(i) - o.b) < 0.01
      );
      if (!esPelo) continue;
      const y = pos.getY(i);
      if (y > 0.12 || y < -0.3) continue;
      if (Math.abs(Math.atan2(pos.getX(i), pos.getZ(i))) < 0.61) n++;
    }
    return n;
  };
  const peloEnLaCara = invadenLaCara(craneo, [esc.COL.pelo, esc.COL.peloClaro]);
  ok(peloEnLaCara === 0, 'El pelo enmarca la cara, no la tapa', `${peloEnLaCara} vértices de pelo delante de los ojos`);

  // La carretilla es el DESTINO: la entrega salta al entrar en CART_RADIUS, así
  // que si se dibujara más pequeña que ese radio la bolsa se depositaría sola
  // antes de llegar, y si se dibujara más grande el ciudadano se metería
  // DENTRO de la carretilla antes de que pasara nada.
  //
  // Se mide la TOLVA sola: es la boca donde cae la bolsa. Los mangos salen por
  // detrás a propósito -- una carretilla se empuja desde entre los mangos, así
  // que el ciudadano tiene que poder meterse ahí sin haber entregado todavía.
  const tamTolva = medidaPropia(carretilla.tolva);
  const radioCarretilla = Math.max(tamTolva.x, tamTolva.z) / 2;
  console.log(`     Carretilla: ${radioCarretilla.toFixed(2)} de radio, planta ${tamTolva.x.toFixed(2)} x ${tamTolva.z.toFixed(2)}`);
  ok(
    Math.abs(radioCarretilla - CART_RADIUS / 40) < 0.2,
    'La carretilla se dibuja del tamaño con el que se entrega',
    `dibujada ${radioCarretilla.toFixed(2)}, entrega a ${(CART_RADIUS / 40).toFixed(2)}`
  );

  // La prueba que faltaba, y el motivo de que hubiera que rehacerla dos veces:
  // desde una cámara casi cenital lo que llega es la PLANTA. Una planta
  // cuadrada es una caja, diga lo que diga el volumen. Se exige que la tolva
  // sea claramente más larga que ancha, y que se ESTRECHE hacia delante: eso
  // es un trapecio, y un trapecio con una rueda delante es una carretilla.
  const anchoTras = anchoTolvaEn(carretilla.tolva, 0.9);
  const anchoDel = anchoTolvaEn(carretilla.tolva, -0.9);
  console.log(`     Planta de la tolva: ${anchoTras.toFixed(2)} de ancho atrás, ${anchoDel.toFixed(2)} delante`);
  ok(tamTolva.z / tamTolva.x > 1.15, 'La tolva es más larga que ancha: en planta no es un cuadrado', `${(tamTolva.z / tamTolva.x).toFixed(2)}`);
  ok(anchoDel < anchoTras * 0.65, 'La tolva se estrecha hacia delante: en planta es un trapecio', `${anchoDel.toFixed(2)} contra ${anchoTras.toFixed(2)}`);

  // ── El presupuesto de luz ──
  // Sin mapeo de tonos, todo lo que pase de 1 se recorta canal a canal y el
  // color se va hacia el blanco. Esta escena ya vivió eso: sumaba 2,8 y la
  // calle entera salía desteñida. Al subir la luz hay que comprobar que no se
  // vuelve a cruzar esa línea, y sobre todo en el ASFALTO, que es la mayor
  // parte de la pantalla: una superficie horizontal no recibe el sol entero,
  // solo su componente vertical, así que el número que importa no es la suma
  // de las luces sino lo que de verdad le llega al suelo.
  const luzTotal = esc.LUZ.hemisferio + esc.LUZ.sol;
  const [sx3, sy3, sz3] = esc.LUZ.posicionSol;
  const nDotL = sy3 / Math.hypot(sx3, sy3, sz3);
  const luzSuelo = esc.LUZ.hemisferio + esc.LUZ.sol * nDotL;

  // Qué se mira y qué no. Un rojo o un naranja saturados tienen un canal ya en
  // el tope y se recortan con cualquier luz por encima de 1: eso no es un
  // fallo, es lo que significa "saturado", y pasaba igual antes de subir nada.
  // Lo que sí arruina una escena es que se quemen las SUPERFICIES GRANDES --
  // el asfalto, las aceras, las fachadas, los tejados -- porque son las que
  // ocupan la pantalla y las que hacen que todo se vea desteñido.
  //
  // La línea de la calzada queda fuera de la lista a propósito: es blanca de
  // fábrica y que se recorte a blanco puro es exactamente lo que tiene que
  // pasarle.
  const GRANDES = [
    'asfalto', 'asfaltoClaro', 'asfaltoOscuro', 'rodada', 'acera', 'aceraOscura',
    'bordillo', 'suelo', 'paredA', 'paredB', 'paredC', 'paredD', 'paredE',
    'tejaA', 'tejaB', 'tejaC', 'azotea',
  ];
  const seRecorta = (hex, luz) => {
    const c = new THREE.Color(hex); // Color.set ya convierte de sRGB a lineal
    return Math.max(c.r, c.g, c.b) * luz > 1.001;
  };
  const quemados = GRANDES.filter((n) => seRecorta(esc.COL[n], luzSuelo));
  console.log(
    `     Luz: ${luzTotal.toFixed(2)} en total, ${luzSuelo.toFixed(2)} en el asfalto;` +
      ` ${quemados.length} de ${GRANDES.length} superficies grandes se queman`
  );
  ok(luzTotal <= 1.45, 'La luz total no pasa del techo a partir del cual la escena se lava', `${luzTotal.toFixed(2)}`);

  // La saturación de la paleta. Es donde vive el color de esta escena: con la
  // luz por debajo de 1,45 y sin mapeo de tonos, lo vivo NO se consigue
  // subiendo las luces (eso lava) sino saturando los materiales. La trampa es
  // que cada retirada puntual para que algo no se recorte baja la media sin
  // que se note, y a los diez arreglos la calle está gris otra vez.
  //
  // Se mide sobre las superficies grandes y las fachadas, que son las que
  // mandan en la impresión general; los grises de estructura (asfalto, acera,
  // suelo) quedan fuera porque son gris a propósito.
  const VIVOS = [
    'paredA', 'paredB', 'paredC', 'paredD', 'tejaA', 'tejaB', 'copa', 'copaClara',
    'cono', 'chaleco', 'camisa', 'pantalon', 'lazo', 'carton', 'cartonDorado',
    'tolva', 'botellaVerde', 'botellaAmbar', 'botellaAzul', 'lataRoja', 'brikNaranja',
  ];
  const satDe = (hex) => {
    const c = new THREE.Color(hex).getHSL({});
    return c.s;
  };
  const satMedia = VIVOS.reduce((t, n) => t + satDe(esc.COL[n]), 0) / VIVOS.length;
  const apagados = VIVOS.filter((n) => satDe(esc.COL[n]) < 0.7);
  console.log(`     Saturación de los colores vivos: ${(satMedia * 100).toFixed(0)} % de media`);
  ok(satMedia > 0.85, 'La paleta viva se mantiene saturada', `${(satMedia * 100).toFixed(0)} %`);
  ok(apagados.length === 0, 'Ningún color vivo se ha quedado por debajo del 70 % de saturación', `${apagados.join(', ')}`);
  ok(GRANDES.every((n) => esc.COL[n] !== undefined), 'La lista de superficies grandes sigue existiendo en la paleta');
  ok(
    quemados.length === 0,
    'Ninguna superficie grande se quema a blanco con la luz de la escena',
    `se queman: ${quemados.join(', ')}`
  );

  // ── Nada tapa la zona de juego ──
  // La cámara mira desde arriba: cualquier cosa que asome sobre la calzada
  // puede esconder una bolsa. Las copas de los árboles son la trampa clásica,
  // porque el tronco está en la acera pero la copa vuela sobre el asfalto.
  // OJO: hay que mirar cada INSTANCIA por separado. Un InstancedMesh reparte
  // copias por los dos lados de la calle, así que su caja envolvente global
  // cruza la calzada SIEMPRE y daría un falso positivo en todo.
  const MEDIA = PLAY.w / 40 / 2;
  const cajaInst = new THREE.Box3();
  const matriz = new THREE.Matrix4();
  let invaden = 0;
  // Se mide transformando los VÉRTICES de verdad, uno a uno. La vía cómoda
  // —rotar la caja envolvente— no sirve: la caja de una caja girada se infla
  // hasta su diagonal, y un árbol de 1,15 de radio girado 45° aparenta 1,63.
  // Eso son 0,48 unidades de invasión imaginaria, más que el margen que se
  // está midiendo. La prueba diría que hay un problema donde no lo hay.
  const vert = new THREE.Vector3();
  const revisar = (m) => {
    // La basura suelta SÍ está en la calzada: es su sitio, y se distingue por
    // llevar color por vértice.
    if (!m.material || m.material.vertexColors) return;
    const pos = m.geometry.attributes.position;
    const n = m.isInstancedMesh ? m.count : 1;
    for (let i = 0; i < n; i++) {
      matriz.identity();
      if (m.isInstancedMesh) m.getMatrixAt(i, matriz);
      matriz.premultiply(m.matrixWorld);
      cajaInst.makeEmpty();
      for (let v = 0; v < pos.count; v++) {
        cajaInst.expandByPoint(vert.fromBufferAttribute(pos, v).applyMatrix4(matriz));
      }
      // Los cables cruzan la calle, pero van a 5 unidades de altura: por
      // encima de todo y demasiado finos para tapar nada.
      if (cajaInst.min.y > 3.4) continue;
      // Las instancias aparcadas bajo tierra no cuentan.
      if (cajaInst.max.y < -1) continue;
      if (cajaInst.min.x < MEDIA && cajaInst.max.x > -MEDIA) invaden++;
    }
  };
  for (const grupo of [ciudad, veg.grupo]) {
    for (const hijo of grupo.children) if (hijo.isMesh) revisar(hijo);
  }
  ok(invaden === 0, 'Ni casas ni árboles asoman sobre la calzada', `${invaden} instancias invaden`);

  // ── Los árboles de la acera derecha, solo en el tramo cercano ──
  // La cámara mira desde +Z sin ladear, así que +X es el lado DERECHO de la
  // pantalla. Un árbol de acera está a 9,7 unidades del eje y los edificios a
  // 23-34: desde la vista cenital la copa se proyecta justo sobre la fachada y
  // la tapa. Ya pasó una vez y hubo que quitarlos todos.
  //
  // La referencia tiene verde a los dos lados, así que vuelven -- pero solo
  // donde no pueden hacer daño: de z = 4 hacia la cámara, donde la fachada que
  // taparían ya queda fuera del encuadre. Lo que esta prueba defiende no es
  // "cero árboles a la derecha", es que ninguno se meta en el tramo LEJANO.
  const deAcera = veg.copas.datos.filter((a) => Math.abs(a.x) < 40);
  const derecha = deAcera.filter((a) => a.x > 0);
  const derechaLejos = derecha.filter((a) => a.z < 4);
  console.log(`     ${deAcera.length} árboles de acera, ${derecha.length} a la derecha (ninguno más allá de z=4)`);
  ok(deAcera.length > 5, 'Sigue habiendo arbolado de acera');
  ok(derecha.length > 0, 'Hay algo de verde también en la acera derecha, como en la referencia');
  ok(
    derechaLejos.length === 0,
    'Ningún árbol de la derecha se mete en el tramo lejano, donde taparía las fachadas',
    `${derechaLejos.length} árboles con z < 4`
  );

  // Y que efectivamente haya edificios a los dos lados que enseñar.
  let alturaDerecha = 0;
  let alturaIzquierda = 0;
  for (const hijo of ciudad.children) {
    if (!hijo.isInstancedMesh) continue;
    for (let i = 0; i < hijo.count; i++) {
      hijo.getMatrixAt(i, matriz);
      const px = matriz.elements[12];
      const alto = matriz.elements[13] * 2;
      if (Math.abs(px) < 40) {
        if (px > 0) alturaDerecha = Math.max(alturaDerecha, alto);
        else alturaIzquierda = Math.max(alturaIzquierda, alto);
      }
    }
  }
  ok(alturaDerecha > 6 && alturaIzquierda > 6, 'Hay edificios altos a los dos lados de la calle');

  // ── La fachada entra en cámara ──
  // Este es el fallo que se escapó a producción: los edificios estaban bien
  // construidos y bien colocados, pero la cámara encuadraba solo la calzada,
  // así que en un teléfono se veía hasta |x|=7,9 en el borde cercano y las
  // fachadas (a 23) no aparecían JAMÁS. Acercarlos no bastaba; el problema
  // era el encuadre. Se mide por bisección hasta dónde llega el encuadre a
  // cada profundidad, y se exige que la fachada quepa.
  const hastaDondeSeVe = (cam, z) => {
    let lo = 0;
    let hi = 60;
    const v = new THREE.Vector3();
    for (let i = 0; i < 40; i++) {
      const m = (lo + hi) / 2;
      v.set(m, 0, z).project(cam);
      if (Math.abs(v.x) <= 0.999) lo = m;
      else hi = m;
    }
    return lo;
  };
  const zCerca = (PLAY.y + PLAY.h - (PLAY.y + PLAY.h / 2)) / 40;
  let sinFachada = 0;
  let peorCerca = Infinity;
  for (const [nombre, w, h] of PANTALLAS) {
    const cam = new PerspectiveCamera(42, w / h, 0.5, 120);
    distanciaQueEncuadra(cam);
    const cerca = hastaDondeSeVe(cam, zCerca);
    const medio = hastaDondeSeVe(cam, 0);
    peorCerca = Math.min(peorCerca, cerca);
    // A media calle tiene que verse una franja de fachada de verdad, no un
    // píxel de esquina.
    if (medio < esc.LINEA_CASAS + 1.2) {
      sinFachada++;
      console.log(`     ✗ ${nombre}: a media calle solo se ve hasta ${medio.toFixed(1)}`);
    }
  }
  console.log(`     En el borde cercano se ve hasta |x|=${peorCerca.toFixed(1)} (la fachada empieza en ${esc.LINEA_CASAS.toFixed(1)})`);
  ok(sinFachada === 0, 'Los edificios entran en cámara en las 14 pantallas', `${sinFachada} pantallas sin fachada`);

  // ── El suelo llega a todas partes ──
  caja.setFromObject(suelo).getSize(tam);
  ok(tam.x >= 300 && tam.z >= 300, 'El suelo sigue midiendo 320 unidades', `${tam.x} × ${tam.z}`);
}

// ── 7. Cuentas, pagos y billetera ──────────────────────────────────────────
//
// Todo esto vino de La Llave Correcta, donde ya funciona con dinero real. Lo
// que se comprueba aquí no es que la lógica portada esté bien —allá lleva
// meses demostrándolo—, sino que el PORTE no la rompió y que las diferencias
// propias de este juego siguen en su sitio. Es donde un cambio inocente
// cuesta dinero de verdad.
console.log('\n7. Cuentas, pagos y billetera');
{
  const construido = path.join(raiz, '.pruebas-build', 'lib');
  const { isWhatsappValid, normalizeWhatsapp, splitWhatsapp } = require(
    path.join(construido, 'auth', 'whatsapp.js')
  );
  const { limpiarCedula, limpiarTelefono } = require(path.join(construido, 'auth', 'datos.js'));
  const { montoGanadoReferido, REFERRAL_REWARD_USD, REFERRAL_TRAMO_GAMES } = require(
    path.join(construido, 'referrals', 'constants.js')
  );
  const { retirosPermitidos, inicioDiaCaracasISO } = require(
    path.join(construido, 'wallet', 'limiteRetiros.js')
  );
  const pagos = require(path.join(construido, 'payments', 'constants.js'));

  // ── El teléfono y la cédula: una persona, una cuenta ──
  // Estas dos normalizaciones son lo que impide que el mismo humano abra dos
  // cuentas escribiendo su número de otra forma. El índice único de la base
  // compara el texto guardado, así que si esto deja pasar dos formas
  // distintas del mismo número, el índice no sirve de nada.
  ok(isWhatsappValid('04121234567'), 'Un móvil venezolano normal vale');
  ok(isWhatsappValid('+584121234567'), 'El mismo número con +58 también vale');
  ok(
    normalizeWhatsapp('+584121234567') === normalizeWhatsapp('04121234567'),
    'El número con +58 y sin él se guardan IGUAL',
    normalizeWhatsapp('+584121234567') + ' contra ' + normalizeWhatsapp('04121234567')
  );
  ok(!isWhatsappValid('0412123456'), 'Un número al que le falta un dígito NO vale');
  ok(!isWhatsappValid('02121234567'), 'Un fijo (0212) no vale: por ahí no se escribe por WhatsApp');
  ok(isWhatsappValid('04221234567'), 'El 0422 de Digitel vale: es el prefijo nuevo y está muy vivo');
  ok(
    splitWhatsapp('04141234567').prefix === '0414' &&
      splitWhatsapp('04141234567').rest === '1234567',
    'El número se parte bien para rellenar el formulario'
  );

  ok(
    limpiarCedula('V-12.345.678') === limpiarCedula('12345678'),
    'La cédula con prefijo y puntos es la MISMA que sin ellos',
    limpiarCedula('V-12.345.678') + ' contra ' + limpiarCedula('12345678')
  );
  ok(
    limpiarTelefono('584121234567') === '04121234567',
    'El teléfono con código de país vuelve a su forma local',
    limpiarTelefono('584121234567')
  );

  // ── Referidos: los tramos ──
  // Los números que mandan viven en el RPC claim_referral, porque el cliente
  // puede llamarlo directo. Estos son los que se MUESTRAN, y tienen que decir
  // exactamente lo mismo: enseñar «te toca $2» y abonar $1 es peor que no
  // enseñar nada.
  ok(montoGanadoReferido(0) === 0, 'Sin partidas del referido no se ha ganado nada');
  ok(montoGanadoReferido(9) === 0, 'Con 9 partidas todavía no se libera el primer dólar');
  ok(montoGanadoReferido(10) === 1, 'A las 10 partidas se libera $1');
  ok(montoGanadoReferido(29) === 2, 'A las 29 partidas van dos tramos, no tres');
  ok(montoGanadoReferido(30) === REFERRAL_REWARD_USD, 'A las 30 se completa el premio entero');
  ok(
    montoGanadoReferido(10000) === REFERRAL_REWARD_USD,
    'Por muchas partidas que juegue el referido, el tope no se pasa',
    String(montoGanadoReferido(10000))
  );
  ok(REFERRAL_TRAMO_GAMES * REFERRAL_REWARD_USD === 30, 'Los tramos cuadran con las 30 partidas');

  // ── Límite de retiros del día ──
  ok(retirosPermitidos(0) === 1, 'Sin jugar hoy, un retiro');
  ok(retirosPermitidos(30) === 1, 'Con 30 partidas sigue siendo uno');
  ok(retirosPermitidos(31) === 2, 'A partir de 31 partidas, dos');
  ok(retirosPermitidos(51) === 3, 'Pasadas 50 partidas, tres');
  ok(retirosPermitidos(9999) === 3, 'Tres es el tope diario, juegue lo que juegue');
  // El día se corta a medianoche de Caracas, no en UTC: preguntando en UTC,
  // un retiro de las 9 de la noche cuenta en el día siguiente y el jugador se
  // encuentra el cupo gastado sin haber hecho nada.
  // Las 11:30 de la noche del 9 en Caracas siguen siendo el día 9: su
  // medianoche es el 9 a las 00:00 hora local, o sea las 04:00 UTC.
  const medianoche = inicioDiaCaracasISO(new Date('2026-09-09T23:30:00-04:00'));
  ok(
    medianoche === '2026-09-09T04:00:00.000Z',
    'El día del límite empieza a medianoche de Caracas, no en UTC',
    medianoche
  );

  // ── Referencias de pago ──
  // La forma canónica de una referencia son sus últimos 6 dígitos, que es por
  // donde empareja el banco. En el juego hermano se comparaba el texto crudo
  // y «124754» y «6124754» pasaron por pagos distintos siendo el mismo: las
  // dos compras se aprobaron.
  ok(
    pagos.referenceTail('6124754') === pagos.referenceTail('124754'),
    'Dos formas del MISMO pago dan la misma cola de 6 dígitos',
    pagos.referenceTail('6124754') + ' contra ' + pagos.referenceTail('124754')
  );
  ok(pagos.referenceTail('00 12-34 56') === '123456', 'La cola ignora espacios y guiones');
  ok(!pagos.isReferenceValid('1234'), 'Cuatro dígitos no bastan para identificar un pago');
  ok(pagos.isReferenceValid('123456'), 'Seis dígitos sí');
  ok(
    pagos.diaCaracas('2026-09-09T23:30:00-04:00') === '2026-09-09',
    'Un pago de las once y media de la noche sigue siendo del día 9 en Caracas',
    pagos.diaCaracas('2026-09-09T23:30:00-04:00')
  );

  // ── EL CERROJO DE LA CUENTA BANCARIA ──
  //
  // La Bank API es MULTICUENTA y La Llave Correcta ya la usa. Reclamar un
  // movimiento lo marca como usado y se lo queda quien llegue primero: si
  // estas dos constantes trajeran de vuelta los valores de allá, un pago
  // hecho para comprar tickets de La Llave se lo quedaría este juego, y aquel
  // jugador se quedaría sin ellos.
  //
  // Por eso NO pueden tener valor por defecto. Esta prueba existe para que
  // nadie los reponga «para que funcione en local».
  const fuente = fs.readFileSync(path.join(raiz, 'lib', 'payments', 'constants.ts'), 'utf8');
  ok(
    !fuente.includes("'llave-bdv-2'") && !fuente.includes("'0102***7113'"),
    'La cuenta bancaria de La Llave NO está escrita en este repositorio'
  );
  ok(
    /BANK_ACCOUNT_NAME_ESPERADO = cleanEnv\(/.test(fuente) &&
      /BANK_CUENTA_ESPERADA = cleanEnv\(/.test(fuente),
    'Las dos constantes de cuenta salen del entorno, no del código'
  );
  ok(
    pagos.BANK_ACCOUNT_NAME_ESPERADO === '' && pagos.BANK_CUENTA_ESPERADA === '',
    'Sin variables de entorno se quedan vacías, y la validación no se enciende',
    '"' + pagos.BANK_ACCOUNT_NAME_ESPERADO + '" / "' + pagos.BANK_CUENTA_ESPERADA + '"'
  );
  const bankApi = fs.readFileSync(path.join(raiz, 'lib', 'payments', 'bankApi.ts'), 'utf8');
  ok(
    /if \(!BANK_ACCOUNT_NAME_ESPERADO \|\| !BANK_CUENTA_ESPERADA\) return null;/.test(bankApi),
    'Sin saber cuál es nuestra cuenta, la API del banco se da por NO configurada'
  );

  // ── Lo que la base tiene que garantizar por sí sola ──
  //
  // Cada uno de estos índices existe porque su ausencia costó dinero en el
  // juego hermano. Una comprobación en código tiene carrera; un índice único
  // no la tiene.
  const sql = fs.readFileSync(
    path.join(raiz, 'supabase', 'migrations', '004_cuentas_y_dinero.sql'),
    'utf8'
  );
  const exige = (re, msg) => ok(re.test(sql), msg);
  exige(
    /CREATE UNIQUE INDEX IF NOT EXISTS referral_claims_tramo_unico[\s\S]*?\(referred_id, tramo\)/,
    'Cada tramo de cada referido se puede cobrar UNA sola vez'
  );
  exige(
    /CREATE UNIQUE INDEX IF NOT EXISTS withdrawals_uno_pendiente[\s\S]*?WHERE status = 'pendiente'/,
    'Un solo retiro pendiente por jugador, garantizado por la base'
  );
  exige(
    /CREATE UNIQUE INDEX IF NOT EXISTS players_referral_code_unico/,
    'Dos jugadores no pueden compartir código de invitación'
  );
  exige(/FOR UPDATE/, 'Los RPC de dinero bloquean la fila del jugador antes de tocarla');
  // Idempotencia de la aprobación: la conciliación REINTENTA por diseño, y
  // sin esto un reintento regala los tickets otra vez.
  exige(
    /IF v_purchase\.status = 'aprobado' THEN[\s\S]{0,260}RETURN json_build_object/,
    'Aprobar una compra ya aprobada no vuelve a entregar tickets'
  );
  // Los RPC que mueven dinero de verdad no los puede llamar el navegador.
  for (const fn of ['approve_purchase', 'reject_purchase', 'pay_withdrawal', 'cancel_withdrawal']) {
    ok(
      new RegExp('REVOKE EXECUTE ON FUNCTION public\\.' + fn + '[^;]*FROM PUBLIC, anon, authenticated').test(sql),
      fn + ' está fuera del alcance del navegador'
    );
  }
  // Y los que sí puede llamar comprueban la sesión ELLOS, no la ruta.
  for (const fn of ['redeem_tickets', 'request_withdrawal', 'claim_referral']) {
    const cuerpo = sql.slice(sql.indexOf('FUNCTION public.' + fn + '('), sql.indexOf('FUNCTION public.' + fn + '(') + 1400);
    ok(
      cuerpo.includes("IF auth.uid() IS NULL THEN RAISE EXCEPTION 'No autorizado'"),
      fn + ' comprueba la sesión por su cuenta, sin fiarse de la ruta'
    );
  }
  // El freno de 24 h tras recuperar la contraseña: es la ventana exacta en la
  // que una cuenta recién robada intentaría vaciarse.
  ok(
    (sql.match(/password_reset_at > NOW\(\) - INTERVAL '24 hours'/g) || []).length >= 2,
    'Retirar y cobrar referidos están frenados 24 h tras recuperar la contraseña'
  );
  // El comprobante es de una persona: lleva su nombre, su banco y su cuenta.
  ok(
    /VALUES \('payment-proofs', 'payment-proofs', FALSE\)/.test(sql),
    'El bucket de comprobantes es PRIVADO'
  );

  // ── La puerta de entrada ──
  //
  // Durante un tiempo, si algo fallaba —sin sesión, sin Supabase, sin red— la
  // pantalla arrancaba una partida LOCAL de mentira para no quedarse en
  // blanco. En un juego de dinero eso es lo peor que puede pasar: se juega un
  // rato creyendo que se juega por dinero, se gana, y no hay premio. El modo
  // demo se quitó entero; estas pruebas están para que no vuelva.
  const juego = fs.readFileSync(path.join(raiz, 'app', '(main)', 'juego', 'page.tsx'), 'utf8');
  ok(!/demo/i.test(juego), 'La pantalla de juego no tiene NADA de modo demo');
  ok(
    /SIN_CONFIGURAR[\s\S]{0,240}setError\(/.test(juego),
    'Sin Supabase el juego lo dice, no arranca una partida falsa'
  );
  ok(
    !fs.existsSync(path.join(raiz, 'lib', 'game', 'demo.ts')),
    'lib/game/demo.ts ya no existe'
  );
  const hud = fs.readFileSync(path.join(raiz, 'components', 'game', 'Hud.tsx'), 'utf8');
  ok(!/demo/i.test(hud), 'El HUD ya no lleva la insignia «Demo»');
  ok(/router\.push\('\/auth\/login'\)/.test(juego), 'Sin sesión se manda a iniciarla');

  // Las pantallas de dinero se cierran en el proxy, no en cada una: sin
  // sesión, /billetera cargaba entera y con todo a cero, que se lee como
  // «he perdido mi saldo».
  const proxy = fs.readFileSync(path.join(raiz, 'proxy.ts'), 'utf8');
  for (const ruta of ['/juego', '/billetera', '/comprar', '/referidos', '/perfil']) {
    ok(proxy.includes("'" + ruta + "'"), ruta + ' está en la lista de rutas privadas del proxy');
  }

  // Ninguna ruta de dinero puede dar por hecho que hay Supabase: aquí el
  // cliente devuelve null cuando no lo hay, y sin la guarda reventaría con un
  // 500 en lugar de decir qué pasa.
  const rutasDinero = [
    'purchases', 'wallet', 'wallet/redeem', 'wallet/withdraw', 'wallet/payout-info',
    'referrals', 'referrals/claim', 'profile/photo', 'purchases/ocr', 'purchases/recheck',
  ];
  let sinGuarda = 0;
  for (const r of rutasDinero) {
    const texto = fs.readFileSync(path.join(raiz, 'app', 'api', ...r.split('/'), 'route.ts'), 'utf8');
    if (texto.includes('await createClient()') && !texto.includes('if (!supabase)')) {
      sinGuarda++;
      console.log('     ✗ /api/' + r + ' no comprueba que haya Supabase');
    }
  }
  ok(sinGuarda === 0, 'Todas las rutas de dinero comprueban que haya base de datos');
}


// ── 8. Panel de administración ─────────────────────────────────────────────
//
// El panel es la única parte de la app que puede mover el dinero de otra
// persona: aprueba compras, paga retiros, suma y resta saldo, corrige la
// cédula a la que se cobra y borra cuentas enteras. Lo que se comprueba aquí
// es quién puede hacer cada cosa y que el porte desde La Llave Correcta no
// dejó atrás nada de lo que allá se aprendió a golpes.
console.log('\n8. Panel de administración');
{
  const construido = path.join(raiz, '.pruebas-build', 'lib');
  const { allowedAreas, hasArea, PANEL_AREAS } = require(
    path.join(construido, 'admin', 'areas.js')
  );
  const { digitosDeBusqueda, esBusquedaNumerica } = require(
    path.join(construido, 'admin', 'busqueda.js')
  );
  const perfil = require(path.join(construido, 'admin', 'playerProfile.js'));
  const { computeRetention } = require(path.join(construido, 'admin', 'retention.js'));
  const { resumenReferidos } = require(path.join(construido, 'referrals', 'ganado.js'));

  const leer = (...trozos) => fs.readFileSync(path.join(raiz, ...trozos), 'utf8');

  // ── Quién ve qué ──
  // Atención al cliente atiende personas; no mira los números del negocio.
  // Da igual lo que alguien marque por error en la pantalla de Equipo: estas
  // cuatro áreas y la de Equipo no se le abren nunca. Y Equipo importa el
  // doble, porque quien reparte permisos puede darse permisos a sí mismo.
  const TODAS = PANEL_AREAS.map((a) => a.key);
  for (const veto of ['resumen', 'caja', 'metricas', 'referidos', 'equipo']) {
    ok(
      !hasArea('support', TODAS, veto),
      `atención al cliente NO ve «${veto}» ni marcándoselo a mano`,
      allowedAreas('support', TODAS).join(', ')
    );
  }
  ok(
    hasArea('support', null, 'transacciones') && hasArea('support', null, 'usuarios'),
    'una cuenta de atención SIN áreas marcadas puede trabajar igual',
    allowedAreas('support', null).join(', ')
  );
  ok(
    allowedAreas('admin', null).length === TODAS.length,
    'un administrador sin restricciones ve el panel entero'
  );
  ok(allowedAreas('player', null).length === 0, 'un jugador no ve NADA del panel');
  ok(allowedAreas(null, null).length === 0, 'sin sesión no se ve NADA del panel');
  ok(
    allowedAreas('admin', ['usuarios']).join() === 'usuarios',
    'a un administrador SÍ se le puede recortar a propósito'
  );
  ok(
    !TODAS.includes('chat'),
    'no queda ninguna pestaña de chat: este juego no tiene atención por chat'
  );

  // ── El buscador de la lista de usuarios ──
  // Allá, buscar el correo «elena.1973saa@gmail.com» sacaba «1973» y devolvía
  // a cualquiera con 1973 en la cédula o el teléfono: Diego salía primero al
  // buscar a Elena. Con una lista de retiros por pagar delante, abrir la ficha
  // equivocada no es un detalle.
  ok(
    digitosDeBusqueda('elena.1973saa@gmail.com') === null,
    'buscar un correo NO se convierte en buscar los dígitos que lleva dentro'
  );
  ok(digitosDeBusqueda('Ana 2') === null, 'un nombre con un número dentro se busca tal cual');
  ok(
    digitosDeBusqueda('V-6.436.499') === '6436499',
    'una cédula escrita como sea sí se busca por sus dígitos',
    String(digitosDeBusqueda('V-6.436.499'))
  );
  ok(
    digitosDeBusqueda('+58 412 7855651') === '584127855651',
    'un teléfono también',
    String(digitosDeBusqueda('+58 412 7855651'))
  );
  ok(digitosDeBusqueda('123') === null, 'menos de 4 dígitos no se persigue: devolvería media base');
  ok(!esBusquedaNumerica('jose@correo.com'), 'un correo no es una búsqueda numérica');

  // ── Corregir los datos de un jugador ──
  // Es la acción más delicada del panel: aquí dentro está la cédula y el
  // teléfono a los que se le PAGA a alguien. El criterio es limpiar antes que
  // rechazar —quien corrige pega el dato de un WhatsApp, con puntos y +58—
  // pero lo que no se puede interpretar tiene que rebotar.
  ok(perfil.revisarCedula('V-28.730.098').valor === '28730098', 'la cédula se guarda en dígitos');
  ok(!perfil.revisarCedula('123').ok, 'una cédula de 3 dígitos NO se guarda');
  ok(!perfil.revisarCedula('1234567890').ok, 'una cédula de 10 dígitos tampoco');
  ok(
    perfil.revisarTelefono('+58 412 123 4567', 'El WhatsApp').valor === '04121234567',
    'el teléfono se guarda en su forma larga venezolana',
    String(perfil.revisarTelefono('+58 412 123 4567', 'El WhatsApp').valor)
  );
  ok(
    !perfil.revisarTelefono('0412123456', 'El WhatsApp').ok,
    'un teléfono al que le falta un dígito NO se guarda'
  );
  ok(!perfil.revisarCorreo('').ok, 'el correo no puede quedar vacío: es con lo que inicia sesión');
  ok(!perfil.revisarCorreo('no-es-correo').ok, 'un correo sin arroba tampoco');
  ok(perfil.revisarCorreo(' JOSE@Correo.COM ').valor === 'jose@correo.com', 'el correo se normaliza');
  ok(!perfil.revisarNombre('Jose2', 'El nombre').ok, 'un nombre con números se rechaza');

  // Solo viajan los campos que de verdad cambiaron. Si el servidor recibiera
  // todos, su propia limpieza (quitarle los guiones al teléfono) entraría en
  // la bitácora como un cambio que nadie hizo.
  ok(
    perfil.diferencias({ cedula: '123', payout_name: 'Ana' }, { cedula: '123', payout_name: 'Eva' })
      .length === 1,
    'la bitácora solo registra lo que de verdad cambió'
  );
  // El nombre visible se mantiene al día solo: si no, el jugador aparecería
  // con dos nombres distintos según la tabla del panel que se mire.
  ok(
    perfil.nombreVisible({ last_name: 'Pérez' }, { first_name: 'Ana', last_name: 'Gómez' }) ===
      'Ana Pérez',
    'corregir el apellido rehace el nombre visible'
  );
  ok(
    perfil.nombreVisible({}, { first_name: 'Ana', last_name: 'Gómez', username: 'Ana Gómez' }) === null,
    'si el nombre visible ya está bien, no se toca'
  );

  // ── Recurrencia ──
  const hoy = '2026-09-09';
  const ret = computeRetention({
    today: hoy,
    players: [
      { id: 'a', username: 'Ana', role: 'player', balance: 1, tickets: 0 },
      { id: 'b', username: 'Beto', role: 'player', balance: 0, tickets: 2 },
      { id: 'z', username: 'Equipo', role: 'admin', balance: 0, tickets: 0 },
      { id: 'n', username: 'Nunca jugó', role: 'player', balance: 0, tickets: 0 },
    ],
    games: [
      // Ana: tres días seguidos
      { player_id: 'a', payout: 0, created_at: '2026-09-06T14:00:00-04:00' },
      { player_id: 'a', payout: 4, created_at: '2026-09-07T14:00:00-04:00' },
      { player_id: 'a', payout: 0, created_at: '2026-09-08T14:00:00-04:00' },
      // Beto: un solo día, hace tiempo
      { player_id: 'b', payout: 0, created_at: '2026-09-01T14:00:00-04:00' },
      // El equipo no es audiencia
      { player_id: 'z', payout: 30, created_at: '2026-09-08T14:00:00-04:00' },
    ],
    purchases: [{ player_id: 'a', amount_usd: 6 }],
    withdrawals: [{ player_id: 'a', amount_usd: 2 }],
  });
  const ana = ret.players.find((p) => p.id === 'a');
  const beto = ret.players.find((p) => p.id === 'b');
  ok(
    !ret.players.some((p) => p.id === 'z'),
    'las partidas del EQUIPO no cuentan como audiencia: falsearían la métrica'
  );
  ok(ana.days_count === 3 && ana.pattern === 'seguidos', 'tres días seguidos se leen como seguidos');
  ok(ana.max_streak === 3 && ana.skipped_days === 0, 'la racha se mide bien');
  ok(ana.rtp !== null && Math.abs(ana.rtp - 4 / 6) < 1e-9, 'el RTP del jugador sale de sus partidas');
  ok(beto.abandoned === true, 'quien jugó un solo día y lleva más de 3 sin volver, abandonó');
  ok(ana.abandoned === false, 'quien juega seguido NO cuenta como abandono');
  ok(
    ret.totals.never_played === 1,
    'los registrados que nunca jugaron se cuentan aparte',
    String(ret.totals.never_played)
  );
  // Una partida de las 9 de la noche en Venezuela cuenta en SU día, no en el
  // siguiente por ser ya UTC.
  const nocturno = computeRetention({
    today: hoy,
    players: [{ id: 'a', username: 'Ana', role: 'player' }],
    games: [{ player_id: 'a', payout: 0, created_at: '2026-09-08T21:30:00-04:00' }],
    purchases: [],
    withdrawals: [],
  });
  ok(
    nocturno.players[0].days[0] === '2026-09-08',
    'una partida de las 9 de la noche cuenta en el día de Venezuela, no en el UTC siguiente',
    nocturno.players[0].days[0]
  );

  // ── Lo ganado invitando ──
  // Hay VARIAS filas por referido (una por cada dólar): se cuentan amigos
  // distintos, no filas, o el panel diría que trajo el triple de gente.
  ok(
    resumenReferidos([
      { amount_usd: 1, referred_id: 'x' },
      { amount_usd: 1, referred_id: 'x' },
      { amount_usd: 1, referred_id: 'y' },
    ]).cobros === 2,
    'tres cobros de dos amigos se cuentan como DOS amigos'
  );

  // ── La puerta está en el servidor, no en la pantalla ──
  // El menú del panel esconde lo que no toca, pero esconder no es proteger:
  // cualquiera puede escribir la dirección de una API. Cada ruta tiene que
  // comprobarlo por su cuenta.
  const RUTAS_PANEL = [
    'caja', 'emails-export', 'interaction', 'payments', 'pending',
    'referrals', 'retention', 'staff', 'stats', 'tags', 'users',
  ];
  let sinGuardia = 0;
  for (const r of RUTAS_PANEL) {
    const texto = leer('app', 'api', 'admin', r, 'route.ts');
    if (!texto.includes('requireStaff(')) {
      sinGuardia++;
      console.log('     ✗ /api/admin/' + r + ' no comprueba que quien pide sea del equipo');
    }
  }
  ok(sinGuardia === 0, 'TODAS las rutas del panel exigen sesión de equipo');

  // Y las áreas: las que enseñan números del negocio piden su área, no valen
  // con "es del equipo".
  const AREA_DE = {
    caja: "requireStaff('caja')",
    referrals: "requireStaff('referidos')",
    retention: "requireStaff('metricas')",
    staff: "requireStaff('equipo')",
    payments: "requireStaff('transacciones')",
    interaction: "requireStaff('interacciones')",
  };
  for (const [ruta, esperado] of Object.entries(AREA_DE)) {
    ok(leer('app', 'api', 'admin', ruta, 'route.ts').includes(esperado),
       `/api/admin/${ruta} exige además el área que le toca`);
  }

  // Crear cuentas del equipo es SOLO de administradores: el guard pide el
  // área 'equipo', y esa área está vetada a atención al cliente.
  ok(!hasArea('support', ['equipo'], 'equipo'), 'atención al cliente no puede crear cuentas de equipo');

  // ── El proxy ──
  const proxyTxt = leer('proxy.ts');
  ok(proxyTxt.includes("'/admin'"), '/admin está entre las rutas que exigen sesión');

  // ── La migración 005 ──
  const sql = leer('supabase', 'migrations', '005_panel_admin.sql');

  // Los tres RPC de agregado leen la base ENTERA saltándose RLS. Si
  // 'authenticated' pudiera ejecutarlos, cualquier jugador con la consola
  // abierta sacaría el saldo y el teléfono de todos los demás.
  for (const fn of ['get_admin_totals()', 'get_interaction_stats()', 'admin_referral_overview()']) {
    const revoke = new RegExp(
      'REVOKE\\s+(ALL|EXECUTE)\\s+ON\\s+FUNCTION\\s+public\\.' +
        fn.replace('()', '\\(\\)') +
        '\\s+FROM\\s+PUBLIC,\\s*anon,\\s*authenticated'
    );
    ok(revoke.test(sql), `${fn} le está prohibida al navegador`);
    ok(
      new RegExp('GRANT EXECUTE ON FUNCTION public\\.' + fn.replace('()', '\\(\\)') + '\\s+TO service_role').test(sql),
      `${fn} solo la puede llamar el servidor`
    );
  }

  // El canje tiene que dejar rastro DENTRO de la misma función: si fuera un
  // paso aparte, podría existir un canje sin su registro y el saldo dejaría
  // de cuadrar sin que nada lo explique.
  const redeem = sql.slice(sql.indexOf('FUNCTION public.redeem_tickets'));
  ok(
    redeem.slice(0, redeem.indexOf('$ LANGUAGE')).includes('INSERT INTO public.ticket_redemptions'),
    'canjear saldo por tickets deja su fila de bitácora en la MISMA transacción'
  );
  ok(redeem.includes('FOR UPDATE'), 'el canje sigue bloqueando la fila del jugador');

  // Las bitácoras no las ve el navegador: son notas del equipo sobre personas.
  for (const t of ['ticket_redemptions', 'manual_adjustments', 'player_data_changes']) {
    ok(
      new RegExp('ALTER TABLE public\\.' + t + '\\s+ENABLE ROW LEVEL SECURITY').test(sql),
      `${t} tiene RLS encendida`
    );
    ok(
      new RegExp('REVOKE ALL ON public\\.' + t + '\\s+FROM anon, authenticated').test(sql),
      `${t} está fuera del alcance del navegador`
    );
  }

  ok(
    /ALTER TABLE public\.ticket_purchases[\s\S]{0,120}handled_by/.test(sql) &&
      /ALTER TABLE public\.withdrawals[\s\S]{0,120}handled_by/.test(sql),
    'las compras y los retiros guardan quién del equipo los atendió'
  );
  // El nombre en texto además del id: si esa cuenta del equipo se borra, el id
  // queda en NULL pero la bitácora tiene que seguir diciendo quién fue.
  ok(sql.includes('made_by_name'), 'la firma de un ajuste sobrevive a que se borre esa cuenta');
  ok(
    /CREATE UNIQUE INDEX IF NOT EXISTS player_tags_unica\s+ON public\.player_tags \(player_id, lower\(label\)\)/.test(sql),
    'la misma etiqueta no se puede poner dos veces al mismo jugador'
  );
  ok(
    sql.includes('LEAST(3.00, (r.partidas / 10) * 1.00)'),
    'el tablero de referidos usa la MISMA regla que paga: $1 por cada 10 partidas, tope $3'
  );

  // ── No quedó nada del chat que este juego no tiene ──
  const ARCHIVOS_PANEL = [
    ['app', '(main)', 'admin', 'page.tsx'],
    ['components', 'admin', 'PlayerDetail.tsx'],
    ['components', 'admin', 'AdminNav.tsx'],
    ['components', 'admin', 'PlayerTags.tsx'],
    ['components', 'admin', 'StaffPanel.tsx'],
    ['app', 'api', 'admin', 'users', 'route.ts'],
    ['lib', 'admin', 'compensacion.ts'],
  ];
  let restos = 0;
  for (const f of ARCHIVOS_PANEL) {
    const texto = leer(...f);
    for (const marca of ['chat_conversations', 'chat_messages', '@/types/chat', "'/admin/chat'"]) {
      if (texto.includes(marca)) {
        restos++;
        console.log('     ✗ ' + f.join('/') + ' todavía nombra ' + marca);
      }
    }
  }
  ok(restos === 0, 'no quedan llamadas a un chat de atención que aquí no existe');

  // ── Y nada del juego hermano se coló ──
  // Las partidas de aquí cuentan bolsas; las de allá, llaves. Un panel que
  // pida keys_tried_count devolvería columnas que no existen.
  let llaves = 0;
  for (const f of [
    ['app', '(main)', 'admin', 'page.tsx'],
    ['components', 'admin', 'PlayerDetail.tsx'],
    ['app', 'api', 'admin', 'users', 'route.ts'],
    ['app', 'api', 'admin', 'stats', 'route.ts'],
    ['types', 'game.ts'],
  ]) {
    if (leer(...f).includes('keys_tried_count')) {
      llaves++;
      console.log('     ✗ ' + f.join('/') + ' todavía pide keys_tried_count');
    }
  }
  ok(llaves === 0, 'el panel cuenta bolsas, no las llaves del juego hermano');
  const statsTxt = leer('app', 'api', 'admin', 'stats', 'route.ts');
  ok(
    statsTxt.includes("from('game_runs')") && !statsTxt.includes('game_sessions'),
    'el panel mira game_runs, que es la tabla de partidas de este juego'
  );

  // Con sesión pero sin ser del equipo, la pantalla no pinta NADA mientras
  // rebota al juego. Sin esto se vería un instante el armazón del panel —con
  // sus pestañas de dinero— a alguien que no tiene por qué verlo.
  ok(
    leer('app', '(main)', 'admin', 'page.tsx').includes('if (!isStaff || !player) return null;'),
    'quien no es del equipo no ve ni el armazón del panel'
  );

  // ── El panel no funciona a medias ──
  // Sus totales suman sobre TODOS los jugadores. Con la sesión del que mira,
  // RLS los recorta en silencio y el Resumen enseñaría un número más pequeño
  // sin avisar de nada. Antes de eso, mejor decir que falta la clave.
  for (const r of ['stats', 'payments', 'interaction']) {
    const texto = leer('app', 'api', 'admin', r, 'route.ts');
    ok(
      texto.includes('isAdminClientConfigured()') && texto.includes('SUPABASE_SECRET_KEY'),
      `/api/admin/${r} avisa en claro si falta la clave del servidor en vez de dar números cortos`
    );
  }
}

// ════════════════════════════════════════════════════════════════════════════
// 9. La PWA
// ════════════════════════════════════════════════════════════════════════════
console.log('\n9. La PWA (instalable en el teléfono)');

{
  const leer = (...p) => fs.readFileSync(path.join(raiz, ...p), 'utf8');
  const hay = (...p) => fs.existsSync(path.join(raiz, ...p));

  // ── Las tres piezas sin las cuales el navegador no ofrece instalar ──
  ok(hay('app', 'manifest.ts'), 'hay manifiesto');
  ok(hay('public', 'sw.js'), 'hay service worker');
  for (const icono of ['icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png']) {
    ok(hay('public', icono), `el icono ${icono} está generado`);
  }

  const man = leer('app', 'manifest.ts');
  ok(/display: 'standalone'/.test(man), 'instalada, la app abre sin la barra del navegador');
  // Sin un icono «maskable», Android mete el nuestro dentro de un cuadro
  // blanco y la app se ve como una página guardada, no como una app.
  ok(/purpose: 'maskable'/.test(man), 'hay un icono que Android puede recortar a su forma');
  ok(/start_url: '\/juego'/.test(man), 'el icono abre directo en el juego');

  const sw = leer('public', 'sw.js');
  // ESTA es la prueba que importa de todo el apartado. Este juego mueve
  // dinero: un saldo servido desde la caché es una cifra vieja presentada
  // como actual, y el jugador que ve $12 cuando tiene $4 cree que le robaron.
  ok(
    /url\.pathname\.startsWith\('\/api\/'\)[\s\S]{0,40}return/.test(sw),
    'el service worker NUNCA guarda nada de /api/: ni saldos, ni compras, ni sesión'
  );
  ok(
    /req\.method !== 'GET'[\s\S]{0,30}return/.test(sw),
    'solo se guardan peticiones GET'
  );
  ok(
    /req\.mode === 'navigate'[\s\S]{0,200}fetch\(req\)\.catch/.test(sw),
    'una pantalla se pide SIEMPRE a la red; la caché solo entra si no hay red'
  );
  ok(hay('public', 'offline.html'), 'hay pantalla de sin conexión');
  ok(
    /saldo est/.test(leer('public', 'offline.html')),
    'la pantalla de sin conexión dice que el dinero sigue ahí'
  );

  // ── El botón, donde el usuario lo pidió ──
  const login = leer('app', 'auth', 'login', 'page.tsx');
  ok(/<BotonInstalar \/>/.test(login), 'el login enseña el botón de descargar la app');
  const boton = leer('components', 'pwa', 'BotonInstalar.tsx');
  ok(/beforeinstallprompt/.test(boton), 'usa el diálogo del navegador cuando existe');
  // El iPhone nunca dispara ese evento. Sin los pasos a mano, el botón
  // sencillamente no aparecería en la mitad de los teléfonos.
  ok(/Compartir/.test(boton) && /pantalla de inicio/.test(boton),
     'y en iPhone explica los pasos, que ahí no hay diálogo');
  ok(/appinstalled/.test(boton), 'el botón se retira solo cuando ya está instalada');

  const layout = leer('app', 'layout.tsx');
  ok(/<RegistrarSW \/>/.test(layout), 'el service worker se registra desde el layout raíz');
  ok(/appleWebApp/.test(layout), 'iOS recibe su nombre e icono, que no lee el manifiesto');
  const reg = leer('components', 'pwa', 'RegistrarSW.tsx');
  ok(
    /NODE_ENV !== 'production'[\s\S]{0,30}return/.test(reg),
    'en desarrollo no se registra: dejaría servidos chunks viejos'
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 10. El estilo: bloques, pero de este siglo
// ════════════════════════════════════════════════════════════════════════════
console.log('\n10. El estilo de la interfaz');

{
  const leer = (...p) => fs.readFileSync(path.join(raiz, ...p), 'utf8');
  const hay = (...p) => fs.existsSync(path.join(raiz, ...p));
  const css = leer('app', 'globals.css');

  // ── La retícula ──
  // Un solo radio para toda la app. Las 3.000 líneas heredadas traen radios
  // literales de 10, 18, 26, 40 y 999 px; sin esta regla conviven cinco
  // formas distintas en la misma pantalla.
  ok(
    /\*,\s*\n\*::before,\s*\n\*::after \{\s*\n\s*border-radius: var\(--mc-radio\) !important;/.test(css),
    'una sola esquina, la misma en toda la interfaz'
  );
  // Apenas redondeada: lo justo para no cortar, no tanto como para dejar de
  // ser un bloque. Es el ajuste que más separa «moderno» de «viejo».
  const radio = css.match(/--mc-radio:\s*(\d+)px/);
  ok(radio && +radio[1] > 0 && +radio[1] <= 10, 'la esquina es suave, no viva ni redonda', radio?.[1]);
  ok(
    /backdrop-filter: none !important/.test(css),
    'ningún desenfoque de fondo: es lo más caro que se le puede pedir a un teléfono flojo'
  );

  // ── El labio: lo ÚNICO que se conserva de la GUI vieja de Minecraft ──
  // Es lo que hace que un botón sea un objeto que se hunde. El bisel de dos
  // tonos y el contorno negro que lo acompañaban se quitaron: son de
  // Windows 95 y hacían que la app se viera vieja, no retro.
  ok(css.includes('--mc-labio:'), 'las piezas que se pulsan tienen labio');
  ok(
    /transform: translateY\(var\(--mc-labio\)\)/.test(css),
    'y al pulsarlas BAJAN hasta comerse su propio labio'
  );
  ok(
    !/inset .* 0 0 var\(--mc-stone-lit\)/.test(css),
    'no queda el bisel de dos tonos de Windows 95'
  );

  // ── La paleta sale de la escena ──
  ok(css.includes('--mc-panel:'), 'las superficies son papel cálido, no piedra gris');
  ok(css.includes('#f7bd1e'), 'el oro es la raya del centro de la calzada');
  ok(css.includes('--mc-grass:'), 'el verde es la copa de los árboles');

  // ── La tipografía ──
  const layout = leer('app', 'layout.tsx');
  ok(/Pixelify_Sans/.test(layout), 'hay una fuente de píxeles');
  ok(/next\/font\/google/.test(layout), 'y se sirve desde nuestro dominio, no desde Google');
  // Se probó Silkscreen y sus minúsculas son versalitas: TODA la pantalla
  // salía gritando en mayúsculas.
  ok(!/Silkscreen\(/.test(layout), 'no se usa una fuente que solo tiene mayúsculas');
  // Y la de píxeles NO manda en el texto corrido: con todo en píxeles la
  // pantalla se lee como un terminal de los ochenta.
  ok(
    /--font-ui:\s*ui-sans-serif/.test(css),
    'el texto corrido va en la fuente del sistema'
  );
  ok(
    /--font-display:\s*var\(--font-pixel-stack\)/.test(css),
    'la de píxeles queda para rótulos, botones y cifras'
  );

  // ── Los campos ──
  // El hueco negro excavado era lo que más envejecía la pantalla.
  ok(
    /\.form-input,[\s\S]{0,400}background: #fff;/.test(css),
    'los campos de texto son claros, no huecos negros'
  );

  // ── El login ──
  const login = leer('app', 'auth', 'login', 'page.tsx');
  ok(/mc-rotulo/.test(login), 'el login enseña el nombre del juego, no solo un formulario');
  ok(/mc-splash/.test(login), 'y el texto amarillo inclinado del menú de Minecraft');
  ok(
    /ciudadano-carretilla\.png/.test(login),
    'el login lo preside el ciudadano con la carretilla llena'
  );
  ok(
    hay('public', 'ciudadano-carretilla.png') && hay('scripts', 'generar-ilustracion.mjs'),
    'y esa ilustración se dibuja por código, no es un binario suelto'
  );

  // ── La pantalla de juego ──
  const juego = leer('app', '(main)', 'juego', 'page.tsx');
  ok(!/rounded-3xl|bg-gradient-to-b/.test(juego), 'la pantalla de juego no lleva clases sueltas de Tailwind');
  // Ningún botón de jugar propio. La acción la lleva la barra amarilla, que
  // elige según tickets y saldo (Iniciar / Cambiar $2 / Comprar), igual que
  // en La Llave. Aquí hubo un «JUGAR» y un «Otra vez» que se saltaban esa
  // decisión y duplicaban el de la barra. (Esta aserción pedía antes lo
  // contrario —que hubiera un .mc-boton— y se cambió a la vez que el diseño.)
  ok(
    !/onClick=\{empezar\}/.test(juego),
    'la pantalla de juego no tiene botón de jugar propio: lo lleva la barra amarilla'
  );
  ok(
    /estado === 'jugando' \|\| estado === 'fin'/.test(juego),
    'al terminar, la calle se queda a la vista en vez de cambiarse por un cartel'
  );

  // El HUD: el botón del sonido caía encima de los puntos de las bolsas en
  // 360 y 390 px, porque los puntos iban centrados con posición absoluta en
  // la misma franja que los botones.
  const hudEscena = leer('components', 'game', 'Hud.tsx');
  ok(
    !/left-1\/2 top-4/.test(hudEscena) && /hud-bolsas/.test(hudEscena),
    'las bolsas del HUD van en su propia fila y no flotan encima de los botones'
  );

  // La barra, dentro de la escena.
  const barraEscena = leer('components', 'layout', 'BarraJugar.tsx');
  ok(/play-bar--escena/.test(barraEscena), 'en /juego la barra amarilla flota sobre la escena');
  ok(
    /\.app-shell > \.play-bar--escena \{/.test(css),
    'y su selector gana a «.app-shell > *:not(.fondo-juego)», que la dejaría en el flujo'
  );

  // El menú: la misma trampa, por tercera vez. Esa regla bajaba la cabecera
  // de z-index 100 a 1, y el contenido —también en 1, pero después en el
  // HTML— se pintaba ENCIMA de las opciones desplegadas.
  const iReglaHijos = css.indexOf('.app-shell > *:not(.fondo-juego) {');
  const iCabecera = css.lastIndexOf('.app-shell > .game-header {');
  ok(
    iReglaHijos >= 0 && iCabecera > iReglaHijos,
    'la cabecera se declara después de la regla de los hijos, o el menú vuelve a quedar tapado'
  );
  ok(
    /\.app-shell > \.game-header \{[^}]*z-index: 100/.test(css),
    'y sube a 100: por encima del contenido y de la barra que flota en /juego (30)'
  );

  // «Recomendar» dorado, y que GANE: la regla de piedra de los neutros
  // también lo nombra, así que el oro tiene que ir después. Sin comprobar el
  // orden, esta prueba pasaría con el botón todavía gris.
  const oroRecomendar = css.lastIndexOf('.play-bar-recomendar {\n  background-color: #f3d98a;');
  const piedraRecomendar = css.lastIndexOf('.play-bar-recomendar,\n.instalar-pwa__boton {');
  ok(
    oroRecomendar > 0 && oroRecomendar > piedraRecomendar,
    '«recomendar juego y ganar $3» es una placa dorada, como en La Llave, no piedra gris'
  );

  // ── Las pantallas de acceso: cristal sobre la calle de verdad ──
  ok(
    hay('public', 'escena-fondo.jpg') && hay('scripts', 'foto-escena.mjs'),
    'el fondo del acceso es un fotograma REAL del motor, y hay con qué rehacerlo'
  );
  const fondo = leer('components', 'auth', 'FondoCalle.tsx');
  ok(/escena-fondo\.jpg/.test(fondo), 'la pantalla de acceso enseña esa foto');
  // ── La piedra, la madera y el marco ──
  //
  // Es lo que separa una interfaz de bloques bonita de una plana: en
  // Minecraft ninguna superficie es de un color liso. Dos teselas de 64×64
  // forran la app entera y pesan menos que cualquier foto.
  for (const t of ['textura-piedra.png', 'textura-madera.png']) {
    ok(hay('public', t), `hay tesela de ${t.replace('textura-', '').replace('.png', '')}`);
    const peso = fs.statSync(path.join(raiz, 'public', t)).size;
    ok(peso < 8 * 1024, `y ${t} pesa lo que tiene que pesar`, `${(peso / 1024).toFixed(1)} KB`);
  }
  ok(hay('scripts', 'generar-texturas.mjs'), 'y se generan por código, no son binarios sueltos');
  ok(
    /background-image: url\('\/textura-piedra\.png'\)/.test(css),
    'las piezas van forradas de piedra, no de un color plano'
  );
  // El marco con grano solo se puede hacer con border-image: ni un color
  // plano ni un box-shadow pueden llevar textura.
  ok(
    /border-image: url\('\/textura-madera\.png'\)/.test(css),
    'y enmarcadas en madera'
  );

  // ── Ni un desenfoque vivo ──
  //
  // La tarjeta del acceso fue de cristal un rato; al pasar a piedra maciza,
  // el desenfoque se fue con ella. Quedan catorce `backdrop-filter` en el CSS
  // heredado, pero el `* { backdrop-filter: none !important }` los mata a
  // todos: solo sobrevive lo que lleve !important, y no debe haber nada.
  const vivos = (css.match(/backdrop-filter: blur\([^;]*!important/g) || []).length;
  ok(vivos === 0, 'no queda ningún desenfoque vivo en toda la app', String(vivos));
  ok(
    !/-webkit-backdrop-filter:[^;]*!important/.test(css),
    'sin prefijos a mano: el compilador los fusiona y se come el bueno'
  );

  // ── El rótulo ──
  // Es un LOGO de juego, hecho con la misma fuente de píxeles y CSS: no hay
  // una imagen más que cargar ni que rehacer si cambia el nombre.
  ok(
    /\.mc-rotulo \{[^}]*-webkit-text-stroke/.test(css),
    'el rótulo lleva contorno, relieve y halo, como el logo de un juego'
  );
  // Sin paint-order el contorno se dibuja ENCIMA y se come el oro.
  ok(/paint-order: stroke fill/.test(css), 'y el contorno va por detrás del relleno');

  ok(
    /:not\(\.fondo-escena\)/.test(css),
    'el fondo está exento de la regla que sube todo por encima de él'
  );
  // El inicio de sesión tiene que caber sin desplazar la pantalla, también en
  // un teléfono corto. (El registro sí puede desplazarse: son ocho campos.)
  ok(
    /@media \(max-height: 700px\)[\s\S]{0,400}\.instalar-pwa__nota \{ display: none/.test(css),
    'en pantallas cortas el login suelta lastre para que el botón de entrar se vea'
  );
  // Lo que se aprieta es la ILUSTRACIÓN, y nada más. El diorama había pasado
  // a ocupar el ancho entero de la tarjeta y, por ir esa regla la última, se
  // comió los tamaños de las consultas de altura: en un teléfono corto el
  // ciudadano se llevaba media pantalla y el botón de entrar caía por debajo
  // del borde. El tope tiene que quedar DESPUÉS del `width: 100%`.
  const iAncha = css.lastIndexOf('.auth-ilustracion {\n  width: 100%');
  const iTope = css.indexOf('.auth-page.es-acceso .auth-ilustracion');
  ok(
    iTope > iAncha && iAncha >= 0,
    'el tope del diorama va después de la regla que lo ensancha, o no ganaría'
  );
  // El rótulo NO entra en el recorte: es el nombre del juego y lo primero
  // que hay que reconocer al abrir. Si algún día vuelve a aparecer un
  // font-size suyo dentro de una consulta de altura, es que alguien pagó el
  // ajuste con el logo en vez de con el muñeco.
  const bloquesDeAltura = [];
  for (const m of css.matchAll(/@media \(max-height:[^)]*\)[^{]*\{/g)) {
    let i = m.index + m[0].length;
    let hondo = 1;
    while (i < css.length && hondo > 0) {
      if (css[i] === '{') hondo++;
      else if (css[i] === '}') hondo--;
      i++;
    }
    bloquesDeAltura.push(css.slice(m.index, i));
  }
  ok(bloquesDeAltura.length > 0, 'el acceso se adapta a la altura de la pantalla');
  ok(
    bloquesDeAltura.every((b) => !/\.mc-rotulo\b[^}]*\{[^}]*font-size/.test(b)),
    'el logo no se encoge para hacer sitio: eso lo paga la ilustración'
  );
  // Y el registro se queda fuera de todo esto: allí son ocho campos y
  // desplazarse está bien.
  ok(
    /es-registro/.test(login) && /es-acceso/.test(login),
    'el acceso y el registro se distinguen por clase, para apretar solo uno'
  );

  // ── Las pantallas de dentro: cristal, pero sin pagar el desenfoque ──
  ok(
    hay('public', 'escena-difusa.jpg'),
    'hay una versión ya desenfocada de la calle para el fondo de dentro'
  );
  // Es la mitad del argumento: el desenfoque va COCIDO en el archivo, y una
  // imagen desenfocada no tiene detalle que perder, así que pesa una décima
  // parte. Si algún día abulta como la nítida, alguien la regeneró sin
  // desenfocar y el fondo estará costando de más en cada pantalla.
  const pesoDifusa = fs.statSync(path.join(raiz, 'public', 'escena-difusa.jpg')).size;
  ok(pesoDifusa < 60 * 1024, 'y pesa poco, que es de lo que se trata', `${Math.round(pesoDifusa / 1024)} KB`);

  const fondoJuego = leer('components', 'layout', 'FondoJuego.tsx');
  ok(/escena-difusa\.jpg/.test(fondoJuego), 'las pantallas de dentro usan esa foto');
  // El panel es una herramienta de trabajo: tablas densas y turnos largos
  // leyendo cifras. Una calle de colores por detrás es ruido puro.
  ok(
    /startsWith\('\/admin'\)[\s\S]{0,40}return null/.test(fondoJuego),
    'pero el panel de administración se queda con su fondo liso'
  );
  ok(
    /:not\(\.fondo-juego\)/.test(css),
    'y el fondo está exento de la regla que sube todo por encima de él'
  );
  // Las tarjetas fueron translúcidas y ahora son piedra maciza dentro de su
  // marco. Lo que se ve de la calle es lo que queda ALREDEDOR de ellas, no a
  // través.
  ok(
    /\.app-shell \.wallet-card,[\s\S]{0,700}background-image: url\('\/textura-piedra\.png'\)/.test(css),
    'las tarjetas de dentro son de piedra, y la calle se ve alrededor'
  );
  // Las tarjetas translúcidas pisaron los colores de los tres niveles de
  // retiro y el nivel alcanzado se quedó en blanco sobre blanco.
  ok(
    /\.app-shell \.rn-step:not\(\.rn-done\):not\(\.rn-curr\)/.test(css),
    'sin borrar el color del nivel de retiro que ya está alcanzado'
  );

  // ── El fallo que apareció al mirar las capturas ──
  // .rn-step no se portó desde La Llave —el CSS se extrajo por uso y esta
  // clase se quedó por el camino—, así que los cuatro textos de cada nivel
  // de retiro caían pegados en la misma línea.
  ok(
    /\.rn-step \{[\s\S]{0,200}flex-direction: column;/.test(css),
    'los tres niveles de retiro se apilan en columna y no se pegan en una línea'
  );
}

console.log(
  fallos === 0
    ? '\n✅ Todo en orden.\n'
    : `\n❌ ${fallos} comprobación(es) fallaron.\n`
);
process.exit(fallos === 0 ? 0 : 1);
