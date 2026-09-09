// ============================================================================
// El motor, en 3D. TypeScript puro: ni una importación de React.
//
// ⚠️ LA SIMULACIÓN NO CAMBIÓ AL PASAR DE 2D A 3D. Sigue corriendo en píxeles
// lógicos X/Y con paso fijo de 60 Hz, exactamente igual que en la versión de
// Pixi: aceleración, frenado, colisión con deslizamiento por los bordes,
// recogida, entrega y tropiezo son el mismo código. Lo único que cambió es
// cómo se DIBUJA: la Y de la simulación pasa a ser la Z del mundo.
//
// Por eso `lib/game/` (RNG, bagSplit, world), el servidor, el reclamo atómico
// y las pruebas siguen valiendo sin tocar una línea.
// ============================================================================

import {
  NoToneMapping,
  Color,
  DirectionalLight,
  Fog,
  Group,
  Matrix4,
  HemisphereLight,
  Object3D,
  PerspectiveCamera,
  Plane,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import {
  buildWorld,
  mulberry32,
  CITIZEN_RADIUS,
  CITIZEN_BODY_RADIUS,
  CITIZEN_FEET_RADIUS,
  BAG_RADIUS,
  CART_RADIUS,
  PLAY,
  World,
  WorldObstacle,
} from '@/lib/game/world';
import {
  BolsaVista,
  crearBolsa,
  crearCarretilla,
  crearCiudad,
  crearCiudadano,
  crearObstaculos,
  crearSuelo,
  crearVegetacion,
  sx,
  sy,
  wx,
  wz,
} from './escena';
import {
  CENTRO,
  colocarCamara,
  distanciaMaximaAlTerreno,
  distanciaQueEncuadra,
} from './encuadre';
import { Fx } from './fx';
import { Audio } from './audio';

// ── Ajustes de movimiento: IDÉNTICOS a la versión 2D. Estos números SON el
// juego, y no tienen nada que ver con cómo se dibuje. ────────────────────────
const PASO_MS = 1000 / 60;
const VEL_BASE = 320;
const MUL_CARGA = 0.85;
const MUL_CHARCO = 0.55;
const ACEL = 2600;
const FRENO = 3200;
const RADIO_LLEGADA = 10;
const TROPIEZO_MS = 800;
const VEL_TROPIEZO = 150;
const BOOST_POR_ENTREGA = 0.04;


export interface ResultadoEntrega {
  monto: number;
  finished: boolean;
  error?: string;
}

export interface GameCallbacks {
  onDeposit: (bagId: number) => Promise<ResultadoEntrega>;
  onPickup?: (bagId: number) => void;
  onState?: (s: { bagsLeft: number; carrying: boolean; deposited: number }) => void;
  onCredit?: (monto: number, total: number) => void;
  onFinished?: () => void;
  onError?: (msg: string) => void;
}

export interface GameOptions {
  seed: number;
  alreadyDeposited?: number[];
  reducedMotion?: boolean;
  callbacks: GameCallbacks;
}

export interface GameHandle {
  destroy: () => void;
  setMuted: (v: boolean) => void;
  isMuted: () => boolean;
}

type EstadoBolsa = 'suelo' | 'cargada' | 'entregada';

interface Bolsa {
  id: number;
  x: number;
  y: number;
  estado: EstadoBolsa;
  vista: BolsaVista;
}

export async function createGame(parent: HTMLElement, opts: GameOptions): Promise<GameHandle> {
  const world: World = buildWorld(opts.seed);
  const reduced = !!opts.reducedMotion;

  // ── Render ────────────────────────────────────────────────────────────────
  const renderer = new WebGLRenderer({
    // Sin suavizado de bordes: en móvil cuesta bastante y el estilo low-poly
    // con caras planas casi no lo necesita. El tope de densidad de píxeles
    // hace más por la nitidez que el antialias, y cuesta menos.
    antialias: false,
    powerPreference: 'high-performance',
    stencil: false,
  });
  // Tope de densidad 2: en pantallas de 3× se dibuja a 2× y se estira. Ahorra
  // el 44 % de los píxeles y no se nota. Es de las mayores ganancias en móvil.
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  // SIN mapeo de tonos. ACESFilmic es una curva de cine: comprime los brillos
  // y DESATURA a propósito, que es justo lo contrario de lo que pide un juego
  // de colores vivos. Sin ella los colores salen tal cual se pintaron.
  renderer.toneMapping = NoToneMapping;
  // Sin mapas de sombra: cada luz con sombra redibuja la escena entera. Cada
  // objeto lleva su mancha oscura plana debajo, que cuesta un círculo.
  renderer.shadowMap.enabled = false;
  // El canvas queda ANCLADO al contenedor. Con `position:absolute` no puede
  // empujar el diseño ni desbordarlo aunque su tamaño en píxeles vaya un
  // fotograma por detrás del contenedor al girar el teléfono.
  renderer.domElement.style.cssText =
    'display:block;position:absolute;top:0;left:0;touch-action:none;';
  parent.appendChild(renderer.domElement);

  const scene = new Scene();
  // Este fondo casi no se ve: con la inclinación de 52° y un campo visual de
  // 42°, hasta el rayo más alto de la cámara apunta 31° POR DEBAJO del
  // horizonte, así que todo lo que se ve es suelo. Queda como respaldo.
  scene.background = new Color(0xb9c2d0);
  // Neblina de mediodía, del mismo tono que la losa lejana. Es lo que funde el
  // borde de la escena con la lejanía: como termina antes de donde acaba esa
  // losa, ese borde NUNCA llega a verse. Y al ser del color del suelo urbano,
  // el horizonte se lee como barrio que sigue, no como cielo metiéndose en la
  // escena. Los valores de aquí son solo el arranque: se recalculan por
  // pantalla más abajo.
  const niebla = new Fog(0xb9c2d0, 60, 90);
  scene.fog = niebla;

  const camera = new PerspectiveCamera(42, 1, 0.5, 120);

  // ── Luz ──
  // La suma de TODAS las luces se queda por debajo de ~1,15. Es lo que
  // decide si los colores se ven vivos o lavados: en cuanto la iluminación
  // pasa de 1, el resultado se satura hacia el BLANCO y se come el color del
  // material. Antes sumaban 2,8 y por eso todo se veía desteñido.
  // La saturación se consigue en la PALETA (ver COL en escena.ts), no
  // subiendo las luces.
  // El color de abajo es el rebote del suelo: sobre asfalto es un gris cálido,
  // no el verde de pasto que había cuando esto era un prado.
  const hemi = new HemisphereLight(0xdff1ff, 0x9a9382, 0.42);
  scene.add(hemi);
  // Luz casi blanca, apenas cálida: una direccional muy amarilla ensucia el
  // asfalto hacia el marrón y apaga las fachadas.
  const sol = new DirectionalLight(0xfffdf4, 0.72);
  sol.position.set(-8, 14, 6);
  scene.add(sol);

  // ── Escena ────────────────────────────────────────────────────────────────
  const rndArte = mulberry32((opts.seed ^ 0x5bf03635) >>> 0);
  const mundo = new Group();
  scene.add(mundo);

  mundo.add(crearSuelo(rndArte));
  const veg = crearVegetacion(rndArte, world);
  mundo.add(veg.grupo);
  mundo.add(crearCiudad(rndArte));
  mundo.add(crearObstaculos(world.obstacles));

  const cart = crearCarretilla();
  cart.grupo.position.set(wx(world.cart.x), 0, wz(world.cart.y));
  mundo.add(cart.grupo);

  const yaEntregadas = new Set(opts.alreadyDeposited ?? []);
  const bolsas: Bolsa[] = world.bags.map((b) => {
    const vista = crearBolsa();
    vista.grupo.position.set(wx(b.x), 0, wz(b.y));
    mundo.add(vista.grupo);
    const entregada = yaEntregadas.has(b.id);
    if (entregada) vista.grupo.visible = false;
    return { id: b.id, x: b.x, y: b.y, estado: entregada ? 'entregada' : 'suelo', vista };
  });

  let entregadas = yaEntregadas.size;
  const pintarCarretilla = () => {
    cart.capas.forEach((c, i) => (c.visible = i < entregadas));
  };
  pintarCarretilla();

  const ciu = crearCiudadano();
  mundo.add(ciu.grupo);

  const fx = new Fx();
  mundo.add(fx.grupo);

  // Destello de pantalla completa: en DOM, no en la escena 3D. Un cuadrado a
  // pantalla completa dentro del render cuesta relleno; una capa CSS es gratis.
  const destello = document.createElement('div');
  destello.style.cssText =
    'position:absolute;inset:0;background:#fff;opacity:0;pointer-events:none;';
  parent.appendChild(destello);

  const audio = new Audio();

  // ── Estado de la simulación (en píxeles lógicos, como en 2D) ──────────────
  const sim = {
    x: world.cart.x,
    y: world.cart.y + CART_RADIUS + 40,
    prevX: 0,
    prevY: 0,
    vx: 0,
    vy: 0,
    rumbo: 0,
    cargando: null as number | null,
    tropiezo: 0,
    fasePaso: 0,
    pasoAlterno: false,
    inactivo: 0,
    entregando: false,
    finLento: 0,
    zoomPulso: 0,
    hitstop: 0,
    tiempo: 0,
  };
  sim.prevX = sim.x;
  sim.prevY = sim.y;

  function circuloVsRect(cx: number, cy: number, r: number, o: WorldObstacle) {
    const nx = Math.max(o.x, Math.min(cx, o.x + o.w));
    const ny = Math.max(o.y, Math.min(cy, o.y + o.h));
    const dx = cx - nx;
    const dy = cy - ny;
    return dx * dx + dy * dy < r * r;
  }
  function chocaSolido(x: number, y: number): boolean {
    for (const o of world.obstacles) {
      if (o.solid && circuloVsRect(x, y, CITIZEN_BODY_RADIUS, o)) return true;
    }
    return false;
  }
  function enCharco(x: number, y: number): boolean {
    for (const o of world.obstacles) {
      if (!o.solid && circuloVsRect(x, y, CITIZEN_BODY_RADIUS * 0.6, o)) return true;
    }
    return false;
  }

  while (chocaSolido(sim.x, sim.y) && sim.y < PLAY.y + PLAY.h - 10) sim.y += 8;

  let destino: { x: number; y: number } | null = null;
  let presionando = false;
  const teclas = new Set<string>();

  // ── Cámara ────────────────────────────────────────────────────────────────
  // La distancia la calcula `lib/three/encuadre.ts`, que es un módulo puro
  // (sin DOM) y por eso `npm test` puede comprobar que el terreno cabe entero
  // en 14 proporciones de pantalla reales, desde un móvil estrecho hasta un
  // monitor ultrapanorámico.
  let distCamara = 26;

  function ajustarCamara() {
    const w = Math.round(parent.clientWidth);
    const h = Math.round(parent.clientHeight);
    // El contenedor puede medir 0 en el primer instante (típico en móvil, con
    // la barra del navegador todavía moviéndose). Reintentar es mejor que
    // encuadrar contra un tamaño falso y quedarse así.
    if (w < 2 || h < 2) return;

    // OJO con el tercer parámetro de setSize (`updateStyle`). En `false`,
    // three.js pone los ATRIBUTOS del canvas a ancho × densidad de píxeles
    // pero NO le da tamaño en CSS: con densidad 2 el canvas se muestra al
    // DOBLE de la pantalla y la escena se ve gigante y recortada. Pasaba en
    // móvil y también en Windows con el escalado al 125 %, donde la densidad
    // tampoco es 1. Tiene que quedarse en `true` (el valor por omisión).
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h);
    camera.aspect = w / h;

    distCamara = distanciaQueEncuadra(camera);

    // La niebla arranca DESPUÉS del punto más lejano del terreno jugable, así
    // que no emborrona nada con lo que se juega, y termina antes de donde
    // acaba la losa lejana, así que su borde nunca llega a verse. Se calcula
    // aquí porque la cámara se aleja más en unas pantallas que en otras: unos
    // valores fijos que quedaran bien en el móvil emborronarían media zona de
    // juego en el escritorio.
    const lejos = distanciaMaximaAlTerreno(camera);
    niebla.near = lejos * 1.04;
    niebla.far = lejos * 1.55;

    calcularDestinoHud();
  }

  // ── Destino de los cartones: donde está el contador del HUD ───────────────
  // El HUD es DOM y vive fuera de la escena, así que se proyecta ese punto de
  // la pantalla a una posición del mundo delante de la cámara.
  const destinoHud = new Vector3();
  function calcularDestinoHud() {
    // Esquina superior derecha, que es donde está el contador.
    destinoHud.set(0.72, 0.86, 0.5).unproject(camera);
    // Se acerca a la cámara para que el cartón "salga" de la escena al llegar.
    destinoHud.lerp(camera.position, 0.55);
  }

  ajustarCamara();

  // ── Reencuadre ────────────────────────────────────────────────────────────
  // `window.resize` NO basta en móvil: la barra del navegador aparece y
  // desaparece cambiando la altura útil sin disparar un resize fiable, y el
  // teclado y la rotación tampoco se comportan igual entre navegadores. Un
  // ResizeObserver sobre el propio contenedor se entera de TODOS esos casos,
  // incluido el de arrancar con tamaño 0 y recibir el tamaño real un
  // fotograma después.
  const ro = new ResizeObserver(() => ajustarCamara());
  ro.observe(parent);

  // iOS informa medidas viejas justo al girar el teléfono: se vuelve a medir
  // un momento después.
  const onOrientacion = () => {
    ajustarCamara();
    setTimeout(ajustarCamara, 250);
  };
  window.addEventListener('orientationchange', onOrientacion);
  const onResize = () => ajustarCamara();
  window.addEventListener('resize', onResize);

  // ── Entrada: presionar y caminar ──────────────────────────────────────────
  // Se lanza un rayo desde el puntero contra el plano del suelo. Es exacto con
  // cámara en perspectiva, donde una regla de tres no valdría.
  const rayo = new Raycaster();
  const planoSuelo = new Plane(new Vector3(0, 1, 0), 0);
  const ndc = new Vector2();
  const golpe = new Vector3();

  function aSimulacion(clientX: number, clientY: number): { x: number; y: number } | null {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.x = ((clientX - r.left) / r.width) * 2 - 1;
    ndc.y = -((clientY - r.top) / r.height) * 2 + 1;
    rayo.setFromCamera(ndc, camera);
    if (!rayo.ray.intersectPlane(planoSuelo, golpe)) return null;
    return { x: sx(golpe.x), y: sy(golpe.z) };
  }

  function onDown(e: PointerEvent) {
    audio.despertar();
    presionando = true;
    const p = aSimulacion(e.clientX, e.clientY);
    if (p) destino = p;
    renderer.domElement.setPointerCapture?.(e.pointerId);
  }
  function onMove(e: PointerEvent) {
    if (!presionando) return;
    const p = aSimulacion(e.clientX, e.clientY);
    if (p) destino = p;
  }
  function onUp() {
    // El destino SE MANTIENE: un toque corto camina hasta ahí y se detiene
    // solo. Soltar el dedo no frena en seco.
    presionando = false;
  }
  function onKeyDown(e: KeyboardEvent) {
    teclas.add(e.key.toLowerCase());
  }
  function onKeyUp(e: KeyboardEvent) {
    teclas.delete(e.key.toLowerCase());
  }

  const lienzo = renderer.domElement;
  lienzo.addEventListener('pointerdown', onDown);
  lienzo.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);

  // ── Entrega ───────────────────────────────────────────────────────────────
  async function entregar(bolsa: Bolsa) {
    sim.entregando = true;
    const n = entregadas;

    if (!reduced) {
      sim.hitstop = 70;
      fx.destello(0.35);
      fx.sacudir(0.16);
      sim.zoomPulso = 1;
      navigator.vibrate?.(25);
    }
    audio.entrega(n);

    bolsa.estado = 'entregada';
    ciu.bolsaHombro.visible = false;
    sim.cargando = null;
    entregadas++;
    pintarCarretilla();

    const ultima = entregadas >= bolsas.length;
    const origen = new Vector3(wx(world.cart.x), 1.5, wz(world.cart.y));
    fx.burstCartones(
      origen,
      ultima ? 60 : 20 + Math.floor(Math.random() * 10),
      ultima ? 1.35 : 1,
      destinoHud,
      ultima
    );

    if (ultima && !reduced) sim.finLento = 600;

    opts.callbacks.onState?.({
      bagsLeft: bolsas.filter((b) => b.estado !== 'entregada').length,
      carrying: false,
      deposited: entregadas,
    });

    let res: ResultadoEntrega;
    try {
      res = await opts.callbacks.onDeposit(bolsa.id);
    } catch {
      res = { monto: 0, finished: false, error: 'No se pudo conectar' };
    }

    if (res.error) {
      // El servidor no aceptó la entrega: se DESHACE. Es preferible a que el
      // jugador crea que cobró algo que no cobró.
      bolsa.estado = 'suelo';
      bolsa.vista.grupo.visible = true;
      entregadas--;
      pintarCarretilla();
      opts.callbacks.onError?.(res.error);
      opts.callbacks.onState?.({
        bagsLeft: bolsas.filter((b) => b.estado !== 'entregada').length,
        carrying: false,
        deposited: entregadas,
      });
    } else {
      bolsa.vista.grupo.visible = false;
      opts.callbacks.onCredit?.(res.monto, entregadas);
      if (res.finished) {
        audio.victoria();
        opts.callbacks.onFinished?.();
      }
    }

    sim.entregando = false;
  }

  // ── Un paso de simulación (siempre PASO_MS) ───────────────────────────────
  function paso() {
    const dt = PASO_MS / 1000;
    sim.tiempo += PASO_MS;
    sim.prevX = sim.x;
    sim.prevY = sim.y;

    let kx = 0;
    let ky = 0;
    if (teclas.has('arrowleft') || teclas.has('a')) kx -= 1;
    if (teclas.has('arrowright') || teclas.has('d')) kx += 1;
    if (teclas.has('arrowup') || teclas.has('w')) ky -= 1;
    if (teclas.has('arrowdown') || teclas.has('s')) ky += 1;
    if (kx || ky) destino = null;

    const cargando = sim.cargando !== null;
    let velMax = VEL_BASE * (1 + entregadas * BOOST_POR_ENTREGA);
    if (cargando) velMax *= MUL_CARGA;
    if (enCharco(sim.x, sim.y)) velMax *= MUL_CHARCO;

    if (sim.tropiezo > 0) {
      sim.tropiezo -= PASO_MS;
      sim.vx -= sim.vx * Math.min(1, 6 * dt);
      sim.vy -= sim.vy * Math.min(1, 6 * dt);
    } else if (kx || ky) {
      const l = Math.hypot(kx, ky) || 1;
      sim.vx += ((kx / l) * velMax - sim.vx) * Math.min(1, (ACEL / velMax) * dt);
      sim.vy += ((ky / l) * velMax - sim.vy) * Math.min(1, (ACEL / velMax) * dt);
    } else if (destino) {
      const dx = destino.x - sim.x;
      const dy = destino.y - sim.y;
      const d = Math.hypot(dx, dy);
      if (d > RADIO_LLEGADA) {
        const deseada = Math.min(velMax, d * 5);
        const k = Math.min(1, (ACEL / Math.max(60, velMax)) * dt);
        sim.vx += ((dx / d) * deseada - sim.vx) * k;
        sim.vy += ((dy / d) * deseada - sim.vy) * k;
      } else {
        destino = null;
      }
    } else {
      const k = Math.min(1, (FRENO / Math.max(60, velMax)) * dt);
      sim.vx -= sim.vx * k;
      sim.vy -= sim.vy * k;
    }

    // Movimiento con DESLIZAMIENTO: los ejes se resuelven por separado, así
    // rozar un cono no deja clavado al ciudadano.
    const velAntes = Math.hypot(sim.vx, sim.vy);
    let chocó = false;
    const nx = sim.x + sim.vx * dt;
    if (!chocaSolido(nx, sim.y)) sim.x = nx;
    else {
      sim.vx = 0;
      chocó = true;
    }
    const ny = sim.y + sim.vy * dt;
    if (!chocaSolido(sim.x, ny)) sim.y = ny;
    else {
      sim.vy = 0;
      chocó = true;
    }

    // El bordillo se frena con los PIES, no con el ancho dibujado. Nadie anda
    // por la calle dejando medio metro de aire hasta la acera: se camina hasta
    // pisar el filo, y los hombros vuelan por encima sin que pase nada.
    sim.x = Math.max(PLAY.x + CITIZEN_FEET_RADIUS, Math.min(PLAY.x + PLAY.w - CITIZEN_FEET_RADIUS, sim.x));
    sim.y = Math.max(PLAY.y + CITIZEN_FEET_RADIUS, Math.min(PLAY.y + PLAY.h - CITIZEN_FEET_RADIUS, sim.y));

    // Tropiezo: solo cargando y con velocidad. NO se pierde ni dinero ni la
    // bolsa: se pierde TIEMPO.
    if (chocó && cargando && velAntes > VEL_TROPIEZO && sim.tropiezo <= 0 && !sim.entregando) {
      sim.tropiezo = TROPIEZO_MS;
      const b = bolsas.find((x) => x.id === sim.cargando);
      if (b) {
        b.estado = 'suelo';
        b.x = sim.x;
        b.y = sim.y + 6;
        b.vista.grupo.position.set(wx(b.x), 0, wz(b.y));
        b.vista.grupo.visible = true;
      }
      sim.cargando = null;
      ciu.bolsaHombro.visible = false;
      if (!reduced) {
        fx.sacudir(0.13);
        navigator.vibrate?.(18);
      }
      fx.puffPolvo(wx(sim.x), wz(sim.y), 10, 1.4);
      audio.tropiezo();
      opts.callbacks.onState?.({
        bagsLeft: bolsas.filter((x) => x.estado !== 'entregada').length,
        carrying: false,
        deposited: entregadas,
      });
    }

    // Recoger
    if (sim.cargando === null && sim.tropiezo <= 0 && !sim.entregando) {
      for (const b of bolsas) {
        if (b.estado !== 'suelo') continue;
        if (Math.hypot(b.x - sim.x, b.y - sim.y) < CITIZEN_RADIUS + BAG_RADIUS) {
          b.estado = 'cargada';
          b.vista.grupo.visible = false;
          sim.cargando = b.id;
          ciu.bolsaHombro.visible = true;
          ciu.bolsaHombro.scale.setScalar(0.4);
          if (!reduced) {
            sim.hitstop = 35; // la mitad que al vaciar: este no es EL momento
            navigator.vibrate?.(12);
          }
          audio.agarrar();
          opts.callbacks.onPickup?.(b.id);
          opts.callbacks.onState?.({
            bagsLeft: bolsas.filter((x) => x.estado !== 'entregada').length,
            carrying: true,
            deposited: entregadas,
          });
          break;
        }
      }
    }

    // Entregar
    if (sim.cargando !== null && !sim.entregando && sim.tropiezo <= 0) {
      if (Math.hypot(world.cart.x - sim.x, world.cart.y - sim.y) < CART_RADIUS) {
        const b = bolsas.find((x) => x.id === sim.cargando);
        if (b) void entregar(b);
      }
    }

    // Animación
    const vel = Math.hypot(sim.vx, sim.vy);
    if (vel > 12) {
      sim.inactivo = 0;
      const antes = sim.fasePaso;
      sim.fasePaso += (vel / 46) * dt * 6;
      if (Math.floor(antes / Math.PI) !== Math.floor(sim.fasePaso / Math.PI)) {
        sim.pasoAlterno = !sim.pasoAlterno;
        audio.paso(sim.pasoAlterno);
        if (vel > 150) fx.puffPolvo(wx(sim.x), wz(sim.y), 1, 0.6);
        if (cargando) audio.tintineo();
      }
      // Rumbo: gira hacia donde camina, por el camino corto.
      const objetivo = Math.atan2(sim.vx, sim.vy);
      let d = objetivo - sim.rumbo;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      sim.rumbo += d * Math.min(1, 12 * dt);
    } else {
      sim.inactivo += PASO_MS;
      sim.fasePaso += dt * 0.6;
    }

    if (sim.finLento > 0) sim.finLento -= PASO_MS;
    if (sim.zoomPulso > 0) sim.zoomPulso = Math.max(0, sim.zoomPulso - PASO_MS / 220);
  }

  // ── Render (interpolado) ──────────────────────────────────────────────────
  function render(alpha: number) {
    const px = sim.prevX + (sim.x - sim.prevX) * alpha;
    const py = sim.prevY + (sim.y - sim.prevY) * alpha;

    ciu.grupo.position.set(wx(px), 0, wz(py));
    ciu.grupo.rotation.y = sim.rumbo;

    const vel = Math.hypot(sim.vx, sim.vy);
    const andando = vel > 12 && sim.tropiezo <= 0;

    // Piernas y brazos: el braceo contrario al paso es lo que hace que
    // caminar se lea como caminar y no como deslizarse.
    const swing = andando ? Math.sin(sim.fasePaso) * 0.55 : 0;
    ciu.piernaIzq.rotation.x = swing;
    ciu.piernaDer.rotation.x = -swing;
    ciu.brazoIzq.rotation.x = -swing * 0.8;
    ciu.brazoDer.rotation.x = sim.cargando !== null ? -0.9 : swing * 0.8;

    // Squash al pisar: casi invisible, imprescindible.
    const bob = andando ? Math.abs(Math.sin(sim.fasePaso)) : 0;
    ciu.cuerpo.scale.y = 1 - bob * 0.05;
    ciu.cuerpo.position.y = -bob * 0.04;

    // Inclinación hacia el lado de la carga: el PESO se ve.
    const objetivoRot = sim.tropiezo > 0 ? Math.sin(sim.tropiezo / 40) * 0.45 : sim.cargando !== null ? 0.12 : 0;
    ciu.cuerpo.rotation.z += (objetivoRot - ciu.cuerpo.rotation.z) * 0.2;

    if (ciu.bolsaHombro.visible) {
      const s = ciu.bolsaHombro.scale.x;
      ciu.bolsaHombro.scale.setScalar(s + (1 - s) * 0.18);
      ciu.bolsaHombro.rotation.z = andando ? Math.sin(sim.fasePaso) * 0.14 : 0;
    }

    // Reposo: tras 4 s quieto se estira y mira alrededor. Cuesta poco y
    // cambia por completo si el muñeco se siente vivo o es un adorno.
    if (sim.inactivo > 4000) {
      const t = (sim.inactivo - 4000) / 1000;
      ciu.cuerpo.scale.y *= 1 + Math.sin(t * 2.2) * 0.045;
      ciu.cabeza.rotation.y = Math.sin(t * 1.1) * 0.5;
    } else {
      ciu.cabeza.rotation.y *= 0.9;
    }

    // Bolsas: giran despacio, y laten y brillan al acercarse el ciudadano.
    for (const b of bolsas) {
      if (b.estado !== 'suelo') continue;
      const d = Math.hypot(b.x - px, b.y - py);
      const cerca = Math.max(0, 1 - d / 190);
      const material = b.vista.brillo.material as { opacity: number };
      material.opacity = cerca * (0.45 + Math.sin(sim.tiempo / 160) * 0.22);
      const late = 1 + cerca * 0.1 * (0.6 + Math.sin(sim.tiempo / 190) * 0.4);
      b.vista.cuerpo.scale.setScalar(late);
      b.vista.cuerpo.rotation.y = sim.tiempo / 2200;
      b.vista.cuerpo.position.y = Math.sin(sim.tiempo / 520 + b.id) * 0.04;
    }

    // La carretilla se enciende mientras llevas una bolsa: te dice adónde ir
    // sin una flecha ni un texto.
    const auraMat = cart.aura.material as { opacity: number };
    const objetivoAura = sim.cargando !== null ? 0.45 + Math.sin(sim.tiempo / 200) * 0.2 : 0;
    auraMat.opacity += (objetivoAura - auraMat.opacity) * 0.12;

    // Viento: las copas se mecen. Son ~26 matrices por fotograma, nada.
    const copas = veg.copas.malla;
    veg.copas.datos.forEach((a, i) => {
      const bal = Math.sin(sim.tiempo / 900 + a.fase) * 0.035;
      for (const k of [0, 1]) {
        copas.getMatrixAt(i * 2 + k, _mat4);
        _pos.setFromMatrixPosition(_mat4);
        _esc.setFromMatrixScale(_mat4);
        _obj.position.copy(_pos);
        _obj.scale.copy(_esc);
        _obj.rotation.set(bal, a.fase, bal * 0.6);
        _obj.updateMatrix();
        copas.setMatrixAt(i * 2 + k, _obj.matrix);
      }
    });
    copas.instanceMatrix.needsUpdate = true;

    // ── Cámara ──
    // No sigue al ciudadano (la pantalla es fija) pero RESPIRA: se desplaza
    // muy poco tras él. Una cámara clavada se siente muerta.
    const sh = reduced ? 0 : fx.shake;
    const zoom = 1 - Math.sin(sim.zoomPulso * Math.PI) * 0.035;
    colocarCamara(camera, distCamara * zoom);
    camera.position.x += (wx(px) - CENTRO.x) * 0.05 + (Math.random() - 0.5) * 2 * sh;
    camera.position.z += (wz(py) - CENTRO.z) * 0.03 + (Math.random() - 0.5) * 2 * sh;
    camera.updateMatrixWorld();

    destello.style.opacity = String(reduced ? 0 : fx.flash);

    renderer.render(scene, camera);
  }

  // Objetos reutilizables del bucle: crear vectores por fotograma es basura
  // para el recolector, y una pausa del recolector es un tirón visible.
  const _mat4 = new Matrix4();
  const _pos = new Vector3();
  const _esc = new Vector3();
  const _obj = new Object3D();

  // ── Bucle ─────────────────────────────────────────────────────────────────
  let acumulador = 0;
  let ultimo = performance.now();
  let rafId = 0;
  let corriendo = true;

  const tick = () => {
    if (!corriendo) return;
    rafId = requestAnimationFrame(tick);
    const ahora = performance.now();
    // Se acota a 100 ms: si la pestaña estuvo en segundo plano, no se simulan
    // cinco minutos de golpe (la "espiral de la muerte").
    let dtMs = Math.min(100, ahora - ultimo);
    ultimo = ahora;

    if (sim.finLento > 0) dtMs *= 0.35;

    // Hitstop: el mundo se congela. Los efectos siguen (el destello tiene que
    // verse) pero la simulación no avanza.
    if (sim.hitstop > 0) {
      sim.hitstop -= dtMs;
      fx.update(dtMs);
      render(1);
      return;
    }

    acumulador += dtMs;
    let vueltas = 0;
    while (acumulador >= PASO_MS && vueltas < 6) {
      paso();
      acumulador -= PASO_MS;
      vueltas++;
    }
    fx.update(dtMs);
    render(acumulador / PASO_MS);
  };
  rafId = requestAnimationFrame(tick);

  // Pausa REAL en segundo plano: se para el bucle Y el audio.
  const onVis = () => {
    if (document.hidden) {
      corriendo = false;
      cancelAnimationFrame(rafId);
      audio.pausar();
    } else if (!corriendo) {
      corriendo = true;
      ultimo = performance.now();
      acumulador = 0;
      rafId = requestAnimationFrame(tick);
      audio.reanudar();
    }
  };
  document.addEventListener('visibilitychange', onVis);

  opts.callbacks.onState?.({
    bagsLeft: bolsas.filter((b) => b.estado !== 'entregada').length,
    carrying: false,
    deposited: entregadas,
  });

  // ── Destrucción ───────────────────────────────────────────────────────────
  // Si esto falla, cambiar de pantalla y volver deja el contexto WebGL vivo y
  // crea otro: a la tercera partida el teléfono se muere. Es el bug número uno
  // de meter un motor 3D dentro de React.
  let destruido = false;
  function destroy() {
    if (destruido) return;
    destruido = true;
    corriendo = false;
    cancelAnimationFrame(rafId);
    document.removeEventListener('visibilitychange', onVis);
    ro.disconnect();
    window.removeEventListener('orientationchange', onOrientacion);
    window.removeEventListener('resize', onResize);
    lienzo.removeEventListener('pointerdown', onDown);
    lienzo.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    audio.destroy();

    // Liberar TODA la memoria de la GPU: geometrías, materiales y el contexto.
    scene.traverse((o) => {
      const m = o as unknown as {
        geometry?: { dispose(): void };
        material?: { dispose(): void } | { dispose(): void }[];
      };
      m.geometry?.dispose?.();
      if (Array.isArray(m.material)) m.material.forEach((x) => x.dispose?.());
      else m.material?.dispose?.();
    });
    fx.dispose();
    renderer.dispose();
    renderer.forceContextLoss?.();
    destello.remove();
    lienzo.remove();
  }


  return {
    destroy,
    setMuted: (v: boolean) => audio.setSilencio(v),
    isMuted: () => audio.mudo,
  };
}
