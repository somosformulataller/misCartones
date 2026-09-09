/**
 * Genera las texturas que forran la interfaz:
 *
 *   public/textura-piedra.png   la cara de las tarjetas y paneles
 *   public/textura-madera.png   el marco que las rodea
 *
 *   node scripts/generar-texturas.mjs
 *
 * Son teselas pequeñas (64×64) que se repiten. Esto es lo que separa una
 * interfaz de bloques BONITA de una plana: en Minecraft ninguna superficie
 * es de un color liso, todas tienen grano. Un panel de un solo tono se lee
 * como un cuadro de diálogo; con grano se lee como piedra.
 *
 * Se generan por código, como los iconos y el ciudadano: cambiar el tono de
 * la piedra es cambiar una constante y volver a correr esto, y el
 * repositorio no arrastra binarios que nadie sabe rehacer.
 *
 * Pesan unos 2 KB cada una y se repiten, así que forrar la app entera cuesta
 * menos que una sola foto.
 */
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

const LADO = 64;

/** PRNG sembrado: la misma tesela en cada ejecución. Una textura que cambia
 *  con cada build ensucia el historial de git sin motivo. */
function azarSembrado(semilla) {
  let h = semilla >>> 0;
  return () => {
    h = (h + 0x6d2b79f5) >>> 0;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rgb = (hex) => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

/**
 * Dibuja una tesela.
 *
 * @param base    color de fondo
 * @param manchas [color, cuántas, tamaño] de cada capa de grano
 * @param vetas   líneas horizontales más oscuras (las juntas de la piedra)
 */
function tesela({ semilla, base, manchas, vetas }) {
  const px = new Uint8Array(LADO * LADO * 3);
  const [br, bg, bb] = rgb(base);
  for (let i = 0; i < LADO * LADO; i++) {
    px[i * 3] = br;
    px[i * 3 + 1] = bg;
    px[i * 3 + 2] = bb;
  }
  const rnd = azarSembrado(semilla);
  const pinta = (x, y, [r, g, b]) => {
    // El módulo es lo que hace la tesela REPETIBLE: una mancha que se sale
    // por la derecha vuelve a entrar por la izquierda, así que al repetir no
    // aparece una rejilla de costuras.
    const i = ((y + LADO) % LADO) * LADO + ((x + LADO) % LADO);
    px[i * 3] = r;
    px[i * 3 + 1] = g;
    px[i * 3 + 2] = b;
  };

  for (const [color, cuantas, tam] of manchas) {
    const c = rgb(color);
    for (let n = 0; n < cuantas; n++) {
      const x0 = Math.floor(rnd() * LADO);
      const y0 = Math.floor(rnd() * LADO);
      const w = 1 + Math.floor(rnd() * tam);
      const h = 1 + Math.floor(rnd() * tam);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) pinta(x0 + x, y0 + y, c);
    }
  }

  for (const [color, cada, grosor] of vetas) {
    const c = rgb(color);
    for (let y = 0; y < LADO; y += cada) {
      // La veta se desplaza un poco cada vez: en línea recta se vería la
      // rejilla, y la piedra dejaría de parecer piedra.
      const salto = Math.floor(rnd() * 8) - 4;
      for (let g = 0; g < grosor; g++) {
        for (let x = 0; x < LADO; x++) pinta(x, y + g + (x > LADO / 2 ? salto : 0), c);
      }
    }
  }
  return px;
}

// ── PNG (RGB, sin filtro) ──
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
function png(px) {
  const filas = Buffer.alloc((LADO * 3 + 1) * LADO);
  for (let y = 0; y < LADO; y++) {
    filas[y * (LADO * 3 + 1)] = 0;
    Buffer.from(px.buffer, y * LADO * 3, LADO * 3).copy(filas, y * (LADO * 3 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(LADO, 0);
  ihdr.writeUInt32BE(LADO, 4);
  ihdr[8] = 8;
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    trozo('IHDR', ihdr),
    trozo('IDAT', zlib.deflateSync(filas, { level: 9 })),
    trozo('IEND', Buffer.alloc(0)),
  ]);
}

const piezas = [
  [
    'textura-piedra.png',
    {
      semilla: 20260909,
      // Piedra CÁLIDA, sacada de la acera de la escena: gris frío parecería
      // otro juego pegado encima.
      // Tono MEDIO, no claro: encima va texto blanco, como en la escena del
      // juego. Sobre una piedra clara ese blanco se pierde.
      base: '#8b8375',
      manchas: [
        // Manchas PEQUEÑAS y de tono cercano: la piedra tiene grano, no
        // camuflaje. Con manchas grandes y contrastadas la tarjeta se
        // convierte en ruido y el texto encima deja de leerse.
        ['#948c7e', 300, 3],
        ['#847c6f', 280, 3],
        ['#9e9583', 70, 2],
        ['#7a7267', 70, 2],
      ],
      vetas: [['#807869', 22, 1]],
    },
  ],
  [
    'textura-madera.png',
    {
      semilla: 771,
      // El marco: madera tostada tirando a oro, para que case con el botón.
      base: '#9c6b28',
      manchas: [
        ['#b07d33', 160, 6],
        ['#87591d', 150, 6],
        ['#c69140', 60, 3],
        ['#6f4715', 50, 3],
      ],
      vetas: [['#7d5219', 21, 2]],
    },
  ],
];

const dir = path.join(process.cwd(), 'public');
for (const [nombre, opciones] of piezas) {
  const buf = png(tesela(opciones));
  fs.writeFileSync(path.join(dir, nombre), buf);
  console.log(`${nombre.padEnd(22)} ${LADO}×${LADO}  ${(buf.length / 1024).toFixed(1)} KB`);
}
