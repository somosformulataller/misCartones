'use client';

import { useState, useEffect, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { motion } from 'framer-motion';
import FondoCalle from '@/components/auth/FondoCalle';
import BotonInstalar from '@/components/pwa/BotonInstalar';
import {
  WHATSAPP_LOCAL_DIGITS,
  WHATSAPP_PREFIXES,
  isWhatsappValid,
} from '@/lib/auth/whatsapp';
import { SUSPENDED_LOGIN_MESSAGE } from '@/lib/supabase/blocked';

// Ninguna cédula empieza en cero (ni escrita como "V-05.002.573").
// Se mira el primer DÍGITO, así el prefijo de letra no estorba.
const CEDULA_ZERO_MSG =
  'La cédula no puede empezar con cero: escríbela sin el 0 de la izquierda.';
const startsWithZero = (value: string) => value.replace(/\D/g, '').startsWith('0');

// El prefijo lo elige de una lista, así que lo único que puede fallar
// del teléfono es la cantidad de dígitos: el aviso lo dice tal cual.
const faltanDigitosMsg = (prefix: string) =>
  `Después del ${prefix} deben ir ${WHATSAPP_LOCAL_DIGITS} dígitos (ejemplo: ${prefix} 1234567).`;

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  // El WhatsApp se arma con dos campos: prefijo elegido + 7 dígitos
  const [waPrefix, setWaPrefix] = useState<string>(WHATSAPP_PREFIXES[0]);
  const [waRest, setWaRest] = useState('');
  const whatsapp = `${waPrefix}${waRest}`;
  const [cedula, setCedula] = useState('');
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Errores propios de un campo (p. ej. cédula o teléfono ya
  // registrados): se muestran DEBAJO de su input para que se vea
  // dónde está el problema
  const [cedulaError, setCedulaError] = useState<string | null>(null);
  const [whatsappError, setWhatsappError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  // Código del afiliado que lo invitó (llega en el link, ?ref=CODIGO)
  const [refCode, setRefCode] = useState<string | null>(null);

  const router = useRouter();
  const supabase = createClient();
  // A dónde ir tras entrar. Es una ref y no estado porque solo se lee en el
  // envío: como estado provocaría un render de más en cada carga del login.
  const destinoRef = useRef('/juego');

  // Si vienen del login con Google y la cuenta está suspendida, el
  // callback los reenvía con ?suspendida=1: mostramos el mismo aviso.
  // Y si vienen por el link de un afiliado (?ref=CODIGO), se guarda el
  // código y se abre directamente el formulario de registro: quien
  // llega por una invitación viene a crear su cuenta, no a entrar.
  // Lee la barra de direcciones, que es un sistema externo y no existe al
  // renderizar en el servidor: en un inicializador perezoso reventaría el
  // prerender. Por eso va en un efecto y no en useState.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (params.get('suspendida') === '1') setError(SUSPENDED_LOGIN_MESSAGE);
    // ?volver= lo pone el proxy cuando corta el paso a una pantalla privada:
    // se vuelve a donde el jugador iba, no a la portada.
    const volver = params.get('volver');
    if (volver && volver.startsWith('/')) destinoRef.current = volver;
    const ref = params.get('ref')?.trim().toUpperCase();
    if (ref) {
      setRefCode(ref);
      setIsSignUp(true);
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setCedulaError(null);
    setWhatsappError(null);
    setSuccess(null);

    if (isSignUp) {
      if (password !== confirm) {
        setError('Las contraseñas no coinciden.');
        return;
      }
      if (!acceptTerms) {
        setError('Debes aceptar los términos y condiciones para registrarte.');
        return;
      }
      // Se corta aquí para no gastar un viaje al servidor (que también
      // lo valida: el cliente se puede saltar)
      if (!isWhatsappValid(whatsapp)) {
        setWhatsappError(faltanDigitosMsg(waPrefix));
        setError('Hay un error en tu registro: revisa el número de teléfono.');
        document.getElementById('whatsapp')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        return;
      }
      if (startsWithZero(cedula)) {
        setCedulaError(CEDULA_ZERO_MSG);
        setError('Hay un error en tu registro: revisa el número de cédula.');
        document.getElementById('cedula')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        return;
      }
    }

    if (!supabase) return;
    setLoading(true);
    try {
      if (isSignUp) {
        // El servidor crea la cuenta YA CONFIRMADA (sin verificar el
        // correo) y aquí se inicia sesión de inmediato.
        const res = await fetch('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email,
            password,
            first_name: firstName.trim(),
            last_name: lastName.trim(),
            whatsapp: whatsapp.trim(),
            cedula: cedula.trim(),
            accepted: acceptTerms,
            ref: refCode ?? undefined,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          const msg = data.error || 'No se pudo crear la cuenta';
          const lower = msg.toLowerCase();
          // Si el problema es la cédula o el teléfono, el detalle va
          // bajo su input y arriba del botón queda el aviso general.
          if (lower.includes('cédula') || lower.includes('cedula')) {
            setCedulaError(msg);
            setError('Hay un error en tu registro: revisa el número de cédula.');
            document.getElementById('cedula')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
          } else if (lower.includes('teléfono') || lower.includes('telefono')) {
            setWhatsappError(msg);
            setError('Hay un error en tu registro: revisa el número de teléfono.');
            document.getElementById('whatsapp')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
          } else {
            setError(msg);
          }
          return;
        }
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        // Deja pendiente el saludo de bienvenida + invitación a referir,
        // que sale al llegar a /juego (lo consume InviteModalProvider).
        try {
          sessionStorage.setItem('cartones_invite_welcome_pending', '1');
        } catch {}
        router.push(destinoRef.current);
        router.refresh();
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        // Se mira `blocked` ANTES de dejar pasar: una cuenta suspendida no
        // entra. (En La Llave aquí se miraba también el rol para mandar al
        // admin a su panel; este juego todavía no tiene panel.)
        const { data: profile } = await supabase
          .from('players')
          .select('blocked')
          .eq('id', data.user.id)
          .single();
        if (profile?.blocked === true) {
          // Deshacemos la sesión que Supabase acaba de crear para que
          // no quede a medias, y le explicamos por qué no puede pasar.
          await supabase.auth.signOut();
          setError(SUSPENDED_LOGIN_MESSAGE);
          return;
        }
        router.push(destinoRef.current);
        router.refresh();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error desconocido';
      if (msg.includes('Invalid login')) setError('Email o contraseña incorrectos.');
      else if (msg.includes('already registered')) setError('Este email ya está registrado.');
      else if (msg.includes('Password should be')) setError('La contraseña debe tener al menos 6 caracteres.');
      else setError(msg);
    } finally {
      setLoading(false);
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
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              className="auth-ilustracion"
              src="/ciudadano-carretilla.png"
              alt=""
              width={600}
              height={420}
            />
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
    // El acceso y el registro son la misma pantalla con ocho campos de
    // diferencia, y esa diferencia decide si cabe o no en un teléfono. La
    // clase deja que la hoja de estilos apriete SOLO el acceso, que sí tiene
    // que caber entero; el registro se desplaza y no pasa nada.
    <div className={`auth-page ${isSignUp ? 'es-registro' : 'es-acceso'}`}>
      {/* La calle de fondo: el mismo mediodía que hay dentro del juego, para
          que entrar a jugar no cambie de mundo. */}
      <FondoCalle />

      <div className="mc-marca">
        <h1 className="mc-rotulo">Mis Cartones</h1>
        {/* El texto amarillo inclinado del menú de Minecraft. Es la única
            broma de toda la pantalla y por eso funciona: dice que esto es un
            juego antes de que el jugador lea una sola etiqueta. */}
        <p className="mc-splash" aria-hidden>
          ¡La basura paga!
        </p>
      </div>

      <motion.div
        className="auth-card"
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        {/* Header */}
        <div className="auth-header">
          {/* El ciudadano del juego con la carretilla llena de bolsas y de
              monedas. Se dibuja por código (scripts/generar-ilustracion.mjs)
              con los colores exactos de la escena, así que es literalmente el
              mismo muñeco que se ve dentro. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className="auth-ilustracion"
            src="/ciudadano-carretilla.png"
            alt=""
            width={600}
            height={420}
          />
          <h1 className="auth-title">
            {isSignUp ? 'Crear cuenta' : 'Iniciar sesión'}
          </h1>
          <p className="auth-subtitle">
            {isSignUp
              ? 'Compra tickets por Pago Móvil y gana premios reales'
              : 'Bienvenido de vuelta'}
          </p>
        </div>

        {/* Form */}
        <form className="auth-form" onSubmit={handleSubmit}>
          {success && <div className="auth-success">✓ {success}</div>}

          {isSignUp && (
            <>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label" htmlFor="firstName">Nombre</label>
                  <input
                    id="firstName"
                    type="text"
                    className="form-input"
                    placeholder="Tu nombre"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    required
                    maxLength={60}
                    autoComplete="given-name"
                  />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="lastName">Apellido</label>
                  <input
                    id="lastName"
                    type="text"
                    className="form-input"
                    placeholder="Tu apellido"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    required
                    maxLength={60}
                    autoComplete="family-name"
                  />
                </div>
              </div>
            </>
          )}

          <div className="form-group">
            <label className="form-label" htmlFor="email">Correo</label>
            <input
              id="email"
              type="email"
              className="form-input"
              placeholder="tu@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </div>

          {isSignUp && (
            <div className="form-row form-row-phone">
              <div className="form-group">
                <label className="form-label" htmlFor="whatsapp">WhatsApp</label>
                {/* El prefijo se ELIGE (así no se puede inventar uno que no
                    existe) y al lado van los 7 dígitos que faltan. */}
                <div className="phone-field">
                  <select
                    className={`form-input phone-prefix ${whatsappError ? 'form-input-error' : ''}`}
                    value={waPrefix}
                    onChange={(e) => {
                      setWaPrefix(e.target.value);
                      setWhatsappError(null);
                    }}
                    aria-label="Prefijo del operador"
                  >
                    {WHATSAPP_PREFIXES.map((p) => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                  <input
                    id="whatsapp"
                    type="tel"
                    inputMode="numeric"
                    className={`form-input phone-rest ${whatsappError ? 'form-input-error' : ''}`}
                    placeholder="1234567"
                    value={waRest}
                    onChange={(e) => {
                      setWaRest(e.target.value.replace(/\D/g, '').slice(0, WHATSAPP_LOCAL_DIGITS));
                      setWhatsappError(null);
                    }}
                    // Se avisa al SALIR del campo, no en cada tecla: mientras
                    // lo escribe todavía le faltan dígitos y sería un error
                    // que aparece y desaparece solo.
                    onBlur={() => {
                      if (waRest && waRest.length !== WHATSAPP_LOCAL_DIGITS) {
                        setWhatsappError(faltanDigitosMsg(waPrefix));
                      }
                    }}
                    required
                    autoComplete="tel-national"
                    aria-invalid={!!whatsappError}
                    aria-describedby={whatsappError ? 'whatsapp-error' : undefined}
                  />
                </div>
                {whatsappError && (
                  <p className="field-error" id="whatsapp-error" role="alert">
                    ⚠️ {whatsappError}
                  </p>
                )}
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="cedula">Cédula</label>
                <input
                  id="cedula"
                  type="text"
                  className={`form-input ${cedulaError ? 'form-input-error' : ''}`}
                  placeholder="V12345678"
                  value={cedula}
                  onChange={(e) => {
                    const value = e.target.value;
                    setCedula(value);
                    // Aviso mientras escribe: ninguna cédula empieza en 0
                    setCedulaError(startsWithZero(value) ? CEDULA_ZERO_MSG : null);
                  }}
                  required
                  minLength={5}
                  maxLength={15}
                  aria-invalid={!!cedulaError}
                  aria-describedby={cedulaError ? 'cedula-error' : undefined}
                />
                {cedulaError && (
                  <p className="field-error" id="cedula-error" role="alert">
                    ⚠️ {cedulaError}
                  </p>
                )}
              </div>
            </div>
          )}

          <div className="form-group">
            <label className="form-label" htmlFor="password">Contraseña</label>
            <input
              id="password"
              type="password"
              className="form-input"
              placeholder={isSignUp ? 'Mínimo 6 caracteres' : '••••••••'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete={isSignUp ? 'new-password' : 'current-password'}
              minLength={6}
            />
          </div>

          {isSignUp && (
            <>
              <div className="form-group">
                <label className="form-label" htmlFor="confirm">Confirmar contraseña</label>
                <input
                  id="confirm"
                  type="password"
                  className="form-input"
                  placeholder="Repite tu contraseña"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                  autoComplete="new-password"
                  minLength={6}
                />
              </div>

              <label className="form-check">
                <input
                  type="checkbox"
                  checked={acceptTerms}
                  onChange={(e) => setAcceptTerms(e.target.checked)}
                  required
                />
                <span>
                  Acepto los{' '}
                  <Link href="/terminos" target="_blank" className="admin-link">
                    términos y condiciones
                  </Link>
                </span>
              </label>
            </>
          )}

          {/* El error SIEMPRE junto al botón: es lo último que el
              usuario ve antes de reintentar */}
          {error && <div className="auth-error">⚠️ {error}</div>}

          <button
            type="submit"
            className="btn-submit"
            disabled={loading}
          >
            {loading
              ? 'Cargando...'
              : isSignUp
              ? 'Crear cuenta y jugar'
              : 'Entrar a jugar'}
          </button>

          {/* Solo al iniciar sesión: en el registro no hay nada que
              recuperar todavía */}
          {!isSignUp && (
            <p className="auth-forgot">
              <Link href="/auth/recuperar">¿Olvidaste tu contraseña?</Link>
            </p>
          )}
        </form>

        {/* Instalar la app. Va debajo del formulario y no encima: primero
            se entra, que es a lo que vinieron. */}
        <BotonInstalar />

        {/* Switch mode */}
        <p className="auth-switch">
          {isSignUp ? '¿Ya tienes cuenta? ' : '¿No tienes cuenta? '}
          <a
            href="#"
            onClick={(e) => { e.preventDefault(); setIsSignUp(!isSignUp); setError(null); setCedulaError(null); setWhatsappError(null); setSuccess(null); }}
          >
            {isSignUp ? 'Inicia sesión' : 'Regístrate'}
          </a>
        </p>
      </motion.div>
    </div>
  );
}
