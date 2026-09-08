// ============================================================================
// Efectos en 3D: cartones, polvo, temblor de cámara y destello.
//
// Cartones y polvo van en InstancedMesh. Da igual que haya 10 o 300: es UNA
// llamada de dibujo cada uno. Es la razón por la que el estallido de la quinta
// bolsa puede permitirse el doble de piezas sin que el teléfono se entere.
// ============================================================================

import {
  BoxGeometry,
  Color,
  Group,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Object3D,
  Quaternion,
  SphereGeometry,
  Vector3,
} from 'three';
import { COL } from './escena';

const MAX_CARTONES = 90;
const MAX_POLVO = 60;

type Fase = 'estalla' | 'vuela';

interface Carton {
  vivo: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  rx: number;
  ry: number;
  rz: number;
  vrx: number;
  vry: number;
  vida: number;
  fase: Fase;
  vuelaEn: number;
  t: number;
  desde: Vector3;
  destino: Vector3;
  rebotado: boolean;
  suelo: number;
  escala: number;
  dorado: boolean;
}

interface Polvo {
  vivo: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  vida: number;
  maxVida: number;
}

/** easeInBack: sale hacia atrás antes de dispararse. Es la curva que hace que
 *  algo lanzado hacia un destino se sienta lanzado y no arrastrado. */
function easeInBack(x: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return c3 * x * x * x - c1 * x * x;
}

export class Fx {
  readonly grupo = new Group();

  private cartones: InstancedMesh;
  private polvos: InstancedMesh;
  private datosCarton: Carton[] = [];
  private datosPolvo: Polvo[] = [];

  private dummy = new Object3D();
  private m = new Matrix4();
  private ocultar = new Matrix4().makeScale(0, 0, 0);
  private _q = new Quaternion();
  private _color = new Color();

  /** Amplitud del temblor de cámara, en unidades de mundo. */
  shake = 0;
  /** Alfa del destello de pantalla completa (lo pinta el DOM). */
  flash = 0;

  constructor() {
    this.cartones = new InstancedMesh(
      new BoxGeometry(0.34, 0.05, 0.26),
      new MeshLambertMaterial({ color: COL.carton, flatShading: true }),
      MAX_CARTONES
    );
    this.cartones.frustumCulled = false;
    this.polvos = new InstancedMesh(
      new SphereGeometry(0.13, 5, 4),
      new MeshBasicMaterial({ color: 0xe0cba4, transparent: true, opacity: 0.5, depthWrite: false }),
      MAX_POLVO
    );
    this.polvos.frustumCulled = false;

    for (let i = 0; i < MAX_CARTONES; i++) {
      this.cartones.setMatrixAt(i, this.ocultar);
      this.datosCarton.push({
        vivo: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
        rx: 0, ry: 0, rz: 0, vrx: 0, vry: 0,
        vida: 0, fase: 'estalla', vuelaEn: 0, t: 0,
        desde: new Vector3(), destino: new Vector3(),
        rebotado: false, suelo: 0, escala: 1, dorado: false,
      });
    }
    for (let i = 0; i < MAX_POLVO; i++) {
      this.polvos.setMatrixAt(i, this.ocultar);
      this.datosPolvo.push({ vivo: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, vida: 0, maxVida: 1 });
    }
    this.cartones.instanceMatrix.needsUpdate = true;
    this.polvos.instanceMatrix.needsUpdate = true;

    this.grupo.add(this.cartones, this.polvos);
  }

  /** Estallido de cartones al vaciar una bolsa en la carretilla. */
  burstCartones(
    origen: Vector3,
    cantidad: number,
    fuerza: number,
    destino: Vector3,
    dorado = false
  ) {
    let puestos = 0;
    for (let i = 0; i < MAX_CARTONES && puestos < cantidad; i++) {
      const c = this.datosCarton[i];
      if (c.vivo) continue;
      const ang = Math.random() * Math.PI * 2;
      const vel = (2.2 + Math.random() * 2.6) * fuerza;
      c.vivo = true;
      c.x = origen.x;
      c.y = origen.y;
      c.z = origen.z;
      c.vx = Math.cos(ang) * vel * 0.55;
      c.vz = Math.sin(ang) * vel * 0.55;
      c.vy = (4.2 + Math.random() * 3) * fuerza;
      c.rx = Math.random() * 6;
      c.ry = Math.random() * 6;
      c.rz = Math.random() * 6;
      c.vrx = (Math.random() - 0.5) * 14;
      c.vry = (Math.random() - 0.5) * 14;
      c.vida = 0;
      c.fase = 'estalla';
      // Escalonados 40 ms: el vuelo al contador se lee como un reguero y no
      // como un salto de todos a la vez.
      c.vuelaEn = 420 + puestos * 40;
      c.t = 0;
      c.destino.copy(destino);
      c.rebotado = false;
      c.suelo = 0.1 + Math.random() * 0.1;
      c.escala = 0.85 + Math.random() * 0.4;
      c.dorado = dorado;
      // El color por instancia se fija AQUÍ y no en el bucle de update: solo
      // cambia al nacer el cartón, así que subirlo a la GPU cada fotograma
      // sería tirar trabajo.
      this.cartones.setColorAt(i, this._color.set(dorado ? COL.cartonDorado : COL.carton));
      puestos++;
    }
    if (puestos && this.cartones.instanceColor) this.cartones.instanceColor.needsUpdate = true;
  }

  /** Puf de polvo: pasos, frenadas, tropiezos. */
  puffPolvo(x: number, z: number, cantidad: number, fuerza = 1) {
    let puestos = 0;
    for (let i = 0; i < MAX_POLVO && puestos < cantidad; i++) {
      const p = this.datosPolvo[i];
      if (p.vivo) continue;
      p.vivo = true;
      p.x = x;
      p.y = 0.1;
      p.z = z;
      p.vx = (Math.random() - 0.5) * 1.6 * fuerza;
      p.vz = (Math.random() - 0.5) * 1.6 * fuerza;
      p.vy = (0.5 + Math.random() * 1.1) * fuerza;
      p.vida = 0;
      p.maxVida = 280 + Math.random() * 260;
      puestos++;
    }
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
    for (let i = 0; i < MAX_CARTONES; i++) {
      const c = this.datosCarton[i];
      if (!c.vivo) continue;
      c.vida += dtMs;
      c.rx += c.vrx * dt;
      c.ry += c.vry * dt;

      if (c.fase === 'estalla') {
        c.vy -= 14 * dt; // gravedad
        c.x += c.vx * dt;
        c.y += c.vy * dt;
        c.z += c.vz * dt;
        // Un solo rebote: dos ya se lee como pelota.
        if (!c.rebotado && c.y < c.suelo && c.vy < 0) {
          c.rebotado = true;
          c.y = c.suelo;
          c.vy = -c.vy * 0.38;
          c.vx *= 0.6;
          c.vz *= 0.6;
          c.vrx *= 0.5;
        } else if (c.rebotado && c.y < c.suelo) {
          c.y = c.suelo;
          c.vy = 0;
          c.vx *= 0.86;
          c.vz *= 0.86;
        }
        if (c.vida >= c.vuelaEn) {
          c.fase = 'vuela';
          c.t = 0;
          c.desde.set(c.x, c.y, c.z);
        }
      } else {
        c.t += dtMs;
        const k = Math.min(1, c.t / 540);
        const s = easeInBack(k);
        c.x = c.desde.x + (c.destino.x - c.desde.x) * s;
        c.y = c.desde.y + (c.destino.y - c.desde.y) * s;
        c.z = c.desde.z + (c.destino.z - c.desde.z) * s;
        if (k >= 1) {
          c.vivo = false;
          this.cartones.setMatrixAt(i, this.ocultar);
          continue;
        }
      }

      const enc = c.fase === 'vuela' ? 1 - Math.min(1, c.t / 540) * 0.55 : 1;
      this.dummy.position.set(c.x, c.y, c.z);
      this.dummy.rotation.set(c.rx, c.ry, c.rz);
      this.dummy.scale.setScalar(c.escala * enc);
      this.dummy.updateMatrix();
      this.cartones.setMatrixAt(i, this.dummy.matrix);
    }
    this.cartones.instanceMatrix.needsUpdate = true;

    // ── Polvo ──
    for (let i = 0; i < MAX_POLVO; i++) {
      const p = this.datosPolvo[i];
      if (!p.vivo) continue;
      p.vida += dtMs;
      const k = p.vida / p.maxVida;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.vx *= 0.94;
      p.vy *= 0.94;
      p.vz *= 0.94;
      if (k >= 1) {
        p.vivo = false;
        this.polvos.setMatrixAt(i, this.ocultar);
        continue;
      }
      this.dummy.position.set(p.x, p.y, p.z);
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.scale.setScalar(0.5 + k * 1.1);
      this.dummy.updateMatrix();
      this.polvos.setMatrixAt(i, this.dummy.matrix);
    }
    this.polvos.instanceMatrix.needsUpdate = true;

    // El temblor cae EXPONENCIALMENTE, nunca lineal: uno que baja recto se
    // siente mecánico, y uno que no para marea.
    this.shake *= Math.exp(-8 * dt);
    if (this.shake < 0.0006) this.shake = 0;
    this.flash *= Math.exp(-9 * dt);
    if (this.flash < 0.01) this.flash = 0;

    void this.m;
    void this._q;
  }

  dispose() {
    this.cartones.geometry.dispose();
    (this.cartones.material as MeshLambertMaterial).dispose();
    this.polvos.geometry.dispose();
    (this.polvos.material as MeshBasicMaterial).dispose();
  }
}
