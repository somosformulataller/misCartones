// ============================================================================
// El motor. TypeScript puro: ni una importación de React.
//
// React monta esto, le pasa callbacks y lo destruye. El bucle de juego vive
// fuera del ciclo de renderizado de React a propósito — es de donde vienen los
// tirones cuando se mezclan.
//
// Simulación de PASO FIJO a 60 Hz con acumulador, y render interpolado: la
// física es idéntica aunque el teléfono baje a 45 fps.
// ============================================================================

import { Application, Container, Graphics, Rectangle } from 'pixi.js';
import {
  buildWorld,
  mulberry32,
  CITIZEN_RADIUS,
  BAG_RADIUS,
  CART_RADIUS,
  PLAY,
  STAGE_H,
  STAGE_W,
  World,
  WorldObstacle,
} from '@/lib/game/world';
import {
  COLORS,
  drawBackground,
  drawObstacle,
  makeBag,
  makeCart,
  makeCartonTexture,
  makeCitizen,
  makeDustTexture,
  paintCartFill,
} from './art';
import { Fx } from './fx';
import { Audio } from './audio';

// ── Ajustes de movimiento. Estos números SON el juego: son lo que se toca
// en la Fase 1 hasta que caminar se sienta bien. ────────────────────────────
const PASO_MS = 1000 / 60;
const VEL_BASE = 320; // px/s
const MUL_CARGA = 0.85; // 15 % más lento cargando (se NOTA que lleva algo)
const MUL_CHARCO = 0.55;
const ACEL = 2600; // px/s²
const FRENO = 3200;
const RADIO_LLEGADA = 10;
const TROPIEZO_MS = 800;
const VEL_TROPIEZO = 150; // por debajo de esto, rozar no hace tropezar
const BOOST_POR_ENTREGA = 0.04; // camina un 4 % más rápido por bolsa entregada

/** Punto lógico al que vuelan los cartones: donde está el contador del HUD. */
const DESTINO_HUD = { x: STAGE_W - 116, y: 46 };

export interface ResultadoEntrega {
  monto: number;
  finished: boolean;
  error?: string;
}

export interface GameCallbacks {
  /** Se llama al VACIAR en la carretilla. Es lo único que toca el servidor. */
  onDeposit: (bagId: number) => Promise<ResultadoEntrega>;
  onPickup?: (bagId: number) => void;
  onState?: (s: { bagsLeft: number; carrying: boolean; deposited: number }) => void;
  onCredit?: (monto: number, total: number) => void;
  onFinished?: () => void;
  onError?: (msg: string) => void;
}

export interface GameOptions {
  seed: number;
  /** Bolsas ya entregadas (partida reanudada). */
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
  view: Container;
  glow: Graphics;
  body: Container;
}

export async function createGame(parent: HTMLElement, opts: GameOptions): Promise<GameHandle> {
  const world: World = buildWorld(opts.seed);
  const reduced = !!opts.reducedMotion;

  const app = new Application();
  await app.init({
    resizeTo: parent,
    background: 0x14171a,
    antialias: true,
    // Tope de densidad 2: en pantallas de 3× se dibuja a 2× y se estira.
    // Ahorra el 44 % de los píxeles y no se nota.
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    autoDensity: true,
    powerPreference: 'high-performance',
  });
  parent.appendChild(app.canvas);
  app.canvas.style.touchAction = 'none';
  app.canvas.style.display = 'block';

  // ── Escena ────────────────────────────────────────────────────────────────
  const root = new Container(); // se escala a la pantalla
  const camara = new Container(); // temblor y respiración
  root.addChild(camara);
  app.stage.addChild(root);

  const rndArte = mulberry32((opts.seed ^ 0x5bf03635) >>> 0);
  camara.addChild(drawBackground(rndArte));

  // Capa de juego: aquí SÍ se ordena por Y en cada fotograma, que es lo que
  // hace que el ciudadano pase por detrás de lo que está más abajo.
  const capaJuego = new Container();
  capaJuego.sortableChildren = true;
  camara.addChild(capaJuego);

  // Obstáculos (estáticos: se crean una vez y no se tocan nunca más)
  for (const o of world.obstacles) {
    const v = drawObstacle(o);
    v.zIndex = o.y + o.h;
    // Los charcos van por debajo de todo lo demás: se pisan, no se rodean.
    if (!o.solid) v.zIndex = PLAY.y - 1;
    capaJuego.addChild(v);
  }

  // Carretilla
  const cart = makeCart();
  cart.view.x = world.cart.x;
  cart.view.y = world.cart.y;
  cart.view.zIndex = world.cart.y;
  capaJuego.addChild(cart.view);

  // Bolsas
  const yaEntregadas = new Set(opts.alreadyDeposited ?? []);
  const bolsas: Bolsa[] = world.bags.map((b) => {
    const m = makeBag();
    m.view.x = b.x;
    m.view.y = b.y;
    m.view.zIndex = b.y;
    capaJuego.addChild(m.view);
    const entregada = yaEntregadas.has(b.id);
    if (entregada) m.view.visible = false;
    return {
      id: b.id,
      x: b.x,
      y: b.y,
      estado: entregada ? 'entregada' : 'suelo',
      view: m.view,
      glow: m.glow,
      body: m.body,
    };
  });

  let entregadas = yaEntregadas.size;
  paintCartFill(cart.monton, entregadas);

  // Ciudadano
  const ciu = makeCitizen();
  capaJuego.addChild(ciu.view);

  // Efectos
  const texCarton = makeCartonTexture(app.renderer);
  const texPolvo = makeDustTexture(app.renderer);
  const fx = new Fx(texCarton, texPolvo);
  camara.addChild(fx.capa);

  // Destello de pantalla completa (por encima de todo, fuera de la cámara)
  const flash = new Graphics();
  flash.rect(0, 0, STAGE_W, STAGE_H).fill(0xffffff);
  flash.alpha = 0;
  root.addChild(flash);

  const audio = new Audio();

  // ── Estado de la simulación ───────────────────────────────────────────────
  const sim = {
    x: world.cart.x,
    y: world.cart.y + CART_RADIUS + 40,
    prevX: 0,
    prevY: 0,
    vx: 0,
    vy: 0,
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

  // El punto de salida podría caer sobre un obstáculo: se empuja fuera.
  while (chocaSolido(sim.x, sim.y) && sim.y < PLAY.y + PLAY.h - 10) sim.y += 8;

  let destino: { x: number; y: number } | null = null;
  let presionando = false;
  const teclas = new Set<string>();

  // ── Colisiones ────────────────────────────────────────────────────────────
  function circuloVsRect(cx: number, cy: number, r: number, o: WorldObstacle) {
    const nx = Math.max(o.x, Math.min(cx, o.x + o.w));
    const ny = Math.max(o.y, Math.min(cy, o.y + o.h));
    const dx = cx - nx;
    const dy = cy - ny;
    return dx * dx + dy * dy < r * r;
  }

  function chocaSolido(x: number, y: number): boolean {
    for (const o of world.obstacles) {
      if (o.solid && circuloVsRect(x, y, CITIZEN_RADIUS, o)) return true;
    }
    return false;
  }

  function enCharco(x: number, y: number): boolean {
    for (const o of world.obstacles) {
      if (!o.solid && circuloVsRect(x, y, CITIZEN_RADIUS * 0.6, o)) return true;
    }
    return false;
  }

  // ── Entrada: presionar y caminar ──────────────────────────────────────────
  // El ciudadano camina HACIA donde está el dedo, no debajo de él. Así el
  // pulgar nunca tapa al personaje, que es el problema número uno del táctil.
  function aLogico(clientX: number, clientY: number) {
    const rect = app.canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left - root.x) / root.scale.x,
      y: (clientY - rect.top - root.y) / root.scale.y,
    };
  }

  function onDown(e: PointerEvent) {
    audio.despertar();
    presionando = true;
    destino = aLogico(e.clientX, e.clientY);
    app.canvas.setPointerCapture?.(e.pointerId);
  }
  function onMove(e: PointerEvent) {
    if (!presionando) return;
    destino = aLogico(e.clientX, e.clientY);
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

  app.canvas.addEventListener('pointerdown', onDown);
  app.canvas.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);

  // ── Escalado a la pantalla ────────────────────────────────────────────────
  function layout() {
    const w = app.screen.width;
    const h = app.screen.height;
    const s = Math.min(w / STAGE_W, h / STAGE_H);
    root.scale.set(s);
    root.x = (w - STAGE_W * s) / 2;
    root.y = (h - STAGE_H * s) / 2;
  }
  layout();
  app.renderer.on('resize', layout);

  // ── Entrega ───────────────────────────────────────────────────────────────
  async function entregar(bolsa: Bolsa) {
    sim.entregando = true;
    const n = entregadas; // 0-4: qué número de entrega es esta

    // Todo lo VISUAL ocurre ya, sin esperar al servidor: el jugador no puede
    // notar el viaje de red. El monto llega después y es lo único que espera.
    if (!reduced) {
      sim.hitstop = 70;
      fx.destello(0.35);
      fx.sacudir(6);
      sim.zoomPulso = 1;
      navigator.vibrate?.(25);
    }
    audio.entrega(n);

    bolsa.estado = 'entregada';
    ciu.bolsaHombro.visible = false;
    sim.cargando = null;
    entregadas++;
    paintCartFill(cart.monton, entregadas);

    const ultima = entregadas >= bolsas.length;
    const fuerza = ultima ? 1.35 : 1;
    const cuantos = ultima ? 46 : 18 + Math.floor(Math.random() * 11);
    fx.burstCartones(world.cart.x, world.cart.y - 16, cuantos, fuerza, DESTINO_HUD);

    if (ultima && !reduced) {
      // Cámara lenta del clímax
      sim.finLento = 600;
    }

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
      // El servidor no aceptó la entrega: se DESHACE. La bolsa vuelve al
      // suelo donde estaba y la carretilla baja un escalón. Es preferible
      // eso a que el jugador crea que cobró algo que no cobró.
      bolsa.estado = 'suelo';
      bolsa.view.visible = true;
      entregadas--;
      paintCartFill(cart.monton, entregadas);
      opts.callbacks.onError?.(res.error);
      opts.callbacks.onState?.({
        bagsLeft: bolsas.filter((b) => b.estado !== 'entregada').length,
        carrying: false,
        deposited: entregadas,
      });
    } else {
      bolsa.view.visible = false;
      fx.flotante(
        world.cart.x,
        world.cart.y - 60,
        `+$${res.monto.toFixed(2)}`,
        ultima ? 0xffe6a0 : 0xffd873,
        ultima ? 46 : 34
      );
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

    // Teclado: manda sobre el destino del puntero mientras se pulsa.
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
      // Tropezando: no responde. Frena solo.
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
        // Cerca del destino desacelera: llega y se para, sin pasarse.
        const deseada = Math.min(velMax, d * 5);
        const tvx = (dx / d) * deseada;
        const tvy = (dy / d) * deseada;
        const k = Math.min(1, (ACEL / Math.max(60, velMax)) * dt);
        sim.vx += (tvx - sim.vx) * k;
        sim.vy += (tvy - sim.vy) * k;
      } else {
        destino = null;
      }
    } else {
      const k = Math.min(1, (FRENO / Math.max(60, velMax)) * dt);
      sim.vx -= sim.vx * k;
      sim.vy -= sim.vy * k;
    }

    // ── Movimiento con DESLIZAMIENTO por los bordes ──
    // Los ejes se resuelven por separado: si X choca se anula solo X y el
    // ciudadano sigue avanzando en Y, rozando el obstáculo. Sin esto, un cono
    // te deja clavado y el juego se siente roto.
    const velAntes = Math.hypot(sim.vx, sim.vy);
    let chocó = false;

    const nx = sim.x + sim.vx * dt;
    if (!chocaSolido(nx, sim.y)) {
      sim.x = nx;
    } else {
      sim.vx = 0;
      chocó = true;
    }
    const ny = sim.y + sim.vy * dt;
    if (!chocaSolido(sim.x, ny)) {
      sim.y = ny;
    } else {
      sim.vy = 0;
      chocó = true;
    }

    sim.x = Math.max(PLAY.x + CITIZEN_RADIUS, Math.min(PLAY.x + PLAY.w - CITIZEN_RADIUS, sim.x));
    sim.y = Math.max(PLAY.y + CITIZEN_RADIUS, Math.min(PLAY.y + PLAY.h - CITIZEN_RADIUS, sim.y));

    // Tropiezo: solo si iba cargando y con velocidad. Rozar un cono despacio
    // no castiga. Y aun tropezando NO se pierde ni dinero ni la bolsa: se
    // pierde TIEMPO. La bolsa cae al suelo y se vuelve a recoger.
    if (chocó && cargando && velAntes > VEL_TROPIEZO && sim.tropiezo <= 0 && !sim.entregando) {
      sim.tropiezo = TROPIEZO_MS;
      const b = bolsas.find((x) => x.id === sim.cargando);
      if (b) {
        b.estado = 'suelo';
        b.x = sim.x;
        b.y = sim.y + 6;
        b.view.x = b.x;
        b.view.y = b.y;
        b.view.visible = true;
      }
      sim.cargando = null;
      ciu.bolsaHombro.visible = false;
      if (!reduced) {
        fx.sacudir(5);
        navigator.vibrate?.(18);
      }
      fx.puffPolvo(sim.x, sim.y + 16, 10, 1.4);
      audio.tropiezo();
      opts.callbacks.onState?.({
        bagsLeft: bolsas.filter((x) => x.estado !== 'entregada').length,
        carrying: false,
        deposited: entregadas,
      });
    }

    // ── Recoger ──
    if (sim.cargando === null && sim.tropiezo <= 0 && !sim.entregando) {
      for (const b of bolsas) {
        if (b.estado !== 'suelo') continue;
        if (Math.hypot(b.x - sim.x, b.y - sim.y) < CITIZEN_RADIUS + BAG_RADIUS) {
          b.estado = 'cargada';
          b.view.visible = false;
          sim.cargando = b.id;
          ciu.bolsaHombro.visible = true;
          ciu.bolsaHombro.scale.set(0.4);
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

    // ── Entregar ──
    if (sim.cargando !== null && !sim.entregando && sim.tropiezo <= 0) {
      if (Math.hypot(world.cart.x - sim.x, world.cart.y - sim.y) < CART_RADIUS) {
        const b = bolsas.find((x) => x.id === sim.cargando);
        if (b) void entregar(b);
      }
    }

    // ── Animación del ciudadano ──
    const vel = Math.hypot(sim.vx, sim.vy);
    if (vel > 12) {
      sim.inactivo = 0;
      const antes = sim.fasePaso;
      sim.fasePaso += (vel / 46) * dt * 6;
      // Un paso "cae" cada media vuelta de la fase: ahí van polvo y sonido.
      if (Math.floor(antes / Math.PI) !== Math.floor(sim.fasePaso / Math.PI)) {
        sim.pasoAlterno = !sim.pasoAlterno;
        audio.paso(sim.pasoAlterno);
        if (vel > 150) fx.puffPolvo(sim.x, sim.y + 18, 1, 0.6);
        if (cargando) audio.tintineo();
      }
    } else {
      sim.inactivo += PASO_MS;
      sim.fasePaso += dt * 0.6;
    }

    if (sim.finLento > 0) sim.finLento -= PASO_MS;
    if (sim.zoomPulso > 0) sim.zoomPulso = Math.max(0, sim.zoomPulso - PASO_MS / 220);
  }

  // ── Render (interpolado) ──────────────────────────────────────────────────
  function render(alpha: number) {
    const x = sim.prevX + (sim.x - sim.prevX) * alpha;
    const y = sim.prevY + (sim.y - sim.prevY) * alpha;

    ciu.view.x = x;
    ciu.view.y = y;
    ciu.view.zIndex = y;

    const vel = Math.hypot(sim.vx, sim.vy);
    const andando = vel > 12 && sim.tropiezo <= 0;

    // Piernas
    const swing = andando ? Math.sin(sim.fasePaso) * 9 : 0;
    ciu.piernaIzq.y = 6 + swing * 0.35;
    ciu.piernaIzq.rotation = swing * 0.05;
    ciu.piernaDer.y = 6 - swing * 0.35;
    ciu.piernaDer.rotation = -swing * 0.05;

    // Squash al pisar: casi invisible, imprescindible. Sin esto el muñeco
    // parece una calcomanía que se desliza.
    const bob = andando ? Math.abs(Math.sin(sim.fasePaso)) : 0;
    ciu.cuerpo.scale.y = 1 - bob * 0.045;
    ciu.cuerpo.scale.x = 1 + bob * 0.03;
    ciu.cuerpo.y = -bob * 2;

    // Inclinación hacia el lado de la carga: el PESO se ve.
    const cargando = sim.cargando !== null;
    const objetivoRot = sim.tropiezo > 0 ? Math.sin(sim.tropiezo / 40) * 0.5 : cargando ? 0.09 : 0;
    ciu.cuerpo.rotation += (objetivoRot - ciu.cuerpo.rotation) * 0.2;

    // El ciudadano mira hacia donde camina (espejando el sprite)
    if (Math.abs(sim.vx) > 20) ciu.cuerpo.scale.x *= sim.vx < 0 ? -1 : 1;

    // La bolsa entra al hombro con rebote y se balancea al andar
    if (ciu.bolsaHombro.visible) {
      const s = ciu.bolsaHombro.scale.x;
      ciu.bolsaHombro.scale.set(s + (1 - s) * 0.18);
      ciu.bolsaHombro.rotation = andando ? Math.sin(sim.fasePaso) * 0.12 : 0;
    }

    // Reposo: tras 4 s quieto, se estira. Cuesta poco y cambia por completo
    // si el muñeco se siente vivo o es un adorno.
    if (sim.inactivo > 4000) {
      const t = (sim.inactivo - 4000) / 1000;
      ciu.cuerpo.scale.y *= 1 + Math.sin(t * 2.2) * 0.05;
      ciu.cabeza.rotation = Math.sin(t * 1.1) * 0.18;
    } else {
      ciu.cabeza.rotation *= 0.9;
    }

    // Bolsas: laten y brillan cuando el ciudadano se acerca (anticipación)
    for (const b of bolsas) {
      if (b.estado !== 'suelo') continue;
      const d = Math.hypot(b.x - x, b.y - y);
      const cerca = Math.max(0, 1 - d / 190);
      b.glow.alpha = cerca * (0.5 + Math.sin(sim.tiempo / 160) * 0.25);
      const late = 1 + cerca * 0.09 * (0.6 + Math.sin(sim.tiempo / 190) * 0.4);
      b.body.scale.set(late);
      b.view.zIndex = b.y;
    }

    // La carretilla se enciende mientras llevas una bolsa: te dice adónde ir
    // sin una flecha ni un texto.
    const objetivoAura = sim.cargando !== null ? 0.55 + Math.sin(sim.tiempo / 200) * 0.25 : 0;
    cart.aura.alpha += (objetivoAura - cart.aura.alpha) * 0.12;

    // ── Cámara ──
    // No se desplaza (la pantalla es fija) pero RESPIRA: sigue al ciudadano
    // con retraso y muy poco recorrido. Una cámara clavada se siente muerta.
    const segX = (x - STAGE_W / 2) * 0.03;
    const segY = (y - STAGE_H / 2) * 0.02;
    const sh = reduced ? 0 : fx.shake;
    camara.x = -segX + (Math.random() - 0.5) * 2 * sh;
    camara.y = -segY + (Math.random() - 0.5) * 2 * sh;

    // Zoom de golpe al vaciar (1 → 1,04 → 1)
    const pulso = 1 + Math.sin(sim.zoomPulso * Math.PI) * 0.04;
    camara.scale.set(pulso);
    camara.pivot.set(STAGE_W / 2, STAGE_H / 2);
    camara.position.set(camara.x + STAGE_W / 2, camara.y + STAGE_H / 2);

    flash.alpha = reduced ? 0 : fx.flash;
    capaJuego.sortChildren();
  }

  // ── Bucle ─────────────────────────────────────────────────────────────────
  let acumulador = 0;

  const tick = () => {
    // Se acota a 100 ms: si la pestaña estuvo en segundo plano, no se
    // simulan cinco minutos de golpe (la "espiral de la muerte").
    let dtMs = Math.min(100, app.ticker.deltaMS);

    // Cámara lenta del clímax
    if (sim.finLento > 0) dtMs *= 0.35;

    // Hitstop: el mundo se congela. Los efectos siguen (el destello tiene que
    // verse) pero la simulación no avanza. Es el truco más barato que existe
    // para que un impacto se sienta sólido.
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

  app.ticker.add(tick);

  // Pausa REAL en segundo plano: se para el bucle y el audio.
  const onVis = () => {
    if (document.hidden) app.ticker.stop();
    else {
      acumulador = 0;
      app.ticker.start();
    }
  };
  document.addEventListener('visibilitychange', onVis);

  opts.callbacks.onState?.({
    bagsLeft: bolsas.filter((b) => b.estado !== 'entregada').length,
    carrying: false,
    deposited: entregadas,
  });

  // ── Destrucción ───────────────────────────────────────────────────────────
  // Si esto falla, cambiar de pantalla y volver duplica el contexto WebGL y a
  // la tercera partida el teléfono se muere. Es el bug número uno de integrar
  // Pixi con React.
  let destruido = false;
  function destroy() {
    if (destruido) return;
    destruido = true;
    app.ticker.remove(tick);
    document.removeEventListener('visibilitychange', onVis);
    app.canvas.removeEventListener('pointerdown', onDown);
    app.canvas.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    app.renderer.off('resize', layout);
    audio.destroy();
    try {
      app.destroy(true, { children: true, texture: true });
    } catch {
      /* ya estaba destruida */
    }
  }

  // Silencia el aviso de "variable no usada" y deja el hitArea listo por si
  // más adelante se usan eventos de Pixi en vez de los del DOM.
  app.stage.hitArea = new Rectangle(0, 0, STAGE_W, STAGE_H);
  void COLORS;

  return {
    destroy,
    setMuted: (v: boolean) => audio.setSilencio(v),
    isMuted: () => audio.mudo,
  };
}
