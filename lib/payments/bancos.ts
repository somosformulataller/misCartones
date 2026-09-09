// Identidad de banco: códigos oficiales y normalización del nombre.
//
// Vive en su propio módulo (una hoja, sin dependencias del resto de
// pagos) para que lo usen por igual el OCR —al GUARDAR, para que
// `ocr_bank` quede canónico— y la regla de origen y el panel —al
// COMPARAR y MOSTRAR—. Antes la normalización solo existía dentro de
// la regla de origen, así que lo guardado seguía crudo: el mismo banco
// aparecía como «BDV», «Banco de Venezuela», «BANCO VZLA»…

/** Códigos oficiales de banco en Venezuela. Los 4 primeros dígitos de
 *  una cuenta son un CÓDIGO, no un nombre: es la forma más fiable de
 *  saber de qué banco viene un pago. */
export const BANCOS: Record<string, string> = {
  '0102': 'BDV', '0104': 'Venezolano de Crédito', '0105': 'Mercantil',
  '0108': 'Provincial', '0114': 'Bancaribe', '0115': 'Exterior',
  '0128': 'Caroní', '0134': 'Banesco', '0137': 'Sofitasa', '0138': 'Plaza',
  '0146': 'Bangente', '0151': 'BFC', '0156': '100% Banco', '0157': 'DelSur',
  '0163': 'Tesoro', '0166': 'Agrícola', '0168': 'Bancrecer', '0169': 'Mi Banco',
  '0171': 'Activo', '0172': 'Bancamiga', '0173': 'Internacional de Desarrollo',
  '0174': 'Banplus', '0175': 'Bicentenario', '0177': 'BANFANB', '0191': 'BNC',
};

/**
 * Un mismo banco se escribe de mil formas en los recibos: «BDV»,
 * «Banco de Venezuela», «BANCO VZLA», «BANCO DE VENEZUELA, SACA»…
 * Comparar el texto tal cual manda a revisión pagos que vienen del
 * mismo sitio. Por eso todo se reduce antes a un nombre canónico.
 *
 * (Es el fallo que el proyecto del compañero tuvo que parchear en
 * producción el 15/08/2026: su comparación por texto libre mandaba a
 * manual recargas de la MISMA cuenta.)
 *
 * Idempotente: darle un nombre ya canónico devuelve el mismo, así que
 * es seguro aplicarla al guardar y volver a aplicarla al comparar.
 * Devuelve null si no reconoce el banco; quien la llama decide si
 * conserva el texto crudo (para no perder un banco desconocido).
 */
export function normalizarBanco(v: string | null | undefined): string | null {
  const t = String(v ?? '').toUpperCase();
  if (!t.trim()) return null;
  if (/BANESCO/.test(t)) return 'Banesco';
  if (/VENEZOLANO DE CR/.test(t)) return 'Venezolano de Crédito';
  if (/MERCANTIL/.test(t)) return 'Mercantil';
  if (/PROVINCIAL|BBVA/.test(t)) return 'Provincial';
  if (/BNC|NACIONAL DE CR/.test(t)) return 'BNC';
  if (/TESORO/.test(t)) return 'Tesoro';
  if (/TRABAJADORES|\bBDT\b/.test(t)) return 'BDT';
  if (/BICENTENARIO/.test(t)) return 'Bicentenario';
  if (/BANCAMIGA/.test(t)) return 'Bancamiga';
  if (/BANCARIBE/.test(t)) return 'Bancaribe';
  if (/BANCRECER/.test(t)) return 'Bancrecer';
  if (/BANPLUS/.test(t)) return 'Banplus';
  if (/BANGENTE/.test(t)) return 'Bangente';
  if (/\bBFC\b|FONDO COM/.test(t)) return 'BFC';
  if (/\bPLAZA\b/.test(t)) return 'Plaza';
  if (/\bACTIVO\b/.test(t)) return 'Activo';
  if (/EXTERIOR/.test(t)) return 'Exterior';
  if (/SOFITASA/.test(t)) return 'Sofitasa';
  if (/DELSUR|DEL SUR/.test(t)) return 'DelSur';
  if (/AGR[IÍ]COLA/.test(t)) return 'Agrícola';
  if (/MI BANCO/.test(t)) return 'Mi Banco';
  if (/BANFANB|FUERZA ARMADA/.test(t)) return 'BANFANB';
  if (/100%/.test(t)) return '100% Banco';
  if (/CARON[IÍ]/.test(t)) return 'Caroní';
  if (/VENEZUELA|VZLA|\bBDV\b/.test(t)) return 'BDV';
  return null;
}
