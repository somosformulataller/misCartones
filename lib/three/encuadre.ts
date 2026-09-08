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

/** Inclinación de la cámara sobre el horizonte. 52° deja ver el volumen de
 *  los objetos sin perder la lectura cenital que necesita el juego. */
export const PITCH = (52 * Math.PI) / 180;

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
  new Vector3(wx(PLAY.x), 3.4, wz(PLAY.y)),
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
