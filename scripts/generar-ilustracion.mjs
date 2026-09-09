/**
 * Dibuja `public/ciudadano-carretilla.png`: el ciudadano del juego empujando
 * la carretilla llena de bolsas y monedas. Es la ilustración que preside el
 * registro y el inicio de sesión.
 *
 *   node scripts/generar-ilustracion.mjs
 *
 * Se dibuja POR CÓDIGO y a resolución de sprite (60×42 píxeles reales, luego
 * ampliados sin suavizado) por tres razones:
 *
 *   · El repositorio no arrastra un binario que nadie sabe rehacer. Cambiar
 *     el color del chaleco es cambiar una constante aquí.
 *   · Los colores salen de `lib/three/escena.ts`, así que el de la portada es
 *     literalmente el mismo muñeco que se ve dentro del juego. Si mañana el
 *     ciudadano cambia de camisa, se cambia en los dos sitios y no hay forma
 *     de que se despisten.
 *   · A esta resolución el dibujo ES la retícula. Ampliado con vecino más
 *     cercano queda pixel art de verdad, no un vector con aire retro.
 */
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

const ANCHO = 92;
const ALTO = 58;
const ESCALA = 10; // 920 × 580 en el archivo

// ── La paleta, sacada de lib/three/escena.ts ──
const C = {
  piel: '#ffc48f',
  pielSombra: '#e0a26d',
  pelo: '#42220e',
  peloClaro: '#79431c',
  ojo: '#1e273f',
  camisa: '#10bdff',
  camisaSombra: '#0a93cc',
  chaleco: '#ff8a1f',
  chalecoSombra: '#d96b0c',
  reflectante: '#ecf4fa',
  pantalon: '#0f36e9',
  pantalonSombra: '#0a26a8',
  zapato: '#2a2e38',
  // La carretilla: el naranja del cono de obra.
  cuba: '#e9702a',
  cubaSombra: '#b74d13',
  cubaLuz: '#ff9354',
  mango: '#a45915',
  rueda: '#2a2e38',
  ruedaEje: '#92806f',
  // El pedestal: un bloque de césped de canto, como los del juego.
  cesped: '#59a832',
  cespedLuz: '#7ed36a',
  cespedSombra: '#3d7d22',
  tierra: '#8a5c34',
  tierraLuz: '#a06f42',
  tierraSombra: '#63421f',
  // La basura y el premio.
  bolsa: '#20232d',
  bolsaLuz: '#3a4050',
  lazo: '#f2c11a',
  oro: '#f7bd1e',
  oroLuz: '#ffd964',
  oroSombra: '#c08704',
  contorno: '#161d1a',
  /* Ocho dígitos: los dos últimos son la opacidad. */
  sombraSuelo: '#16241e4d',
};

// ── Lienzo: un color por celda, o null si es transparente ──
const lienzo = new Array(ANCHO * ALTO).fill(null);
const dentro = (x, y) => x >= 0 && y >= 0 && x < ANCHO && y < ALTO;
const punto = (x, y, color) => {
  x = Math.round(x);
  y = Math.round(y);
  if (dentro(x, y)) lienzo[y * ANCHO + x] = color;
};
/** Rectángulo relleno, extremos incluidos. */
const caja = (x0, y0, x1, y1, color) => {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) punto(x, y, color);
};
/** Elipse rellena. */
const elipse = (cx, cy, rx, ry, color) => {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const u = (x - cx) / rx;
      const v = (y - cy) / ry;
      if (u * u + v * v <= 1.05) punto(x, y, color);
    }
  }
};
/** Barra recta de grosor `g`, para brazos y mangos. */
const barra = (x0, y0, x1, y1, g, color) => {
  const pasos = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 2;
  for (let i = 0; i <= pasos; i++) {
    const t = i / pasos;
    const x = x0 + (x1 - x0) * t;
    const y = y0 + (y1 - y0) * t;
    for (let d = 0; d < g; d++) punto(x, y + d, color);
  }
};

// ════════════════════════════════════════════════════════════════════════════
// La escena, de atrás hacia delante
// ════════════════════════════════════════════════════════════════════════════

// ── 1 · Los mangos de la carretilla, que pasan por detrás del ciudadano ──
barra(15, 25, 30, 21, 2, C.mango);
barra(15, 28, 30, 24, 2, C.mango);

// ── 2 · El ciudadano ──
// Pierna de atrás, adelantada; pierna de delante, plantada. Dos tonos: sin
// ellos, a esta escala las dos piernas se leen como una sola pieza.
caja(9, 27, 12, 35, C.pantalonSombra);
caja(14, 27, 17, 36, C.pantalon);
caja(8, 36, 13, 37, C.zapato);
caja(13, 37, 19, 38, C.zapato);

// Torso: camisa por debajo, chaleco de obra por encima.
caja(8, 16, 18, 28, C.camisa);
caja(8, 16, 10, 28, C.camisaSombra);
caja(9, 17, 17, 27, C.chaleco);
caja(9, 25, 17, 27, C.chalecoSombra);
// La banda reflectante: es lo que convierte una camiseta naranja en un
// chaleco de trabajo.
caja(9, 21, 17, 22, C.reflectante);

// Cabeza.
caja(10, 7, 17, 15, C.piel);
caja(10, 13, 17, 15, C.pielSombra);
caja(9, 5, 18, 9, C.pelo);
caja(10, 5, 16, 6, C.peloClaro);
caja(9, 9, 10, 12, C.pelo); // patilla
punto(15, 11, C.ojo);
punto(16, 11, C.ojo);
caja(15, 9, 16, 9, C.pelo); // ceja
caja(14, 14, 16, 14, C.pielSombra); // boca

// Cuello y brazo que empuja, hasta agarrar el mango.
caja(12, 15, 15, 16, C.pielSombra);
barra(16, 20, 28, 22, 2, C.chaleco);
caja(27, 21, 30, 24, C.piel); // la mano en el mango

// ── 3 · La carretilla ──
// La cuba es un trapecio: ancha arriba, estrecha abajo. Un rectángulo se lee
// como una caja, y una caja con rueda no es una carretilla.
for (let y = 0; y <= 9; y++) {
  const x0 = Math.round(29 + y * 0.45);
  const x1 = Math.round(55 - y * 0.5);
  caja(x0, 19 + y, x1, 19 + y, y > 6 ? C.cubaSombra : C.cuba);
}
caja(29, 18, 55, 19, C.cubaLuz); // el filo de arriba, a la luz
caja(33, 29, 51, 29, C.cubaSombra);

// Pata delantera y rueda.
caja(33, 29, 35, 36, C.mango);
elipse(45, 33, 5, 5, C.rueda);
elipse(45, 33, 2, 2, C.ruedaEje);

// ── 4 · La carga: bolsas de basura y el premio encima ──
// Dos bolsas, con un surco de sombra entre ellas. Pegadas sin ese surco se
// leían como una sola mancha negra.
elipse(37, 14, 6, 6, C.bolsa);
elipse(36, 12, 3, 2, C.bolsaLuz); // el reflejo del plástico
elipse(48, 15, 6, 5, C.bolsa);
elipse(47, 13, 3, 2, C.bolsaLuz);
caja(42, 10, 42, 19, C.contorno);

// Los lazos amarillos: es lo que hace que un bulto negro sea una bolsa y no
// una piedra. Van donde NO cae ninguna moneda encima.
const lazo = (x, y) => {
  caja(x, y + 2, x + 2, y + 4, C.bolsa);
  caja(x, y, x + 2, y + 2, C.lazo);
  caja(x - 1, y - 1, x + 3, y, C.lazo);
};
lazo(33, 7);
lazo(50, 9);

// Las monedas. Pequeñas y con canto: una elipse dorada grande y lisa se lee
// como una fruta, no como dinero. El canto oscuro alrededor es lo que las
// convierte en moneda, y el oro sobre el negro de las bolsas es el contraste
// más alto de toda la paleta.
const moneda = (cx, cy) => {
  elipse(cx, cy, 3, 2.1, C.oroSombra);
  elipse(cx, cy - 0.4, 2.1, 1.3, C.oro);
  punto(cx - 1, cy - 1, C.oroLuz);
};
moneda(38, 9);
moneda(45, 11);
moneda(53, 13);
// Dos en el aire, saltando de la carretilla: es lo que da el movimiento.
moneda(44, 4);
moneda(56, 7);

// ── 5 · El pedestal ──
// El muñeco estaba flotando en el aire. Puesto sobre un bloque de césped
// —el mismo que pisa dentro del juego— la ilustración deja de ser un recorte
// y pasa a ser una escena: hay un suelo, y encima hay alguien trabajando.

/** Un bloque visto de canto: la cara de arriba, la de delante y su sombra. */
const bloque = (x0, x1, yTop, alto, arriba, arribaLuz, frente, frenteLuz, frenteSombra) => {
  // Cara de arriba, en dos tonos: la franja de luz de la primera fila es lo
  // que hace que se lea como una superficie y no como una raya de color.
  caja(x0, yTop, x1, yTop + 1, arribaLuz);
  caja(x0, yTop + 2, x1, yTop + 4, arriba);
  caja(x0, yTop + 4, x1, yTop + 4, C.cespedSombra);
  // Cara de delante, más estrecha: da el canto del bloque.
  caja(x0 + 2, yTop + 5, x1 - 2, yTop + alto, frente);
  caja(x0 + 2, yTop + 5, x1 - 2, yTop + 6, frenteLuz);
  caja(x0 + 2, yTop + alto - 2, x1 - 2, yTop + alto, frenteSombra);
};

// El bloque grande, donde está el ciudadano.
bloque(3, 67, 39, 15, C.cesped, C.cespedLuz, C.tierra, C.tierraLuz, C.tierraSombra);

// Un segundo bloque a la derecha, más bajo, con su montón de monedas: es lo
// que rompe la simetría y hace que la escena tenga profundidad.
bloque(69, 90, 45, 12, C.cesped, C.cespedLuz, C.tierra, C.tierraLuz, C.tierraSombra);
moneda(76, 41);
moneda(84, 43);
moneda(80, 37);

// ── 6 · La sombra del suelo ──
// Sin ella la figura flota sobre la tarjeta. Va translúcida y por DEBAJO de
// todo, así que se dibuja al final pero solo donde no hay nada pintado.
for (let x = 8; x <= 52; x++) {
  const dx = (x - 30) / 22;
  const alto = Math.round(1 + Math.sqrt(Math.max(0, 1 - dx * dx)));
  for (let y = 39; y <= 39 + alto; y++) punto(x, y, C.cespedSombra);
}

// ── 7 · El contorno ──
// Un píxel oscuro alrededor de todo. Es lo que separa el muñeco del fondo y
// lo que hace que se lea como una figura y no como manchas de color; sin él,
// un sprite sobre cualquier fondo claro se deshace.
const copia = lienzo.map((c) => (c === C.sombraSuelo ? null : c));
for (let y = 0; y < ALTO; y++) {
  for (let x = 0; x < ANCHO; x++) {
    if (copia[y * ANCHO + x] !== null) continue;
    const vecino =
      (dentro(x - 1, y) && copia[y * ANCHO + x - 1]) ||
      (dentro(x + 1, y) && copia[y * ANCHO + x + 1]) ||
      (dentro(x, y - 1) && copia[(y - 1) * ANCHO + x]) ||
      (dentro(x, y + 1) && copia[(y + 1) * ANCHO + x]);
    if (vecino && lienzo[y * ANCHO + x] !== C.sombraSuelo) lienzo[y * ANCHO + x] = C.contorno;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// A PNG
// ════════════════════════════════════════════════════════════════════════════
const TABLA_CRC = (() => {
  const t = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = -1;
  for (const b of buf) c = TABLA_CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};
const trozo = (tipo, datos) => {
  const largo = Buffer.alloc(4);
  largo.writeUInt32BE(datos.length);
  const cuerpo = Buffer.concat([Buffer.from(tipo, 'ascii'), datos]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(cuerpo));
  return Buffer.concat([largo, cuerpo, crc]);
};

const W = ANCHO * ESCALA;
const H = ALTO * ESCALA;
const filas = Buffer.alloc((W * 4 + 1) * H);
const rgb = (hex) => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
  hex.length > 7 ? parseInt(hex.slice(7, 9), 16) : 255,
];
for (let y = 0; y < H; y++) {
  const base = y * (W * 4 + 1);
  filas[base] = 0; // filtro None
  for (let x = 0; x < W; x++) {
    // Vecino más cercano: la ampliación NO interpola, así el borde de cada
    // píxel del sprite sigue siendo un borde recto.
    const c = lienzo[Math.floor(y / ESCALA) * ANCHO + Math.floor(x / ESCALA)];
    const o = base + 1 + x * 4;
    if (!c) continue; // transparente
    const [r, g, b, a] = rgb(c);
    filas[o] = r;
    filas[o + 1] = g;
    filas[o + 2] = b;
    filas[o + 3] = a;
  }
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8;
ihdr[9] = 6; // RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  trozo('IHDR', ihdr),
  trozo('IDAT', zlib.deflateSync(filas, { level: 9 })),
  trozo('IEND', Buffer.alloc(0)),
]);

const salida = path.join(process.cwd(), 'public', 'ciudadano-carretilla.png');
fs.writeFileSync(salida, png);
console.log(`ciudadano-carretilla.png  ${W}×${H}  (${(png.length / 1024).toFixed(1)} KB)`);
