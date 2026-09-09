'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { createClient } from '@/lib/supabase/client';
import FondoCalle from '@/components/auth/FondoCalle';
import { WHATSAPP_LOCAL_DIGITS, WHATSAPP_PREFIXES } from '@/lib/auth/whatsapp';
import { CLAVE_MINIMA, HORAS_FRENO_RETIRO } from '@/lib/auth/recuperar';

// Recuperar la contraseña SIN salir de esta pantalla: los datos, y la
// contraseña nueva justo debajo. Nada de «te enviamos un correo, ve a
// buscarlo»: ahí se pierde a la mitad de la gente, y encima el correo
// del plan gratuito de Supabase apenas manda unos pocos por hora.
//
// El teléfono se pide igual que en el registro —prefijo de una lista y
// 7 dígitos— para que la comparación no falle por la forma de
// escribirlo. La cédula sí se acepta como venga («V-28.730.098»): la
// limpia el servidor.

export default function RecuperarPage() {
  const router = useRouter();
  const supabase = createClient();

  const [paso, setPaso] = useState<1 | 2>(1);
  const [correo, setCorreo] = useState('');
  const [waPrefix, setWaPrefix] = useState<string>(WHATSAPP_PREFIXES[0]);
  const [waRest, setWaRest] = useState('');
  const [cedula, setCedula] = useState('');

  const [permiso, setPermiso] = useState('');
  const [nombre, setNombre] = useState<string | null>(null);
  const [clave, setClave] = useState('');
  const [repetida, setRepetida] = useState('');

  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const verificar = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setCargando(true);
    try {
      const res = await fetch('/api/auth/recuperar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          correo,
          cedula,
          telefono: `${waPrefix}${waRest}`,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'No se pudo verificar. Inténtalo de nuevo.');
        return;
      }
      setPermiso(data.permiso);
      setNombre(data.nombre ?? null);
      setPaso(2);
    } catch {
      setError('No hay conexión. Revisa tu internet e inténtalo otra vez.');
    } finally {
      setCargando(false);
    }
  };

  const guardar = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setCargando(true);
    try {
      const res = await fetch('/api/auth/recuperar/clave', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ permiso, clave, repetida, correo }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'No se pudo cambiar la contraseña.');
        // El permiso se gasta al usarse: si el problema fue ese, hay que
        // volver a empezar, y decirlo aquí en vez de dejar a la persona
        // dándole a un botón que ya no puede funcionar.
        if (res.status === 401) {
          setPaso(1);
          setPermiso('');
        }
        return;
      }
      // Entrar directamente con la contraseña recién puesta: es la
      // prueba de que funciona y ahorra volver a escribirla.
      const { error: errorEntrada } = await supabase!.auth.signInWithPassword({
        email: correo.trim(),
        password: clave,
      });
      if (errorEntrada) {
        setError('Contraseña cambiada. Vuelve a la pantalla de inicio de sesión y entra con ella.');
        return;
      }
      router.push('/juego');
      router.refresh();
    } catch {
      setError('No hay conexión. Revisa tu internet e inténtalo otra vez.');
    } finally {
      setCargando(false);
    }
  };

  // Sin Supabase configurado no hay cuentas que crear ni a dónde entrar. Se
  // dice claramente en vez de dejar un formulario que no va a hacer nada: un
  // botón que no responde parece un fallo del teléfono del jugador.
  if (!supabase) {
    return (
      <div className="auth-page">
        <FondoCalle />
        <div className="auth-card">
          <div className="auth-header">
            <div className="auth-logo" aria-hidden>
              ♻️
            </div>
            <h1 className="auth-title">Cuentas no disponibles</h1>
            <p className="auth-subtitle">
              El registro no está configurado en este servidor todavía.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <FondoCalle />

      <motion.div
        className="auth-card"
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <div className="auth-header">
          <div className="auth-logo">
            ♻️
          </div>
          <h1 className="auth-title">
            {paso === 1 ? 'Recuperar mi cuenta' : 'Tu nueva contraseña'}
          </h1>
          <p className="auth-subtitle">
            {paso === 1
              ? 'Confirma que eres tú con los datos que registraste'
              : `${nombre ? `¡Hola, ${nombre}! ` : ''}Elige una contraseña nueva y entras al momento`}
          </p>
        </div>

        {paso === 1 ? (
          <form className="auth-form" onSubmit={verificar}>
            <div className="form-group">
              <label className="form-label" htmlFor="correo">Correo</label>
              <input
                id="correo"
                type="email"
                className="form-input"
                placeholder="tu@email.com"
                value={correo}
                onChange={(e) => setCorreo(e.target.value)}
                required
                autoComplete="email"
                autoFocus
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="telefono">Teléfono que registraste</label>
              <div className="phone-field">
                <select
                  className="form-input phone-prefix"
                  value={waPrefix}
                  onChange={(e) => setWaPrefix(e.target.value)}
                  aria-label="Prefijo del operador"
                >
                  {WHATSAPP_PREFIXES.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
                <input
                  id="telefono"
                  type="tel"
                  inputMode="numeric"
                  className="form-input phone-rest"
                  placeholder="1234567"
                  value={waRest}
                  onChange={(e) =>
                    setWaRest(e.target.value.replace(/\D/g, '').slice(0, WHATSAPP_LOCAL_DIGITS))
                  }
                  required
                  autoComplete="tel-national"
                />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="cedula">Cédula</label>
              <input
                id="cedula"
                type="text"
                className="form-input"
                placeholder="V12345678"
                value={cedula}
                onChange={(e) => setCedula(e.target.value)}
                required
                maxLength={20}
              />
            </div>

            {error && <div className="auth-error">⚠️ {error}</div>}

            <button type="submit" className="btn-submit" disabled={cargando}>
              {cargando ? 'Comprobando…' : '🔎 Continuar'}
            </button>
          </form>
        ) : (
          <form className="auth-form" onSubmit={guardar}>
            <div className="form-group">
              <label className="form-label" htmlFor="clave">Contraseña nueva</label>
              <input
                id="clave"
                type="password"
                className="form-input"
                placeholder={`Al menos ${CLAVE_MINIMA} caracteres`}
                value={clave}
                onChange={(e) => setClave(e.target.value)}
                required
                minLength={CLAVE_MINIMA}
                autoComplete="new-password"
                autoFocus
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="repetida">Repite la contraseña</label>
              <input
                id="repetida"
                type="password"
                className="form-input"
                placeholder="La misma otra vez"
                value={repetida}
                onChange={(e) => setRepetida(e.target.value)}
                required
                minLength={CLAVE_MINIMA}
                autoComplete="new-password"
              />
            </div>

            {/* Que no sea una sorpresa después: se dice ANTES de
                cambiarla, no cuando vaya a pedir su dinero. */}
            <p className="auth-note">
              🔐 Por seguridad, al recuperar tu cuenta los <strong>retiros quedan en pausa
              durante {HORAS_FRENO_RETIRO} horas</strong>. Puedes jugar y comprar tickets con
              normalidad.
            </p>

            {error && <div className="auth-error">⚠️ {error}</div>}

            <button type="submit" className="btn-submit" disabled={cargando}>
              {cargando ? 'Guardando…' : '🔑 Guardar y entrar'}
            </button>
          </form>
        )}

        <p className="auth-switch">
          <Link href="/auth/login">← Volver al inicio de sesión</Link>
        </p>
      </motion.div>
    </div>
  );
}
