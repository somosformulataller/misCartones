// ============================================================================
// La escena en 3D. Geometría LOW-POLY generada por código: ni un archivo de
// modelo, igual que antes no había ni una imagen. Un árbol es un cono sobre un
// cilindro, una piedra un icosaedro de caras planas, el ciudadano cápsulas y
// cajas.
//
// ── Cómo se mantiene barato en un teléfono flojo ──
// Lo que hunde los fps en 3D móvil no son los polígonos: son las LLAMADAS DE
// DIBUJO, las sombras en tiempo real y el relleno de transparencias. Aquí:
//   · Todo lo repetido (flores, hierba, árboles, arbustos, obstáculos,
//     cartones) va en InstancedMesh: 150 flores cuestan UNA llamada.
//   · Cero sombras en tiempo real. Cada objeto lleva una mancha oscura plana
//     debajo, que cuesta un círculo diminuto en vez de redibujar la escena.
//   · MeshLambertMaterial con caras planas. Nada de PBR.
//   · Una luz direccional y una hemisférica. Ni post-procesado ni niebla cara.
// La escena entera queda en unas 40 llamadas y ~6.000 triángulos.
// ============================================================================

import {
  BoxGeometry,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Object3D,
  PlaneGeometry,
  Quaternion,
  SphereGeometry,
  Vector3,
} from 'three';
import { PLAY, World, WorldObstacle } from '@/lib/game/world';

// ── Conversión de coordenadas ───────────────────────────────────────────────
// La simulación NO cambia: sigue en píxeles lógicos X/Y, igual que en 2D. Aquí
// solo se traduce a metros del mundo 3D, con el centro del terreno en el
// origen. Por eso toda la lógica de juego, el servidor y las pruebas siguen
// valiendo sin tocar una línea.
export const U = 1 / 40; // 40 px lógicos = 1 unidad de mundo
export const CX = PLAY.x + PLAY.w / 2;
export const CZ = PLAY.y + PLAY.h / 2;

export const wx = (sx: number) => (sx - CX) * U;
export const wz = (sy: number) => (sy - CZ) * U;
export const sx = (x: number) => x / U + CX;
export const sy = (z: number) => z / U + CZ;

export const ANCHO = PLAY.w * U;
export const FONDO = PLAY.h * U;

export const COL = {
  pasto: 0x7dbf5c,
  pastoClaro: 0x96d472,
  pastoOscuro: 0x69ab4c,
  pastoSeco: 0xbcc46a,
  tierra: 0xcaa068,
  tierraOscura: 0xb08a55,
  copa: 0x4ea34a,
  copaClara: 0x6ec267,
  tronco: 0x8a5a33,
  arbusto: 0x57ab52,
  piedra: 0xb2aea4,
  heno: 0xe2c05c,
  barro: 0x8a6740,
  cerca: 0xc9a173,
  florA: 0xffd84a,
  florB: 0xff8ec4,
  florC: 0xfdfdf5,
  florD: 0xb083ec,
  camisa: 0x3f8fe0,
  pantalon: 0x46536b,
  piel: 0xf0bc8c,
  sombrero: 0xe8c65e,
  bolsa: 0x33403f,
  lazo: 0xffd84a,
  carton: 0xd9a768,
  cartonDorado: 0xffd77a,
  metal: 0xbcc3c9,
  tolva: 0xe0722c,
} as const;

/** Material low-poly: una sola luz por píxel y caras planas. Es lo más barato
 *  que existe que siga reaccionando a la luz. */
const mat = (color: number, opts: { plano?: boolean } = {}) =>
  new MeshLambertMaterial({ color, flatShading: opts.plano ?? true });

/** Mancha de sombra: sustituye a las sombras en tiempo real, que en móvil
 *  cuestan redibujar la escena entera por cada luz. */
const MAT_SOMBRA = new MeshBasicMaterial({
  color: 0x2a4a2e,
  transparent: true,
  opacity: 0.26,
  depthWrite: false,
});

const _m = new Matrix4();
const _p = new Vector3();
const _q = new Quaternion();
const _e = new Vector3(1, 1, 1);
const _c = new Color();

function poner(
  malla: InstancedMesh,
  i: number,
  x: number,
  y: number,
  z: number,
  ex: number,
  ey: number,
  ez: number,
  rotY = 0
) {
  _p.set(x, y, z);
  _q.setFromAxisAngle(new Vector3(0, 1, 0), rotY);
  _e.set(ex, ey, ez);
  _m.compose(_p, _q, _e);
  malla.setMatrixAt(i, _m);
}

// ── Suelo ───────────────────────────────────────────────────────────────────

/**
 * El terreno: un plano subdividido cuyos VÉRTICES llevan el color. Así el
 * pasto tiene manchas, zonas secas y el camino de tierra sin usar ni una sola
 * textura y en UNA llamada de dibujo. Pintar el camino en los vértices, en vez
 * de ponerlo como una malla encima, evita además el parpadeo por z-fighting.
 */
export function crearSuelo(rnd: () => number): Mesh {
  const margen = 6; // el prado se extiende más allá del área jugable
  const w = ANCHO + margen * 2;
  const d = FONDO + margen * 2;
  const geo = new PlaneGeometry(w, d, 48, 72);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position;
  const colores: number[] = [];
  const verde = new Color(COL.pasto);
  const verdeClaro = new Color(COL.pastoClaro);
  const verdeOscuro = new Color(COL.pastoOscuro);
  const seco = new Color(COL.pastoSeco);
  const tierra = new Color(COL.tierra);

  // Semillas de manchas, para que el prado no sea liso
  const manchas = Array.from({ length: 22 }, () => ({
    x: (rnd() - 0.5) * w,
    z: (rnd() - 0.5) * d,
    r: 1.2 + rnd() * 3.2,
    seco: rnd() > 0.55,
  }));

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);

    _c.copy(rnd() > 0.5 ? verde : rnd() > 0.5 ? verdeClaro : verdeOscuro);

    for (const m of manchas) {
      const d2 = Math.hypot(x - m.x, z - m.z);
      if (d2 < m.r) {
        _c.lerp(m.seco ? seco : verdeOscuro, (1 - d2 / m.r) * 0.75);
      }
    }

    // Camino de tierra serpenteante. Se calcula en coordenadas de simulación
    // para que coincida exactamente con el que se dibujaba en 2D.
    const simY = sy(z);
    const centro = wx(360 + Math.sin(simY * 0.004) * 150 + Math.sin(simY * 0.011) * 46);
    const ancho = (56 + Math.sin(simY * 0.008) * 12) * U;
    const dc = Math.abs(x - centro);
    if (dc < ancho) {
      _c.lerp(tierra, 1 - Math.pow(dc / ancho, 4) * 0.55);
    }

    // Ondulación suave del terreno: un prado plano como una mesa se ve falso.
    // Fuera del área jugable se levanta más, para insinuar colinas.
    const fuera = Math.max(0, Math.abs(z) - FONDO / 2, Math.abs(x) - ANCHO / 2);
    const alto =
      Math.sin(x * 0.35) * 0.05 + Math.cos(z * 0.28) * 0.05 + fuera * fuera * 0.06;
    pos.setY(i, alto);

    colores.push(_c.r, _c.g, _c.b);
  }

  geo.setAttribute('color', new Float32BufferAttribute(colores, 3));
  geo.computeVertexNormals();

  return new Mesh(geo, new MeshLambertMaterial({ vertexColors: true, flatShading: true }));
}

// ── Vegetación ──────────────────────────────────────────────────────────────

export interface Vegetacion {
  grupo: Group;
  /** Copas de los árboles: se mecen. Guardadas para animarlas. */
  copas: { malla: InstancedMesh; datos: { x: number; z: number; e: number; fase: number }[] };
}

/** Árboles, arbustos, hierba y flores. Todo instanciado: son 5 llamadas de
 *  dibujo para varios cientos de objetos. */
export function crearVegetacion(rnd: () => number, world: World): Vegetacion {
  const grupo = new Group();

  // ── Árboles ──
  // Se plantan FUERA del área jugable, en una banda alrededor: así ninguna
  // copa puede tapar una bolsa ni confundirse con un obstáculo.
  const arboles: { x: number; z: number; e: number; fase: number }[] = [];
  const bordeX = ANCHO / 2;
  const bordeZ = FONDO / 2;
  for (let i = 0; i < 26; i++) {
    let x = 0;
    let z = 0;
    for (let t = 0; t < 30; t++) {
      x = (rnd() - 0.5) * (ANCHO + 11);
      z = (rnd() - 0.5) * (FONDO + 11);
      if (Math.abs(x) > bordeX + 0.7 || Math.abs(z) > bordeZ + 0.7) break;
    }
    if (Math.abs(x) <= bordeX + 0.7 && Math.abs(z) <= bordeZ + 0.7) continue;
    arboles.push({ x, z, e: 0.8 + rnd() * 0.6, fase: rnd() * Math.PI * 2 });
  }

  const geoTronco = new CylinderGeometry(0.16, 0.24, 1.5, 6);
  const troncos = new InstancedMesh(geoTronco, mat(COL.tronco), arboles.length);
  const geoCopa = new ConeGeometry(1.15, 2.4, 7);
  const copas = new InstancedMesh(geoCopa, mat(COL.copa), arboles.length * 2);

  arboles.forEach((a, i) => {
    poner(troncos, i, a.x, 0.75 * a.e, a.z, a.e, a.e, a.e);
    // Dos conos apilados y girados: da una silueta menos de "arbolito de
    // Navidad" y más de copa frondosa, por el mismo precio.
    poner(copas, i * 2, a.x, (1.5 + 1.0) * a.e, a.z, a.e * 1.15, a.e, a.e * 1.15, rnd() * 3);
    poner(copas, i * 2 + 1, a.x, (1.5 + 1.85) * a.e, a.z, a.e * 0.82, a.e * 0.85, a.e * 0.82, rnd() * 3);
    copas.setColorAt(i * 2, _c.set(COL.copa));
    copas.setColorAt(i * 2 + 1, _c.set(COL.copaClara));
  });
  troncos.instanceMatrix.needsUpdate = true;
  copas.instanceMatrix.needsUpdate = true;
  if (copas.instanceColor) copas.instanceColor.needsUpdate = true;
  grupo.add(troncos, copas);

  // Sombra de cada árbol
  const sombrasArbol = new InstancedMesh(
    new CircleGeometry(1, 10).rotateX(-Math.PI / 2),
    MAT_SOMBRA,
    arboles.length
  );
  arboles.forEach((a, i) => poner(sombrasArbol, i, a.x, 0.02, a.z, a.e, 1, a.e));
  sombrasArbol.instanceMatrix.needsUpdate = true;
  grupo.add(sombrasArbol);

  // ── Arbustos decorativos ──
  const nArb = 18;
  const arbustos = new InstancedMesh(new IcosahedronGeometry(0.45, 0), mat(COL.arbusto), nArb);
  for (let i = 0; i < nArb; i++) {
    let x = 0;
    let z = 0;
    do {
      x = (rnd() - 0.5) * (ANCHO + 7);
      z = (rnd() - 0.5) * (FONDO + 7);
    } while (Math.abs(x) < bordeX && Math.abs(z) < bordeZ);
    poner(arbustos, i, x, 0.3, z, 1 + rnd() * 0.6, 0.75 + rnd() * 0.4, 1 + rnd() * 0.6, rnd() * 3);
  }
  arbustos.instanceMatrix.needsUpdate = true;
  grupo.add(arbustos);

  // ── Hierba alta ──
  // Dentro del área jugable también, pero es puramente visual: no colisiona.
  const nHierba = 220;
  const hierba = new InstancedMesh(new ConeGeometry(0.09, 0.42, 4), mat(COL.pastoOscuro), nHierba);
  for (let i = 0; i < nHierba; i++) {
    const x = (rnd() - 0.5) * (ANCHO + 8);
    const z = (rnd() - 0.5) * (FONDO + 8);
    // Ni encima de la carretilla ni de las bolsas
    if (Math.hypot(x - wx(world.cart.x), z - wz(world.cart.y)) < 2) continue;
    poner(hierba, i, x, 0.21, z, 1, 0.8 + rnd() * 0.8, 1, rnd() * 3);
    hierba.setColorAt(i, _c.set(rnd() > 0.5 ? COL.pastoOscuro : COL.pastoSeco));
  }
  hierba.instanceMatrix.needsUpdate = true;
  if (hierba.instanceColor) hierba.instanceColor.needsUpdate = true;
  grupo.add(hierba);

  // ── Flores ──
  // Lo que más color mete en toda la escena y cuesta UNA llamada de dibujo.
  const nFlores = 190;
  const flores = new InstancedMesh(new DodecahedronGeometry(0.1, 0), mat(COL.florA), nFlores);
  const paleta = [COL.florA, COL.florB, COL.florC, COL.florD];
  for (let i = 0; i < nFlores; i++) {
    const x = (rnd() - 0.5) * (ANCHO + 9);
    const z = (rnd() - 0.5) * (FONDO + 9);
    poner(flores, i, x, 0.18, z, 1, 1, 1, rnd() * 3);
    flores.setColorAt(i, _c.set(paleta[Math.floor(rnd() * paleta.length)]));
  }
  flores.instanceMatrix.needsUpdate = true;
  if (flores.instanceColor) flores.instanceColor.needsUpdate = true;
  grupo.add(flores);

  return { grupo, copas: { malla: copas, datos: arboles } };
}

/** Cerca de madera alrededor del terreno: postes instanciados + travesaños. */
export function crearCerca(): Group {
  const g = new Group();
  const hx = ANCHO / 2 + 1.4;
  const hz = FONDO / 2 + 1.4;

  const postes: { x: number; z: number }[] = [];
  for (let x = -hx; x <= hx; x += 2.2) {
    postes.push({ x, z: -hz });
    postes.push({ x, z: hz });
  }
  for (let z = -hz + 2.2; z < hz; z += 2.2) {
    postes.push({ x: -hx, z });
    postes.push({ x: hx, z });
  }

  const malla = new InstancedMesh(new BoxGeometry(0.16, 1.1, 0.16), mat(COL.cerca), postes.length);
  postes.forEach((p, i) => poner(malla, i, p.x, 0.55, p.z, 1, 1, 1));
  malla.instanceMatrix.needsUpdate = true;
  g.add(malla);

  // Travesaños: cuatro cajas largas por lado, dos alturas
  const matCerca = mat(COL.cerca);
  for (const y of [0.4, 0.78]) {
    for (const z of [-hz, hz]) {
      const m = new Mesh(new BoxGeometry(hx * 2, 0.1, 0.09), matCerca);
      m.position.set(0, y, z);
      g.add(m);
    }
    for (const x of [-hx, hx]) {
      const m = new Mesh(new BoxGeometry(0.09, 0.1, hz * 2), matCerca);
      m.position.set(x, y, 0);
      g.add(m);
    }
  }
  return g;
}

// ── Obstáculos ──────────────────────────────────────────────────────────────

/** Los obstáculos del terreno, agrupados por tipo en InstancedMesh: como
 *  mucho 6 llamadas de dibujo para todos. */
export function crearObstaculos(obstaculos: WorldObstacle[]): Group {
  const g = new Group();
  const porTipo = new Map<string, WorldObstacle[]>();
  for (const o of obstaculos) {
    const l = porTipo.get(o.kind) ?? [];
    l.push(o);
    porTipo.set(o.kind, l);
  }

  const sombras: WorldObstacle[] = [];

  for (const [kind, lista] of porTipo) {
    const n = lista.length;
    let malla: InstancedMesh;

    switch (kind) {
      case 'piedra':
        malla = new InstancedMesh(new IcosahedronGeometry(0.5, 0), mat(COL.piedra), n);
        lista.forEach((o, i) => {
          const cw = o.w * U;
          const ch = o.h * U;
          poner(malla, i, wx(o.x + o.w / 2), ch * 0.42, wz(o.y + o.h / 2), cw, ch * 1.1, ch, i);
        });
        sombras.push(...lista);
        break;

      case 'tronco': {
        const geo = new CylinderGeometry(0.34, 0.36, 1, 7);
        geo.rotateZ(Math.PI / 2); // tumbado
        malla = new InstancedMesh(geo, mat(COL.tronco), n);
        lista.forEach((o, i) => {
          poner(malla, i, wx(o.x + o.w / 2), 0.32, wz(o.y + o.h / 2), o.w * U, 1, 1, 0);
        });
        sombras.push(...lista);
        break;
      }

      case 'tocon':
        malla = new InstancedMesh(new CylinderGeometry(0.5, 0.56, 0.75, 8), mat(COL.tronco), n);
        lista.forEach((o, i) => {
          poner(malla, i, wx(o.x + o.w / 2), 0.36, wz(o.y + o.h / 2), o.w * U, 1, o.h * U);
        });
        sombras.push(...lista);
        break;

      case 'arbusto':
        malla = new InstancedMesh(new IcosahedronGeometry(0.5, 0), mat(COL.arbusto), n);
        lista.forEach((o, i) => {
          poner(malla, i, wx(o.x + o.w / 2), 0.42, wz(o.y + o.h / 2), o.w * U, o.h * U * 1.1, o.h * U, i);
        });
        sombras.push(...lista);
        break;

      case 'heno': {
        const geo = new CylinderGeometry(0.5, 0.5, 1, 9);
        geo.rotateZ(Math.PI / 2);
        malla = new InstancedMesh(geo, mat(COL.heno), n);
        lista.forEach((o, i) => {
          poner(malla, i, wx(o.x + o.w / 2), o.h * U * 0.5, wz(o.y + o.h / 2), o.w * U, o.h * U, o.h * U);
        });
        sombras.push(...lista);
        break;
      }

      case 'barro':
      default:
        // El barro NO bloquea: se pisa. Por eso va plano contra el suelo.
        malla = new InstancedMesh(
          new CircleGeometry(0.5, 12).rotateX(-Math.PI / 2),
          new MeshLambertMaterial({ color: COL.barro }),
          n
        );
        lista.forEach((o, i) => {
          poner(malla, i, wx(o.x + o.w / 2), 0.03, wz(o.y + o.h / 2), o.w * U, 1, o.h * U);
        });
        break;
    }

    malla.instanceMatrix.needsUpdate = true;
    g.add(malla);
  }

  if (sombras.length) {
    const s = new InstancedMesh(
      new CircleGeometry(0.5, 10).rotateX(-Math.PI / 2),
      MAT_SOMBRA,
      sombras.length
    );
    sombras.forEach((o, i) =>
      poner(s, i, wx(o.x + o.w / 2), 0.015, wz(o.y + o.h / 2) + 0.12, o.w * U * 1.1, 1, o.h * U * 0.9)
    );
    s.instanceMatrix.needsUpdate = true;
    g.add(s);
  }

  return g;
}

// ── Bolsa ───────────────────────────────────────────────────────────────────

export interface BolsaVista {
  grupo: Group;
  cuerpo: Group;
  brillo: Mesh;
}

export function crearBolsa(): BolsaVista {
  const grupo = new Group();

  const sombra = new Mesh(new CircleGeometry(0.62, 12).rotateX(-Math.PI / 2), MAT_SOMBRA);
  sombra.position.y = 0.02;
  grupo.add(sombra);

  // Halo que se enciende al acercarse: la anticipación de la que habla el plan
  const brillo = new Mesh(
    new CircleGeometry(1.15, 16).rotateX(-Math.PI / 2),
    new MeshBasicMaterial({ color: 0xfff0a8, transparent: true, opacity: 0, depthWrite: false })
  );
  brillo.position.y = 0.04;
  grupo.add(brillo);

  const cuerpo = new Group();
  const bulto = new Mesh(new IcosahedronGeometry(0.58, 0), mat(COL.bolsa));
  bulto.scale.set(1, 0.92, 1);
  bulto.position.y = 0.52;
  cuerpo.add(bulto);
  const cuello = new Mesh(new CylinderGeometry(0.14, 0.24, 0.3, 6), mat(COL.bolsa));
  cuello.position.y = 1.02;
  cuerpo.add(cuello);
  // Lazo amarillo: es lo que impide que una bolsa oscura se pierda sobre el
  // pasto verde. Ya cumplía esa función en la versión 2D.
  const lazo = new Mesh(new CylinderGeometry(0.17, 0.17, 0.1, 8), mat(COL.lazo));
  lazo.position.y = 1.15;
  cuerpo.add(lazo);

  grupo.add(cuerpo);
  return { grupo, cuerpo, brillo };
}

// ── Carretilla ──────────────────────────────────────────────────────────────

export interface CarretillaVista {
  grupo: Group;
  aura: Mesh;
  capas: Mesh[];
}

export function crearCarretilla(): CarretillaVista {
  const grupo = new Group();

  const sombra = new Mesh(new CircleGeometry(1.5, 14).rotateX(-Math.PI / 2), MAT_SOMBRA);
  sombra.position.y = 0.02;
  sombra.scale.set(1, 1, 0.7);
  grupo.add(sombra);

  const aura = new Mesh(
    new CircleGeometry(1.9, 20).rotateX(-Math.PI / 2),
    new MeshBasicMaterial({ color: 0xfff2b0, transparent: true, opacity: 0, depthWrite: false })
  );
  aura.position.y = 0.05;
  grupo.add(aura);

  const matMetal = mat(COL.metal);

  // Tolva: una caja abierta, algo más ancha arriba
  const tolva = new Mesh(new CylinderGeometry(1.15, 0.85, 0.8, 4), mat(COL.tolva));
  tolva.rotation.y = Math.PI / 4;
  tolva.position.y = 0.72;
  grupo.add(tolva);

  const rueda = new Mesh(new CylinderGeometry(0.32, 0.32, 0.18, 10), mat(0x4a4038));
  rueda.rotation.z = Math.PI / 2;
  rueda.position.set(0, 0.32, -1.05);
  grupo.add(rueda);

  for (const lado of [-0.72, 0.72]) {
    const mango = new Mesh(new BoxGeometry(0.11, 0.11, 2.7), matMetal);
    mango.position.set(lado, 0.62, 0.55);
    grupo.add(mango);
    const pata = new Mesh(new BoxGeometry(0.11, 0.55, 0.11), matMetal);
    pata.position.set(lado, 0.28, 1.25);
    grupo.add(pata);
  }

  // Montón que crece con cada entrega: el marcador de progreso del juego.
  const capas: Mesh[] = [];
  for (let i = 0; i < 5; i++) {
    const ultima = i === 4;
    const c = new Mesh(
      new BoxGeometry(1.5 - i * 0.1, 0.24, 1.5 - i * 0.1),
      mat(ultima ? COL.cartonDorado : COL.carton)
    );
    c.position.y = 1.02 + i * 0.2;
    c.rotation.y = i * 0.4;
    c.visible = false;
    grupo.add(c);
    capas.push(c);
  }

  return { grupo, aura, capas };
}

// ── Ciudadano ───────────────────────────────────────────────────────────────

export interface CiudadanoVista {
  grupo: Group;
  cuerpo: Group;
  torso: Mesh;
  cabeza: Group;
  piernaIzq: Mesh;
  piernaDer: Mesh;
  brazoIzq: Mesh;
  brazoDer: Mesh;
  bolsaHombro: Group;
  sombra: Mesh;
}

export function crearCiudadano(): CiudadanoVista {
  const grupo = new Group();

  const sombra = new Mesh(new CircleGeometry(0.5, 12).rotateX(-Math.PI / 2), MAT_SOMBRA);
  sombra.position.y = 0.02;
  sombra.scale.set(1, 1, 0.75);
  grupo.add(sombra);

  // `cuerpo` es lo que se inclina y hace squash; el grupo exterior solo se
  // mueve y gira. Separarlos evita que la inclinación arrastre la sombra.
  const cuerpo = new Group();

  const piernaIzq = new Mesh(new BoxGeometry(0.2, 0.5, 0.22), mat(COL.pantalon));
  piernaIzq.position.set(-0.16, 0.25, 0);
  cuerpo.add(piernaIzq);
  const piernaDer = piernaIzq.clone();
  piernaDer.position.x = 0.16;
  cuerpo.add(piernaDer);

  const torso = new Mesh(new BoxGeometry(0.6, 0.62, 0.36), mat(COL.camisa));
  torso.position.y = 0.8;
  cuerpo.add(torso);

  const brazoIzq = new Mesh(new BoxGeometry(0.16, 0.5, 0.16), mat(COL.piel));
  brazoIzq.position.set(-0.4, 0.82, 0);
  cuerpo.add(brazoIzq);
  const brazoDer = brazoIzq.clone();
  brazoDer.position.x = 0.4;
  cuerpo.add(brazoDer);

  const cabeza = new Group();
  const craneo = new Mesh(new SphereGeometry(0.27, 8, 6), mat(COL.piel, { plano: false }));
  cabeza.add(craneo);
  const ala = new Mesh(new CylinderGeometry(0.46, 0.46, 0.05, 10), mat(COL.sombrero));
  ala.position.y = 0.16;
  cabeza.add(ala);
  const copa = new Mesh(new CylinderGeometry(0.24, 0.27, 0.24, 10), mat(COL.sombrero));
  copa.position.y = 0.28;
  cabeza.add(copa);
  cabeza.position.y = 1.36;
  cuerpo.add(cabeza);

  // La bolsa al hombro, con un cartón asomando: la promesa de lo que lleva
  const bolsaHombro = new Group();
  const bh = new Mesh(new IcosahedronGeometry(0.4, 0), mat(COL.bolsa));
  bolsaHombro.add(bh);
  const lazoH = new Mesh(new CylinderGeometry(0.12, 0.12, 0.08, 8), mat(COL.lazo));
  lazoH.position.y = 0.36;
  bolsaHombro.add(lazoH);
  const asoma = new Mesh(new BoxGeometry(0.3, 0.22, 0.05), mat(COL.carton));
  asoma.position.set(0.1, 0.42, 0.1);
  asoma.rotation.z = 0.4;
  bolsaHombro.add(asoma);
  bolsaHombro.position.set(-0.5, 1.15, 0.1);
  bolsaHombro.visible = false;
  cuerpo.add(bolsaHombro);

  grupo.add(cuerpo);

  return { grupo, cuerpo, torso, cabeza, piernaIzq, piernaDer, brazoIzq, brazoDer, bolsaHombro, sombra };
}

/** Un objeto suelto reutilizable para cálculos, para no crear basura por
 *  fotograma. */
export const TEMP = new Object3D();
