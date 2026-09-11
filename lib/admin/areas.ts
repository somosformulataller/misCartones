// Áreas del panel de administración. Un admin sin restricciones
// (panel_areas NULL) ve todo; a un usuario de atención al cliente
// (role 'support') se le asignan áreas concretas al crearlo.
// Este módulo es compartido por el servidor (guard de las APIs)
// y el cliente (menú lateral del panel).

export type PanelArea =
  | 'resumen'
  | 'caja'
  | 'usuarios'
  | 'transacciones'
  | 'interacciones'
  | 'metricas'
  | 'referidos'
  | 'partidas'
  | 'chat'
  | 'equipo';

export const PANEL_AREAS: { key: PanelArea; label: string }[] = [
  { key: 'resumen', label: '📊 Resumen' },
  { key: 'caja', label: '💵 Resumen de 30 días' },
  { key: 'usuarios', label: '👥 Usuarios' },
  { key: 'transacciones', label: '💳 Transacciones' },
  { key: 'interacciones', label: '📈 Interacciones' },
  { key: 'metricas', label: '📅 Métrica histórica' },
  { key: 'referidos', label: '🤝 Referidos' },
  { key: 'partidas', label: '🎰 Partidas' },
  { key: 'chat', label: '💬 Chat' },
  { key: 'equipo', label: '🛡️ Equipo' },
];

export type StaffRole = 'admin' | 'support';

export function isStaffRole(role: string | null | undefined): role is StaffRole {
  return role === 'admin' || role === 'support';
}

// Áreas que atención al cliente NO ve nunca, por mucho que alguien las
// marque por error en la pantalla de Equipo:
//  - `resumen`, `metricas`, `caja` y `referidos`: ahí viven el RTP, la
//    métrica histórica, cuánto gana la casa cada día y las estadísticas
//    del programa de afiliados. Son números del negocio, no
//    herramientas de atención.
//  - `equipo`: quien puede crear cuentas de staff puede darse a sí
//    mismo permisos de administrador. Se queda solo para admins.
const VETADAS_SUPPORT: PanelArea[] = ['resumen', 'caja', 'metricas', 'referidos', 'equipo'];

/** Áreas visibles para un miembro del staff.
 *
 *  Admin: todo (o solo lo asignado, si se le restringió a propósito).
 *
 *  Atención al cliente: TODO lo que necesita para trabajar —usuarios,
 *  transacciones, interacciones y partidas— sin tener que ir marcando
 *  casillas una por una. En el juego hermano, una cuenta de atención
 *  sin áreas asignadas se quedaba casi sin panel, y si al crearla se
 *  olvidaba marcar alguna, esa parte le quedaba cerrada sin
 *  explicación. Las casillas de Equipo siguen sirviendo para recortar
 *  más, pero nunca para ampliar a las áreas vetadas de arriba. */
export function allowedAreas(
  role: string | null | undefined,
  panelAreas: string[] | null | undefined
): PanelArea[] {
  if (!isStaffRole(role)) return [];
  const all = PANEL_AREAS.map((a) => a.key);
  if (role === 'admin') {
    if (!panelAreas || panelAreas.length === 0) return all;
    const set = new Set(panelAreas);
    return all.filter((a) => set.has(a));
  }
  // support: parte de todo lo permitido y solo recorta si se le
  // asignaron áreas concretas a propósito.
  const permitidas = all.filter((a) => !VETADAS_SUPPORT.includes(a));
  if (!panelAreas || panelAreas.length === 0) return permitidas;
  const set = new Set(panelAreas);
  return permitidas.filter((a) => set.has(a));
}

export function hasArea(
  role: string | null | undefined,
  panelAreas: string[] | null | undefined,
  area: PanelArea | PanelArea[]
): boolean {
  const allowed = new Set(allowedAreas(role, panelAreas));
  const wanted = Array.isArray(area) ? area : [area];
  return wanted.some((a) => allowed.has(a));
}
