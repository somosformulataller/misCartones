// ============================================================================
// La escena en 3D: una CALLE de barrio a pleno día, en clave anime. Geometría
// low-poly generada por código: ni un archivo de modelo, ni una sola textura.
// Una casa es una caja con un tejado piramidal, un árbol dos conos sobre un
// cilindro, una lata un cilindro tumbado.
//
// ── Por qué sin texturas ──
// Una calle "de verdad" pide fotos de asfalto, ladrillo y teja. Eso son megas
// que descargar y memoria de vídeo que un teléfono flojo no tiene. El estilo
// anime juega a favor: se sostiene sobre COLOR PLANO y silueta, que es
// exactamente lo que sale gratis aquí. El asfalto no necesita grano; necesita
// ser de un gris azulado con manchas y dos rodadas más oscuras.
//
// ── Cómo se mantiene barato en un teléfono flojo ──
// Lo que hunde los fps en 3D móvil no son los polígonos: son las LLAMADAS DE
// DIBUJO, las sombras en tiempo real y el relleno de transparencias. Aquí:
//   · Todo lo repetido (casas, ventanas, árboles, postes, basura, obstáculos,
//     cartones) va en InstancedMesh: 48 casas cuestan DOS llamadas.
//   · Cero sombras en tiempo real. Cada objeto lleva una mancha oscura plana
//     debajo, que cuesta un círculo diminuto en vez de redibujar la escena.
//   · MeshLambertMaterial con caras planas. Nada de PBR.
//   · Una luz direccional y una hemisférica. Ni post-procesado.
// La escena entera queda en unas 45 llamadas y ~14.000 triángulos.
// ============================================================================

import {
  BoxGeometry,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
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
  TorusGeometry,
  Vector3,
} from 'three';
import { PLAY, World, WorldObstacle } from '@/lib/game/world';

// ── Conversión de coordenadas ───────────────────────────────────────────────
// La simulación NO cambia: sigue en píxeles lógicos X/Y, igual que en 2D. Aquí
// solo se traduce a metros del mundo 3D, con el centro de la calle en el
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

// ── Trazado de la calle ─────────────────────────────────────────────────────
// El área jugable ES la calzada: el ciudadano camina de bordillo a bordillo.
// Las aceras empiezan justo donde acaba lo jugable, así el borde del juego
// tiene una razón visible en la escena en vez de ser una pared invisible.
const MEDIA_CALZADA = ANCHO / 2 + 0.2;
const ANCHO_ACERA = 2.7;
/** Donde acaba la acera y empiezan las casas. */
const LINEA_CASAS = MEDIA_CALZADA + ANCHO_ACERA;
/** La calle sigue mucho más allá de lo jugable: se pierde en la neblina. */
const LARGO_CALLE = 220;

/**
 * Paleta ANIME. Los colores están deliberadamente sobresaturados respecto a lo
 * que sería "realista": con la iluminación por debajo de 1 (ver las luces en
 * game.ts) el material se ve casi tal cual, así que la saturación tiene que
 * venir de aquí. Subirla con las luces en vez de con la paleta hace lo
 * contrario de lo que parece: lava los colores hacia el blanco.
 */
export const COL = {
  // Calle
  asfalto: 0x767c8b,
  asfaltoClaro: 0x8b91a0,
  asfaltoOscuro: 0x5e6472,
  rodada: 0x5a606d,
  linea: 0xf4f6fa,
  acera: 0xcfc9bb,
  aceraOscura: 0xb0a99a,
  bordillo: 0xe6e0d2,
  suelo: 0x9aa1ad,
  // Casas: el color de la escena vive aquí. Un barrio se lee por sus fachadas.
  paredA: 0xf5a23c,
  paredB: 0xf2d84e,
  paredC: 0xe0654a,
  paredD: 0x63c9dd,
  paredE: 0xf2efe2,
  tejaA: 0xd8543a,
  tejaB: 0xb8452f,
  tejaC: 0x8f97a6,
  ventana: 0xa9e2f7,
  // Vegetación
  copa: 0x35c23f,
  copaClara: 0x74e659,
  tronco: 0x8f5a2a,
  // Poste y cables
  poste: 0x8d8074,
  cable: 0x33363f,
  // Basura suelta: los puntos de color sobre el gris del asfalto
  papel: 0xffffff,
  papelCrema: 0xf0dfae,
  botellaVerde: 0x3ddc84,
  botellaAzul: 0x4fb8ff,
  lataRoja: 0xff3b30,
  lataAzul: 0x2f6df0,
  cartonSuelto: 0xd99b52,
  // Obstáculos de calle
  escombro: 0xa8b0bc,
  palet: 0xc8944e,
  rueda: 0x2c2f36,
  caja: 0xcf9a55,
  cono: 0xff6a10,
  charco: 0x4a5768,
  // Ciudadano
  camisa: 0x1fb6f0,
  chaleco: 0xff8a1f,
  reflectante: 0xeef4f8,
  pantalon: 0x2f4bc9,
  piel: 0xffc48f,
  gorra: 0x2b3a57,
  // Bolsa: negra como una bolsa de basura de verdad. Lo que impide que se
  // pierda sobre el asfalto gris no es su color, es el LAZO amarillo y el
  // halo que se enciende al acercarse.
  bolsa: 0x24262d,
  bolsaClara: 0x565d6d,
  lazo: 0xffe816,
  // Cartones
  carton: 0xffab33,
  cartonDorado: 0xffd60a,
  // Carretilla
  metal: 0xd8e0e8,
  tolva: 0xff6a10,
} as const;

/** Material low-poly: una sola luz por píxel y caras planas. Es lo más barato
 *  que existe que siga reaccionando a la luz. */
const mat = (color: number, opts: { plano?: boolean } = {}) =>
  new MeshLambertMaterial({ color, flatShading: opts.plano ?? true });

/** Mancha de sombra: sustituye a las sombras en tiempo real, que en móvil
 *  cuestan redibujar la escena entera por cada luz. Azulada, no negra: una
 *  sombra neutra sobre asfalto gris ensucia; esta se lee como sombra de sol. */
const MAT_SOMBRA = new MeshBasicMaterial({
  color: 0x1e2433,
  transparent: true,
  opacity: 0.26,
  depthWrite: false,
});

const _m = new Matrix4();
const _p = new Vector3();
const _q = new Quaternion();
const _e = new Vector3(1, 1, 1);
const _c = new Color();
const EJE_Y = new Vector3(0, 1, 0);

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
  _q.setFromAxisAngle(EJE_Y, rotY);
  _e.set(ex, ey, ez);
  _m.compose(_p, _q, _e);
  malla.setMatrixAt(i, _m);
}

// ── Suelo ───────────────────────────────────────────────────────────────────

/**
 * La calle: losa lejana, calzada, aceras y pintura.
 *
 * La calzada lleva el color en los VÉRTICES, así el asfalto tiene manchas,
 * parches y dos rodadas más oscuras sin usar ni una textura y en UNA llamada
 * de dibujo. Las aceras y las líneas, en cambio, son mallas aparte: sus bordes
 * tienen que ser RECTOS y limpios, y un plano subdividido no da ese filo salvo
 * con una malla densísima.
 */
export function crearSuelo(rnd: () => number): Group {
  const g = new Group();

  // ── Suelo LEJANO ──
  // Una losa enorme y lisa por debajo de todo. Existe por un motivo muy
  // concreto: cuando la cámara se aleja para encuadrar la calle en una
  // pantalla ancha, ve MÁS ALLÁ del borde de la escena, y detrás no hay nada —
  // se veía el fondo ocupando media pantalla. Con esta losa el suelo no se
  // acaba nunca dentro de lo que la cámara alcanza a ver, y la neblina se
  // encarga de que su borde real quede fuera de alcance.
  // Cuesta 128 triángulos y una llamada de dibujo.
  const lejano = new Mesh(
    new PlaneGeometry(320, 320, 8, 8).rotateX(-Math.PI / 2),
    new MeshLambertMaterial({ color: COL.suelo, flatShading: true })
  );
  lejano.position.y = -0.1;
  g.add(lejano);

  // ── Calzada ──
  const geo = new PlaneGeometry(MEDIA_CALZADA * 2, LARGO_CALLE, 18, 96);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position;
  const colores: number[] = [];
  const base = new Color(COL.asfalto);
  const claro = new Color(COL.asfaltoClaro);
  const oscuro = new Color(COL.asfaltoOscuro);
  const rodada = new Color(COL.rodada);

  // Parches de asfalto reciente y zonas gastadas: un asfalto liso se lee como
  // plástico. Estas manchas son lo que le da edad a la calle.
  const parches = Array.from({ length: 26 }, () => ({
    x: (rnd() - 0.5) * MEDIA_CALZADA * 2,
    z: (rnd() - 0.5) * LARGO_CALLE,
    r: 0.9 + rnd() * 2.6,
    nuevo: rnd() > 0.5,
  }));

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);

    _c.copy(rnd() > 0.55 ? base : rnd() > 0.5 ? claro : oscuro);

    for (const p of parches) {
      const d = Math.hypot(x - p.x, z - p.z);
      if (d < p.r) _c.lerp(p.nuevo ? oscuro : claro, (1 - d / p.r) * 0.7);
    }

    // Las dos rodadas: por donde pasan las ruedas el asfalto está más pulido y
    // oscuro. Son dos bandas simétricas, y es el detalle que más hace por que
    // la calzada se lea como una calle transitada y no como un suelo gris.
    const dr = Math.abs(Math.abs(x) - MEDIA_CALZADA * 0.46);
    if (dr < 0.95) _c.lerp(rodada, (1 - dr / 0.95) * 0.55);

    // Plana del todo, pero no perfecta: una micro-ondulación rompe el brillo
    // uniforme sin que se note un bache.
    pos.setY(i, Math.sin(x * 1.7) * 0.012 + Math.cos(z * 1.1) * 0.012);

    colores.push(_c.r, _c.g, _c.b);
  }

  geo.setAttribute('color', new Float32BufferAttribute(colores, 3));
  geo.computeVertexNormals();
  g.add(new Mesh(geo, new MeshLambertMaterial({ vertexColors: true, flatShading: true })));

  // ── Aceras ──
  // Un cajón elevado por lado, con el bordillo (la cara superior del filo) en
  // un tono más claro para que el escalón se lea desde arriba.
  const geoAcera = new BoxGeometry(ANCHO_ACERA, 0.18, LARGO_CALLE);
  const matAcera = mat(COL.acera);
  const geoBordillo = new BoxGeometry(0.34, 0.2, LARGO_CALLE);
  const matBordillo = mat(COL.bordillo);
  for (const lado of [-1, 1]) {
    const a = new Mesh(geoAcera, matAcera);
    a.position.set(lado * (MEDIA_CALZADA + ANCHO_ACERA / 2), 0.09, 0);
    g.add(a);
    const b = new Mesh(geoBordillo, matBordillo);
    b.position.set(lado * (MEDIA_CALZADA + 0.17), 0.1, 0);
    g.add(b);
  }

  // Juntas de las losetas de la acera: rayas transversales instanciadas. Una
  // llamada de dibujo, y es lo que impide que la acera parezca una cinta lisa.
  const nJuntas = Math.floor(LARGO_CALLE / 2.4);
  const juntas = new InstancedMesh(
    new BoxGeometry(ANCHO_ACERA, 0.02, 0.07),
    mat(COL.aceraOscura),
    nJuntas * 2
  );
  for (let i = 0; i < nJuntas; i++) {
    const z = -LARGO_CALLE / 2 + i * 2.4;
    for (const [k, lado] of [-1, 1].entries()) {
      poner(juntas, i * 2 + k, lado * (MEDIA_CALZADA + ANCHO_ACERA / 2), 0.19, z, 1, 1, 1);
    }
  }
  juntas.instanceMatrix.needsUpdate = true;
  g.add(juntas);

  // ── Pintura ──
  // Discontinua central. Va a y=0,02 sobre la calzada: separarla en vez de
  // pintarla en los vértices evita el parpadeo por z-fighting y, sobre todo,
  // da un borde recto que un plano subdividido no puede dar.
  const matLinea = mat(COL.linea, { plano: false });
  const nRayas = Math.floor(LARGO_CALLE / 3.4);
  const rayas = new InstancedMesh(new BoxGeometry(0.17, 0.02, 1.7), matLinea, nRayas);
  for (let i = 0; i < nRayas; i++) {
    poner(rayas, i, 0, 0.02, -LARGO_CALLE / 2 + i * 3.4, 1, 1, 1);
  }
  rayas.instanceMatrix.needsUpdate = true;
  g.add(rayas);

  // Líneas continuas de borde
  for (const lado of [-1, 1]) {
    const l = new Mesh(new BoxGeometry(0.14, 0.02, LARGO_CALLE), matLinea);
    l.position.set(lado * (MEDIA_CALZADA - 0.6), 0.02, 0);
    g.add(l);
  }

  return g;
}

// ── Ciudad: casas, postes y cables ──────────────────────────────────────────

/**
 * Las dos hileras de casas, los postes de la luz con sus cables cruzando, y un
 * anillo de bloques lejanos.
 *
 * Los bloques lejanos no son decoración: sin ellos el horizonte es una franja
 * gris lisa y la calle parece flotar en el vacío. Con ellos el barrio continúa
 * más allá de donde se juega, que es lo que pide la referencia.
 */
export function crearCiudad(rnd: () => number): Group {
  const g = new Group();

  interface Casa {
    x: number;
    z: number;
    ancho: number;
    fondo: number;
    alto: number;
    lado: number;
    pared: number;
    teja: number;
    altoTejado: number;
  }

  const paredes = [COL.paredA, COL.paredB, COL.paredC, COL.paredD, COL.paredE];
  const tejas = [COL.tejaA, COL.tejaB, COL.tejaC];

  const casas: Casa[] = [];
  for (const lado of [-1, 1]) {
    // Se empieza desplazado en cada lado para que las dos hileras no queden
    // enfrentadas casa a casa, que se ve artificial desde arriba.
    let z = -66 + rnd() * 4 + (lado > 0 ? 3.5 : 0);
    while (z < 66) {
      const ancho = 5 + rnd() * 4; // a lo largo de la calle
      const fondo = 7 + rnd() * 4.5; // hacia dentro de la manzana
      casas.push({
        x: lado * (LINEA_CASAS + fondo / 2),
        z: z + ancho / 2,
        ancho,
        fondo,
        alto: 3.1 + rnd() * 2.9,
        lado,
        pared: paredes[Math.floor(rnd() * paredes.length)],
        teja: tejas[Math.floor(rnd() * tejas.length)],
        altoTejado: 1 + rnd() * 0.8,
      });
      z += ancho + 0.35 + rnd() * 0.5;
    }
  }

  // Muros. Una caja por casa, todas en una llamada de dibujo.
  const muros = new InstancedMesh(new BoxGeometry(1, 1, 1), mat(COL.paredA), casas.length);
  // Tejado a cuatro aguas: un cono de 4 lados es una pirámide de base cuadrada
  // girada 45°. Al girarla otros 45° queda alineada con la casa. La base de esa
  // pirámide tiene medio lado = radio/√2, así que para cubrir un fondo D con
  // un 15 % de vuelo hay que escalar D·0,575/0,707 = D·0,813.
  const tejados = new InstancedMesh(
    new ConeGeometry(1, 1, 4).rotateY(Math.PI / 4),
    mat(COL.tejaA),
    casas.length
  );

  casas.forEach((c, i) => {
    poner(muros, i, c.x, c.alto / 2, c.z, c.fondo, c.alto, c.ancho);
    muros.setColorAt(i, _c.set(c.pared));
    poner(
      tejados,
      i,
      c.x,
      c.alto + c.altoTejado / 2,
      c.z,
      c.fondo * 0.813,
      c.altoTejado,
      c.ancho * 0.813
    );
    tejados.setColorAt(i, _c.set(c.teja));
  });
  muros.instanceMatrix.needsUpdate = true;
  tejados.instanceMatrix.needsUpdate = true;
  if (muros.instanceColor) muros.instanceColor.needsUpdate = true;
  if (tejados.instanceColor) tejados.instanceColor.needsUpdate = true;
  g.add(muros, tejados);

  // Ventanas y puertas en la fachada que da a la calle. Van por FUERA del muro
  // (medio grosor más allá de la cara), no empotradas: empotrarlas provoca
  // z-fighting con la pared y hace que parpadeen al girar la cámara.
  const huecos: { x: number; y: number; z: number; alto: number; ancho: number }[] = [];
  for (const c of casas) {
    const cara = c.lado * (LINEA_CASAS + 0.05);
    const n = 1 + Math.floor(rnd() * 3);
    for (let k = 0; k < n; k++) {
      huecos.push({
        x: cara,
        y: 1.1 + rnd() * Math.max(0.2, c.alto - 2.1),
        z: c.z + (k - (n - 1) / 2) * (c.ancho / (n + 0.4)),
        alto: 0.75,
        ancho: 0.85,
      });
    }
  }
  const ventanas = new InstancedMesh(new BoxGeometry(0.1, 1, 1), mat(COL.ventana), huecos.length);
  huecos.forEach((h, i) => poner(ventanas, i, h.x, h.y, h.z, 1, h.alto, h.ancho));
  ventanas.instanceMatrix.needsUpdate = true;
  g.add(ventanas);

  // ── Postes de la luz ──
  // Solo en un lado, como en la calle de la referencia.
  const zPostes: number[] = [];
  for (let z = -55; z <= 55; z += 11) zPostes.push(z);
  const xPoste = LINEA_CASAS - 0.55;

  const postes = new InstancedMesh(
    new CylinderGeometry(0.11, 0.16, 5.8, 6),
    mat(COL.poste),
    zPostes.length
  );
  const brazos = new InstancedMesh(
    new BoxGeometry(0.09, 0.09, 1.7),
    mat(COL.poste),
    zPostes.length * 2
  );
  zPostes.forEach((z, i) => {
    poner(postes, i, xPoste, 2.9, z, 1, 1, 1);
    poner(brazos, i * 2, xPoste, 5.1, z, 1, 1, 1);
    poner(brazos, i * 2 + 1, xPoste, 4.6, z, 1, 1, 1);
  });
  postes.instanceMatrix.needsUpdate = true;
  brazos.instanceMatrix.needsUpdate = true;
  g.add(postes, brazos);

  // ── Cables ──
  // Cajas larguísimas y finísimas. Cruzan por encima de la escena y, vistos
  // desde la cámara cenital, dibujan líneas sobre la calle: es una de las
  // señas de identidad del encuadre de la referencia y cuesta 5 cajas.
  const matCable = mat(COL.cable, { plano: false });
  const largoCable = LARGO_CALLE * 0.7;
  for (const [dx, y] of [
    [-0.55, 5.08],
    [0, 5.12],
    [0.55, 5.06],
    [-0.3, 4.62],
  ] as const) {
    const cable = new Mesh(new BoxGeometry(0.05, 0.05, largoCable), matCable);
    cable.position.set(xPoste + dx, y, 0);
    g.add(cable);
  }
  // Dos cables cruzando la calle hacia el otro lado: rompen la simetría y
  // dan profundidad al encuadre.
  for (const z of [-14, 21]) {
    const cruce = new Mesh(new BoxGeometry(0.05, 0.05, LINEA_CASAS * 2.1), matCable);
    cruce.rotation.y = Math.PI / 2;
    cruce.position.set(0, 4.9, z);
    cruce.rotation.z = 0.02;
    g.add(cruce);
  }

  // ── Bloques lejanos ──
  // A los lados, nunca dentro del corredor de la calle: el fondo de la calle
  // tiene que quedar abierto para que se pierda en la neblina, que es lo que
  // da la sensación de que el barrio sigue.
  const nBloques = 70;
  const bloques = new InstancedMesh(new BoxGeometry(1, 1, 1), mat(COL.paredE), nBloques);
  const techos = new InstancedMesh(
    new ConeGeometry(1, 1, 4).rotateY(Math.PI / 4),
    mat(COL.tejaB),
    nBloques
  );
  for (let i = 0; i < nBloques; i++) {
    const x = (rnd() > 0.5 ? 1 : -1) * (22 + rnd() * 72);
    const z = (rnd() - 0.5) * 190;
    const alto = 3 + rnd() * 6;
    const ancho = 5 + rnd() * 7;
    const fondo = 5 + rnd() * 7;
    poner(bloques, i, x, alto / 2, z, fondo, alto, ancho, rnd() * 0.4);
    bloques.setColorAt(i, _c.set(paredes[Math.floor(rnd() * paredes.length)]));
    poner(techos, i, x, alto + 0.5, z, fondo * 0.813, 1, ancho * 0.813, 0);
    techos.setColorAt(i, _c.set(tejas[Math.floor(rnd() * tejas.length)]));
  }
  bloques.instanceMatrix.needsUpdate = true;
  techos.instanceMatrix.needsUpdate = true;
  if (bloques.instanceColor) bloques.instanceColor.needsUpdate = true;
  if (techos.instanceColor) techos.instanceColor.needsUpdate = true;
  g.add(bloques, techos);

  return g;
}

// ── Árboles y basura suelta ─────────────────────────────────────────────────

export interface Vegetacion {
  grupo: Group;
  /** Copas de los árboles: se mecen. Guardadas para animarlas. */
  copas: { malla: InstancedMesh; datos: { x: number; z: number; e: number; fase: number }[] };
}

/**
 * Los árboles de la acera y la basura tirada por la calle.
 *
 * La basura suelta (papeles, botellas, latas, cartones) es lo que separa esta
 * escena de "una calle limpia con cinco bolsas encima". No estorba, no
 * colisiona y no se puede recoger: es puro decorado. Pero es lo que cuenta de
 * un vistazo por qué hay alguien ahí con una carretilla.
 *
 * Todo instanciado: unas 6 llamadas de dibujo para varios cientos de objetos.
 */
export function crearVegetacion(rnd: () => number, world: World): Vegetacion {
  const grupo = new Group();

  // ── Árboles de la acera ──
  const arboles: { x: number; z: number; e: number; fase: number }[] = [];
  const xArbol = MEDIA_CALZADA + ANCHO_ACERA * 0.52;
  for (const lado of [-1, 1]) {
    for (let z = -40 + rnd() * 5; z < 40; z += 7.5 + rnd() * 3.5) {
      arboles.push({
        x: lado * xArbol,
        z,
        e: 0.95 + rnd() * 0.5,
        fase: rnd() * Math.PI * 2,
      });
    }
  }

  // Arboleda LEJANA, por detrás de las casas: da textura al horizonte. Está
  // fuera de todo lo jugable y la neblina se la va comiendo con la distancia.
  for (let i = 0; i < 46; i++) {
    arboles.push({
      x: (rnd() > 0.5 ? 1 : -1) * (18 + rnd() * 70),
      z: (rnd() - 0.5) * 180,
      e: 1.2 + rnd() * 1.2,
      fase: rnd() * Math.PI * 2,
    });
  }

  const troncos = new InstancedMesh(
    new CylinderGeometry(0.16, 0.24, 1.9, 6),
    mat(COL.tronco),
    arboles.length
  );
  const copas = new InstancedMesh(new ConeGeometry(1.15, 2.4, 7), mat(COL.copa), arboles.length * 2);

  arboles.forEach((a, i) => {
    poner(troncos, i, a.x, 0.95 * a.e, a.z, a.e, a.e, a.e);
    // Dos conos apilados y girados: da una silueta menos de "arbolito de
    // Navidad" y más de copa frondosa, por el mismo precio.
    poner(copas, i * 2, a.x, (1.9 + 1.0) * a.e, a.z, a.e * 1.2, a.e, a.e * 1.2, rnd() * 3);
    poner(copas, i * 2 + 1, a.x, (1.9 + 1.9) * a.e, a.z, a.e * 0.85, a.e * 0.9, a.e * 0.85, rnd() * 3);
    copas.setColorAt(i * 2, _c.set(COL.copa));
    copas.setColorAt(i * 2 + 1, _c.set(COL.copaClara));
  });
  troncos.instanceMatrix.needsUpdate = true;
  copas.instanceMatrix.needsUpdate = true;
  if (copas.instanceColor) copas.instanceColor.needsUpdate = true;
  grupo.add(troncos, copas);

  const sombrasArbol = new InstancedMesh(
    new CircleGeometry(1, 10).rotateX(-Math.PI / 2),
    MAT_SOMBRA,
    arboles.length
  );
  arboles.forEach((a, i) => poner(sombrasArbol, i, a.x, 0.2, a.z, a.e, 1, a.e));
  sombrasArbol.instanceMatrix.needsUpdate = true;
  grupo.add(sombrasArbol);

  // ── Basura suelta ──
  const cartX = wx(world.cart.x);
  const cartZ = wz(world.cart.y);
  /** Un punto al azar de la calle, nunca encima de la carretilla. */
  const puntoLibre = (radio: number): [number, number] | null => {
    for (let t = 0; t < 8; t++) {
      const x = (rnd() - 0.5) * (MEDIA_CALZADA * 2 + ANCHO_ACERA * 1.6);
      const z = (rnd() - 0.5) * (FONDO + 26);
      if (Math.hypot(x - cartX, z - cartZ) > radio) return [x, z];
    }
    return null;
  };
  /** ¿Está sobre la acera? Sirve para levantar la basura ese escalón. */
  const altura = (x: number) => (Math.abs(x) > MEDIA_CALZADA ? 0.18 : 0);

  // Papeles y cartones: chapas finas tumbadas, giradas al azar.
  const nPapeles = 130;
  const papeles = new InstancedMesh(new BoxGeometry(0.34, 0.02, 0.26), mat(COL.papel), nPapeles);
  const tonosPapel = [COL.papel, COL.papel, COL.papelCrema, COL.cartonSuelto];
  let iP = 0;
  for (let i = 0; i < nPapeles; i++) {
    const p = puntoLibre(1.9);
    if (!p) continue;
    const e = 0.7 + rnd() * 1.1;
    poner(papeles, iP, p[0], altura(p[0]) + 0.012, p[1], e, 1, e, rnd() * 3.14);
    papeles.setColorAt(iP, _c.set(tonosPapel[Math.floor(rnd() * tonosPapel.length)]));
    iP++;
  }
  for (let i = iP; i < nPapeles; i++) poner(papeles, i, 0, -50, 0, 0, 0, 0);
  papeles.instanceMatrix.needsUpdate = true;
  if (papeles.instanceColor) papeles.instanceColor.needsUpdate = true;
  grupo.add(papeles);

  // Botellas y latas: cilindros TUMBADOS. La geometría se gira una vez al
  // crearla, así que la instancia solo tiene que rotar sobre Y.
  const geoTumbado = new CylinderGeometry(0.075, 0.075, 0.3, 6).rotateZ(Math.PI / 2);
  const nEnvases = 90;
  const envases = new InstancedMesh(geoTumbado, mat(COL.botellaVerde), nEnvases);
  const tonosEnvase = [COL.botellaVerde, COL.botellaAzul, COL.lataRoja, COL.lataAzul, COL.papel];
  let iE = 0;
  for (let i = 0; i < nEnvases; i++) {
    const p = puntoLibre(1.9);
    if (!p) continue;
    const largo = 0.85 + rnd() * 0.8;
    poner(envases, iE, p[0], altura(p[0]) + 0.075, p[1], largo, 1, 1, rnd() * 3.14);
    envases.setColorAt(iE, _c.set(tonosEnvase[Math.floor(rnd() * tonosEnvase.length)]));
    iE++;
  }
  for (let i = iE; i < nEnvases; i++) poner(envases, i, 0, -50, 0, 0, 0, 0);
  envases.instanceMatrix.needsUpdate = true;
  if (envases.instanceColor) envases.instanceColor.needsUpdate = true;
  grupo.add(envases);

  // Montoncitos de basura contra el bordillo: es donde se acumula de verdad,
  // y colocarlos ahí en vez de al azar es lo que hace que la calle se lea
  // como una calle y no como un tablero con cosas encima.
  const nMonton = 22;
  const montones = new InstancedMesh(
    new IcosahedronGeometry(0.36, 0),
    mat(COL.cartonSuelto),
    nMonton
  );
  const tonosMonton = [COL.cartonSuelto, COL.papelCrema, COL.papel, COL.botellaVerde];
  for (let i = 0; i < nMonton; i++) {
    const lado = rnd() > 0.5 ? 1 : -1;
    const x = lado * (MEDIA_CALZADA - 0.15 - rnd() * 0.5);
    const z = (rnd() - 0.5) * (FONDO + 30);
    poner(montones, i, x, 0.16, z, 1 + rnd() * 0.8, 0.6 + rnd() * 0.4, 1 + rnd() * 0.8, rnd() * 3);
    montones.setColorAt(i, _c.set(tonosMonton[Math.floor(rnd() * tonosMonton.length)]));
  }
  montones.instanceMatrix.needsUpdate = true;
  if (montones.instanceColor) montones.instanceColor.needsUpdate = true;
  grupo.add(montones);

  return { grupo, copas: { malla: copas, datos: arboles } };
}

// ── Obstáculos ──────────────────────────────────────────────────────────────

/** Lo que estorba en la calzada, agrupado por tipo en InstancedMesh: como
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
      case 'escombro':
        // Cascotes de obra: un icosaedro de caras planas.
        malla = new InstancedMesh(new IcosahedronGeometry(0.5, 0), mat(COL.escombro), n);
        lista.forEach((o, i) => {
          const cw = o.w * U;
          const ch = o.h * U;
          poner(malla, i, wx(o.x + o.w / 2), ch * 0.42, wz(o.y + o.h / 2), cw, ch * 1.1, ch, i);
        });
        sombras.push(...lista);
        break;

      case 'palet': {
        // Palé tirado: una tabla gruesa, ligeramente girada.
        malla = new InstancedMesh(new BoxGeometry(1, 0.22, 1), mat(COL.palet), n);
        lista.forEach((o, i) => {
          poner(malla, i, wx(o.x + o.w / 2), 0.12, wz(o.y + o.h / 2), o.w * U, 1, o.h * U * 1.6, 0.2);
        });
        sombras.push(...lista);
        break;
      }

      case 'rueda': {
        // Neumático viejo: un toro tumbado. Desde la cámara cenital el agujero
        // del centro es lo que lo hace reconocible al instante.
        const geo = new TorusGeometry(0.34, 0.15, 6, 12).rotateX(-Math.PI / 2);
        malla = new InstancedMesh(geo, mat(COL.rueda), n);
        lista.forEach((o, i) => {
          poner(malla, i, wx(o.x + o.w / 2), 0.15, wz(o.y + o.h / 2), o.w * U * 1.1, 1, o.w * U * 1.1);
        });
        sombras.push(...lista);
        break;
      }

      case 'caja':
        malla = new InstancedMesh(new BoxGeometry(1, 1, 1), mat(COL.caja), n);
        lista.forEach((o, i) => {
          poner(
            malla,
            i,
            wx(o.x + o.w / 2),
            o.h * U * 0.5,
            wz(o.y + o.h / 2),
            o.w * U,
            o.h * U,
            o.h * U,
            (i % 5) * 0.22
          );
        });
        sombras.push(...lista);
        break;

      case 'cono': {
        // Cono de obra: naranja chillón. Es el obstáculo más visible, y eso
        // está bien: es el que más ocupa.
        malla = new InstancedMesh(new ConeGeometry(0.5, 1, 8), mat(COL.cono), n);
        lista.forEach((o, i) => {
          poner(malla, i, wx(o.x + o.w / 2), o.h * U * 0.5, wz(o.y + o.h / 2), o.w * U, o.h * U, o.w * U);
        });
        sombras.push(...lista);
        break;
      }

      case 'charco':
      default:
        // El charco NO bloquea: se pisa. Por eso va plano contra el suelo.
        malla = new InstancedMesh(
          new CircleGeometry(0.5, 12).rotateX(-Math.PI / 2),
          new MeshLambertMaterial({ color: COL.charco }),
          n
        );
        lista.forEach((o, i) => {
          poner(malla, i, wx(o.x + o.w / 2), 0.035, wz(o.y + o.h / 2), o.w * U, 1, o.h * U);
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
      poner(s, i, wx(o.x + o.w / 2), 0.03, wz(o.y + o.h / 2) + 0.12, o.w * U * 1.1, 1, o.h * U * 0.9)
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
  sombra.position.y = 0.025;
  grupo.add(sombra);

  // Halo que se enciende al acercarse: la anticipación de la que habla el plan.
  // Sobre asfalto gris hace falta más que sobre pasto, porque la bolsa es
  // oscura y el suelo también.
  const brillo = new Mesh(
    new CircleGeometry(1.15, 16).rotateX(-Math.PI / 2),
    new MeshBasicMaterial({ color: 0xfff0a8, transparent: true, opacity: 0, depthWrite: false })
  );
  brillo.position.y = 0.045;
  grupo.add(brillo);

  const cuerpo = new Group();
  const bulto = new Mesh(new IcosahedronGeometry(0.58, 0), mat(COL.bolsa));
  bulto.scale.set(1, 0.92, 1);
  bulto.position.y = 0.52;
  cuerpo.add(bulto);
  // Brillo: una segunda pieza más clara arriba. Sin ella la bolsa negra es una
  // silueta plana contra el asfalto; con ella se le ve el bulto y el plástico.
  const luz = new Mesh(new IcosahedronGeometry(0.31, 0), mat(COL.bolsaClara));
  luz.position.set(-0.2, 0.78, 0.2);
  cuerpo.add(luz);
  const cuello = new Mesh(new CylinderGeometry(0.14, 0.24, 0.3, 6), mat(COL.bolsa));
  cuello.position.y = 1.02;
  cuerpo.add(cuello);
  // Lazo amarillo: es lo que impide que una bolsa negra se pierda sobre el
  // asfalto. Ya cumplía esa función en la versión 2D.
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
  sombra.position.y = 0.025;
  sombra.scale.set(1, 1, 0.7);
  grupo.add(sombra);

  const aura = new Mesh(
    new CircleGeometry(1.9, 20).rotateX(-Math.PI / 2),
    new MeshBasicMaterial({ color: 0xfff2b0, transparent: true, opacity: 0, depthWrite: false })
  );
  aura.position.y = 0.055;
  grupo.add(aura);

  const matMetal = mat(COL.metal);

  // Tolva: una caja abierta, algo más ancha arriba
  const tolva = new Mesh(new CylinderGeometry(1.15, 0.85, 0.8, 4), mat(COL.tolva));
  tolva.rotation.y = Math.PI / 4;
  tolva.position.y = 0.72;
  grupo.add(tolva);

  const rueda = new Mesh(new CylinderGeometry(0.32, 0.32, 0.18, 10), mat(0x2c2f36));
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

/**
 * El barrendero. Lleva chaleco reflectante naranja por el mismo motivo que lo
 * llevan los de verdad: desde arriba, a distancia, es lo único que se ve. Con
 * camisa azul a secas el personaje se perdía sobre el asfalto gris.
 */
export function crearCiudadano(): CiudadanoVista {
  const grupo = new Group();

  const sombra = new Mesh(new CircleGeometry(0.5, 12).rotateX(-Math.PI / 2), MAT_SOMBRA);
  sombra.position.y = 0.03;
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

  // Chaleco: una caja un pelo mayor que el torso, para que la camisa asome por
  // los hombros y los costados.
  const chaleco = new Mesh(new BoxGeometry(0.64, 0.46, 0.42), mat(COL.chaleco));
  chaleco.position.y = 0.78;
  cuerpo.add(chaleco);
  const franja = new Mesh(new BoxGeometry(0.66, 0.08, 0.44), mat(COL.reflectante));
  franja.position.y = 0.78;
  cuerpo.add(franja);

  const brazoIzq = new Mesh(new BoxGeometry(0.16, 0.5, 0.16), mat(COL.piel));
  brazoIzq.position.set(-0.4, 0.82, 0);
  cuerpo.add(brazoIzq);
  const brazoDer = brazoIzq.clone();
  brazoDer.position.x = 0.4;
  cuerpo.add(brazoDer);

  const cabeza = new Group();
  const craneo = new Mesh(new SphereGeometry(0.27, 8, 6), mat(COL.piel, { plano: false }));
  cabeza.add(craneo);
  // Gorra: copa + visera. Se ve desde arriba, que es justo el ángulo del
  // juego, así que la visera es la que da la lectura de "hacia dónde mira".
  const copa = new Mesh(new SphereGeometry(0.28, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), mat(COL.gorra));
  copa.position.y = 0.06;
  cabeza.add(copa);
  const visera = new Mesh(new BoxGeometry(0.36, 0.05, 0.26), mat(COL.gorra));
  visera.position.set(0, 0.08, 0.26);
  cabeza.add(visera);
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
