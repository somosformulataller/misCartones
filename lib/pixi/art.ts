// ============================================================================
// Arte del PROTOTIPO — campo abierto, de día.
//
// Todo se dibuja con Graphics: no hay ni un solo archivo de imagen todavía, a
// propósito. La Fase 1 existe para decidir si el juego se SIENTE bien, y eso
// se decide con formas. El arte final (Fase 6) entra por aquí sustituyendo
// estas funciones por un atlas, sin tocar una línea de la lógica.
//
// El escenario es un prado con camino de tierra, árboles, arbustos, flores y
// una cerca de madera, bajo un cielo de mediodía. Todo lo estático se compone
// UNA vez (no hay scroll), así que dibujar de más aquí no cuesta nada en el
// bucle: el coste se paga al empezar la partida y ya.
// ============================================================================

import { Container, Graphics, Renderer, Texture } from 'pixi.js';
import { PLAY, STAGE_H, STAGE_W, WorldObstacle } from '@/lib/game/world';

export const COLORS = {
  // Cielo y fondo lejano
  cielo: 0x8fd3f4,
  cieloBajo: 0xc7ecfb,
  colinaLejos: 0x8fc17a,
  colinaCerca: 0x74b060,
  arboledaLejos: 0x5d9c56,

  // Suelo
  pasto: 0x86c765,
  pastoOscuro: 0x6fb352,
  pastoClaro: 0x9fd97b,
  pastoSeco: 0xc8cf72,
  tierra: 0xd2a86a,
  tierraOscura: 0xbb8f56,

  // Vegetación
  copa: 0x4ea34a,
  copaClara: 0x69c05f,
  copaOscura: 0x3d8a3e,
  tronco: 0x8a5a33,
  troncoOscuro: 0x6d452690,
  arbusto: 0x57ab52,
  arbustoClaro: 0x74c46b,

  // Flores
  florAmarilla: 0xffd84a,
  florRosa: 0xff8ec4,
  florBlanca: 0xfdfdf5,
  florMorada: 0xb083ec,

  // Objetos
  piedra: 0xb0aca2,
  piedraOscura: 0x8e8a80,
  barro: 0x8a6740,
  barroClaro: 0xa8825a,
  heno: 0xe8c65e,
  henoOscuro: 0xc9a441,
  cerca: 0xc9a173,
  cercaOscura: 0xa27e53,

  // Personaje
  camisa: 0x3f8fe0,
  camisaOscura: 0x2d6cb4,
  pantalon: 0x4a5b74,
  piel: 0xf0bc8c,
  gorra: 0xe8552f,

  // Bolsa y cartones
  bolsa: 0x2f3a3f,
  bolsaClara: 0x4a595f,
  lazo: 0xffd84a,
  carton: 0xd9a768,
  cartonOscuro: 0xb8894f,
  cartonDorado: 0xffd77a,

  // Carretilla
  metal: 0xbcc3c9,
  metalOscuro: 0x939aa1,
  tolva: 0xe0722c,
  tolvaOscura: 0xb85a20,

  sombra: 0x2a4a2e,
} as const;

// ── Suelo ───────────────────────────────────────────────────────────────────

/** El prado COMPLETO en un solo Graphics: pasto, camino de tierra, parches,
 *  flores y piedrecitas. Se dibuja una vez y no se vuelve a tocar. */
export function drawField(rnd: () => number): Container {
  const c = new Container();
  const g = new Graphics();

  // Cielo (banda superior, por encima del área jugable)
  g.rect(0, 0, STAGE_W, PLAY.y - 40).fill(COLORS.cielo);
  g.rect(0, PLAY.y - 130, STAGE_W, 90).fill(COLORS.cieloBajo);

  // Colinas del fondo: tres capas para dar profundidad
  const colina = (baseY: number, alto: number, color: number, semilla: number) => {
    const pts: number[] = [0, baseY];
    for (let x = 0; x <= STAGE_W; x += 60) {
      const h = Math.sin((x + semilla) * 0.006) * alto + Math.sin((x + semilla) * 0.017) * (alto * 0.4);
      pts.push(x, baseY - alto - h);
    }
    pts.push(STAGE_W, baseY, STAGE_W, baseY + 200, 0, baseY + 200);
    g.poly(pts).fill(color);
  };
  colina(PLAY.y - 66, 26, COLORS.colinaLejos, 0);
  colina(PLAY.y - 46, 18, COLORS.colinaCerca, 400);

  // Arboleda lejana en el horizonte: copas apiñadas, sin detalle
  for (let x = -20; x < STAGE_W + 20; x += 26 + rnd() * 18) {
    const r = 14 + rnd() * 12;
    g.circle(x, PLAY.y - 52 - rnd() * 10, r).fill(COLORS.arboledaLejos);
  }

  // Pasto: base + franjas segadas suaves (dan textura sin costar nada)
  g.rect(0, PLAY.y - 44, STAGE_W, STAGE_H - (PLAY.y - 44)).fill(COLORS.pasto);
  for (let y = PLAY.y - 44; y < STAGE_H; y += 86) {
    g.rect(0, y, STAGE_W, 43).fill({ color: COLORS.pastoClaro, alpha: 0.28 });
  }

  // Parches de pasto más oscuro y más seco, repartidos
  for (let i = 0; i < 34; i++) {
    const mx = rnd() * STAGE_W;
    const my = PLAY.y - 30 + rnd() * (STAGE_H - PLAY.y);
    g.ellipse(mx, my, 30 + rnd() * 60, 18 + rnd() * 34).fill({
      color: rnd() > 0.6 ? COLORS.pastoSeco : COLORS.pastoOscuro,
      alpha: 0.2 + rnd() * 0.22,
    });
  }

  // Camino de tierra serpenteante de arriba abajo: guía la vista y rompe el
  // verde. Es decoración pura, no afecta al movimiento.
  const camino: number[] = [];
  const derecha: number[] = [];
  for (let y = PLAY.y - 50; y <= STAGE_H; y += 40) {
    const cx = STAGE_W / 2 + Math.sin(y * 0.004) * 150 + Math.sin(y * 0.011) * 46;
    const ancho = 56 + Math.sin(y * 0.008) * 12;
    camino.push(cx - ancho, y);
    derecha.unshift(cx + ancho, y);
  }
  g.poly([...camino, ...derecha]).fill({ color: COLORS.tierra, alpha: 0.9 });
  // Rodadas
  for (let y = PLAY.y - 50; y <= STAGE_H; y += 40) {
    const cx = STAGE_W / 2 + Math.sin(y * 0.004) * 150 + Math.sin(y * 0.011) * 46;
    g.ellipse(cx - 22, y, 9, 16).fill({ color: COLORS.tierraOscura, alpha: 0.35 });
    g.ellipse(cx + 22, y, 9, 16).fill({ color: COLORS.tierraOscura, alpha: 0.35 });
  }

  // Piedrecitas
  for (let i = 0; i < 40; i++) {
    const px = rnd() * STAGE_W;
    const py = PLAY.y - 20 + rnd() * (STAGE_H - PLAY.y);
    g.ellipse(px, py, 3 + rnd() * 4, 2 + rnd() * 3).fill({
      color: COLORS.piedra,
      alpha: 0.5,
    });
  }

  // Flores silvestres: lo que más color mete y lo más barato de todo
  const paleta = [COLORS.florAmarilla, COLORS.florRosa, COLORS.florBlanca, COLORS.florMorada];
  for (let i = 0; i < 150; i++) {
    const fx = rnd() * STAGE_W;
    const fy = PLAY.y - 34 + rnd() * (STAGE_H - PLAY.y + 20);
    const col = paleta[Math.floor(rnd() * paleta.length)];
    const r = 2.6 + rnd() * 2;
    // Cuatro pétalos y centro: a este tamaño se lee como flor, no como punto
    g.circle(fx - r, fy, r).fill(col);
    g.circle(fx + r, fy, r).fill(col);
    g.circle(fx, fy - r, r).fill(col);
    g.circle(fx, fy + r, r).fill(col);
    g.circle(fx, fy, r * 0.8).fill(0xffe9a8);
  }

  // Matas de hierba alta sueltas
  for (let i = 0; i < 70; i++) {
    const hx = rnd() * STAGE_W;
    const hy = PLAY.y - 24 + rnd() * (STAGE_H - PLAY.y);
    const col = rnd() > 0.5 ? COLORS.pastoOscuro : COLORS.pastoClaro;
    for (let b = -2; b <= 2; b++) {
      g.poly([hx + b * 3, hy, hx + b * 3 + 1.6, hy - 9 - rnd() * 7, hx + b * 3 + 3.2, hy]).fill({
        color: col,
        alpha: 0.85,
      });
    }
  }

  c.addChild(g);
  return c;
}

/** La cerca de madera que marca el borde de arriba del terreno. */
export function drawFence(): Container {
  const c = new Container();
  const g = new Graphics();
  const y = PLAY.y - 30;
  // Dos travesaños
  g.rect(0, y + 8, STAGE_W, 7).fill(COLORS.cerca);
  g.rect(0, y + 24, STAGE_W, 7).fill(COLORS.cercaOscura);
  // Postes
  for (let x = 16; x < STAGE_W; x += 96) {
    g.rect(x, y - 6, 11, 46).fill(COLORS.cerca);
    g.rect(x, y - 6, 4, 46).fill({ color: COLORS.cercaOscura, alpha: 0.6 });
  }
  c.addChild(g);
  return c;
}

// ── Vegetación decorativa ───────────────────────────────────────────────────

interface ItemDecor {
  view: Container;
  copa: Container;
  fase: number;
  amp: number;
}

/** Un árbol: tronco + copa en tres masas. La copa se mece en el viento. */
function makeTree(escala: number, rnd: () => number): { view: Container; copa: Container } {
  const view = new Container();

  const sombra = new Graphics();
  sombra.ellipse(0, 6, 42 * escala, 15 * escala).fill({ color: COLORS.sombra, alpha: 0.22 });
  view.addChild(sombra);

  const tronco = new Graphics();
  tronco.poly([-9 * escala, 4, 9 * escala, 4, 6 * escala, -46 * escala, -6 * escala, -46 * escala])
    .fill(COLORS.tronco);
  tronco.poly([-9 * escala, 4, -3 * escala, 4, -2 * escala, -46 * escala, -6 * escala, -46 * escala])
    .fill({ color: 0x6d4526, alpha: 0.55 });
  view.addChild(tronco);

  // La copa va en su propio contenedor con el pivote abajo: así al mecerse
  // gira desde el tronco y no flota suelta.
  const copa = new Container();
  const g = new Graphics();
  const r = 40 * escala;
  g.circle(-r * 0.55, 6, r * 0.78).fill(COLORS.copaOscura);
  g.circle(r * 0.55, 2, r * 0.72).fill(COLORS.copaOscura);
  g.circle(0, -r * 0.35, r).fill(COLORS.copa);
  g.circle(-r * 0.4, -r * 0.15, r * 0.62).fill(COLORS.copa);
  g.circle(r * 0.42, -r * 0.2, r * 0.58).fill(COLORS.copa);
  // Luz por arriba a la izquierda: es lo que le da volumen
  g.circle(-r * 0.28, -r * 0.6, r * 0.42).fill({ color: COLORS.copaClara, alpha: 0.9 });
  g.circle(r * 0.1, -r * 0.72, r * 0.3).fill({ color: COLORS.copaClara, alpha: 0.6 });
  copa.addChild(g);
  copa.y = -46 * escala;
  view.addChild(copa);

  void rnd;
  return { view, copa };
}

/** Un arbusto redondo. */
function makeBush(escala: number): Container {
  const c = new Container();
  const g = new Graphics();
  const r = 26 * escala;
  g.ellipse(0, r * 0.55, r * 1.1, r * 0.34).fill({ color: COLORS.sombra, alpha: 0.2 });
  g.circle(-r * 0.5, 0, r * 0.7).fill(COLORS.arbusto);
  g.circle(r * 0.5, 2, r * 0.66).fill(COLORS.arbusto);
  g.circle(0, -r * 0.28, r * 0.86).fill(COLORS.arbusto);
  g.circle(-r * 0.2, -r * 0.5, r * 0.45).fill({ color: COLORS.arbustoClaro, alpha: 0.9 });
  // Bayas
  g.circle(r * 0.3, -r * 0.3, 3).fill(COLORS.florRosa);
  g.circle(-r * 0.45, -r * 0.1, 3).fill(COLORS.florRosa);
  c.addChild(g);
  return c;
}

/**
 * Todo el decorado que NO estorba: árboles grandes y arbustos en las bandas
 * de arriba y de abajo, fuera del área jugable. Se mecen suavemente — es lo
 * que hace que el campo parezca vivo en vez de un dibujo pegado.
 */
export function makeDecor(rnd: () => number): { capa: Container; items: ItemDecor[] } {
  const capa = new Container();
  capa.sortableChildren = true;
  const items: ItemDecor[] = [];

  const plantarArbol = (x: number, y: number, escala: number) => {
    const t = makeTree(escala, rnd);
    t.view.x = x;
    t.view.y = y;
    t.view.zIndex = y;
    capa.addChild(t.view);
    items.push({ view: t.view, copa: t.copa, fase: rnd() * Math.PI * 2, amp: 0.02 + rnd() * 0.025 });
  };

  // Hilera de arriba, detrás de la cerca
  for (let x = 40; x < STAGE_W; x += 118 + rnd() * 60) {
    plantarArbol(x + rnd() * 24, PLAY.y - 58 - rnd() * 16, 0.72 + rnd() * 0.3);
  }
  // Hilera de abajo: los troncos quedan FUERA de la pantalla y solo asoman
  // las copas, encuadrando la escena por delante. Van tan abajo a propósito:
  // si subieran, una copa podría tapar una bolsa del área jugable.
  for (let x = 10; x < STAGE_W + 40; x += 150 + rnd() * 80) {
    plantarArbol(x + rnd() * 30, PLAY.y + PLAY.h + 126 + rnd() * 34, 1.05 + rnd() * 0.35);
  }
  // Un par en las esquinas, para cerrar el encuadre
  plantarArbol(-6, PLAY.y + PLAY.h + 150, 1.3);
  plantarArbol(STAGE_W + 8, PLAY.y + PLAY.h + 142, 1.25);

  // Arbustos sueltos por las bandas
  for (let i = 0; i < 12; i++) {
    const arriba = rnd() > 0.5;
    const b = makeBush(0.7 + rnd() * 0.5);
    b.x = rnd() * STAGE_W;
    b.y = arriba ? PLAY.y - 26 - rnd() * 14 : PLAY.y + PLAY.h + 18 + rnd() * 60;
    b.zIndex = b.y;
    capa.addChild(b);
  }

  return { capa, items };
}

/** Sombras de nube que cruzan el prado despacio. Cuestan cuatro elipses y
 *  son lo que más "aire libre" da a la escena. */
export function makeCloudShadows(rnd: () => number): { capa: Container; nubes: Container[] } {
  const capa = new Container();
  const nubes: Container[] = [];
  for (let i = 0; i < 4; i++) {
    const n = new Container();
    const g = new Graphics();
    const s = 0.8 + rnd() * 0.9;
    g.ellipse(0, 0, 150 * s, 80 * s).fill({ color: 0x1e3a24, alpha: 0.09 });
    g.ellipse(-110 * s, 20 * s, 90 * s, 54 * s).fill({ color: 0x1e3a24, alpha: 0.08 });
    g.ellipse(120 * s, -14 * s, 100 * s, 58 * s).fill({ color: 0x1e3a24, alpha: 0.08 });
    n.addChild(g);
    n.x = rnd() * (STAGE_W + 700) - 350;
    n.y = PLAY.y + rnd() * PLAY.h;
    capa.addChild(n);
    nubes.push(n);
  }
  return { capa, nubes };
}

// ── Obstáculos ──────────────────────────────────────────────────────────────

/** Un obstáculo del campo. Cada tipo se ve distinto para que se lea de un
 *  vistazo qué se puede pisar (el barro) y qué hay que rodear. */
export function drawObstacle(o: WorldObstacle): Container {
  const c = new Container();
  const g = new Graphics();
  const { w, h } = o;

  switch (o.kind) {
    case 'piedra':
      g.ellipse(w / 2, h - 3, w / 2, 7).fill({ color: COLORS.sombra, alpha: 0.25 });
      g.poly([2, h, w * 0.16, h * 0.3, w * 0.55, 2, w * 0.92, h * 0.42, w - 2, h]).fill(COLORS.piedra);
      g.poly([2, h, w * 0.16, h * 0.3, w * 0.42, h * 0.5, w * 0.36, h]).fill(COLORS.piedraOscura);
      g.ellipse(w * 0.55, h * 0.3, w * 0.14, h * 0.1).fill({ color: 0xd6d2c8, alpha: 0.6 });
      break;

    case 'tronco':
      g.ellipse(w / 2, h - 4, w / 2, 8).fill({ color: COLORS.sombra, alpha: 0.25 });
      g.roundRect(0, h * 0.16, w, h * 0.7, h * 0.35).fill(COLORS.tronco);
      g.roundRect(0, h * 0.5, w, h * 0.36, h * 0.2).fill({ color: 0x6d4526, alpha: 0.5 });
      // Anillos en el corte
      g.ellipse(w - 6, h * 0.5, 8, h * 0.34).fill(0xc79a63);
      g.ellipse(w - 6, h * 0.5, 4.5, h * 0.19).fill(0xa87c47);
      g.ellipse(w - 6, h * 0.5, 2, h * 0.08).fill(0xc79a63);
      break;

    case 'tocon':
      g.ellipse(w / 2, h - 3, w / 2, 6).fill({ color: COLORS.sombra, alpha: 0.25 });
      g.roundRect(w * 0.12, h * 0.25, w * 0.76, h * 0.72, 5).fill(COLORS.tronco);
      g.ellipse(w / 2, h * 0.28, w * 0.42, h * 0.22).fill(0xc79a63);
      g.ellipse(w / 2, h * 0.28, w * 0.24, h * 0.12).fill(0xa87c47);
      // Un brote verde: detalle que lo hace simpático
      g.ellipse(w * 0.74, h * 0.16, 7, 4).fill(COLORS.copaClara);
      break;

    case 'arbusto': {
      const r = w * 0.42;
      g.ellipse(w / 2, h - 4, r * 1.15, 7).fill({ color: COLORS.sombra, alpha: 0.22 });
      g.circle(w * 0.3, h * 0.62, r * 0.72).fill(COLORS.arbusto);
      g.circle(w * 0.72, h * 0.66, r * 0.68).fill(COLORS.arbusto);
      g.circle(w * 0.5, h * 0.38, r * 0.9).fill(COLORS.arbusto);
      g.circle(w * 0.38, h * 0.26, r * 0.46).fill({ color: COLORS.arbustoClaro, alpha: 0.9 });
      g.circle(w * 0.66, h * 0.4, 3.5).fill(COLORS.florBlanca);
      g.circle(w * 0.3, h * 0.5, 3.5).fill(COLORS.florBlanca);
      break;
    }

    case 'heno':
      g.ellipse(w / 2, h - 4, w / 2, 8).fill({ color: COLORS.sombra, alpha: 0.25 });
      g.roundRect(w * 0.05, h * 0.2, w * 0.9, h * 0.74, 12).fill(COLORS.heno);
      // Hebras
      for (let i = 0; i < 7; i++) {
        const yy = h * 0.3 + i * (h * 0.09);
        g.rect(w * 0.1, yy, w * 0.8, 2.5).fill({ color: COLORS.henoOscuro, alpha: 0.55 });
      }
      g.roundRect(w * 0.05, h * 0.2, w * 0.9, h * 0.16, 10).fill({ color: 0xf3d885, alpha: 0.7 });
      break;

    case 'barro':
      // NO bloquea: se puede pisar, solo frena. Por eso se ve plano y hundido.
      g.ellipse(w / 2, h / 2, w / 2, h / 2).fill({ color: COLORS.barro, alpha: 0.92 });
      g.ellipse(w / 2, h / 2, w * 0.42, h * 0.4).fill({ color: COLORS.barroClaro, alpha: 0.5 });
      g.ellipse(w * 0.36, h * 0.4, w * 0.13, h * 0.11).fill({ color: 0xd9c2a0, alpha: 0.45 });
      g.ellipse(w * 0.66, h * 0.58, w * 0.08, h * 0.07).fill({ color: 0xd9c2a0, alpha: 0.35 });
      break;
  }

  c.addChild(g);
  c.x = o.x;
  c.y = o.y;
  return c;
}

// ── Bolsas ──────────────────────────────────────────────────────────────────

/** Bolsa de basura en el suelo. `glow` la enciende cuando el ciudadano se
 *  acerca — la anticipación de la que habla el plan. El lazo amarillo es lo
 *  que hace que la bolsa oscura NO se pierda sobre el pasto verde. */
export function makeBag(): { view: Container; glow: Graphics; body: Container } {
  const view = new Container();

  const sombra = new Graphics();
  sombra.ellipse(0, 21, 25, 9).fill({ color: COLORS.sombra, alpha: 0.3 });
  view.addChild(sombra);

  const glow = new Graphics();
  glow.circle(0, -2, 44).fill({ color: 0xfff0a8, alpha: 0.3 });
  glow.circle(0, -2, 30).fill({ color: 0xffffff, alpha: 0.18 });
  glow.alpha = 0;
  view.addChild(glow);

  const body = new Container();
  const g = new Graphics();
  g.ellipse(0, 2, 25, 23).fill(COLORS.bolsa);
  g.ellipse(-8, -7, 10, 9).fill({ color: COLORS.bolsaClara, alpha: 0.55 });
  g.poly([-10, -16, 10, -16, 6, -27, -6, -27]).fill(COLORS.bolsa);
  // Lazo de cierre: el toque de color que la hace visible sobre el verde
  g.ellipse(0, -17, 12, 5).fill(COLORS.lazo);
  g.poly([-7, -27, -13, -34, -3, -28]).fill(COLORS.lazo);
  g.poly([7, -27, 13, -34, 3, -28]).fill(COLORS.lazo);
  // Contorno claro: la despega del fondo
  g.ellipse(0, 2, 25, 23).stroke({ width: 2, color: 0x1a2226, alpha: 0.45 });
  body.addChild(g);
  view.addChild(body);

  return { view, glow, body };
}

// ── Carretilla ──────────────────────────────────────────────────────────────

export function makeCart(): { view: Container; monton: Graphics; aura: Graphics } {
  const view = new Container();

  const sombra = new Graphics();
  sombra.ellipse(0, 35, 58, 15).fill({ color: COLORS.sombra, alpha: 0.28 });
  view.addChild(sombra);

  const aura = new Graphics();
  aura.circle(0, 0, 78).fill({ color: 0xfff2b0, alpha: 0.22 });
  aura.circle(0, 0, 56).fill({ color: 0xffffff, alpha: 0.12 });
  aura.alpha = 0;
  view.addChild(aura);

  const g = new Graphics();
  g.circle(0, 31, 13).fill(0x4a4038);
  g.circle(0, 31, 6).fill(COLORS.metalOscuro);
  g.rect(-45, 19, 90, 7).fill(COLORS.metal);
  g.poly([-49, -19, 49, -19, 37, 21, -37, 21]).fill(COLORS.tolva);
  g.poly([-49, -19, 49, -19, 41, -8, -41, -8]).fill(COLORS.tolvaOscura);
  g.poly([-49, -19, -41, -8, -37, 21, -49, 21]).fill({ color: 0xffffff, alpha: 0.14 });
  g.rect(-54, -23, 11, 46).fill(COLORS.metal);
  g.rect(43, -23, 11, 46).fill(COLORS.metal);
  g.rect(-54, -23, 4, 46).fill({ color: COLORS.metalOscuro, alpha: 0.7 });
  view.addChild(g);

  const monton = new Graphics();
  view.addChild(monton);

  return { view, monton, aura };
}

/** Redibuja el montón de la carretilla para `n` bolsas entregadas (0-5). Es
 *  el marcador de progreso del juego: no hace falta ningún número. */
export function paintCartFill(monton: Graphics, n: number) {
  monton.clear();
  if (n <= 0) return;
  for (let i = 0; i < n; i++) {
    const y = -15 - i * 8;
    const w = 74 - i * 4;
    const ultima = i === 4;
    monton.roundRect(-w / 2, y, w, 12, 3).fill(ultima ? COLORS.cartonDorado : COLORS.carton);
    monton
      .roundRect(-w / 2 + 6, y - 3, w * 0.4, 9, 2)
      .fill(ultima ? 0xffe6a8 : COLORS.cartonOscuro);
  }
  if (n >= 5) {
    monton.roundRect(-60, -23, 24, 11, 3).fill(COLORS.cartonDorado);
    monton.roundRect(37, -27, 24, 11, 3).fill(COLORS.cartonDorado);
    monton.roundRect(-14, -60, 26, 12, 3).fill(COLORS.cartonDorado);
  }
}

// ── Ciudadano ───────────────────────────────────────────────────────────────

/** Por partes, para poder animarlas: piernas que se mueven, cuerpo que hace
 *  squash al pisar, y la bolsa al hombro cuando carga. */
export function makeCitizen() {
  const view = new Container();

  const sombra = new Graphics();
  sombra.ellipse(0, 23, 19, 7).fill({ color: COLORS.sombra, alpha: 0.32 });
  view.addChild(sombra);

  const cuerpo = new Container();

  const piernaIzq = new Graphics();
  piernaIzq.roundRect(-3.5, 0, 8, 17, 3).fill(COLORS.pantalon);
  piernaIzq.roundRect(-4, 13, 9, 5, 2).fill(0x3a2f26);
  piernaIzq.y = 6;
  piernaIzq.x = -6;
  cuerpo.addChild(piernaIzq);

  const piernaDer = new Graphics();
  piernaDer.roundRect(-3.5, 0, 8, 17, 3).fill(COLORS.pantalon);
  piernaDer.roundRect(-4, 13, 9, 5, 2).fill(0x3a2f26);
  piernaDer.y = 6;
  piernaDer.x = 6;
  cuerpo.addChild(piernaDer);

  const torso = new Graphics();
  torso.roundRect(-12.5, -15, 25, 25, 8).fill(COLORS.camisa);
  torso.roundRect(-12.5, 2, 25, 8, 4).fill(COLORS.camisaOscura);
  // Peto: rompe el bloque de color y le da aire de trabajador del campo
  torso.rect(-6, -13, 12, 20).fill({ color: 0x3f6ea8, alpha: 0.5 });
  torso.circle(-4, -9, 1.8).fill(COLORS.lazo);
  torso.circle(4, -9, 1.8).fill(COLORS.lazo);
  // Brazos
  torso.roundRect(-16, -11, 6, 16, 3).fill(COLORS.piel);
  torso.roundRect(10, -11, 6, 16, 3).fill(COLORS.piel);
  cuerpo.addChild(torso);

  const cabeza = new Graphics();
  cabeza.circle(0, -25, 10.5).fill(COLORS.piel);
  cabeza.circle(-3.5, -26, 1.6).fill(0x3a2a20);
  cabeza.circle(3.5, -26, 1.6).fill(0x3a2a20);
  // Sombrero de paja: es de día y está en el campo
  cabeza.ellipse(0, -31, 19, 6).fill(COLORS.heno);
  cabeza.ellipse(0, -31, 19, 6).stroke({ width: 1.5, color: COLORS.henoOscuro });
  cabeza.ellipse(0, -35, 9, 7).fill(COLORS.heno);
  cabeza.rect(-9, -35, 18, 3).fill(COLORS.gorra);
  cuerpo.addChild(cabeza);

  const bolsaHombro = new Container();
  const bg = new Graphics();
  bg.ellipse(0, 0, 18, 16).fill(COLORS.bolsa);
  bg.ellipse(-5, -4, 7, 6).fill({ color: COLORS.bolsaClara, alpha: 0.5 });
  bg.poly([-6, -11, 6, -11, 3, -18, -3, -18]).fill(COLORS.bolsa);
  bg.ellipse(0, -12, 9, 4).fill(COLORS.lazo);
  bolsaHombro.addChild(bg);
  // El cartón que ASOMA durante todo el viaje: la promesa de lo que hay dentro
  const asoma = new Graphics();
  asoma.roundRect(-6, -25, 13, 9, 2).fill(COLORS.carton);
  asoma.roundRect(-4, -23, 7, 3, 1).fill(COLORS.cartonOscuro);
  bolsaHombro.addChild(asoma);
  bolsaHombro.x = -17;
  bolsaHombro.y = -23;
  bolsaHombro.visible = false;
  cuerpo.addChild(bolsaHombro);

  view.addChild(cuerpo);

  return { view, cuerpo, torso, cabeza, piernaIzq, piernaDer, bolsaHombro, sombra };
}

// ── Texturas de partículas ──────────────────────────────────────────────────

/** Un cartón. Una sola textura para todos: es lo que permite que el
 *  ParticleContainer los dibuje de una tacada. */
export function makeCartonTexture(renderer: Renderer): Texture {
  const g = new Graphics();
  g.roundRect(0, 0, 24, 17, 3).fill(COLORS.carton);
  g.roundRect(2, 2, 20, 5, 2).fill(COLORS.cartonOscuro);
  g.roundRect(3, 9, 12, 3, 1).fill({ color: 0xfff0d0, alpha: 0.5 });
  g.roundRect(0, 0, 24, 17, 3).stroke({ width: 1.5, color: 0x8a6535 });
  const tex = renderer.generateTexture(g);
  g.destroy();
  return tex;
}

/** Polvo/tierra de los pasos y los tropiezos. */
export function makeDustTexture(renderer: Renderer): Texture {
  const g = new Graphics();
  g.circle(9, 9, 9).fill({ color: 0xe0cba4, alpha: 0.6 });
  const tex = renderer.generateTexture(g);
  g.destroy();
  return tex;
}

/** Hoja que sale volando al tropezar contra un arbusto o al correr. Le da
 *  vida al campo por casi nada. */
export function makeLeafTexture(renderer: Renderer): Texture {
  const g = new Graphics();
  g.ellipse(8, 6, 8, 5).fill(COLORS.copaClara);
  g.ellipse(8, 6, 8, 5).stroke({ width: 1, color: COLORS.copaOscura });
  const tex = renderer.generateTexture(g);
  g.destroy();
  return tex;
}
