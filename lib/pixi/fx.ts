// ============================================================================
// Efectos: cartones, polvo, temblor, destello y textos flotantes.
//
// Los cartones y el polvo viven en un ParticleContainer: es el contenedor que
// Pixi optimiza para muchos sprites de la MISMA textura, y dibuja 300 de una
// tacada por casi lo mismo que 10. Es exactamente el caso de la lluvia de
// cartones al vaciar una bolsa.
// ============================================================================

import { Container, Particle, ParticleContainer, Text, Texture } from 'pixi.js';

type Fase = 'estalla' | 'vuela';

interface EstadoCarton {
  p: Particle;
  vx: number;
  vy: number;
  vr: number;
  vida: number;
  fase: Fase;
  /** cuándo deja la gravedad y sale volando al contador (ms) */
  vuelaEn: number;
  t: number;
  desdeX: number;
  desdeY: number;
  destino: { x: number; y: number };
  rebotado: boolean;
  sueloY: number;
}

interface EstadoPolvo {
  p: Particle;
  vx: number;
  vy: number;
  vida: number;
  maxVida: number;
}

interface TextoFlotante {
  t: Text;
  vida: number;
  maxVida: number;
  vy: number;
}

/** easeInBack: sale hacia atrás antes de dispararse. Es la curva que hace que
 *  un objeto que vuela hacia un destino se sienta "lanzado" y no arrastrado. */
function easeInBack(x: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return c3 * x * x * x - c1 * x * x;
}

export class Fx {
  readonly capa = new Container();
  private cartones: ParticleContainer;
  private polvos: ParticleContainer;
  private textos = new Container();

  private estadosCarton: EstadoCarton[] = [];
  private estadosPolvo: EstadoPolvo[] = [];
  private estadosTexto: TextoFlotante[] = [];

  /** Amplitud actual del temblor de cámara, en píxeles lógicos. */
  shake = 0;
  /** Alfa del destello de pantalla completa. */
  flash = 0;

  constructor(
    private texCarton: Texture,
    private texPolvo: Texture
  ) {
    // dynamicProperties: hay que declarar QUÉ se va a animar. Lo que no se
    // declara se sube a la GPU una sola vez y deja de costar.
    this.polvos = new ParticleContainer({
      dynamicProperties: { position: true, rotation: false, scale: true, color: true },
    });
    this.cartones = new ParticleContainer({
      dynamicProperties: { position: true, rotation: true, scale: true, color: true },
    });
    this.capa.addChild(this.polvos, this.cartones, this.textos);
  }

  /** Estallido de cartones al vaciar una bolsa en la carretilla. */
  burstCartones(
    x: number,
    y: number,
    cantidad: number,
    fuerza: number,
    destino: { x: number; y: number }
  ) {
    for (let i = 0; i < cantidad; i++) {
      const p = new Particle({
        texture: this.texCarton,
        x,
        y,
        anchorX: 0.5,
        anchorY: 0.5,
      });
      const ang = -Math.PI / 2 + (Math.random() - 0.5) * 2.2;
      const vel = (180 + Math.random() * 260) * fuerza;
      this.cartones.addParticle(p);
      this.estadosCarton.push({
        p,
        vx: Math.cos(ang) * vel,
        vy: Math.sin(ang) * vel,
        vr: (Math.random() - 0.5) * 12,
        vida: 0,
        fase: 'estalla',
        // Escalonados: 40 ms entre uno y otro, para que el vuelo al contador
        // se lea como un reguero y no como un salto de todos a la vez.
        vuelaEn: 400 + i * 40,
        t: 0,
        desdeX: x,
        desdeY: y,
        destino,
        rebotado: false,
        sueloY: y + 18 + Math.random() * 26,
      });
    }
  }

  /** Puf de polvo: pasos, frenadas, tropiezos. */
  puffPolvo(x: number, y: number, cantidad: number, fuerza = 1) {
    for (let i = 0; i < cantidad; i++) {
      const p = new Particle({
        texture: this.texPolvo,
        x,
        y,
        anchorX: 0.5,
        anchorY: 0.5,
        scaleX: 0.5,
        scaleY: 0.5,
      });
      this.polvos.addParticle(p);
      const maxVida = 260 + Math.random() * 240;
      this.estadosPolvo.push({
        p,
        vx: (Math.random() - 0.5) * 90 * fuerza,
        vy: -(20 + Math.random() * 50) * fuerza,
        vida: 0,
        maxVida,
      });
    }
  }

  /** Texto que sube y se desvanece: «+$0,35». */
  flotante(x: number, y: number, texto: string, color = 0xffd873, tam = 34) {
    const t = new Text({
      text: texto,
      style: {
        fontFamily: 'system-ui, sans-serif',
        fontSize: tam,
        fontWeight: '800',
        fill: color,
        stroke: { color: 0x14171a, width: 5 },
      },
    });
    t.anchor.set(0.5);
    t.x = x;
    t.y = y;
    this.textos.addChild(t);
    this.estadosTexto.push({ t, vida: 0, maxVida: 1100, vy: -46 });
  }

  sacudir(amp: number) {
    this.shake = Math.max(this.shake, amp);
  }

  destello(a = 0.35) {
    this.flash = Math.max(this.flash, a);
  }

  update(dtMs: number) {
    const dt = dtMs / 1000;

    // ── Cartones ──
    for (let i = this.estadosCarton.length - 1; i >= 0; i--) {
      const e = this.estadosCarton[i];
      e.vida += dtMs;
      e.p.rotation += e.vr * dt;

      if (e.fase === 'estalla') {
        e.vy += 1600 * dt; // gravedad
        e.p.x += e.vx * dt;
        e.p.y += e.vy * dt;
        // Un solo rebote en el suelo: dos ya se lee como pelota.
        if (!e.rebotado && e.p.y > e.sueloY && e.vy > 0) {
          e.rebotado = true;
          e.vy = -e.vy * 0.38;
          e.vx *= 0.6;
          e.vr *= 0.5;
        } else if (e.rebotado && e.p.y > e.sueloY) {
          e.p.y = e.sueloY;
          e.vy = 0;
          e.vx *= 0.86;
        }
        if (e.vida >= e.vuelaEn) {
          e.fase = 'vuela';
          e.t = 0;
          e.desdeX = e.p.x;
          e.desdeY = e.p.y;
        }
      } else {
        // Vuelo al contador del HUD
        e.t += dtMs;
        const k = Math.min(1, e.t / 520);
        const s = easeInBack(k);
        e.p.x = e.desdeX + (e.destino.x - e.desdeX) * s;
        e.p.y = e.desdeY + (e.destino.y - e.desdeY) * s;
        e.p.scaleX = e.p.scaleY = 1 - k * 0.55;
        e.p.alpha = k > 0.75 ? 1 - (k - 0.75) / 0.25 : 1;
        if (k >= 1) {
          this.cartones.removeParticle(e.p);
          this.estadosCarton.splice(i, 1);
        }
      }
    }

    // ── Polvo ──
    for (let i = this.estadosPolvo.length - 1; i >= 0; i--) {
      const e = this.estadosPolvo[i];
      e.vida += dtMs;
      const k = e.vida / e.maxVida;
      e.p.x += e.vx * dt;
      e.p.y += e.vy * dt;
      e.vx *= 0.94;
      e.vy *= 0.94;
      e.p.alpha = Math.max(0, 0.55 * (1 - k));
      e.p.scaleX = e.p.scaleY = 0.5 + k * 0.9;
      if (k >= 1) {
        this.polvos.removeParticle(e.p);
        this.estadosPolvo.splice(i, 1);
      }
    }

    // ── Textos ──
    for (let i = this.estadosTexto.length - 1; i >= 0; i--) {
      const e = this.estadosTexto[i];
      e.vida += dtMs;
      const k = e.vida / e.maxVida;
      e.t.y += e.vy * dt;
      e.vy *= 0.95;
      e.t.alpha = k > 0.6 ? 1 - (k - 0.6) / 0.4 : 1;
      e.t.scale.set(1 + Math.min(0.18, k * 0.6));
      if (k >= 1) {
        e.t.destroy();
        this.textos.removeChild(e.t);
        this.estadosTexto.splice(i, 1);
      }
    }

    // El temblor cae EXPONENCIALMENTE, no lineal: un temblor que baja recto
    // se siente mecánico, y uno que no para marea.
    this.shake *= Math.exp(-8 * dt);
    if (this.shake < 0.05) this.shake = 0;
    this.flash *= Math.exp(-9 * dt);
    if (this.flash < 0.01) this.flash = 0;
  }

  destroy() {
    this.estadosTexto.forEach((e) => e.t.destroy());
    this.estadosCarton.length = 0;
    this.estadosPolvo.length = 0;
    this.estadosTexto.length = 0;
    this.capa.destroy({ children: true });
  }
}
