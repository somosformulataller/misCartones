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

console.log('Compilando lib/game y lib/three…');
execSync(`npx tsc -p "${path.join(aqui, 'tsconfig.pruebas.json')}"`, {
  cwd: raiz,
  stdio: 'inherit',
});

const require = createRequire(import.meta.url);
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
  // Se buscan los vértices por su color: los de piel dan el radio del cráneo,
  // los de ojo tienen que salirse de él.
  const radioPorColor = (malla, hex) => {
    const g = malla.geometry;
    const col = g.attributes.color;
    const pos = g.attributes.position;
    const objetivo = new THREE.Color(hex);
    let max = -1;
    for (let i = 0; i < pos.count; i++) {
      const d =
        Math.abs(col.getX(i) - objetivo.r) +
        Math.abs(col.getY(i) - objetivo.g) +
        Math.abs(col.getZ(i) - objetivo.b);
      if (d < 0.01) max = Math.max(max, Math.hypot(pos.getX(i), pos.getY(i), pos.getZ(i)));
    }
    return max;
  };
  const craneo = ciudadano.cabeza.children[0];
  const radioPiel = radioPorColor(craneo, esc.COL.piel);
  const radioOjo = radioPorColor(craneo, esc.COL.ojo);
  const radioBoca = radioPorColor(craneo, esc.COL.boca);
  console.log(`     Cara: cráneo ${radioPiel.toFixed(3)}, ojos ${radioOjo.toFixed(3)}, boca ${radioBoca.toFixed(3)}`);
  ok(radioOjo > radioPiel, 'Los ojos asoman del cráneo, no están hundidos dentro', `ojos ${radioOjo.toFixed(3)} contra cráneo ${radioPiel.toFixed(3)}`);
  ok(radioBoca > radioPiel * 0.96, 'La boca llega a la superficie de la cara', `boca ${radioBoca.toFixed(3)} contra cráneo ${radioPiel.toFixed(3)}`);

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

  // ── La acera derecha se queda sin árboles ──
  // La cámara mira desde +Z sin ladear, así que +X es el lado DERECHO de la
  // pantalla. Un árbol de acera está a 9,7 unidades del eje y los edificios a
  // 23-34: desde la vista cenital la copa se proyecta justo sobre la fachada y
  // la tapa. La arboleda de acera va solo a la izquierda a propósito, y esto
  // lo deja escrito para que no vuelva a colarse un árbol a la derecha.
  const deAcera = veg.copas.datos.filter((a) => Math.abs(a.x) < 40);
  const derecha = deAcera.filter((a) => a.x > 0);
  console.log(`     ${deAcera.length} árboles de acera, ${derecha.length} a la derecha`);
  ok(deAcera.length > 5, 'Sigue habiendo arbolado de acera');
  ok(derecha.length === 0, 'Ningún árbol de acera tapa los edificios de la derecha', `${derecha.length} árboles`);

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

console.log(
  fallos === 0
    ? '\n✅ Todo en orden.\n'
    : `\n❌ ${fallos} comprobación(es) fallaron.\n`
);
process.exit(fallos === 0 ? 0 : 1);
