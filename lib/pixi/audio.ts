// ============================================================================
// Sonido del prototipo, sintetizado con WebAudio. Ni un archivo de audio: son
// osciladores y ruido. Suena a juguete a propósito — sirve para AFINAR el
// ritmo (¿la nota cae en el fotograma correcto?) antes de encargar el sprite
// de audio definitivo en la Fase 6.
//
// El contexto arranca SUSPENDIDO: los navegadores no dejan sonar nada hasta
// que el usuario toca la pantalla. `despertar()` se llama en el primer toque.
// ============================================================================

/** Escala pentatónica ascendente: Do Re Mi Sol La. Una nota por entrega, y
 *  suben. El oído entiende que estás progresando aunque nadie se lo diga. */
const ESCALA = [523.25, 587.33, 659.25, 783.99, 880.0];

export class Audio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private silenciado = false;

  despertar() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    try {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.28;
      this.master.connect(this.ctx.destination);
    } catch {
      // Sin audio disponible: el juego funciona igual, mudo.
      this.ctx = null;
    }
  }

  setSilencio(v: boolean) {
    this.silenciado = v;
    if (this.master) this.master.gain.value = v ? 0 : 0.28;
  }

  get mudo() {
    return this.silenciado;
  }

  private tono(
    freq: number,
    dur: number,
    tipo: OscillatorType = 'sine',
    vol = 0.5,
    slide = 0
  ) {
    if (!this.ctx || !this.master || this.silenciado) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = tipo;
    osc.frequency.setValueAtTime(freq, t);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private ruido(dur: number, vol = 0.3, corte = 1800) {
    if (!this.ctx || !this.master || this.silenciado) return;
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
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
  }

  /** Paso. Dos variantes alternando para que no canse. */
  paso(alterno: boolean) {
    this.ruido(0.06, alterno ? 0.1 : 0.075, alterno ? 900 : 1300);
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

  /** Tropiezo. */
  tropiezo() {
    this.ruido(0.22, 0.3, 700);
    this.tono(150, 0.18, 'sawtooth', 0.16, -70);
  }

  /** Vaciar en la carretilla: la nota n de la escala (0-4) + el volcado. */
  entrega(n: number) {
    const f = ESCALA[Math.min(ESCALA.length - 1, Math.max(0, n))];
    this.tono(f, 0.42, 'triangle', 0.4);
    this.tono(f * 2, 0.28, 'sine', 0.16);
    this.ruido(0.2, 0.2, 2200);
  }

  /** Cierre de partida: acorde ascendente. */
  victoria() {
    if (!this.ctx) return;
    [0, 2, 4].forEach((i, k) => {
      setTimeout(() => this.tono(ESCALA[i] * 2, 0.5, 'triangle', 0.3), k * 110);
    });
  }

  /** Un cartón aterrizando en el contador. */
  carton() {
    this.tono(1400 + Math.random() * 500, 0.05, 'square', 0.05);
  }

  destroy() {
    try {
      void this.ctx?.close();
    } catch {
      /* nada */
    }
    this.ctx = null;
    this.master = null;
  }
}
