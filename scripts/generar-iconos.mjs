/**
 * Genera los iconos de la PWA en `public/`.
 *
 * Se dibujan por código y no se guarda un .png hecho a mano por dos razones:
 * el repositorio no arrastra binarios que nadie sabe regenerar, y cambiar el
 * color de la marca es cambiar una constante aquí y volver a correr esto.
 *
 *   node scripts/generar-iconos.mjs
 *
 * El icono es una pila de monedas sobre el verde de la app. Se dibuja a 4x y
 * se reduce al final: es antialiasing por fuerza bruta, pero para cuatro
 * ficheros que se generan una vez sale más barato que escribir el rasterizador
 * bueno.
 */
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

const SALIDA = path.join(process.cwd(), 'public');

// La paleta de la app: el verde del fondo y el oro de los premios.
const VERDE_ALTO = [17, 74, 57];
const VERDE_BAJO = [9, 42, 32];
const ORO = [244, 197, 66];
const ORO_SOMBRA = [190, 138, 32];
const ORO_LUZ = [255, 228, 140];

const SS = 4; // supermuestreo

/** Mezcla `color` sobre `base` con opacidad `a` (0..1). */
function sobre(base, color, a) {
  return [
    base[0] + (color[0] - base[0]) * a,
    base[1] + (color[1] - base[1]) * a,
    base[2] + (color[2] - base[2]) * a,
  ];
}

/**
 * Dibuja el icono a tamaño `n`.
 *
 * `maskable` = el sistema puede recortar el icono en círculo, así que el fondo
 * llega a los bordes y el dibujo se encoge a la zona segura (el 80% central
 * que la especificación garantiza visible).
 */
function dibujar(n, { maskable }) {
  const N = n * SS;
  const px = new Float64Array(N * N * 3);
  const alfa = new Float64Array(N * N);

  const radio = maskable ? N : N * 0.22; // esquinas redondeadas
  const escala = maskable ? 0.62 : 0.78; // cuánto ocupa la pila de monedas

  // ── Fondo ──
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      // Dentro del rectángulo redondeado?
      const dx = Math.max(radio - x, x - (N - radio), 0);
      const dy = Math.max(radio - y, y - (N - radio), 0);
      const dentro = maskable || Math.hypot(dx, dy) <= radio;
      if (!dentro) continue;
      alfa[i] = 1;
      const t = y / N;
      const c = sobre(VERDE_ALTO, VERDE_BAJO, t);
      px[i * 3] = c[0];
      px[i * 3 + 1] = c[1];
      px[i * 3 + 2] = c[2];
    }
  }

  // ── Tres monedas apiladas ──
  // Cada moneda es una elipse aplastada más su canto: se dibujan de abajo
  // arriba para que la de arriba tape el canto de la de abajo.
  const rx = (N * escala) / 2;
  const ry = rx * 0.34;
  const cx = N / 2;
  const paso = ry * 0.92;
  const canto = ry * 0.5;
  const centros = [N / 2 + paso, N / 2, N / 2 - paso];

  const pintar = (x, y, color) => {
    const i = y * N + x;
    if (!alfa[i]) return;
    px[i * 3] = color[0];
    px[i * 3 + 1] = color[1];
    px[i * 3 + 2] = color[2];
  };

  for (const cy of centros) {
    // El canto: la misma elipse desplazada hacia abajo, en oro oscuro.
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const u = (x - cx) / rx;
        for (let d = 0; d <= canto; d++) {
          const v = (y - (cy + d)) / ry;
          if (u * u + v * v <= 1) { pintar(x, y, ORO_SOMBRA); break; }
        }
      }
    }
    // La cara: elipse en oro, con un brillo arriba a la izquierda.
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const u = (x - cx) / rx;
        const v = (y - cy) / ry;
        const r = u * u + v * v;
        if (r > 1) continue;
        // El brillo baja con la distancia a la esquina superior izquierda.
        const luz = Math.max(0, 1 - Math.hypot(u + 0.45, v + 0.5) * 1.1);
        pintar(x, y, sobre(ORO, ORO_LUZ, luz * 0.85));
      }
    }
  }

  // ── Reducir a tamaño real ──
  const out = Buffer.alloc(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const i = (y * SS + sy) * N + (x * SS + sx);
          r += px[i * 3]; g += px[i * 3 + 1]; b += px[i * 3 + 2]; a += alfa[i];
        }
      }
      const m = SS * SS;
      const o = (y * n + x) * 4;
      out[o] = Math.round(r / m);
      out[o + 1] = Math.round(g / m);
      out[o + 2] = Math.round(b / m);
      out[o + 3] = Math.round((a / m) * 255);
    }
  }
  return out;
}

// ── Codificador PNG mínimo (RGBA, sin filtro) ──
const TABLA_CRC = (() => {
  const t = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (const b of buf) c = TABLA_CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function trozo(tipo, datos) {
  const largo = Buffer.alloc(4);
  largo.writeUInt32BE(datos.length);
  const cuerpo = Buffer.concat([Buffer.from(tipo, 'ascii'), datos]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(cuerpo));
  return Buffer.concat([largo, cuerpo, crc]);
}
function png(rgba, n) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(n, 0);
  ihdr.writeUInt32BE(n, 4);
  ihdr[8] = 8;  // 8 bits por canal
  ihdr[9] = 6;  // RGBA
  const filas = Buffer.alloc((n * 4 + 1) * n);
  for (let y = 0; y < n; y++) {
    filas[y * (n * 4 + 1)] = 0; // filtro None
    rgba.copy(filas, y * (n * 4 + 1) + 1, y * n * 4, (y + 1) * n * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    trozo('IHDR', ihdr),
    trozo('IDAT', zlib.deflateSync(filas, { level: 9 })),
    trozo('IEND', Buffer.alloc(0)),
  ]);
}

fs.mkdirSync(SALIDA, { recursive: true });
const piezas = [
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  ['icon-maskable-512.png', 512, true],
  // iOS no lee el manifiesto para el icono del escritorio: usa este.
  // Y recorta él las esquinas, así que va sin redondear.
  ['apple-touch-icon.png', 180, true],
];
for (const [nombre, n, maskable] of piezas) {
  const archivo = path.join(SALIDA, nombre);
  fs.writeFileSync(archivo, png(dibujar(n, { maskable }), n));
  console.log(`${nombre.padEnd(24)} ${n}×${n}`);
}
