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
