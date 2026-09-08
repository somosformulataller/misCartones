// Next 16 usa la "flat config" de ESLint 9 y `eslint-config-next` ya la
// exporta directamente: no hace falta FlatCompat ni el antiguo `next lint`.
import coreWebVitals from 'eslint-config-next/core-web-vitals';
import typescript from 'eslint-config-next/typescript';

const config = [
  ...coreWebVitals,
  ...typescript,
  { ignores: ['.next/**', 'node_modules/**', '.pruebas-build/**', 'scripts/**'] },
];

export default config;
