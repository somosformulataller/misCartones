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
//   · Las 5 repartidas en celdas distintas, para que el recorrido use toda
//     la pantalla.
//
// Nada de Date, Math.random ni DOM: la misma semilla da el mismo escenario en
// cualquier motor de JavaScript.
// ============================================================================

/** Tamaño LÓGICO del escenario. El motor lo escala a la pantalla real, así
 *  que estas coordenadas son idénticas en todos los teléfonos. */
export const STAGE_W = 720;
export const STAGE_H = 1280;

/** Rectángulo por el que el ciudadano puede caminar (dentro de las aceras). */
export const PLAY = { x: 52, y: 212, w: 616, h: 950 } as const;

export const CITIZEN_RADIUS = 22;
export const BAG_RADIUS = 26;
export const CART_RADIUS = 62;

const MIN_BAG_GAP = 90;
const MIN_CART_DIST = 140;
const MAX_CART_DIST = 620;
/** Holgura entre una bolsa y cualquier obstáculo */
const BAG_CLEARANCE = 34;

export const TOTAL_BAGS = 5;

export type ObstacleKind = 'cono' | 'escombros' | 'hueco' | 'alcantarilla' | 'charco' | 'moto';

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

const OBSTACLE_SIZES: Record<ObstacleKind, { w: number; h: number; solid: boolean }> = {
  cono: { w: 34, h: 34, solid: true },
  escombros: { w: 74, h: 46, solid: true },
  hueco: { w: 58, h: 44, solid: true },
  alcantarilla: { w: 46, h: 46, solid: true },
  charco: { w: 96, h: 58, solid: false },
  moto: { w: 52, h: 96, solid: true },
};

const KINDS: ObstacleKind[] = ['cono', 'escombros', 'hueco', 'alcantarilla', 'charco', 'moto'];

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
    const pad = CITIZEN_RADIUS;
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

  // Carretilla: en la celda central, con holgura para su propio tamaño.
  const cart = {
    x: centro.x + CART_RADIUS + rnd() * (centro.w - CART_RADIUS * 2),
    y: centro.y + CART_RADIUS + rnd() * (centro.h - CART_RADIUS * 2),
  };

  // Cinco de las ocho celdas de alrededor, barajadas.
  const around = sectors.filter((s) => s.i !== 4);
  for (let i = around.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [around[i], around[j]] = [around[j], around[i]];
  }
  const elegidas = around.slice(0, TOTAL_BAGS);

  // Una bolsa por celda, con hasta 40 tiros para cumplir las distancias.
  const bags: WorldBag[] = [];
  for (let i = 0; i < TOTAL_BAGS; i++) {
    const s = elegidas[i];
    let colocada: WorldBag | null = null;
    for (let t = 0; t < 40 && !colocada; t++) {
      const x = s.x + BAG_RADIUS + rnd() * (s.w - BAG_RADIUS * 2);
      const y = s.y + BAG_RADIUS + rnd() * (s.h - BAG_RADIUS * 2);
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
      if (distToRect(cart.x, cart.y, rect) < CART_RADIUS + 30) continue;
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
  // Último recurso, imposible en la práctica: escenario mínimo válido.
  return {
    seed,
    cart: { x: STAGE_W / 2, y: PLAY.y + PLAY.h / 2 },
    bags: Array.from({ length: TOTAL_BAGS }, (_, i) => ({
      id: i,
      x: PLAY.x + ((i + 1) * PLAY.w) / (TOTAL_BAGS + 1),
      y: PLAY.y + 80,
    })),
    obstacles: [],
  };
}
