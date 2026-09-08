// ============================================================================
// Arte del PROTOTIPO. Todo se dibuja con Graphics: no hay ni un solo archivo
// de imagen todavía, a propósito. La Fase 1 existe para decidir si el juego se
// SIENTE bien, y eso se decide con formas grises. El arte final (Fase 6) entra
// por aquí sustituyendo estas funciones por un atlas, sin tocar la lógica.
// ============================================================================

import { Container, Graphics, Renderer, Texture } from 'pixi.js';
import { PLAY, STAGE_H, STAGE_W, WorldObstacle } from '@/lib/game/world';

export const COLORS = {
  asfalto: 0x2b2f33,
  asfaltoOscuro: 0x24282b,
  acera: 0x4a4f55,
  aceraBorde: 0x5d636a,
  raya: 0xd9a520,
  edificio: 0x1b1f22,
  edificioAlt: 0x232a2e,
  ventana: 0x3d4a52,
  cuerpo: 0x4a86d8,
  cuerpoOscuro: 0x2f5f9e,
  piel: 0xe0a878,
  bolsa: 0x26312b,
  bolsaClara: 0x37453d,
  carretilla: 0xb0b6bc,
  carretillaTolva: 0xc4682c,
  carton: 0xc79a5b,
  cartonOscuro: 0xa87d43,
  cono: 0xe2662a,
  conoBanda: 0xf0f0f0,
  escombros: 0x6b6259,
  hueco: 0x14171a,
  charco: 0x3f5563,
  moto: 0x8c3a3a,
  sombra: 0x000000,
} as const;

/** Fondo COMPLETO de la calle en un solo Graphics. Al no haber scroll esto se
 *  dibuja una vez y no se vuelve a tocar en toda la partida: es la ventaja
 *  grande de la pantalla fija. */
export function drawBackground(rnd: () => number): Container {
  const c = new Container();
  const g = new Graphics();

  // Asfalto
  g.rect(0, 0, STAGE_W, STAGE_H).fill(COLORS.asfalto);

  // Aceras arriba y abajo
  g.rect(0, PLAY.y - 44, STAGE_W, 44).fill(COLORS.acera);
  g.rect(0, PLAY.y + PLAY.h, STAGE_W, 44).fill(COLORS.acera);
  g.rect(0, PLAY.y - 6, STAGE_W, 6).fill(COLORS.aceraBorde);
  g.rect(0, PLAY.y + PLAY.h, STAGE_W, 6).fill(COLORS.aceraBorde);

  // Edificios (bandas superior e inferior)
  let x = 0;
  while (x < STAGE_W) {
    const w = 70 + rnd() * 90;
    const alto = 100 + rnd() * 60;
    g.rect(x, PLAY.y - 44 - alto, w - 6, alto).fill(
      rnd() > 0.5 ? COLORS.edificio : COLORS.edificioAlt
    );
    // Ventanas
    for (let vy = 0; vy < Math.floor(alto / 34); vy++) {
      for (let vx = 0; vx < Math.floor((w - 6) / 30); vx++) {
        if (rnd() > 0.45) {
          g.rect(x + 10 + vx * 30, PLAY.y - 44 - alto + 12 + vy * 34, 14, 18).fill({
            color: COLORS.ventana,
            alpha: 0.35 + rnd() * 0.5,
          });
        }
      }
    }
    x += w;
  }
  x = 0;
  while (x < STAGE_W) {
    const w = 70 + rnd() * 90;
    const alto = 80 + rnd() * 50;
    g.rect(x, PLAY.y + PLAY.h + 44, w - 6, alto).fill(
      rnd() > 0.5 ? COLORS.edificio : COLORS.edificioAlt
    );
    x += w;
  }

  // Raya discontinua central
  for (let y = PLAY.y + 20; y < PLAY.y + PLAY.h - 20; y += 78) {
    g.rect(STAGE_W / 2 - 4, y, 8, 44).fill({ color: COLORS.raya, alpha: 0.55 });
  }

  // Manchas de asfalto: rompen la uniformidad y hacen que la calle no parezca
  // una alfombra lisa. Deterministas como todo lo demás.
  for (let i = 0; i < 26; i++) {
    const mx = PLAY.x + rnd() * PLAY.w;
    const my = PLAY.y + rnd() * PLAY.h;
    g.ellipse(mx, my, 18 + rnd() * 40, 10 + rnd() * 22).fill({
      color: COLORS.asfaltoOscuro,
      alpha: 0.35 + rnd() * 0.3,
    });
  }

  c.addChild(g);
  return c;
}

/** Un obstáculo. Cada tipo se ve distinto para que se lean de un vistazo. */
export function drawObstacle(o: WorldObstacle): Container {
  const c = new Container();
  const g = new Graphics();
  const { w, h } = o;

  switch (o.kind) {
    case 'cono':
      g.ellipse(w / 2, h - 3, w / 2, 6).fill({ color: COLORS.sombra, alpha: 0.3 });
      g.poly([w / 2, 0, w, h, 0, h]).fill(COLORS.cono);
      g.rect(w * 0.28, h * 0.5, w * 0.44, 6).fill(COLORS.conoBanda);
      break;
    case 'escombros':
      g.ellipse(w / 2, h - 4, w / 2, 7).fill({ color: COLORS.sombra, alpha: 0.3 });
      g.roundRect(0, h * 0.3, w * 0.5, h * 0.7, 4).fill(COLORS.escombros);
      g.roundRect(w * 0.4, h * 0.1, w * 0.6, h * 0.9, 4).fill(0x7c7269);
      break;
    case 'hueco':
      g.ellipse(w / 2, h / 2, w / 2, h / 2).fill(COLORS.hueco);
      g.ellipse(w / 2, h / 2, w / 2, h / 2).stroke({ width: 3, color: 0x3a4045 });
      break;
    case 'alcantarilla':
      g.rect(0, 0, w, h).fill(0x555b61);
      for (let i = 0; i < 4; i++) {
        g.rect(6, 8 + i * 9, w - 12, 4).fill(0x2f3438);
      }
      break;
    case 'charco':
      g.ellipse(w / 2, h / 2, w / 2, h / 2).fill({ color: COLORS.charco, alpha: 0.85 });
      g.ellipse(w * 0.35, h * 0.4, w * 0.16, h * 0.14).fill({ color: 0x7fa8bd, alpha: 0.4 });
      break;
    case 'moto':
      g.ellipse(w / 2, h - 6, w / 2, 8).fill({ color: COLORS.sombra, alpha: 0.3 });
      g.roundRect(w * 0.2, h * 0.12, w * 0.6, h * 0.76, 10).fill(COLORS.moto);
      g.circle(w / 2, h * 0.18, 9).fill(0x2b2f33);
      g.circle(w / 2, h * 0.82, 9).fill(0x2b2f33);
      break;
  }

  c.addChild(g);
  c.x = o.x;
  c.y = o.y;
  return c;
}

/** Bolsa de basura en el suelo. `glow` la enciende cuando el ciudadano se
 *  acerca — la anticipación de la que habla el plan. */
export function makeBag(): { view: Container; glow: Graphics; body: Container } {
  const view = new Container();

  const sombra = new Graphics();
  sombra.ellipse(0, 20, 24, 9).fill({ color: COLORS.sombra, alpha: 0.35 });
  view.addChild(sombra);

  const glow = new Graphics();
  glow.circle(0, 0, 40).fill({ color: 0xffd873, alpha: 0.22 });
  glow.alpha = 0;
  view.addChild(glow);

  const body = new Container();
  const g = new Graphics();
  // Cuerpo abombado + nudo arriba: silueta inconfundible de bolsa de basura
  g.ellipse(0, 2, 24, 22).fill(COLORS.bolsa);
  g.ellipse(-7, -6, 9, 8).fill({ color: COLORS.bolsaClara, alpha: 0.5 });
  g.poly([-9, -16, 9, -16, 5, -26, -5, -26]).fill(COLORS.bolsa);
  g.ellipse(0, -27, 8, 4).fill(COLORS.bolsaClara);
  body.addChild(g);
  view.addChild(body);

  return { view, glow, body };
}

/** La carretilla. `nivel` (0-5) hace crecer el montón a la vista: es el
 *  marcador de progreso del juego, sin un solo número en pantalla. */
export function makeCart(): { view: Container; monton: Graphics; aura: Graphics } {
  const view = new Container();

  const sombra = new Graphics();
  sombra.ellipse(0, 34, 56, 14).fill({ color: COLORS.sombra, alpha: 0.35 });
  view.addChild(sombra);

  const aura = new Graphics();
  aura.circle(0, 0, 74).fill({ color: 0xffd873, alpha: 0.16 });
  aura.alpha = 0;
  view.addChild(aura);

  const g = new Graphics();
  // Rueda y patas
  g.circle(0, 30, 12).fill(0x3a4045);
  g.rect(-44, 18, 88, 7).fill(COLORS.carretilla);
  // Tolva (vista 3/4: un trapecio abierto hacia arriba)
  g.poly([-48, -18, 48, -18, 36, 20, -36, 20]).fill(COLORS.carretillaTolva);
  g.poly([-48, -18, 48, -18, 40, -8, -40, -8]).fill(0x8f4a1e);
  // Mangos
  g.rect(-52, -22, 10, 44).fill(COLORS.carretilla);
  g.rect(42, -22, 10, 44).fill(COLORS.carretilla);
  view.addChild(g);

  const monton = new Graphics();
  view.addChild(monton);

  return { view, monton, aura };
}

/** Redibuja el montón de la carretilla para `n` bolsas entregadas (0-5). */
export function paintCartFill(monton: Graphics, n: number) {
  monton.clear();
  if (n <= 0) return;
  // Cada entrega añade una capa de cartones que asoma un poco más.
  for (let i = 0; i < n; i++) {
    const y = -14 - i * 8;
    const w = 72 - i * 4;
    monton.roundRect(-w / 2, y, w, 12, 3).fill(i === 4 ? 0xe0b463 : COLORS.carton);
    monton
      .roundRect(-w / 2 + 6, y - 3, w * 0.4, 9, 2)
      .fill(i === 4 ? 0xf0cd8a : COLORS.cartonOscuro);
  }
  if (n >= 5) {
    // Desbordada: cartones asomando por los lados
    monton.roundRect(-58, -22, 22, 10, 3).fill(0xe0b463);
    monton.roundRect(36, -26, 22, 10, 3).fill(0xe0b463);
  }
}

/** El ciudadano, por partes, para poder animarlas: piernas que se mueven,
 *  cuerpo que hace squash al pisar, y la bolsa al hombro cuando carga. */
export function makeCitizen() {
  const view = new Container();

  const sombra = new Graphics();
  sombra.ellipse(0, 22, 18, 7).fill({ color: COLORS.sombra, alpha: 0.4 });
  view.addChild(sombra);

  const cuerpo = new Container();

  const piernaIzq = new Graphics();
  piernaIzq.roundRect(-3, 0, 7, 16, 3).fill(0x2c3238);
  piernaIzq.y = 6;
  piernaIzq.x = -6;
  cuerpo.addChild(piernaIzq);

  const piernaDer = new Graphics();
  piernaDer.roundRect(-3, 0, 7, 16, 3).fill(0x2c3238);
  piernaDer.y = 6;
  piernaDer.x = 6;
  cuerpo.addChild(piernaDer);

  const torso = new Graphics();
  torso.roundRect(-12, -14, 24, 24, 8).fill(COLORS.cuerpo);
  torso.roundRect(-12, 2, 24, 8, 4).fill(COLORS.cuerpoOscuro);
  cuerpo.addChild(torso);

  const cabeza = new Graphics();
  cabeza.circle(0, -24, 10).fill(COLORS.piel);
  // Gorra: da un frente claro y hace legible hacia dónde mira
  cabeza.poly([-11, -28, 11, -28, 9, -34, -9, -34]).fill(0xd8532f);
  cuerpo.addChild(cabeza);

  const bolsaHombro = new Container();
  const bg = new Graphics();
  bg.ellipse(0, 0, 17, 15).fill(COLORS.bolsa);
  bg.poly([-6, -11, 6, -11, 3, -18, -3, -18]).fill(COLORS.bolsa);
  bolsaHombro.addChild(bg);
  // El cartón que ASOMA durante todo el viaje: la promesa de lo que hay dentro
  const asoma = new Graphics();
  asoma.roundRect(-5, -24, 11, 8, 2).fill(COLORS.carton);
  bolsaHombro.addChild(asoma);
  bolsaHombro.x = -16;
  bolsaHombro.y = -22;
  bolsaHombro.visible = false;
  cuerpo.addChild(bolsaHombro);

  view.addChild(cuerpo);

  return { view, cuerpo, torso, cabeza, piernaIzq, piernaDer, bolsaHombro, sombra };
}

/** Textura de un cartón para las partículas. Una sola textura para todos:
 *  es lo que permite que el ParticleContainer los dibuje de una tacada. */
export function makeCartonTexture(renderer: Renderer): Texture {
  const g = new Graphics();
  g.roundRect(0, 0, 22, 16, 3).fill(COLORS.carton);
  g.roundRect(2, 2, 18, 5, 2).fill(COLORS.cartonOscuro);
  g.roundRect(0, 0, 22, 16, 3).stroke({ width: 1.5, color: 0x8a6535 });
  const tex = renderer.generateTexture(g);
  g.destroy();
  return tex;
}

/** Textura de una partícula de polvo (pasos, tropiezos). */
export function makeDustTexture(renderer: Renderer): Texture {
  const g = new Graphics();
  g.circle(8, 8, 8).fill({ color: 0xb9b0a2, alpha: 0.55 });
  const tex = renderer.generateTexture(g);
  g.destroy();
  return tex;
}
