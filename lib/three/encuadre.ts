// ============================================================================
// Encuadre de la cámara. Módulo PURO: no toca el DOM ni el renderizador, solo
// matemática de cámara. Por eso `npm test` puede ejecutarlo tal cual y
// comprobar que el terreno cabe entero en cualquier proporción de pantalla,
// sin necesidad de un navegador.
//
// Un juego con cámara fija y un área de juego fija tiene un problema que
// parece trivial y no lo es: la distancia a la que hay que poner la cámara
// depende de la proporción de la pantalla. Fijarla a ojo funciona en el
// teléfono del que la fijó y se rompe en todos los demás — en uno estrecho se
// sale del encuadre, en uno ancho sobra medio prado.
//
// Aquí se busca por bisección la distancia MÍNIMA a la que las esquinas del
// terreno caen dentro de la pantalla. Es exacta y funciona igual en un móvil
// vertical, en una tablet y en un monitor apaisado.
// ============================================================================

import { PerspectiveCamera, Vector3 } from 'three';
import { PLAY } from '../game/world';

/**
 * Inclinación de la cámara sobre el horizonte.
 *
 * Estuvo en 52°, y a esa altura lo que llega de cada objeto es casi solo su
 * PLANTA: la carretilla se leía como un cuadrado por más volumen que tuviera
 * el modelo, y el ciudadano como un sombrero con hombros. A 45° se ve un buen
 * trozo de costado de todo — el cuenco de la carretilla, la rueda de canto, el
 * chaleco del barrendero, las fachadas — sin perder la lectura cenital que el
 * juego necesita para que se entienda dónde está cada bolsa.
 *
 * Cuesta casi nada de encuadre: la cámara se aleja de 66,1 a 67,2 unidades en
 * el móvil más estrecho, un 1,7 %.
 */
export const PITCH = (45 * Math.PI) / 180;

/** Margen: 0,97 deja un respiro para que nada roce el borde exacto. */
const MARGEN = 0.97;

/**
 * Cuánto encuadre de MÁS se pide a lo ancho, por encima de la calzada.
 *
 * Sin esto la cámara ajustaba el encuadre a la calzada y nada más, y el
 * resultado medido en un teléfono era: se ve hasta |x|=7,9 en el borde
 * cercano y 10,5 en el lejano. O sea que las aceras apenas asomaban y las
 * fachadas NO ENTRABAN EN CÁMARA — daba igual lo cerca que se pusieran los
 * edificios, porque el problema no era la distancia sino el encuadre.
 *
 * Con 1,28 se ve hasta |x|≈10 en el borde cercano y ≈13 en el lejano, así que
 * la fachada aparece a los dos lados y se va abriendo hacia el horizonte, que
 * es la perspectiva de la referencia. Cuesta que todo se vea un 28 % más
 * pequeño EN MÓVIL; en escritorio no cuesta nada, porque ahí quien manda en
 * el encuadre es el fondo de la calle, no su anchura.
 */
export const MARGEN_LATERAL = 1.28;

const U = 1 / 40;
const CX = PLAY.x + PLAY.w / 2;
const CZ = PLAY.y + PLAY.h / 2;
const wx = (s: number) => (s - CX) * U;
const wz = (s: number) => (s - CZ) * U;

/** Centro del terreno, adonde mira la cámara. */
export const CENTRO = new Vector3(wx(CX), 0, wz(CZ));

/**
 * Los puntos que la cámara tiene que encuadrar: las cuatro esquinas del área
 * jugable y un punto ALTO en el borde de arriba. Sin ese quinto punto, los
 * árboles del fondo asoman por encima del encuadre y se ve el vacío detrás.
 */
export const PUNTOS_A_ENCUADRAR: Vector3[] = [
  new Vector3(wx(PLAY.x), 0, wz(PLAY.y)),
  new Vector3(wx(PLAY.x + PLAY.w), 0, wz(PLAY.y)),
  new Vector3(wx(PLAY.x), 0, wz(PLAY.y + PLAY.h)),
  new Vector3(wx(PLAY.x + PLAY.w), 0, wz(PLAY.y + PLAY.h)),
  // Y este ALTO, en el borde del fondo. Sin él los árboles asoman por encima
  // del encuadre y se ve el vacío detrás. Sube con el ciudadano: mide 4,6 de
  // alto, y si el punto se quedara por debajo se le cortaría la gorra justo
  // cuando camina por el fondo de la calle.
  new Vector3(wx(PLAY.x), 4.9, wz(PLAY.y)),
  // Los dos de la acera, en el borde CERCANO: es el que manda, porque es
  // donde el encuadre es más estrecho. Sin ellos la calle no tiene lados.
  new Vector3(wx(PLAY.x) * MARGEN_LATERAL, 0, wz(PLAY.y + PLAY.h)),
  new Vector3(wx(PLAY.x + PLAY.w) * MARGEN_LATERAL, 0, wz(PLAY.y + PLAY.h)),
];

/** Coloca la cámara a `dist` del centro, con la inclinación del juego. */
export function colocarCamara(camera: PerspectiveCamera, dist: number) {
  camera.position.set(
    CENTRO.x,
    CENTRO.y + Math.sin(PITCH) * dist,
    CENTRO.z + Math.cos(PITCH) * dist
  );
  camera.lookAt(CENTRO);
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();
}

const _v = new Vector3();

/**
 * Distancia de la cámara al punto MÁS LEJANO del terreno jugable.
 *
 * La niebla se ajusta a partir de esto en vez de con números fijos, y es
 * imprescindible: la cámara se aleja más en unas pantallas que en otras (de 32
 * a 53 unidades), así que una niebla fija que quede bien en el móvil emborrona
 * media zona de juego en el escritorio.
 */
export function distanciaMaximaAlTerreno(camera: PerspectiveCamera): number {
  let max = 0;
  for (const p of PUNTOS_A_ENCUADRAR) {
    max = Math.max(max, camera.position.distanceTo(p));
  }
  return max;
}

/** ¿Cabe el terreno entero con la cámara a esta distancia? */
export function cabeTodo(camera: PerspectiveCamera, dist: number): boolean {
  colocarCamara(camera, dist);
  for (const p of PUNTOS_A_ENCUADRAR) {
    _v.copy(p).project(camera);
    if (Math.abs(_v.x) > MARGEN || Math.abs(_v.y) > MARGEN) return false;
  }
  return true;
}

/**
 * La distancia mínima a la que el terreno cabe entero. La cámara queda
 * colocada a esa distancia al salir.
 *
 * `camera.aspect` tiene que estar puesto ANTES de llamar: es justo lo que
 * hace que el resultado dependa de la forma de la pantalla.
 */
export function distanciaQueEncuadra(camera: PerspectiveCamera): number {
  let lo = 8;
  let hi = 90;

  if (!cabeTodo(camera, hi)) {
    // Pantalla rarísima (muy estrecha o muy apaisada): se aleja hasta que
    // quepa, sin pasar del plano lejano de la cámara.
    while (hi < 110 && !cabeTodo(camera, hi)) hi += 6;
    colocarCamara(camera, hi);
    return hi;
  }

  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (cabeTodo(camera, mid)) hi = mid;
    else lo = mid;
  }
  colocarCamara(camera, hi);
  return hi;
}

// ── Por dónde se anda ───────────────────────────────────────────────────────
// El ciudadano ya no queda encerrado en la calzada: anda por TODO lo que se ve.
// Al fondo, hasta que la cabeza toca el borde de arriba de la pantalla; hacia
// la cámara, hasta que los pies tocan el de abajo; a los lados, por las aceras
// hasta la fachada, o hasta el borde de la pantalla si llega antes.

/** Por dónde puede andar el ciudadano, en unidades de mundo. */
export interface LimitesAndables {
  /** Lo más al fondo (la z más negativa). */
  zLejos: number;
  /** Lo más cerca de la cámara. */
  zCerca: number;
  /** Media anchura que deja el borde de la pantalla en zLejos y en zCerca.
   *  Entre las dos es EXACTAMENTE lineal: el borde de la pantalla sobre el
   *  suelo es una recta. */
  xLejos: number;
  xCerca: number;
  /** Tope de las casas, igual a cualquier profundidad. Va aparte y el mínimo
   *  se toma a cada z: interpolar el mínimo ya hecho recortaba la acera a
   *  media calle. */
  xFachada: number;
}

/** Media anchura andable a la profundidad `z`. */
export function mediaAnchuraAndable(l: LimitesAndables, z: number): number {
  const t = (z - l.zLejos) / (l.zCerca - l.zLejos || 1);
  return Math.min(l.xFachada, l.xLejos + (l.xCerca - l.xLejos) * t);
}

const _a = new Vector3();
const _b = new Vector3();

/** La z donde el rayo que sale a la altura `ndcY` de la pantalla corta el
 *  plano horizontal de altura `y`. */
function zEnPantalla(camera: PerspectiveCamera, ndcY: number, y: number): number {
  _a.set(0, ndcY, -1).unproject(camera);
  _b.set(0, ndcY, 1).unproject(camera);
  const t = (y - _a.y) / (_b.y - _a.y);
  return _a.z + (_b.z - _a.z) * t;
}

/** Hasta qué |x| se ve el suelo a la profundidad `z`. A z fija, la x de la
 *  pantalla es lineal en la x del mundo: bastan dos puntos. */
function mediaAnchuraVisible(camera: PerspectiveCamera, z: number): number {
  const n0 = _a.set(0, 0, z).project(camera).x;
  const n1 = _b.set(1, 0, z).project(camera).x;
  return (MARGEN - n0) / (n1 - n0);
}

/**
 * Hasta qué distancia de la cámara puede alejarse el ciudadano: donde la
 * neblina lo tapa un 30 %. La neblina de game.ts va de lejos × 1,14 a
 * lejos × 1,85 (una prueba vigila que siga así). Con el tope anterior, en
 * lejos × 1,1, se paraba muy por debajo del borde de arriba de la pantalla.
 */
export function distanciaAndableMax(lejos: number): number {
  return lejos * (1.14 + (1.85 - 1.14) * 0.3);
}

/**
 * Los límites por los que anda el ciudadano con la cámara donde está ahora
 * (recién encuadrada). `distanciaMax` evita que en pantallas muy altas se
 * meta en la neblina del fondo.
 */
export function limitesAndables(
  camera: PerspectiveCamera,
  o: {
    lineaCasas: number;
    radioPies: number;
    radioAncho: number;
    alto: number;
    distanciaMax: number;
    /** Hasta dónde puede subir la cabeza, en la escala -1..1 de la pantalla:
     *  por debajo de lo que tape la interfaz. Por omisión, el borde. */
    ndcArriba?: number;
    /** Una z que SIEMPRE se puede alcanzar al fondo, tape lo que tape la
     *  interfaz: el fondo de la calzada, donde nacen las bolsas. */
    zFondoMinimo?: number;
  }
): LimitesAndables {
  const zCerca = zEnPantalla(camera, -MARGEN, 0) - o.radioPies;
  let zLejos = zEnPantalla(camera, Math.min(MARGEN, o.ndcArriba ?? MARGEN), o.alto);
  const altoCamara = camera.position.y;
  if (o.distanciaMax > altoCamara) {
    zLejos = Math.max(zLejos, camera.position.z - Math.sqrt(o.distanciaMax ** 2 - altoCamara ** 2));
  }
  // Va lo último para que gane a los dos topes: sin esto, un marcador alto en
  // una pantalla corta dejaría bolsas del fondo fuera de alcance.
  if (o.zFondoMinimo !== undefined) zLejos = Math.min(zLejos, o.zFondoMinimo);
  return {
    zLejos,
    zCerca,
    // Con el ancho DIBUJADO: con el del torso, en las esquinas de abajo medio
    // cuerpo se salía de la pantalla.
    xLejos: mediaAnchuraVisible(camera, zLejos) - o.radioAncho,
    xCerca: mediaAnchuraVisible(camera, zCerca) - o.radioAncho,
    xFachada: o.lineaCasas - o.radioPies,
  };
}
