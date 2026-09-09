'use client';

import { useRouter } from 'next/navigation';

export type AdminSection =
  | 'resumen'
  | 'caja'
  | 'usuarios'
  | 'transacciones'
  | 'interacciones'
  | 'metricas'
  | 'referidos'
  | 'partidas'
  | 'equipo';

const ITEMS: { key: AdminSection; label: string }[] = [
  { key: 'resumen', label: '📊 Resumen' },
  { key: 'caja', label: '💵 Resumen de 30 días' },
  { key: 'usuarios', label: '👥 Usuarios' },
  { key: 'transacciones', label: '💳 Transacciones' },
  { key: 'interacciones', label: '📈 Interacciones' },
  { key: 'metricas', label: '📅 Métrica histórica' },
  { key: 'referidos', label: '🤝 Referidos' },
  { key: 'partidas', label: '🎰 Partidas' },
  { key: 'equipo', label: '🛡️ Equipo' },
];

interface AdminNavProps {
  active: AdminSection;
  /** En /admin cambia la sección sin navegar */
  onSelect?: (key: AdminSection) => void;
  /** Áreas visibles para este miembro del staff (sin ella: todas) */
  allowed?: AdminSection[];
  /** Pendientes por atender por pestaña: pinta la insignia roja */
  badges?: Partial<Record<AdminSection, number>>;
}

// Menú lateral del panel de administración (en móvil, fila de chips).
// Solo muestra las áreas permitidas para el usuario del panel.
export default function AdminNav({ active, onSelect, allowed, badges }: AdminNavProps) {
  const router = useRouter();

  const go = (key: AdminSection) => {
    if (onSelect) onSelect(key);
    else router.push(`/admin?s=${key}`);
  };

  const items = allowed ? ITEMS.filter((i) => allowed.includes(i.key)) : ITEMS;

  return (
    <nav className="admin-side">
      {items.map((item) => {
        const badge = badges?.[item.key] ?? 0;
        return (
          <button
            key={item.key}
            className={`admin-side-item ${active === item.key ? 'admin-side-active' : ''}`}
            onClick={() => go(item.key)}
          >
            {item.label}
            {badge > 0 && (
              <span className="admin-side-badge" aria-label={`${badge} pendientes`}>
                {badge > 9 ? '9+' : badge}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
}
