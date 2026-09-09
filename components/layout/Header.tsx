'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import { usePlayer } from '@/components/providers/PlayerProvider';

/**
 * Cabecera en UNA fila: el desplegable de navegación a la izquierda y, pegado
 * a la esquina derecha, el atajo a Referidos.
 *
 * Es un desplegable propio y no un `<select>` nativo por un motivo concreto:
 * el nativo se pinta con el estilo del sistema operativo, así que en un
 * Android antiguo salía una lista gris del sistema encima de la calle. Aquí
 * el menú es parte del juego.
 *
 * «Salir» va SIEMPRE la última y separada por una línea: es la única opción
 * del menú que no se puede deshacer con otro toque.
 *
 * Lo que NO va aquí es el saldo. Vive en la escena del juego y en la
 * billetera, que son los dos sitios donde significa algo; repetido en la
 * cabecera de todas las pantallas se convierte en un número que se mira
 * cada rato, y este juego no necesita eso.
 */
export default function Header() {
  const { player, isLoading, isStaff, signOut } = usePlayer();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Cerrar al tocar fuera o con Escape. Las dos cosas: en el móvil se cierra
  // tocando la calle, y en escritorio con la tecla.
  useEffect(() => {
    if (!menuOpen) return;
    const fuera = (e: MouseEvent | TouchEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', fuera);
    document.addEventListener('touchstart', fuera);
    document.addEventListener('keydown', tecla);
    return () => {
      document.removeEventListener('mousedown', fuera);
      document.removeEventListener('touchstart', fuera);
      document.removeEventListener('keydown', tecla);
    };
  }, [menuOpen]);

  const ir = (path: string) => {
    setMenuOpen(false);
    router.push(path);
  };

  const opciones = [
    // El panel primero y solo para el equipo: es a lo que entran a
    // trabajar, y para un jugador ni siquiera existe.
    ...(isStaff ? [{ label: '👑 Panel', path: '/admin' }] : []),
    { label: '👛 Canjear o retirar', path: '/billetera' },
    { label: '🎟️ Comprar tickets', path: '/comprar' },
    { label: '🤝 Referidos', path: '/referidos' },
    { label: '🖼️ Foto de perfil', path: '/perfil' },
    { label: '♻️ Jugar', path: '/juego' },
  ];

  return (
    <header className="game-header">
      {player ? (
        <div className="header-row">
          <div className="menu-wrap" ref={menuRef}>
            <button
              className="header-select"
              onClick={() => setMenuOpen((v) => !v)}
              aria-expanded={menuOpen}
              aria-haspopup="menu"
            >
              <span className="header-select-label">☰ Menú</span>
              <span className={`menu-caret ${menuOpen ? 'menu-caret-open' : ''}`}>▾</span>
            </button>
            <AnimatePresence>
              {menuOpen && (
                <motion.div
                  className="menu-list"
                  role="menu"
                  initial={{ opacity: 0, y: -6, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -6, scale: 0.98 }}
                  transition={{ duration: 0.15, ease: 'easeOut' }}
                >
                  {opciones.map((o) => (
                    <button
                      key={o.path}
                      className="menu-item"
                      role="menuitem"
                      onClick={() => ir(o.path)}
                    >
                      {o.label}
                    </button>
                  ))}
                  <div className="menu-divider" />
                  <button
                    className="menu-item menu-item-danger"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      signOut();
                    }}
                  >
                    🚪 Salir
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="header-corner">
            <Link href="/referidos" className="afi-fab" aria-label="Referidos">
              🤝<span className="afi-fab-label">Referidos</span>
            </Link>
          </div>
        </div>
      ) : isLoading ? (
        // Cargando el perfil: la fila se queda vacía en vez de enseñar el
        // botón de «Iniciar sesión». Si no, a quien SÍ tiene sesión le
        // parpadea un instante un botón que le está diciendo lo contrario.
        <div className="header-row" />
      ) : (
        <div className="header-row header-row-end">
          <Link href="/auth/login" className="btn-login" prefetch>
            Iniciar sesión
          </Link>
        </div>
      )}
    </header>
  );
}
