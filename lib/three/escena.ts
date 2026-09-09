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
//   · Todo lo repetido (casas, edificios, ventanas, árboles, postes, basura,
//     obstáculos, cartones) va en InstancedMesh: las ~48 casas cuestan DOS
//     llamadas y sus ~350 ventanas, una.
//   · Cero sombras en tiempo real. Cada objeto lleva una mancha oscura plana
//     debajo, que cuesta un círculo diminuto en vez de redibujar la escena.
//   · MeshLambertMaterial con caras planas. Nada de PBR.
//   · Una luz direccional y una hemisférica. Ni post-procesado.
// La escena entera queda en unas 50 llamadas y ~18.000 triángulos.
// ============================================================================

import {
  BoxGeometry,
  BufferGeometry,
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
// Ruta relativa, no el alias '@/': el banco de pruebas compila este módulo con
// tsc a secas y tsc NO reescribe los alias de rutas al emitir. Con '@/' las
// pruebas no podrían cargar la escena, que es justo donde más falta hacen
// porque es lo único que no puedo comprobar mirando.
import { PLAY, World, WorldObstacle } from '../game/world';

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
// La acera es estrecha a propósito. Cada unidad que mide es una unidad que
// aleja la fachada del ojo, y el encuadre a lo ancho es el recurso más caro
// que hay: ensancharlo empequeñece el juego entero.
const ANCHO_ACERA = 1.7;
/** Donde acaba la acera y empiezan las casas. Se exporta porque las pruebas
 *  comprueban que esta línea entre en cámara en todas las pantallas. */
export const LINEA_CASAS = MEDIA_CALZADA + ANCHO_ACERA;
/** La calle sigue mucho más allá de lo jugable: se pierde en la neblina. */
const LARGO_CALLE = 220;

/**
 * Cuánto se agranda el ciudadano sobre su tamaño modelado.
 *
 * Con 1,0 el muñeco medía 1,63 unidades: correcto contra las casas, pero
 * diminuto en la pantalla, porque la cámara se aleja hasta 53 unidades para
 * encuadrar una calle de 24 de largo. En un juego el personaje tiene que
 * LEERSE, no estar a escala arquitectónica, así que se agranda hasta que su
 * ancho coincide con CITIZEN_RADIUS, el radio con el que choca de verdad.
 */
const ESCALA_CIUDADANO = 2.4;

/**
 * Lo mismo para la carretilla, y por el mismo motivo.
 *
 * Ensanchar el encuadre para que entraran las fachadas alejó la cámara un 24 %
 * en móvil, y los dos elementos que el jugador tiene que localizar de un
 * vistazo — el muñeco y su destino — quedaron demasiado pequeños en pantalla.
 * Como el radio de entrega es CART_RADIUS, la carretilla se agranda hasta que
 * su tolva vuelve a llenar ese radio: lo que se ve sigue siendo lo que cuenta.
 */
const ESCALA_CARRETILLA = 1.62;

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
  azotea: 0xb9b2a2,
  ventana: 0xa9e2f7,
  // Vegetación
  copa: 0x35c23f,
  copaClara: 0x74e659,
  tronco: 0x8f5a2a,
  // Poste y cables
  poste: 0x8d8074,
  cable: 0x33363f,
  // Basura suelta: los puntos de color sobre el gris del asfalto. Estos tonos
  // van a la INSTANCIA y multiplican al multiplicador de brillo guardado en el
  // vértice, así que son prácticamente el color final: conviene que sean
  // saturados, porque cada pieza ocupa pocos píxeles y el color es casi toda
  // la información que llega.
  papel: 0xffffff,
  papelCrema: 0xf0dfae,
  cartonSuelto: 0xd99b52,
  botellaVerde: 0x2fd46f,
  botellaAmbar: 0xd98a2b,
  botellaAzul: 0x4fb8ff,
  botellaRoja: 0xf0402f,
  botellaClara: 0xdff3f7,
  lataRoja: 0xff3b30,
  lataAzul: 0x2f6df0,
  lataPlata: 0xdfe4ea,
  brikNaranja: 0xff8a2b,
  brikAmarillo: 0xffd52e,
  brikRojo: 0xe03a52,
  brikVerde: 0x46c94f,
  plato: 0xfbfbf6,
  platoCrema: 0xf3e6c8,
  bandeja: 0xe8f0f5,
  comidaTomate: 0xe8452f,
  comidaMaiz: 0xffc53d,
  comidaVerde: 0x74c93a,
  comidaPan: 0xd9a45c,
  comidaCarne: 0xa8552f,
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
  // La cara. El ojo no es negro puro: a esta escala un negro absoluto sobre
  // piel clara vibra y se lee como un agujero.
  ojo: 0x23293a,
  brilloOjo: 0xffffff,
  boca: 0xb56b52,
  // Bolsa: negra como una bolsa de basura de verdad. Lo que impide que se
  // pierda sobre el asfalto gris no es su color, es el LAZO amarillo y el
  // halo que se enciende al acercarse.
  // Tres tonos, no uno: el plástico negro solo se lee como plástico si tiene
  // un degradado de la panza (en sombra) al hombro (a la luz) y un reflejo
  // duro arriba. Con un único negro la bolsa sale como una silueta plana.
  bolsa: 0x22242b,
  bolsaMedia: 0x3a3f4a,
  bolsaClara: 0x6a7182,
  lazo: 0xffe816,
  // Cartones
  carton: 0xffab33,
  cartonDorado: 0xffd60a,
  // Carretilla.
  //
  // Empezó NARANJA, y eso era medio problema: naranja son también los conos de
  // obra y el chaleco del ciudadano, así que el destino de la partida competía
  // en color con un obstáculo y con el propio jugador. Pasó por fucsia, que
  // resolvía la confusión pero no pegaba con una herramienta de obra.
  //
  // Ahora es ROJO BERMELLÓN, que es de hecho el color de media carretilla de
  // verdad. Es puro, sin el amarillo del naranja, así que no se confunde ni
  // con los conos ni con el chaleco; y es bastante más oscuro y saturado que
  // la teja de los tejados, que además queda lejos, fuera de la calzada.
  // Sobre el asfalto gris no hay forma de perderla, y el halo amarillo que se
  // enciende al cargar una bolsa contrasta con ella en vez de fundirse.
  //
  // La otra mitad son los CONTRASTES internos: el fondo en sombra contra el
  // labio claro del borde (es lo que dibuja el contorno desde arriba) y el
  // caucho negro de la rueda y los puños contra el metal del bastidor.
  metal: 0xd8e0e8,
  metalOscuro: 0x97a2b0,
  tolva: 0xd6202f,
  tolvaOscura: 0x7d0e1b,
  tolvaBorde: 0xff6f5e,
  neumatico: 0x25272e,
  llanta: 0xe9eef4,
  puno: 0x2b3a57,
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

  // ── Aceras y líneas de borde ──
  // Un cajón elevado por lado, con el bordillo (la cara superior del filo) en
  // un tono más claro para que el escalón se lea desde arriba, y la línea
  // continua pintada junto a él. Seis piezas fijas, una sola malla.
  g.add(
    new Mesh(
      fundir([
        { geo: new BoxGeometry(ANCHO_ACERA, 0.18, LARGO_CALLE).translate(-(MEDIA_CALZADA + ANCHO_ACERA / 2), 0.09, 0), color: COL.acera },
        { geo: new BoxGeometry(ANCHO_ACERA, 0.18, LARGO_CALLE).translate(MEDIA_CALZADA + ANCHO_ACERA / 2, 0.09, 0), color: COL.acera },
        { geo: new BoxGeometry(0.34, 0.2, LARGO_CALLE).translate(-(MEDIA_CALZADA + 0.17), 0.1, 0), color: COL.bordillo },
        { geo: new BoxGeometry(0.34, 0.2, LARGO_CALLE).translate(MEDIA_CALZADA + 0.17, 0.1, 0), color: COL.bordillo },
        { geo: new BoxGeometry(0.14, 0.02, LARGO_CALLE).translate(-(MEDIA_CALZADA - 0.6), 0.02, 0), color: COL.linea },
        { geo: new BoxGeometry(0.14, 0.02, LARGO_CALLE).translate(MEDIA_CALZADA - 0.6, 0.02, 0), color: COL.linea },
      ]),
      MAT_FUNDIDO
    )
  );

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

  // ── La fachada de la calle ──
  // Una SOLA hilera pegada al borde de la acera, mezclando casas bajas y
  // edificios de varias plantas. Antes eran dos filas —casas delante,
  // edificios a 12,5 unidades por detrás— y el resultado era que los
  // edificios no se veían: quedaban demasiado lejos y demasiado atrás.
  //
  // Una calle real tampoco separa por altura: el edificio de cinco plantas
  // está pegado a la casa de una, y ese contraste es justo lo que da carácter
  // urbano. Todos arrancan en LINEA_CASAS, o sea que su fachada cae exacta
  // sobre el borde de la acera.
  //
  // Que un edificio de 11 unidades esté tan cerca no tapa la zona de juego: la
  // cámara está en x=0 y a 42 de altura, así que el rayo hacia la esquina más
  // lejana de la calzada nunca pasa de |x|=7,7. Todo esto vive a partir de
  // 10,6.
  interface Lote {
    x: number;
    z: number;
    ancho: number;
    fondo: number;
    alto: number;
    lado: number;
    pared: number;
    /** Casa: tejado a cuatro aguas. Edificio: azotea y rejilla de ventanas. */
    esEdificio: boolean;
    teja: number;
    altoTejado: number;
    plantas: number;
  }

  const paredes = [COL.paredA, COL.paredB, COL.paredC, COL.paredD, COL.paredE];
  const tejas = [COL.tejaA, COL.tejaB, COL.tejaC];
  const lotes: Lote[] = [];

  const nuevoLote = (lado: number, z: number, ancho: number, retranqueo: number): Lote => {
    const esEdificio = rnd() > 0.45;
    const plantas = esEdificio ? 3 + Math.floor(rnd() * 5) : 1 + Math.floor(rnd() * 2);
    const fondo = esEdificio ? 8 + rnd() * 5 : 7 + rnd() * 4.5;
    return {
      x: lado * (LINEA_CASAS + retranqueo + fondo / 2),
      z: z + ancho / 2,
      ancho,
      fondo,
      alto: esEdificio ? plantas * 1.55 : 3.1 + rnd() * 1.6,
      lado,
      pared: paredes[Math.floor(rnd() * paredes.length)],
      esEdificio,
      teja: tejas[Math.floor(rnd() * tejas.length)],
      altoTejado: 1 + rnd() * 0.8,
      plantas,
    };
  };

  for (const lado of [-1, 1]) {
    // Se empieza desplazado en cada lado para que las dos hileras no queden
    // enfrentadas edificio contra edificio, que se ve artificial desde arriba.
    let z = -66 + rnd() * 4 + (lado > 0 ? 4.5 : 0);
    while (z < 66) {
      const ancho = 6 + rnd() * 6;
      // Retranqueo de 0 a 1,2: una hilera perfectamente alineada canta a
      // decorado. Con un poco de juego, la fachada respira.
      lotes.push(nuevoLote(lado, z, ancho, rnd() * 1.2));
      z += ancho + 0.4 + rnd() * 0.8;
    }
  }

  // Segunda hilera, MÁS ATRÁS y solo de edificios: asoma por encima de la
  // primera y da fondo a la manzana sin quitarle sitio a la fachada.
  const fondoManzana: Lote[] = [];
  for (const lado of [-1, 1]) {
    let z = -60 + rnd() * 8;
    while (z < 60) {
      const ancho = 9 + rnd() * 7;
      const l = nuevoLote(lado, z, ancho, 15 + rnd() * 6);
      l.esEdificio = true;
      l.plantas = 5 + Math.floor(rnd() * 5);
      l.alto = l.plantas * 1.55;
      fondoManzana.push(l);
      z += ancho + 2 + rnd() * 4;
    }
  }
  lotes.push(...fondoManzana);

  const casas = lotes.filter((l) => !l.esEdificio);
  const edificios = lotes.filter((l) => l.esEdificio);

  // Muros: una caja por lote, todos en una llamada de dibujo.
  const muros = new InstancedMesh(new BoxGeometry(1, 1, 1), mat(COL.paredA), lotes.length);
  lotes.forEach((l, i) => {
    poner(muros, i, l.x, l.alto / 2, l.z, l.fondo, l.alto, l.ancho);
    muros.setColorAt(i, _c.set(l.pared));
  });
  muros.instanceMatrix.needsUpdate = true;
  if (muros.instanceColor) muros.instanceColor.needsUpdate = true;
  g.add(muros);

  // Tejado a cuatro aguas: un cono de 4 lados es una pirámide de base cuadrada
  // girada 45°. Al girarla otros 45° queda alineada con la casa. La base de esa
  // pirámide tiene medio lado = radio/√2, así que para cubrir un fondo D con
  // un 15 % de vuelo hay que escalar D·0,575/0,707 = D·0,813.
  const tejados = new InstancedMesh(
    new ConeGeometry(1, 1, 4).rotateY(Math.PI / 4),
    mat(COL.tejaA),
    casas.length
  );
  casas.forEach((l, i) => {
    poner(tejados, i, l.x, l.alto + l.altoTejado / 2, l.z, l.fondo * 0.813, l.altoTejado, l.ancho * 0.813);
    tejados.setColorAt(i, _c.set(l.teja));
  });
  tejados.instanceMatrix.needsUpdate = true;
  if (tejados.instanceColor) tejados.instanceColor.needsUpdate = true;
  g.add(tejados);

  // Azotea: un pretil un poco más ancho que el edificio. Desde arriba, que es
  // como se ve todo aquí, un edificio sin pretil parece una caja cortada.
  const azoteas = new InstancedMesh(new BoxGeometry(1, 0.42, 1), mat(COL.azotea), edificios.length);
  edificios.forEach((l, i) =>
    poner(azoteas, i, l.x, l.alto + 0.16, l.z, l.fondo + 0.35, 1, l.ancho + 0.35)
  );
  azoteas.instanceMatrix.needsUpdate = true;
  g.add(azoteas);

  // Ventanas de la fachada que da a la calle: una rejilla en los edificios y
  // unos pocos huecos sueltos en las casas. Es lo que da la ESCALA — sin ellas
  // un bloque de 12 unidades podría ser de 3 plantas o de 30.
  //
  // Van un pelo POR FUERA del muro, no empotradas: empotrarlas provoca
  // z-fighting con la pared y las hace parpadear al girar la cámara. La
  // fachada a la calle es la más cercana a x=0, y como `l.x` ya lleva el signo
  // del lado, restarle `lado * fondo/2` cae siempre en ella.
  const huecos: { x: number; y: number; z: number; alto: number; ancho: number }[] = [];
  for (const l of lotes) {
    const xCara = l.x - l.lado * (l.fondo / 2 + 0.06);
    if (l.esEdificio) {
      const cols = Math.max(2, Math.round(l.ancho / 2.6));
      for (let f = 0; f < l.plantas; f++) {
        for (let c = 0; c < cols; c++) {
          huecos.push({
            x: xCara,
            y: 0.95 + f * 1.55,
            z: l.z + (c - (cols - 1) / 2) * (l.ancho / (cols + 0.5)),
            alto: 0.85,
            ancho: 0.95,
          });
        }
      }
    } else {
      const n = 1 + Math.floor(rnd() * 3);
      for (let k = 0; k < n; k++) {
        huecos.push({
          x: xCara,
          y: 1.1 + rnd() * Math.max(0.2, l.alto - 2.1),
          z: l.z + (k - (n - 1) / 2) * (l.ancho / (n + 0.4)),
          alto: 0.75,
          ancho: 0.85,
        });
      }
    }
  }
  const ventanas = new InstancedMesh(new BoxGeometry(0.12, 1, 1), mat(COL.ventana), huecos.length);
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
  const largoCable = LARGO_CALLE * 0.7;
  const tendido: { geo: BufferGeometry; color: number }[] = [];
  for (const [dx, y] of [
    [-0.55, 5.08],
    [0, 5.12],
    [0.55, 5.06],
    [-0.3, 4.62],
  ] as const) {
    tendido.push({
      geo: new BoxGeometry(0.05, 0.05, largoCable).translate(xPoste + dx, y, 0),
      color: COL.cable,
    });
  }
  // Dos cables cruzando la calle hacia el otro lado: rompen la simetría y
  // dan profundidad al encuadre.
  for (const z of [-14, 21]) {
    tendido.push({
      geo: new BoxGeometry(0.05, 0.05, LINEA_CASAS * 2.1).rotateY(Math.PI / 2).translate(0, 4.9, z),
      color: COL.cable,
    });
  }
  g.add(new Mesh(fundir(tendido), MAT_FUNDIDO));

  // ── Bloques lejanos ──
  // A los lados, nunca dentro del corredor de la calle: el fondo de la calle
  // tiene que quedar abierto para que se pierda en la neblina, que es lo que
  // da la sensación de que el barrio sigue.
  // Arrancan a 40 unidades, más allá de donde acaba la hilera de edificios
  // (que llega a ~34): si empezaran antes se meterían DENTRO de ellos.
  const nBloques = 70;
  const bloques = new InstancedMesh(new BoxGeometry(1, 1, 1), mat(COL.paredE), nBloques);
  const techos = new InstancedMesh(
    new ConeGeometry(1, 1, 4).rotateY(Math.PI / 4),
    mat(COL.tejaB),
    nBloques
  );
  for (let i = 0; i < nBloques; i++) {
    const x = (rnd() > 0.5 ? 1 : -1) * (40 + rnd() * 58);
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

// ── Modelos de basura ───────────────────────────────────────────────────────
// Una calle sucia no se lee por tener manchas de color en el suelo: se lee por
// tener OBJETOS reconocibles. Una botella de refresco tumbada, un brik de jugo,
// un plato con restos. Con rectángulos planos lo único que se entiende es
// "papeles", que es justo el problema que esto resuelve.
//
// Cada modelo se funde en UNA geometría, así que las 34 botellas siguen
// costando una sola llamada de dibujo pese a tener cuerpo, etiqueta, hombro,
// cuello y tapón.

/**
 * Funde varias piezas en una geometría, guardando en el color de cada vértice
 * un MULTIPLICADOR de brillo (1 = tal cual, 0,3 = casi negro).
 *
 * Es un multiplicador y no un color por un motivo concreto: el color de verdad
 * lo pone la instancia, y three multiplica los dos. Así una única geometría de
 * botella —con la etiqueta a 0,95 y el tapón a 0,32— sale verde, ámbar o azul
 * según la copia, conservando siempre la etiqueta clara y el tapón oscuro.
 * Guardar colores absolutos aquí los teñiría también, y adiós contraste.
 *
 * Y va en multiplicadores crudos, no en hexadecimales, para no pisar la
 * gestión de color de three: un 0x484848 pasado por `Color.set` se convierte
 * de sRGB a lineal y acaba valiendo 0,065, no el 0,28 que uno esperaba.
 */
function fundir(partes: { geo: BufferGeometry; tono?: number; color?: number }[]): BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  for (const parte of partes) {
    const g = parte.geo.index ? parte.geo.toNonIndexed() : parte.geo;
    const gp = g.attributes.position;
    const gn = g.attributes.normal;
    // Con `color` se pasa por Color.set, que convierte de sRGB a lineal — que
    // es exactamente lo que espera un atributo de color de vértice. Con
    // `tono` NO se convierte, porque ahí el número no es un color sino un
    // multiplicador y convertirlo lo oscurecería sin sentido.
    let r = 1;
    let v = 1;
    let a = 1;
    if (parte.color !== undefined) {
      _c.set(parte.color);
      r = _c.r;
      v = _c.g;
      a = _c.b;
    } else {
      r = v = a = parte.tono ?? 1;
    }
    for (let i = 0; i < gp.count; i++) {
      pos.push(gp.getX(i), gp.getY(i), gp.getZ(i));
      nor.push(gn.getX(i), gn.getY(i), gn.getZ(i));
      col.push(r, v, a);
    }
  }
  const out = new BufferGeometry();
  out.setAttribute('position', new Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new Float32BufferAttribute(nor, 3));
  out.setAttribute('color', new Float32BufferAttribute(col, 3));
  return out;
}

/** Material único de toda la basura: el color viene del vértice y de la
 *  instancia, así que una sola llamada sirve para todos los tonos. */
const MAT_BASURA = new MeshLambertMaterial({ vertexColors: true, flatShading: true });

/**
 * Material de las piezas FUNDIDAS con colores absolutos (bolsa, carretilla,
 * mobiliario de la calle). Es el que permite que una bolsa de basura con trece
 * piezas de cuatro colores distintos cueste UNA llamada de dibujo en vez de
 * trece — que con cinco bolsas en pantalla son 60 llamadas de diferencia, la
 * mayor economía de toda la escena en un teléfono flojo.
 */
const MAT_FUNDIDO = new MeshLambertMaterial({ vertexColors: true, flatShading: true });

/** Botella de refresco TUMBADA, con su etiqueta y su tapón. El eje va en X, así
 *  que la instancia solo tiene que girar sobre Y para tirarla en cualquier
 *  dirección. Centrada en el origen para que ese giro no la desplace. */
const GEO_BOTELLA = fundir([
  { geo: new CylinderGeometry(0.115, 0.115, 0.4, 9).rotateZ(Math.PI / 2).translate(-0.13, 0, 0), tono: 1 },
  // Etiqueta: la banda clara del centro. Es lo que hace que a 40 unidades de
  // cámara se distinga una botella de un palo.
  { geo: new CylinderGeometry(0.128, 0.128, 0.18, 9).rotateZ(Math.PI / 2).translate(-0.15, 0, 0), tono: 0.95 },
  { geo: new ConeGeometry(0.115, 0.09, 9).rotateZ(Math.PI / 2).translate(-0.375, 0, 0), tono: 0.9 },
  { geo: new ConeGeometry(0.115, 0.17, 9).rotateZ(-Math.PI / 2).translate(0.155, 0, 0), tono: 1 },
  { geo: new CylinderGeometry(0.05, 0.05, 0.12, 7).rotateZ(Math.PI / 2).translate(0.3, 0, 0), tono: 0.85 },
  { geo: new CylinderGeometry(0.063, 0.063, 0.07, 8).rotateZ(Math.PI / 2).translate(0.39, 0, 0), tono: 0.32 },
]);

/** Brik de jugo tumbado, con su tapita y la pajita puesta. */
const GEO_BRIK = fundir([
  { geo: new BoxGeometry(0.36, 0.2, 0.17).translate(0, 0.1, 0), tono: 1 },
  { geo: new BoxGeometry(0.37, 0.075, 0.18).translate(0, 0.13, 0), tono: 0.62 },
  { geo: new CylinderGeometry(0.032, 0.032, 0.05, 6).rotateZ(Math.PI / 2).translate(0.2, 0.15, 0), tono: 0.35 },
  { geo: new CylinderGeometry(0.015, 0.015, 0.24, 4).rotateZ(0.6).translate(0.29, 0.22, 0.03), tono: 0.95 },
]);

/** Lata de refresco tumbada: cuerpo, banda oscura y los dos bordes de aluminio. */
const GEO_LATA = fundir([
  { geo: new CylinderGeometry(0.1, 0.1, 0.27, 9).rotateZ(Math.PI / 2), tono: 1 },
  { geo: new CylinderGeometry(0.104, 0.104, 0.1, 9).rotateZ(Math.PI / 2), tono: 0.55 },
  { geo: new CylinderGeometry(0.086, 0.086, 0.035, 9).rotateZ(Math.PI / 2).translate(0.15, 0, 0), tono: 0.88 },
  { geo: new CylinderGeometry(0.086, 0.086, 0.035, 9).rotateZ(Math.PI / 2).translate(-0.15, 0, 0), tono: 0.88 },
]);

/** Plato o bandeja de comida para llevar, con su borde. Desde la cámara
 *  cenital un disco claro con reborde se lee al instante. */
const GEO_PLATO = fundir([
  { geo: new CylinderGeometry(0.21, 0.17, 0.045, 14).translate(0, 0.022, 0), tono: 1 },
  { geo: new TorusGeometry(0.21, 0.028, 4, 14).rotateX(-Math.PI / 2).translate(0, 0.045, 0), tono: 0.82 },
  { geo: new CylinderGeometry(0.13, 0.13, 0.015, 12).translate(0, 0.05, 0), tono: 0.7 },
]);

/** Restos de comida: tres bultos sobre una mancha. */
const GEO_COMIDA = fundir([
  { geo: new CylinderGeometry(0.15, 0.15, 0.014, 9).translate(0, 0.007, 0), tono: 0.72 },
  { geo: new IcosahedronGeometry(0.08, 0).translate(0.04, 0.07, 0.02), tono: 1 },
  { geo: new IcosahedronGeometry(0.062, 0).translate(-0.07, 0.055, 0.05), tono: 0.85 },
  { geo: new IcosahedronGeometry(0.05, 0).translate(0.02, 0.05, -0.08), tono: 0.93 },
]);

/** Papel o cartón ARRUGADO, no una lámina plana: un icosaedro aplastado con una
 *  esquina asomando. La lámina plana era exactamente lo que se leía como
 *  "papelito" y no como basura. */
const GEO_PAPEL = fundir([
  { geo: new IcosahedronGeometry(0.12, 0).scale(1.5, 0.5, 1.2).translate(0, 0.06, 0), tono: 1 },
  { geo: new BoxGeometry(0.26, 0.014, 0.2).rotateZ(0.22).rotateY(0.5).translate(0.14, 0.04, 0.06), tono: 0.88 },
]);

/**
 * La bolsa de basura, entera, en una geometría.
 *
 * La versión anterior era una bola oscura con un cuello: leía como "objeto",
 * no como bolsa. Lo que hace que una bolsa parezca una bolsa son cuatro cosas,
 * y todas están aquí:
 *
 *   1. NO es esférica. Se desparrama: la panza es ancha y achatada porque
 *      apoya en el suelo, y se estrecha hacia arriba.
 *   2. Tiene BULTOS. El plástico va tenso sobre lo que hay dentro, y esos
 *      picos irregulares son la señal más reconocible de todas.
 *   3. Se estrangula en un CUELLO y termina en un NUDO con dos orejas — el
 *      remate de haber atado el plástico.
 *   4. El negro no es plano: la panza en sombra, el hombro a media luz y un
 *      reflejo duro arriba. Un negro único la deja como una silueta recortada.
 *
 * Y es GRANDE: 0,86 unidades de radio, que es exactamente el BAG_RADIUS de la
 * simulación, así que lo que se ve es lo que colisiona.
 */
const GEO_BOLSA = fundir([
  // Panza: achatada y ancha, como una bolsa que apoya en el suelo.
  { geo: new SphereGeometry(0.86, 10, 7).scale(1, 0.66, 0.96).translate(0, 0.5, 0), color: COL.bolsa },
  // Hombro: la parte alta, que recibe la luz. Más estrecha que la panza.
  { geo: new SphereGeometry(0.63, 9, 6).scale(1, 0.8, 1).translate(0, 0.9, 0), color: COL.bolsaMedia },
  // Bultos: lo de dentro empujando el plástico. Es lo que más distingue una
  // bolsa de una pelota negra.
  { geo: new IcosahedronGeometry(0.3, 0).scale(1.05, 1.05, 1.05).translate(0.66, 0.44, 0.26), color: COL.bolsa },
  { geo: new IcosahedronGeometry(0.3, 0).scale(1.2, 1.2, 1.2).translate(-0.58, 0.38, -0.4), color: COL.bolsa },
  { geo: new IcosahedronGeometry(0.3, 0).scale(0.9, 0.9, 0.9).translate(0.12, 0.5, -0.72), color: COL.bolsa },
  { geo: new IcosahedronGeometry(0.3, 0).scale(0.8, 0.8, 0.8).translate(-0.34, 0.92, 0.5), color: COL.bolsaMedia },
  { geo: new IcosahedronGeometry(0.3, 0).scale(0.7, 0.7, 0.7).translate(0.46, 0.86, -0.3), color: COL.bolsaMedia },
  // Reflejo: el brillo duro del plástico. Va medio embebido en el hombro, así
  // que solo asoma un casquete — que es como se ve un reflejo de verdad.
  { geo: new SphereGeometry(0.3, 7, 5).scale(1.3, 0.55, 1).rotateZ(0.25).translate(-0.3, 1.06, 0.3), color: COL.bolsaClara },
  // Cuello: el plástico estrangulado antes del nudo.
  { geo: new CylinderGeometry(0.17, 0.5, 0.44, 8).translate(0, 1.44, 0), color: COL.bolsaMedia },
  // Lazo amarillo: es lo que impide que una bolsa negra se pierda sobre el
  // asfalto. Ya cumplía esa función en la versión 2D.
  { geo: new CylinderGeometry(0.22, 0.22, 0.13, 10).translate(0, 1.66, 0), color: COL.lazo },
  // Nudo y sus dos orejas: el remate de haber atado la bolsa. Sin ellas el
  // cuello parece el gollete de un jarrón.
  { geo: new IcosahedronGeometry(0.19, 0).translate(0, 1.78, 0), color: COL.bolsa },
  { geo: new ConeGeometry(0.15, 0.46, 5).scale(1, 1, 0.55).rotateZ(0.95).translate(-0.23, 1.94, -0.06), color: COL.bolsaMedia },
  { geo: new ConeGeometry(0.15, 0.46, 5).scale(1, 1, 0.55).rotateZ(-0.95).translate(0.23, 1.94, 0.06), color: COL.bolsaMedia },
]);

/** Torso del barrendero: camisa, chaleco reflectante y su franja. El chaleco
 *  es un pelo mayor que el torso para que la camisa asome por los hombros. */
const GEO_TORSO = fundir([
  { geo: new BoxGeometry(0.6, 0.62, 0.36).translate(0, 0.8, 0), color: COL.camisa },
  { geo: new BoxGeometry(0.64, 0.46, 0.42).translate(0, 0.78, 0), color: COL.chaleco },
  { geo: new BoxGeometry(0.66, 0.08, 0.44).translate(0, 0.78, 0), color: COL.reflectante },
]);

/**
 * Cabeza con gorra y CARA.
 *
 * Dos decisiones aquí, y las dos son de legibilidad, no de anatomía:
 *
 * 1. La cabeza es DESPROPORCIONADA: 0,36 de radio sobre un cuerpo de 1,5. Es
 *    la proporción del dibujo animado, y existe por este motivo exacto: a
 *    tamaño realista, la cara de un personaje visto desde arriba y a veinte
 *    metros ocupa cuatro píxeles y no es nada. Agrandando la cabeza la cara
 *    llega a unos treinta píxeles de ancho en un móvil, que ya es una cara.
 *
 * 2. Los ojos van POR FUERA del cráneo, no hundidos. Con caras planas y una
 *    sola luz, un ojo embebido queda a la misma iluminación que la mejilla y
 *    desaparece; sacándolo, coge su propio sombreado y se recorta. Es el mismo
 *    truco que usa el reflejo de la bolsa. Ojo con esto al tocar el radio del
 *    cráneo: al pasar de 0,36 a 0,40 los ojos se quedaron DENTRO y la cara
 *    desapareció entera sin que nada fallara.
 *
 * La visera sigue siendo lo que dice HACIA DÓNDE MIRA desde la cámara cenital,
 * que es justo el ángulo del juego; ahora además enmarca la cara.
 */
const GEO_CABEZA = fundir([
  { geo: new SphereGeometry(0.4, 9, 7), color: COL.piel },
  // Gorra: casquete y visera, las dos más grandes que antes en proporción.
  { geo: new SphereGeometry(0.415, 9, 6, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 0.08, 0), color: COL.gorra },
  { geo: new BoxGeometry(0.54, 0.07, 0.36).translate(0, 0.11, 0.4), color: COL.gorra },
  // Ojos: almendrados y altos, como los de un dibujo. Van a media altura de
  // la cara, por debajo del filo de la gorra.
  { geo: new SphereGeometry(0.095, 7, 5).scale(0.95, 1.4, 0.5).translate(-0.155, -0.01, 0.35), color: COL.ojo },
  { geo: new SphereGeometry(0.095, 7, 5).scale(0.95, 1.4, 0.5).translate(0.155, -0.01, 0.35), color: COL.ojo },
  // El brillo del ojo. Un punto claro arriba a un lado: es lo que separa una
  // mirada de dos manchas negras.
  { geo: new SphereGeometry(0.038, 6, 4).translate(-0.19, 0.07, 0.39), color: COL.brilloOjo },
  { geo: new SphereGeometry(0.038, 6, 4).translate(0.12, 0.07, 0.39), color: COL.brilloOjo },
  // Boca: un trazo corto. Con la cabeza a este tamaño ya se ve.
  { geo: new BoxGeometry(0.13, 0.035, 0.05).translate(0, -0.2, 0.36), color: COL.boca },
]);

/**
 * La carretilla, pieza a pieza.
 *
 * Ha pasado por tres versiones y el fallo de las dos primeras era el mismo:
 * DESDE ARRIBA SE VEÍA UN CUADRADO. Da igual el volumen que tenga el modelo si
 * su PLANTA es un cuadrado, porque la cámara mira casi a plomo y la planta es
 * casi todo lo que llega. Un cuadrado naranja sobre el asfalto es una caja.
 *
 * Lo que se ve desde arriba de una carretilla de verdad es un TRAPECIO que se
 * estrecha hasta una rueda. Así que la tolva ya no es un prisma de cuatro
 * lados iguales: mide 2,00 de ancho por detrás y 0,80 por delante sobre 2,90
 * de largo, y de esa punta sale la rueda sola, separada. Esa silueta no se
 * parece a nada más en la calle.
 *
 * Lo demás sostiene esa lectura:
 *   · Está ABIERTA, con el fondo en sombra: se lee como cuenco, no como bulto.
 *   · Tiene LABIO claro sobresaliendo por todo el filo, que es lo que dibuja
 *     el contorno del trapecio desde arriba. Sin él, el borde se pierde.
 *   · Los largueros CONVERGEN hacia la rueda acompañando al trapecio, en vez
 *     de ir paralelos como dos raíles.
 *   · UNA rueda delante y DOS puños detrás: esa asimetría es su firma.
 *
 * El chasis va aparte de la tolva porque la tolva es la BOCA DE ENTREGA, y es
 * ella la que la prueba mide contra CART_RADIUS; los mangos sobresalen por
 * detrás a propósito, que es justo por donde se acerca quien empuja.
 */

/** Semiancho trasero, semiancho delantero y semilargo de la tolva. El trapecio
 *  entero se deriva de estos tres números. */
const TOLVA_TRAS = 1.0;
const TOLVA_DEL = 0.4;
const TOLVA_Z = 1.45;

/**
 * Las cuatro paredes del trapecio a una altura dada. `fuera` las separa hacia
 * afuera, que es como se saca el labio del borde con la misma forma.
 */
function contornoTolva(y: number, alto: number, fuera: number, color: number) {
  const tras = TOLVA_TRAS + fuera;
  const del = TOLVA_DEL + fuera;
  const z = TOLVA_Z + fuera;
  // Los laterales van inclinados: se giran el mismo ángulo que la pendiente
  // del trapecio, o quedarían huecos en las esquinas.
  const largo = Math.hypot(tras - del, 2 * z);
  const ang = Math.atan2(tras - del, 2 * z);
  const gr = 0.13;
  return [
    { geo: new BoxGeometry(tras * 2, alto, gr).translate(0, y, z), color },
    { geo: new BoxGeometry(del * 2, alto, gr).translate(0, y, -z), color },
    { geo: new BoxGeometry(gr, alto, largo).rotateY(ang).translate((tras + del) / 2, y, 0), color },
    { geo: new BoxGeometry(gr, alto, largo).rotateY(-ang).translate(-(tras + del) / 2, y, 0), color },
  ];
}

/** La tolva: el cuenco trapezoidal. Es la boca de entrega. */
const GEO_TOLVA = fundir([
  // Fondo, en sombra. En tres escalones que siguen la pendiente del trapecio:
  // un rectángulo se asomaría por fuera de las paredes en la parte estrecha.
  { geo: new BoxGeometry(1.8, 0.1, 0.99).translate(0, 0.53, 0.97), color: COL.tolvaOscura },
  { geo: new BoxGeometry(1.4, 0.1, 0.99).translate(0, 0.53, 0), color: COL.tolvaOscura },
  { geo: new BoxGeometry(1.0, 0.1, 0.99).translate(0, 0.53, -0.97), color: COL.tolvaOscura },
  ...contornoTolva(0.9, 0.72, 0, COL.tolva),
  // Labio: sobresale 0,09 y va claro. Es el contorno.
  ...contornoTolva(1.29, 0.14, 0.09, COL.tolvaBorde),
]);

/** El chasis: largueros, rueda, puños y patas. */
const GEO_CHASIS = fundir([
  // Largueros: convergen hacia la rueda, siguiendo al trapecio.
  { geo: new BoxGeometry(0.14, 0.14, 3.6).rotateY(0.17).translate(0.6, 0.42, 0.05), color: COL.metal },
  { geo: new BoxGeometry(0.14, 0.14, 3.6).rotateY(-0.17).translate(-0.6, 0.42, 0.05), color: COL.metal },
  // Travesaño delantero: donde se atornilla la horquilla de la rueda.
  { geo: new BoxGeometry(1.0, 0.1, 0.14).translate(0, 0.42, -1.2), color: COL.metalOscuro },
  // Horquilla: las dos pletinas que bajan al eje.
  { geo: new BoxGeometry(0.09, 0.5, 0.13).translate(-0.28, 0.46, -1.7), color: COL.metalOscuro },
  { geo: new BoxGeometry(0.09, 0.5, 0.13).translate(0.28, 0.46, -1.7), color: COL.metalOscuro },
  // Rueda: neumático negro y buje claro. El contraste es lo que la hace rueda
  // y no un cilindro. Va SOLA delante, separada de la tolva: ese hueco es la
  // parte de la silueta que más dice "carretilla".
  { geo: new CylinderGeometry(0.46, 0.46, 0.26, 14).rotateZ(Math.PI / 2).translate(0, 0.46, -1.78), color: COL.neumatico },
  { geo: new CylinderGeometry(0.2, 0.2, 0.29, 8).rotateZ(Math.PI / 2).translate(0, 0.46, -1.78), color: COL.llanta },
  // Puños de goma en las puntas: dicen por dónde se agarra.
  { geo: new CylinderGeometry(0.13, 0.13, 0.52, 8).rotateX(Math.PI / 2).translate(-0.9, 0.42, 1.72), color: COL.puno },
  { geo: new CylinderGeometry(0.13, 0.13, 0.52, 8).rotateX(Math.PI / 2).translate(0.9, 0.42, 1.72), color: COL.puno },
  // Patas con pie: lo que la mantiene de pie mientras se carga.
  { geo: new BoxGeometry(0.11, 0.44, 0.11).translate(-0.76, 0.2, 1.2), color: COL.metalOscuro },
  { geo: new BoxGeometry(0.11, 0.44, 0.11).translate(0.76, 0.2, 1.2), color: COL.metalOscuro },
  { geo: new BoxGeometry(0.16, 0.1, 0.4).translate(-0.76, 0.05, 1.25), color: COL.metalOscuro },
  { geo: new BoxGeometry(0.16, 0.1, 0.4).translate(0.76, 0.05, 1.25), color: COL.metalOscuro },
]);

/** Montoncito acumulado contra el bordillo: varios bultos y una botella
 *  asomando, que es lo que delata que el montón es de basura. */
const GEO_MONTON = fundir([
  { geo: new IcosahedronGeometry(0.34, 0).scale(1.1, 0.75, 1).translate(0, 0.24, 0), tono: 1 },
  { geo: new IcosahedronGeometry(0.24, 0).translate(0.26, 0.18, 0.14), tono: 0.8 },
  { geo: new IcosahedronGeometry(0.2, 0).translate(-0.24, 0.16, -0.12), tono: 0.9 },
  { geo: new CylinderGeometry(0.07, 0.07, 0.34, 7).rotateZ(1.1).translate(0.2, 0.42, -0.16), tono: 0.6 },
]);

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
  // Los árboles van pegados al borde EXTERIOR de la acera, y con la escala
  // acotada, por un motivo que no es estético: la copa vuela alrededor del
  // tronco, y desde una cámara cenital una copa que asome sobre el asfalto
  // puede esconder una bolsa. Con el tronco a 9,29 y la copa como mucho a
  // 1,52 de radio, el borde interior queda en 7,77 — por fuera de la calzada,
  // que acaba en 7,7. Hay una prueba que lo comprueba, y ya falló una vez.
  // Al estrechar la acera hubo que encoger también la copa: la acera es la
  // que decide cuánto sitio hay para un árbol.
  //
  // Y van SOLO en la acera izquierda. La cámara mira desde +Z sin ladear, así
  // que el eje +X del mundo es el lado derecho de la pantalla: una hilera de
  // árboles ahí queda MUCHO más cerca del ojo (a 9,7 unidades) que los
  // edificios (a 23-34), y desde una vista cenital sus copas se proyectan
  // justo encima de las fachadas y las tapan enteras. Con arbolado en los dos
  // lados el barrio no se veía; con uno solo, la izquierda da vegetación y la
  // derecha enseña los edificios.
  const arboles: { x: number; z: number; e: number; fase: number }[] = [];
  const xArbol = -(MEDIA_CALZADA + ANCHO_ACERA * 0.82);
  for (let z = -40 + rnd() * 5; z < 40; z += 7.5 + rnd() * 3.5) {
    arboles.push({
      x: xArbol,
      z,
      e: 0.85 + rnd() * 0.25,
      fase: rnd() * Math.PI * 2,
    });
  }

  // Arboleda LEJANA, por detrás de los edificios: da textura al horizonte.
  // Está fuera de todo lo jugable y la neblina se la va comiendo con la
  // distancia. Empieza a 45 unidades, no a 36: la hilera de edificios llega a
  // 34, y un árbol a 36 quedaba prácticamente a su altura, disputándoles la
  // silueta en vez de quedar claramente por detrás.
  for (let i = 0; i < 46; i++) {
    arboles.push({
      x: (rnd() > 0.5 ? 1 : -1) * (45 + rnd() * 50),
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
  // Aquí no valen manchas de color: si la basura son rectángulos planos, se
  // lee como "papeles tirados" y ya. Lo que hace que una calle se vea SUCIA
  // son objetos RECONOCIBLES — una botella de refresco, un brik de jugo, un
  // plato con restos. Por eso cada tipo es una silueta de verdad, fundida en
  // una sola geometría para que siga costando UNA llamada de dibujo.
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

  /**
   * Siembra `n` copias de una geometría por la calle.
   *
   * El color va por instancia y MULTIPLICA al color de los vértices, que es
   * justo lo que interesa: la etiqueta se pintó blanca y el tapón oscuro al
   * fundir la geometría, así que al teñir la instancia de verde sale una
   * botella verde con la etiqueta clara y el tapón oscuro. Un solo modelo, y
   * cada copia con su color.
   */
  const sembrar = (
    geo: BufferGeometry,
    n: number,
    tonos: readonly number[],
    y: number,
    opts: { escalaMin?: number; escalaMax?: number; radio?: number } = {}
  ) => {
    const malla = new InstancedMesh(geo, MAT_BASURA, n);
    let k = 0;
    for (let i = 0; i < n; i++) {
      const pt = puntoLibre(opts.radio ?? 2.1);
      if (!pt) continue;
      const e =
        (opts.escalaMin ?? 0.85) + rnd() * ((opts.escalaMax ?? 1.15) - (opts.escalaMin ?? 0.85));
      poner(malla, k, pt[0], altura(pt[0]) + y * e, pt[1], e, e, e, rnd() * Math.PI * 2);
      malla.setColorAt(k, _c.set(tonos[Math.floor(rnd() * tonos.length)]));
      k++;
    }
    // Las que no encontraron sitio se mandan bajo tierra: una instancia sin
    // matriz se dibuja en el origen, encima de la carretilla.
    for (let i = k; i < n; i++) poner(malla, i, 0, -50, 0, 0, 0, 0);
    malla.instanceMatrix.needsUpdate = true;
    if (malla.instanceColor) malla.instanceColor.needsUpdate = true;
    grupo.add(malla);
  };

  sembrar(GEO_BOTELLA, 34, [
    COL.botellaVerde,
    COL.botellaAmbar,
    COL.botellaAzul,
    COL.botellaRoja,
    COL.botellaClara,
  ], 0.13);
  sembrar(GEO_BRIK, 26, [COL.brikNaranja, COL.brikAmarillo, COL.brikRojo, COL.brikVerde], 0.0);
  sembrar(GEO_LATA, 30, [COL.lataRoja, COL.lataAzul, COL.lataPlata, COL.brikVerde], 0.1);
  sembrar(GEO_PLATO, 20, [COL.plato, COL.plato, COL.platoCrema, COL.bandeja], 0.0, {
    escalaMin: 0.9,
    escalaMax: 1.35,
  });
  sembrar(GEO_COMIDA, 34, [
    COL.comidaTomate,
    COL.comidaMaiz,
    COL.comidaVerde,
    COL.comidaPan,
    COL.comidaCarne,
  ], 0.0, { escalaMin: 0.7, escalaMax: 1.25 });
  sembrar(GEO_PAPEL, 46, [COL.papel, COL.papel, COL.papelCrema, COL.cartonSuelto], 0.0, {
    escalaMin: 0.75,
    escalaMax: 1.4,
  });

  // Montoncitos contra el bordillo: es donde se acumula de verdad la basura, y
  // colocarlos ahí en vez de al azar es lo que hace que la calle se lea como
  // una calle y no como un tablero con cosas encima.
  const nMonton = 24;
  const montones = new InstancedMesh(GEO_MONTON, MAT_BASURA, nMonton);
  const tonosMonton = [COL.cartonSuelto, COL.papelCrema, COL.papel, COL.brikNaranja];
  for (let i = 0; i < nMonton; i++) {
    const lado = rnd() > 0.5 ? 1 : -1;
    const x = lado * (MEDIA_CALZADA - 0.2 - rnd() * 0.6);
    const z = (rnd() - 0.5) * (FONDO + 30);
    poner(montones, i, x, 0.1, z, 1 + rnd() * 0.7, 0.7 + rnd() * 0.5, 1 + rnd() * 0.7, rnd() * 3);
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
  cuerpo: Mesh;
  brillo: Mesh;
}

/** La bolsa colocada en el suelo, con su sombra y su halo. La geometría del
 *  cuerpo está en GEO_BOLSA. */
export function crearBolsa(): BolsaVista {
  const grupo = new Group();

  const sombra = new Mesh(new CircleGeometry(0.95, 14).rotateX(-Math.PI / 2), MAT_SOMBRA);
  sombra.position.y = 0.025;
  sombra.scale.set(1, 1, 0.88);
  grupo.add(sombra);

  // Halo que se enciende al acercarse: la anticipación de la que habla el plan.
  // Sobre asfalto gris hace falta más que sobre pasto, porque la bolsa es
  // oscura y el suelo también.
  const brillo = new Mesh(
    new CircleGeometry(1.6, 18).rotateX(-Math.PI / 2),
    new MeshBasicMaterial({ color: 0xfff0a8, transparent: true, opacity: 0, depthWrite: false })
  );
  brillo.position.y = 0.045;
  grupo.add(brillo);

  // Todo el cuerpo va FUNDIDO en una sola geometría. La bolsa no articula
  // ninguna pieza —se escala y gira entera—, así que no hay motivo para que
  // trece mallas cuesten trece llamadas de dibujo. Con cinco bolsas en
  // pantalla, fundirlas ahorra 60 llamadas.
  const cuerpo = new Mesh(GEO_BOLSA, MAT_FUNDIDO);

  grupo.add(cuerpo);
  return { grupo, cuerpo, brillo };
}

// ── Carretilla ──────────────────────────────────────────────────────────────

export interface CarretillaVista {
  grupo: Group;
  /** La tolva sola. La prueba la mide contra CART_RADIUS. */
  tolva: Mesh;
  aura: Mesh;
  capas: Mesh[];
}

export function crearCarretilla(): CarretillaVista {
  const grupo = new Group();
  // Nada del bucle de animación escribe la escala de este grupo (solo toca la
  // opacidad del aura y la visibilidad de las capas), así que aquí sí puede ir
  // sobre el propio grupo, al contrario que en el ciudadano.
  grupo.scale.setScalar(ESCALA_CARRETILLA);

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

  // Aparcada EN DIAGONAL, no a escuadra con la calle. Un objeto alineado con
  // los ejes de la pantalla enseña una sola cara y se lee como un icono
  // plano; girada, se le ven a la vez el costado del cuenco y la rueda de
  // canto, que son las dos señales que dicen "carretilla". Y de paso es como
  // se queda una carretilla de verdad cuando alguien la suelta.
  grupo.rotation.y = -0.36;

  // Dos mallas fundidas, no dieciocho: la tolva por un lado (que es lo que
  // mide la prueba contra CART_RADIUS) y el chasis por otro.
  const tolva = new Mesh(GEO_TOLVA, MAT_FUNDIDO);
  grupo.add(tolva);
  grupo.add(new Mesh(GEO_CHASIS, MAT_FUNDIDO));

  // Montón que crece con cada entrega: el marcador de progreso del juego.
  const capas: Mesh[] = [];
  for (let i = 0; i < 5; i++) {
    const ultima = i === 4;
    // Van en la mitad ANCHA del trapecio, no centrados: así el morro y la
    // rueda siguen despejados y la silueta se lee aunque esté llena.
    const c = new Mesh(
      new BoxGeometry(1.32 - i * 0.09, 0.24, 1.2 - i * 0.08),
      mat(ultima ? COL.cartonDorado : COL.carton)
    );
    c.position.z = 0.5;
    // Arranca DENTRO de la tolva (su fondo está a 0,59) y va asomando por
    // encima del labio: así el montón se lee como carga, no como una tapa.
    c.position.y = 0.74 + i * 0.21;
    c.rotation.y = i * 0.4;
    c.visible = false;
    grupo.add(c);
    capas.push(c);
  }

  return { grupo, tolva, aura, capas };
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

  // Grupo de ESCALA intermedio. El muñeco se modela a tamaño 1 y se agranda
  // aquí, en vez de reescribir cada medida, porque el bucle de animación
  // escribe `cuerpo.scale.y` y `cuerpo.position.y` ABSOLUTOS cada fotograma
  // (el squash del paso). Si el aumento viviera en `cuerpo`, el primer
  // fotograma de animación lo borraría y el muñeco encogería de golpe.
  const escala = new Group();
  escala.scale.setScalar(ESCALA_CIUDADANO);
  grupo.add(escala);

  const sombra = new Mesh(new CircleGeometry(0.5, 12).rotateX(-Math.PI / 2), MAT_SOMBRA);
  sombra.position.y = 0.03 / ESCALA_CIUDADANO;
  sombra.scale.set(1, 1, 0.75);
  escala.add(sombra);

  // `cuerpo` es lo que se inclina y hace squash; el grupo exterior solo se
  // mueve y gira. Separarlos evita que la inclinación arrastre la sombra.
  const cuerpo = new Group();

  const piernaIzq = new Mesh(new BoxGeometry(0.2, 0.5, 0.22), mat(COL.pantalon));
  piernaIzq.position.set(-0.16, 0.25, 0);
  cuerpo.add(piernaIzq);
  const piernaDer = piernaIzq.clone();
  piernaDer.position.x = 0.16;
  cuerpo.add(piernaDer);

  // Torso, chaleco y franja reflectante: tres piezas fijas entre sí, una malla.
  const torso = new Mesh(GEO_TORSO, MAT_FUNDIDO);
  cuerpo.add(torso);

  const brazoIzq = new Mesh(new BoxGeometry(0.16, 0.5, 0.16), mat(COL.piel));
  brazoIzq.position.set(-0.4, 0.82, 0);
  cuerpo.add(brazoIzq);
  const brazoDer = brazoIzq.clone();
  brazoDer.position.x = 0.4;
  cuerpo.add(brazoDer);

  // La cabeza sigue siendo un Group porque el bucle de animación la GIRA
  // (mira alrededor cuando el jugador se queda quieto); lo que va fundido es
  // su contenido: cráneo, copa de la gorra y visera.
  const cabeza = new Group();
  cabeza.add(new Mesh(GEO_CABEZA, MAT_FUNDIDO));
  cabeza.position.y = 1.44;
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

  escala.add(cuerpo);

  return { grupo, cuerpo, torso, cabeza, piernaIzq, piernaDer, brazoIzq, brazoDer, bolsaHombro, sombra };
}

/** Un objeto suelto reutilizable para cálculos, para no crear basura por
 *  fotograma. */
export const TEMP = new Object3D();
