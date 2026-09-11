// ============================================================================
// Colocación determinista del escenario a partir de la semilla del SERVIDOR.
//
// Este módulo corre IGUAL en el navegador y en el servidor. Es lo que impide
// que un cliente modificado se invente bolsas de más o las mueva de sitio: el
// servidor conoce la misma semilla y puede recalcular el escenario entero.
//
// Reglas duras que el generador SIEMPRE cumple (van con pruebas):
//   · Ninguna bolsa encima de un obstáculo ni a menos de MIN_BAG_GAP de otra.
//   · Ninguna bolsa a menos de MIN_CART_DIST de la carretilla (si no, no hay
//     viaje) ni a más de MAX_CART_DIST (~2,5 s de camino).
//   · SIEMPRE existe una ruta libre entre cada bolsa y la carretilla. Se
//     comprueba con una rejilla de ocupación y una inundación desde la
//     carretilla; si alguna bolsa queda aislada, se resortea el escenario.
//   · WORLD_BAGS bolsas (15) por toda la calzada. Se cobran las 5 primeras
//     que el jugador lleve a la carretilla: cuáles, lo elige él.
//
// Nada de Date, Math.random ni DOM: la misma semilla da el mismo escenario en
// cualquier motor de JavaScript.
// ============================================================================

/** Tamaño LÓGICO del escenario. El motor lo escala a la pantalla real, así
 *  que estas coordenadas son idénticas en todos los teléfonos. */
export const STAGE_W = 720;
export const STAGE_H = 1280;

/** Rectángulo por el que el ciudadano puede caminar: el asfalto, de bordillo
 *  a bordillo. Las aceras quedan justo fuera. */
export const PLAY = { x: 52, y: 212, w: 616, h: 950 } as const;

// Estos radios son la simulación, pero también mandan sobre el dibujo: el
// ciudadano y las bolsas se modelan a este tamaño exacto. Si el muñeco se
// dibujara más grande que su radio, atravesaría visiblemente los obstáculos;
// si la bolsa se dibujara más grande que el suyo, se recogería "desde lejos".
//
// El ciudadano tiene TRES radios, y confundirlos fue un error real: al crecer
// de 22 a 48 para que se le viera la cara, el mismo número que mide su ancho
// dibujado se estaba usando también para apartarlo del bordillo, y le comía
// 48 px de calle por cada lado. Se quedaba clavado a un palmo de la línea sin
// motivo visible. Son tres cosas distintas y se miden por separado, cada una
// sobre la parte del cuerpo que de verdad hace ese trabajo:
export const CITIZEN_RADIUS = 48; // ancho DIBUJADO (brazos y cabeza incluidos)
export const CITIZEN_BODY_RADIUS = 32; // el TORSO: lo que choca con las cosas
export const CITIZEN_FEET_RADIUS = 26; // los PIES: lo único que pisa la calle
// Era 36. Se agrandó para que las bolsas se vean bien sobre la calle: la
// escena escala su modelo con este mismo número.
export const BAG_RADIUS = 48;
export const CART_RADIUS = 100;

// La separación mínima entre bolsas y la holgura con los obstáculos suben con
// el radio de la bolsa: con bolsas de 36 y una separación de 90 quedarían a
// 18 px de distancia entre bordes, prácticamente pegadas. Se calculan a partir
// del radio para que agrandar la bolsa no las pegue: 24 px entre bordes.
// MEDIDO con 15 bolsas en la calzada: con 36 px fallaba el 30 % de los
// intentos de colocación; con 24, el 3,7 % (y esos se resortean).
const MIN_BAG_GAP = BAG_RADIUS * 2 + 24;
// Y la distancia mínima a la carretilla sube con CART_RADIUS: con una tolva de
// 100 y una bolsa de 36, cualquier valor por debajo de 136 pondría la bolsa
// DENTRO de la carretilla y el viaje duraría cero pasos.
const MIN_CART_DIST = 205;
const MAX_CART_DIST = 620;
/** Holgura entre el centro de una bolsa y cualquier obstáculo: su radio y
 *  10 px de aire. */
const BAG_CLEARANCE = BAG_RADIUS + 10;

/** Las bolsas que se ENTREGAN (y cobran) en cada partida. */
export const TOTAL_BAGS = 5;
/** Las bolsas que hay en la calle. Las que sobran no pagan nada: son elección. */
export const WORLD_BAGS = 15;
/** De esas, las que van sobre la ACERA, la mitad a cada lado: así no quedan
 *  todas amontonadas en la calzada. */
export const SIDEWALK_BAGS = 4;
/** Del bordillo al centro de una bolsa de acera. La acera (68 px) es más
 *  estrecha que la bolsa (96): a 30 px el saco no se mete en la fachada y solo
 *  asoma un poco sobre el bordillo. */
export const SIDEWALK_BAG_OFFSET = 30;
/** Tramo de la calle donde van: por debajo del marcador y lejos de la parte
 *  cercana a la cámara, donde en un teléfono estrecho la acera se sale de la
 *  pantalla. Las pruebas lo comprueban en 14 pantallas. */
export const SIDEWALK_BAG_Y = { min: PLAY.y + 110, max: PLAY.y + PLAY.h * 0.75 } as const;
/** Los postes de luz de la acera, cada 11 unidades (440 px). Tiene que
 *  coincidir con Z_POSTES de la escena: hay prueba. */
export const POSTE_Y: readonly number[] = Array.from(
  { length: 11 },
  (_, i) => PLAY.y + PLAY.h / 2 + (-55 + i * 11) * 40
);

/**
 * Lo que estorba en una calle descuidada. La lista sale de la referencia, no
 * de la imaginación: contenedores de basura volcados, cartones aplastados,
 * ruedas viejas, cajas, conos y cascotes. Fuera quedaron el palé (no aparece
 * en ninguna calle así) y el charco (esta calle está seca y castigada por el
 * sol, no encharcada).
 */
export type ObstacleKind = 'escombro' | 'carton' | 'rueda' | 'caja' | 'cono' | 'contenedor';

export interface WorldObstacle {
  x: number;
  y: number;
  w: number;
  h: number;
  kind: ObstacleKind;
  /** false = no bloquea el paso, solo frena (charcos) */
  solid: boolean;
}

export interface WorldBag {
  id: number;
  x: number;
  y: number;
}

export interface World {
  seed: number;
  cart: { x: number; y: number };
  bags: WorldBag[];
  obstacles: WorldObstacle[];
}

/** PRNG determinista. Mismo entero → misma secuencia, en cualquier motor. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const dist = (ax: number, ay: number, bx: number, by: number) =>
  Math.sqrt((ax - bx) * (ax - bx) + (ay - by) * (ay - by));

/** Distancia de un punto al rectángulo (0 si está dentro) */
function distToRect(px: number, py: number, r: { x: number; y: number; w: number; h: number }) {
  const dx = Math.max(r.x - px, 0, px - (r.x + r.w));
  const dy = Math.max(r.y - py, 0, py - (r.y + r.h));
  return Math.sqrt(dx * dx + dy * dy);
}

// `solid: false` = se puede pisar, solo frena. Hoy solo el cartón aplastado,
// que está tirado plano contra el suelo: bloquear el paso con una lámina de
// cartón de un centímetro se lee como un fallo, no como un obstáculo.
//
// El contenedor hereda el hueco que dejó el charco en la lista, pero al revés:
// es el obstáculo más GRANDE y sí bloquea. Es lo que pide la referencia, donde
// hay dos volcados en mitad de la calzada.
const OBSTACLE_SIZES: Record<ObstacleKind, { w: number; h: number; solid: boolean }> = {
  escombro: { w: 56, h: 42, solid: true },
  carton: { w: 112, h: 86, solid: false },
  rueda: { w: 46, h: 40, solid: true },
  caja: { w: 64, h: 54, solid: true },
  cono: { w: 72, h: 64, solid: true },
  contenedor: { w: 98, h: 78, solid: true },
};

const KINDS: ObstacleKind[] = ['escombro', 'carton', 'rueda', 'caja', 'cono', 'contenedor'];

// ── Rejilla de ocupación e inundación ──────────────────────────────────────
// Se comprueba que exista camino con una rejilla gruesa: cada celda queda
// bloqueada si un obstáculo sólido, inflado por el radio del ciudadano, la
// toca. Después se inunda desde la carretilla y se mira si cada bolsa quedó
// alcanzada. Es la garantía de que ninguna partida nace imposible.

const CELL = 20;

function buildGrid(obstacles: WorldObstacle[]) {
  const cols = Math.ceil(PLAY.w / CELL);
  const rows = Math.ceil(PLAY.h / CELL);
  const blocked = new Uint8Array(cols * rows);
  for (const o of obstacles) {
    if (!o.solid) continue;
    // El torso, no el ancho dibujado: los brazos pasan por encima de un palé
    // sin engancharse, y contarlos aquí estrecharía los pasillos sin motivo.
    const pad = CITIZEN_BODY_RADIUS;
    const x0 = Math.floor((o.x - pad - PLAY.x) / CELL);
    const x1 = Math.ceil((o.x + o.w + pad - PLAY.x) / CELL);
    const y0 = Math.floor((o.y - pad - PLAY.y) / CELL);
    const y1 = Math.ceil((o.y + o.h + pad - PLAY.y) / CELL);
    for (let gy = Math.max(0, y0); gy < Math.min(rows, y1); gy++) {
      for (let gx = Math.max(0, x0); gx < Math.min(cols, x1); gx++) {
        blocked[gy * cols + gx] = 1;
      }
    }
  }
  return { cols, rows, blocked };
}

function cellOf(x: number, y: number, cols: number, rows: number) {
  const gx = Math.min(cols - 1, Math.max(0, Math.floor((x - PLAY.x) / CELL)));
  const gy = Math.min(rows - 1, Math.max(0, Math.floor((y - PLAY.y) / CELL)));
  return gy * cols + gx;
}

/** ¿Todas las bolsas tienen camino hasta la carretilla? */
function allReachable(world: World): boolean {
  const { cols, rows, blocked } = buildGrid(world.obstacles);
  const start = cellOf(world.cart.x, world.cart.y, cols, rows);
  if (blocked[start]) return false;

  const seen = new Uint8Array(cols * rows);
  const queue = new Int32Array(cols * rows);
  let head = 0;
  let tail = 0;
  queue[tail++] = start;
  seen[start] = 1;

  while (head < tail) {
    const cur = queue[head++];
    const cx = cur % cols;
    const cy = (cur / cols) | 0;
    // 4 vecinos: basta para conectividad y evita colarse por diagonales
    const neigh = [
      cx > 0 ? cur - 1 : -1,
      cx < cols - 1 ? cur + 1 : -1,
      cy > 0 ? cur - cols : -1,
      cy < rows - 1 ? cur + cols : -1,
    ];
    for (const n of neigh) {
      if (n < 0 || seen[n] || blocked[n]) continue;
      seen[n] = 1;
      queue[tail++] = n;
    }
  }

  return world.bags.every((b) => seen[cellOf(b.x, b.y, cols, rows)] === 1);
}

// ── Generación ─────────────────────────────────────────────────────────────

/** Las 9 celdas de una rejilla 3×3 sobre el área jugable. La carretilla vive
 *  en la del centro y las bolsas salen de las otras ocho: así el recorrido
 *  usa toda la pantalla en vez de amontonarse en una esquina. */
function sectorRects() {
  const w = PLAY.w / 3;
  const h = PLAY.h / 3;
  const out: { x: number; y: number; w: number; h: number; i: number }[] = [];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      out.push({ x: PLAY.x + c * w, y: PLAY.y + r * h, w, h, i: r * 3 + c });
    }
  }
  return out;
}

function intento(seed: number): World | null {
  const rnd = mulberry32(seed);
  const sectors = sectorRects();
  const centro = sectors[4];

  // Carretilla: en la celda central. Ya no cabe con su radio entero de margen
  // (la celda mide 205 de ancho y el radio es 100), y tampoco hace falta: la
  // celda central está a una celda entera de cualquier borde de la calzada,
  // así que la tolva puede asomar a las celdas vecinas sin pisar la acera. Lo
  // que sí hace falta es que quede MARGEN DE SORTEO, o la carretilla saldría
  // clavada en el mismo punto en todas las partidas.
  const margen = (medida: number) => Math.min(CART_RADIUS, medida * 0.28);
  const cart = {
    x: centro.x + margen(centro.w) + rnd() * (centro.w - margen(centro.w) * 2),
    y: centro.y + margen(centro.h) + rnd() * (centro.h - margen(centro.h) * 2),
  };

  // WORLD_BAGS bolsas por toda la calzada, cada una con hasta 80 tiros para
  // cumplir las distancias. Si alguna no cabe, se resortea el escenario.
  // Las SIDEWALK_BAGS primeras van a la acera, alternando lado y nunca junto
  // a un poste.
  const bags: WorldBag[] = [];
  for (let i = 0; i < WORLD_BAGS; i++) {
    const enAcera = i < SIDEWALK_BAGS;
    let colocada: WorldBag | null = null;
    for (let t = 0; t < 80 && !colocada; t++) {
      let x: number;
      let y: number;
      if (enAcera) {
        x = i % 2 === 0 ? PLAY.x - SIDEWALK_BAG_OFFSET : PLAY.x + PLAY.w + SIDEWALK_BAG_OFFSET;
        y = SIDEWALK_BAG_Y.min + rnd() * (SIDEWALK_BAG_Y.max - SIDEWALK_BAG_Y.min);
        if (POSTE_Y.some((py) => Math.abs(py - y) < BAG_RADIUS + 30)) continue;
      } else {
        x = PLAY.x + BAG_RADIUS + rnd() * (PLAY.w - BAG_RADIUS * 2);
        y = PLAY.y + BAG_RADIUS + rnd() * (PLAY.h - BAG_RADIUS * 2);
      }
      const d = dist(x, y, cart.x, cart.y);
      if (d < MIN_CART_DIST || d > MAX_CART_DIST) continue;
      if (bags.some((b) => dist(x, y, b.x, b.y) < MIN_BAG_GAP)) continue;
      colocada = { id: i, x, y };
    }
    if (!colocada) return null;
    bags.push(colocada);
  }

  // Obstáculos: entre 8 y 12, siempre lejos de las bolsas y de la carretilla.
  const cuantos = 8 + Math.floor(rnd() * 5);
  const obstacles: WorldObstacle[] = [];
  for (let i = 0; i < cuantos; i++) {
    const kind = KINDS[Math.floor(rnd() * KINDS.length)];
    const size = OBSTACLE_SIZES[kind];
    for (let t = 0; t < 30; t++) {
      const x = PLAY.x + rnd() * (PLAY.w - size.w);
      const y = PLAY.y + rnd() * (PLAY.h - size.h);
      const rect = { x, y, w: size.w, h: size.h };
      // Nunca encima de una bolsa ni pisando la boca de la carretilla.
      if (bags.some((b) => distToRect(b.x, b.y, rect) < BAG_CLEARANCE)) continue;
      // +70 y no +30: los mangos sobresalen por detrás de la tolva, y un palé
      // atravesado encima de ellos se ve como un fallo de colocación.
      if (distToRect(cart.x, cart.y, rect) < CART_RADIUS + 70) continue;
      if (obstacles.some((o) => distToRect(o.x + o.w / 2, o.y + o.h / 2, rect) < 40)) continue;
      obstacles.push({ ...rect, kind, solid: size.solid });
      break;
    }
  }

  return { seed, cart, bags, obstacles };
}

/**
 * El escenario de una partida. Determinista: misma semilla, mismo escenario,
 * en el cliente y en el servidor.
 *
 * Si un intento no cumple las reglas (bolsa aislada, distancias imposibles),
 * se resortea con una semilla derivada. Tras 24 intentos se devuelve el
 * escenario sin obstáculos, que siempre es válido — es una red de seguridad
 * que en la práctica no se alcanza nunca, pero garantiza que esta función
 * JAMÁS deja a un jugador sin partida.
 */
export function buildWorld(seed: number): World {
  for (let i = 0; i < 24; i++) {
    const w = intento((seed + i * 0x9e3779b1) >>> 0);
    if (w && allReachable(w)) return w;
  }
  const base = intento(seed >>> 0);
  if (base) return { ...base, obstacles: [] };
  // Último recurso, imposible en la práctica: posiciones fijas que cumplen
  // todas las distancias. Cuatro en la acera (entre postes) y el resto en una
  // rejilla de 4 columnas cada 154 px, dos filas por encima y dos por debajo
  // de la carretilla, quitando las que quedan pegadas a las de la acera.
  const acera = [400, 850].flatMap((y) => [
    { x: PLAY.x - SIDEWALK_BAG_OFFSET, y },
    { x: PLAY.x + PLAY.w + SIDEWALK_BAG_OFFSET, y },
  ]);
  const xs = [0, 1, 2, 3].map((c) => PLAY.x + PLAY.w / 8 + (c * PLAY.w) / 4);
  const calzada = [262, 402, 972, 1112]
    .flatMap((y) => xs.map((x) => ({ x, y })))
    .filter((p) => acera.every((a) => dist(p.x, p.y, a.x, a.y) >= MIN_BAG_GAP));
  return {
    seed,
    cart: { x: STAGE_W / 2, y: PLAY.y + PLAY.h / 2 },
    bags: [...acera, ...calzada].slice(0, WORLD_BAGS).map((p, i) => ({ id: i, ...p })),
    obstacles: [],
  };
}
