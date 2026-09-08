// ============================================================================
// Sonido del prototipo, sintetizado con WebAudio. Ni un archivo de audio: son
// osciladores y ruido filtrado. Suena a juguete a propósito — sirve para
// AFINAR el ritmo (¿la nota cae en el fotograma correcto?, ¿el ambiente tapa
// los efectos?) antes de encargar el sprite de audio definitivo en la Fase 6.
//
// El contexto arranca SUSPENDIDO: los navegadores no dejan sonar nada hasta
// que el usuario toca la pantalla. `despertar()` se llama en el primer toque y
// es también donde arranca el ambiente de campo.
//
// ── Dos buses ──
// Los efectos y el ambiente van por buses separados bajo el maestro. Eso
// permite que el ambiente esté MUY por debajo (un fondo no debe competir con
// lo que informa al jugador) y que se AGACHE un instante cuando pasa algo
// importante — al vaciar una bolsa o al tropezar. Ese agachado es la mitad
// del motivo por el que un golpe se siente contundente.
// ============================================================================

/** Escala pentatónica ascendente: Do Re Mi Sol La. Una nota por entrega, y
 *  suben. El oído entiende que estás progresando aunque nadie se lo diga. */
const ESCALA = [523.25, 587.33, 659.25, 783.99, 880.0];

const VOL_MAESTRO = 0.28;
/** El ambiente vive por debajo de todo. Si se sube, tapa los pasos. */
const VOL_AMBIENTE = 0.5;

type Pajaro = 'trino' | 'silbo' | 'pio' | 'lejano';

export class Audio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private busSfx: GainNode | null = null;
  private busAmb: GainNode | null = null;
  private silenciado = false;

  /** Nodos del ambiente, guardados para poder pararlos al destruir. */
  private fuentes: AudioScheduledSourceNode[] = [];
  private pajaroTimer: ReturnType<typeof setTimeout> | null = null;
  private ambienteVivo = false;

  despertar() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      this.arrancarAmbiente();
      return;
    }
    try {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctor();

      this.master = this.ctx.createGain();
      this.master.gain.value = this.silenciado ? 0 : VOL_MAESTRO;
      this.master.connect(this.ctx.destination);

      this.busSfx = this.ctx.createGain();
      this.busSfx.gain.value = 1;
      this.busSfx.connect(this.master);

      this.busAmb = this.ctx.createGain();
      this.busAmb.gain.value = VOL_AMBIENTE;
      this.busAmb.connect(this.master);

      this.arrancarAmbiente();
    } catch {
      // Sin audio disponible: el juego funciona igual, mudo.
      this.ctx = null;
    }
  }

  setSilencio(v: boolean) {
    this.silenciado = v;
    if (this.master && this.ctx) {
      // Rampa corta en vez de corte seco: un salto de ganancia a cero produce
      // un chasquido audible.
      this.master.gain.cancelScheduledValues(this.ctx.currentTime);
      this.master.gain.linearRampToValueAtTime(
        v ? 0 : VOL_MAESTRO,
        this.ctx.currentTime + 0.08
      );
    }
  }

  get mudo() {
    return this.silenciado;
  }

  /** Pestaña oculta: se para el reloj del audio entero. Sin esto el campo
   *  sigue sonando con el juego en segundo plano. */
  pausar() {
    if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend();
  }

  reanudar() {
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
  }

  // ── Ambiente de campo ─────────────────────────────────────────────────────

  /** Ruido blanco en bucle: la materia prima del viento. Cuatro segundos
   *  bastan para que el bucle no se note. */
  private bufferRuido(segundos: number): AudioBuffer {
    const ctx = this.ctx!;
    const n = Math.floor(ctx.sampleRate * segundos);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  private arrancarAmbiente() {
    if (!this.ctx || !this.busAmb || this.ambienteVivo) return;
    this.ambienteVivo = true;
    const ctx = this.ctx;

    // ── VIENTO ──
    // Ruido pasado por un filtro grave. Lo que lo convierte en viento y no en
    // estática son las RACHAS: dos osciladores muy lentos que mueven el corte
    // del filtro y el volumen. Al ser osciladores y no temporizadores, el
    // patrón nunca se repite igual y no cuesta nada de CPU.
    const viento = ctx.createBufferSource();
    viento.buffer = this.bufferRuido(4);
    viento.loop = true;

    const filtroViento = ctx.createBiquadFilter();
    filtroViento.type = 'lowpass';
    filtroViento.frequency.value = 420;
    filtroViento.Q.value = 0.7;

    const gViento = ctx.createGain();
    gViento.gain.value = 0.055;

    // Racha de corte: abre y cierra el filtro (el "silbido" que va y viene)
    const lfoCorte = ctx.createOscillator();
    lfoCorte.frequency.value = 0.13;
    const profCorte = ctx.createGain();
    profCorte.gain.value = 260;
    lfoCorte.connect(profCorte).connect(filtroViento.frequency);

    // Racha de volumen: el viento sube y baja
    const lfoVol = ctx.createOscillator();
    lfoVol.frequency.value = 0.05;
    const profVol = ctx.createGain();
    profVol.gain.value = 0.032;
    lfoVol.connect(profVol).connect(gViento.gain);

    viento.connect(filtroViento).connect(gViento).connect(this.busAmb);

    // ── HOJAS ──
    // Una segunda capa de ruido, más aguda y muy floja: es el roce de las
    // copas. Sin ella el viento suena a tubo; con ella suena a campo.
    const hojas = ctx.createBufferSource();
    hojas.buffer = this.bufferRuido(3);
    hojas.loop = true;

    const filtroHojas = ctx.createBiquadFilter();
    filtroHojas.type = 'bandpass';
    filtroHojas.frequency.value = 2600;
    filtroHojas.Q.value = 0.8;

    const gHojas = ctx.createGain();
    gHojas.gain.value = 0.016;

    const lfoHojas = ctx.createOscillator();
    lfoHojas.frequency.value = 0.19;
    const profHojas = ctx.createGain();
    profHojas.gain.value = 0.012;
    lfoHojas.connect(profHojas).connect(gHojas.gain);

    hojas.connect(filtroHojas).connect(gHojas).connect(this.busAmb);

    // ── CHICHARRAS ──
    // Zumbido agudo con trémolo rápido: es EL sonido de un campo a mediodía.
    // Va muy bajo a propósito; se nota más cuando falta que cuando está.
    const chicharras = ctx.createBufferSource();
    chicharras.buffer = this.bufferRuido(2);
    chicharras.loop = true;

    const filtroChi = ctx.createBiquadFilter();
    filtroChi.type = 'bandpass';
    filtroChi.frequency.value = 5200;
    filtroChi.Q.value = 12;

    const gChi = ctx.createGain();
    gChi.gain.value = 0.01;

    const tremolo = ctx.createOscillator();
    tremolo.frequency.value = 11;
    const profTremolo = ctx.createGain();
    profTremolo.gain.value = 0.008;
    tremolo.connect(profTremolo).connect(gChi.gain);

    chicharras.connect(filtroChi).connect(gChi).connect(this.busAmb);

    [viento, hojas, chicharras, lfoCorte, lfoVol, lfoHojas, tremolo].forEach((n) => {
      n.start();
      this.fuentes.push(n);
    });

    this.programarPajaro();
  }

  /** Un canto de pájaro cada pocos segundos, con el tipo y la posición en el
   *  estéreo al azar. La irregularidad es lo importante: un pájaro cada 4
   *  segundos exactos deja de parecer un pájaro a la tercera vez. */
  private programarPajaro() {
    if (!this.ctx) return;
    const espera = 2600 + Math.random() * 5200;
    this.pajaroTimer = setTimeout(() => {
      this.cantar();
      this.programarPajaro();
    }, espera);
  }

  private cantar() {
    if (!this.ctx || !this.busAmb) return;
    if (this.ctx.state !== 'running') return;

    const tipos: Pajaro[] = ['trino', 'silbo', 'pio', 'lejano'];
    const tipo = tipos[Math.floor(Math.random() * tipos.length)];

    // Panorámica: los pájaros vienen de un lado, no del centro. Es lo que
    // hace que el campo se sienta ancho. Si el navegador no trae panorámica
    // (algún Safari viejo), suenan centrados y ya: no vale la pena quedarse
    // sin pájaros por eso.
    let pan: AudioNode = this.busAmb;
    if (typeof this.ctx.createStereoPanner === 'function') {
      const p = this.ctx.createStereoPanner();
      p.pan.value = Math.random() * 1.6 - 0.8;
      p.connect(this.busAmb);
      pan = p;
    }

    const base = 1800 + Math.random() * 1400;
    // El "lejano" suena más grave y mucho más flojo: da profundidad.
    const lejos = tipo === 'lejano';
    const vol = lejos ? 0.045 : 0.1 + Math.random() * 0.05;
    const f = lejos ? base * 0.55 : base;

    switch (tipo) {
      case 'trino': {
        // Tres o cuatro chirridos rápidos que suben
        const n = 3 + Math.floor(Math.random() * 2);
        for (let i = 0; i < n; i++) {
          this.chirrido(pan, f * (1 + i * 0.09), 0.055, vol, i * 0.075, 1.5);
        }
        break;
      }
      case 'silbo':
        // Dos notas: la segunda más grave y más larga
        this.chirrido(pan, f * 1.15, 0.12, vol, 0, 0.7);
        this.chirrido(pan, f * 0.86, 0.2, vol * 0.9, 0.17, 0.6);
        break;
      case 'pio':
        this.chirrido(pan, f, 0.07, vol, 0, 2.2);
        this.chirrido(pan, f, 0.07, vol * 0.8, 0.13, 2.2);
        break;
      case 'lejano':
        this.chirrido(pan, f, 0.16, vol, 0, 0.8);
        this.chirrido(pan, f * 0.92, 0.14, vol * 0.85, 0.22, 0.75);
        break;
    }
  }

  /**
   * Un chirrido: un tono que BARRE de frecuencia. El barrido es lo que lo
   * convierte en pájaro; un tono plano suena a pitido de horno.
   * @param subida multiplicador de frecuencia al final del barrido
   */
  private chirrido(
    destino: AudioNode,
    freq: number,
    dur: number,
    vol: number,
    retraso: number,
    subida: number
  ) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + retraso;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(80, freq * subida), t + dur * 0.7);
    osc.frequency.exponentialRampToValueAtTime(Math.max(80, freq * 0.85), t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(destino);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  /**
   * Agacha el ambiente un instante. Se llama al vaciar una bolsa y al
   * tropezar: durante ese momento el campo se calla y el golpe ocupa todo el
   * espacio. Es la mitad de por qué un impacto se siente contundente.
   */
  duck(ms = 380, cuanto = 0.28) {
    if (!this.ctx || !this.busAmb) return;
    const t = this.ctx.currentTime;
    this.busAmb.gain.cancelScheduledValues(t);
    this.busAmb.gain.setValueAtTime(this.busAmb.gain.value, t);
    this.busAmb.gain.linearRampToValueAtTime(VOL_AMBIENTE * cuanto, t + 0.03);
    this.busAmb.gain.linearRampToValueAtTime(VOL_AMBIENTE, t + ms / 1000);
  }

  // ── Efectos ───────────────────────────────────────────────────────────────

  private tono(
    freq: number,
    dur: number,
    tipo: OscillatorType = 'sine',
    vol = 0.5,
    slide = 0
  ) {
    if (!this.ctx || !this.busSfx || this.silenciado) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = tipo;
    osc.frequency.setValueAtTime(freq, t);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.busSfx);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private ruido(dur: number, vol = 0.3, corte = 1800) {
    if (!this.ctx || !this.busSfx || this.silenciado) return;
    const t = this.ctx.currentTime;
    const n = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = corte;
    const g = this.ctx.createGain();
    g.gain.value = vol;
    src.connect(f).connect(g).connect(this.busSfx);
    src.start(t);
  }

  /** Paso sobre hierba. Dos variantes alternando para que no canse. */
  paso(alterno: boolean) {
    this.ruido(0.07, alterno ? 0.095 : 0.07, alterno ? 1100 : 1600);
  }

  /** Agarrar la bolsa: plástico + un tintineo apagado (hay algo dentro). */
  agarrar() {
    this.ruido(0.12, 0.16, 2600);
    this.tono(1180, 0.09, 'triangle', 0.12);
  }

  /** Tintineo de los cartones al caminar cargando. */
  tintineo() {
    this.tono(900 + Math.random() * 340, 0.05, 'triangle', 0.055);
  }

  /** Tropiezo. El ambiente se agacha un poco: el golpe se lleva el momento. */
  tropiezo() {
    this.ruido(0.22, 0.3, 700);
    this.tono(150, 0.18, 'sawtooth', 0.16, -70);
    this.duck(320, 0.45);
  }

  /** Vaciar en la carretilla: la nota n de la escala (0-4) + el volcado. */
  entrega(n: number) {
    const f = ESCALA[Math.min(ESCALA.length - 1, Math.max(0, n))];
    this.tono(f, 0.42, 'triangle', 0.4);
    this.tono(f * 2, 0.28, 'sine', 0.16);
    this.ruido(0.2, 0.2, 2200);
    this.duck(520, 0.22);
  }

  /** Cierre de partida: acorde ascendente. */
  victoria() {
    if (!this.ctx) return;
    this.duck(1400, 0.2);
    [0, 2, 4].forEach((i, k) => {
      setTimeout(() => this.tono(ESCALA[i] * 2, 0.5, 'triangle', 0.3), k * 110);
    });
  }

  /** Un cartón aterrizando en el contador. */
  carton() {
    this.tono(1400 + Math.random() * 500, 0.05, 'square', 0.05);
  }

  destroy() {
    if (this.pajaroTimer) clearTimeout(this.pajaroTimer);
    this.pajaroTimer = null;
    // Parar las fuentes a mano: si solo se cierra el contexto, en algunos
    // navegadores los bucles siguen sonando un instante.
    for (const f of this.fuentes) {
      try {
        f.stop();
      } catch {
        /* ya parada */
      }
    }
    this.fuentes = [];
    this.ambienteVivo = false;
    try {
      void this.ctx?.close();
    } catch {
      /* nada */
    }
    this.ctx = null;
    this.master = null;
    this.busSfx = null;
    this.busAmb = null;
  }
}
