/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Hay otro package-lock.json más arriba en el disco (en la carpeta del
  // usuario) y Turbopack elegía ESA como raíz del workspace. Se fija a mano.
  turbopack: { root: __dirname },
  // El motor de Pixi vive fuera de React y se monta/desmonta a mano.
  // StrictMode lo monta dos veces en desarrollo a propósito: GameCanvas está
  // escrito para soportarlo (destruye la Application en la limpieza), así que
  // si algún día se rompe la destrucción, se nota en el acto.
};

module.exports = nextConfig;
