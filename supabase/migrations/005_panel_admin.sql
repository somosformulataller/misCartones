-- ============================================================================
-- 005 — Lo que la base necesita para sostener el panel de administración.
--
-- El panel no es solo pantallas: casi todo lo que enseña son preguntas que
-- solo la base puede responder bien. Aquí van las tres piezas que faltaban:
--
--   1. FIRMAS — quién del equipo aprobó cada compra y pagó cada retiro.
--      Sin esto, dentro de un mes nadie sabe quién decidió qué. En el juego
--      hermano esto llegó tarde (migración 022) y todo lo anterior a esa
--      fecha quedó sin autor para siempre. Aquí nace con el panel.
--
--   2. BITÁCORAS — cada canje, cada ＋/− a mano de tickets o saldo, y cada
--      corrección de datos. El saldo de un jugador tiene que poder
--      explicarse entero: premios, compras, canjes, referidos y ajustes.
--      Un movimiento sin registro es un descuadre que nadie puede resolver.
--
--   3. AGREGADOS — los totales, la interacción y el tablero de referidos,
--      calculados EN LA BASE. La regla que costó dinero aprender allá: un
--      total NUNCA se calcula sobre una consulta con límite. PostgREST
--      corta en 1.000 filas y no avisa; el 17/08/2026 el panel del juego
--      hermano enseñaba el RTP de los 200 jugadores más nuevos como si
--      fuera el de la app entera (98,9% contra 97,3% real) y decía deber
--      $58 en billeteras cuando debía $284.
--
-- Los tres RPC de agregado son SOLO para service_role: el panel comprueba
-- primero que quien mira es del equipo y luego los llama con la clave del
-- servidor. Desde el navegador no se pueden llamar ni con sesión de
-- administrador.
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- 1 · Firmas: quién atendió cada cosa
-- ════════════════════════════════════════════════════════════════════════════

-- NULL no significa "no se sabe quién": en las compras significa que no hubo
-- nadie — la aprobó sola la validación automática contra el banco. El panel
-- distingue los dos casos por `origin`.
ALTER TABLE public.ticket_purchases
  ADD COLUMN IF NOT EXISTS handled_by UUID REFERENCES public.players(id) ON DELETE SET NULL;
ALTER TABLE public.withdrawals
  ADD COLUMN IF NOT EXISTS handled_by UUID REFERENCES public.players(id) ON DELETE SET NULL;

-- Quién puso cada etiqueta interna sobre un jugador.
ALTER TABLE public.player_tags
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES public.players(id) ON DELETE SET NULL;

-- La misma etiqueta dos veces en el mismo jugador es ruido, no información.
-- Sin distinguir mayúsculas: «Testimonio pedido» y «testimonio pedido» son
-- la misma cosa para quien las lee.
CREATE UNIQUE INDEX IF NOT EXISTS player_tags_unica
  ON public.player_tags (player_id, lower(label));

-- ════════════════════════════════════════════════════════════════════════════
-- 2 · Bitácoras
-- ════════════════════════════════════════════════════════════════════════════

-- Cada canje de saldo por tickets. Hasta ahora `redeem_tickets` movía los dos
-- contadores y no dejaba rastro: al cuadrar una cuenta, ese dinero
-- desaparecía sin explicación y parecía un descuento hecho a mano.
CREATE TABLE IF NOT EXISTS public.ticket_redemptions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id  UUID NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  quantity   INT NOT NULL,
  amount_usd DECIMAL(10,2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ticket_redemptions_player_idx
  ON public.ticket_redemptions (player_id, created_at DESC);

-- Cada ＋/− de tickets o de saldo hecho por una persona del equipo.
--
-- `made_by_name` guarda el nombre COMO TEXTO además del id. Es a propósito:
-- si esa cuenta del equipo se elimina, el id queda en NULL pero la bitácora
-- tiene que seguir diciendo quién fue. Una firma que se borra sola no es
-- una firma.
CREATE TABLE IF NOT EXISTS public.manual_adjustments (
  id           BIGSERIAL PRIMARY KEY,
  player_id    UUID NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  tipo         TEXT NOT NULL CHECK (tipo IN ('tickets', 'saldo')),
  -- Positivo = se le dio; negativo = se le quitó.
  delta        DECIMAL(10,2) NOT NULL,
  antes        DECIMAL(10,2) NOT NULL,
  despues      DECIMAL(10,2) NOT NULL,
  motivo       TEXT,
  made_by      UUID REFERENCES public.players(id) ON DELETE SET NULL,
  made_by_name TEXT,
  made_by_role TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS manual_adjustments_player_idx
  ON public.manual_adjustments (player_id, created_at DESC);

-- Cada campo corregido desde el panel, con el valor ANTERIOR. Entre lo que
-- se puede tocar están la cédula y el teléfono a los que se le paga a
-- alguien: sin el valor anterior, un error de tecleo no se puede deshacer
-- ni demostrar.
CREATE TABLE IF NOT EXISTS public.player_data_changes (
  id         BIGSERIAL PRIMARY KEY,
  player_id  UUID NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  campo      TEXT NOT NULL,
  antes      TEXT,
  despues    TEXT,
  changed_by UUID REFERENCES public.players(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS player_data_changes_player_idx
  ON public.player_data_changes (player_id, created_at DESC);

-- ── RLS: nada de esto lo ve el navegador ──
-- Son notas del equipo sobre las personas. El panel las lee con la clave
-- del servidor, que salta RLS; sin políticas, para anon y authenticated no
-- existen.
ALTER TABLE public.ticket_redemptions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.manual_adjustments  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_data_changes ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.ticket_redemptions  FROM anon, authenticated;
REVOKE ALL ON public.manual_adjustments  FROM anon, authenticated;
REVOKE ALL ON public.player_data_changes FROM anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 3 · El canje deja rastro
-- ════════════════════════════════════════════════════════════════════════════

-- Igual que la de la 004 (mismo FOR UPDATE, mismas comprobaciones), más la
-- fila de bitácora. Se escribe DENTRO de la función a propósito: así el
-- canje y su registro son la misma transacción y no puede existir uno sin
-- el otro.
CREATE OR REPLACE FUNCTION public.redeem_tickets(p_qty INT)
RETURNS JSON AS $$
DECLARE
  v_player public.players%ROWTYPE;
  v_cost DECIMAL(10,2);
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'No autorizado'; END IF;
  IF p_qty IS NULL OR p_qty < 1 OR p_qty > 500 THEN
    RAISE EXCEPTION 'Cantidad inválida';
  END IF;
  v_cost := p_qty * 2.00;

  SELECT * INTO v_player FROM public.players WHERE id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Jugador no encontrado'; END IF;
  IF v_player.blocked THEN RAISE EXCEPTION 'CUENTA_BLOQUEADA'; END IF;
  IF v_player.balance < v_cost THEN
    RAISE EXCEPTION 'Saldo insuficiente para canjear % ticket(s)', p_qty;
  END IF;

  UPDATE public.players
  SET balance = balance - v_cost, tickets = tickets + p_qty
  WHERE id = auth.uid();

  INSERT INTO public.ticket_redemptions (player_id, quantity, amount_usd)
  VALUES (auth.uid(), p_qty, v_cost);

  RETURN json_build_object(
    'balance', v_player.balance - v_cost,
    'tickets', v_player.tickets + p_qty
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.redeem_tickets(INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.redeem_tickets(INT) TO authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 4 · Totales del Resumen, sumados por la base
--
-- Seis números en una sola llamada, igual de rápida con 500 jugadores que
-- con 50.000. Ojo con las dos fuentes: saldo y tickets salen de `players`
-- (no hay otro sitio); partidas y premios salen de `game_history`, que es
-- el libro de lo que de verdad pasó. Los contadores total_wagered /
-- total_won del jugador se desfasan (partidas empezadas y no terminadas,
-- ajustes a mano), así que para el RTP no sirven.
--
-- El precio del ticket NO está aquí a propósito: vive en
-- lib/game/constants.ts (TICKET_COST) y es quien multiplica las partidas
-- para saber lo apostado. Un solo sitio donde cambiarlo.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_admin_totals()
RETURNS JSON AS $$
  SELECT json_build_object(
    'jugadores',         (SELECT COUNT(*) FROM public.players),
    'saldo_billeteras',  (SELECT COALESCE(SUM(balance), 0) FROM public.players),
    'tickets_sin_jugar', (SELECT COALESCE(SUM(tickets), 0) FROM public.players),
    'partidas',          (SELECT COUNT(*) FROM public.game_history),
    'premios',           (SELECT COALESCE(SUM(payout), 0) FROM public.game_history)
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.get_admin_totals() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_totals() TO service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- 5 · Interacción por jugador
--
-- Sesiones, navegación, partidas ganadas y perdidas, y cuándo se le vio por
-- última vez. Las cuentas del equipo quedan fuera: sus partidas de prueba
-- falsearían los números.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_interaction_stats()
RETURNS JSON AS $$
  SELECT COALESCE(json_agg(row_to_json(s) ORDER BY s.last_seen DESC NULLS LAST), '[]'::json)
  FROM (
    SELECT
      p.id, p.username, p.tickets, p.balance, p.total_wagered, p.total_won,
      COALESCE(e.logins, 0)     AS logins,
      COALESCE(e.app_opens, 0)  AS app_opens,
      COALESCE(e.page_views, 0) AS page_views,
      COALESCE(g.games, 0)      AS games,
      COALESCE(g.wins, 0)       AS wins,
      COALESCE(g.losses, 0)     AS losses,
      GREATEST(e.last_event, g.last_game) AS last_seen,
      p.created_at
    FROM public.players p
    LEFT JOIN (
      SELECT player_id,
        COUNT(*) FILTER (WHERE event_type = 'login')     AS logins,
        COUNT(*) FILTER (WHERE event_type = 'app_open')  AS app_opens,
        COUNT(*) FILTER (WHERE event_type = 'page_view') AS page_views,
        MAX(created_at) AS last_event
      FROM public.app_events GROUP BY player_id
    ) e ON e.player_id = p.id
    LEFT JOIN (
      SELECT player_id,
        COUNT(*)                           AS games,
        COUNT(*) FILTER (WHERE payout > 0) AS wins,
        COUNT(*) FILTER (WHERE payout = 0) AS losses,
        MAX(created_at) AS last_game
      FROM public.game_history GROUP BY player_id
    ) g ON g.player_id = p.id
    WHERE p.role = 'player'
  ) s;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.get_interaction_stats() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_interaction_stats() TO service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- 6 · Tablero de referidos
--
-- Todo lo que enseña la pestaña Referidos: el resumen, las métricas por
-- ventana de tiempo y la tabla de referidores con sus referidos anidados.
-- Va en SQL y no sumando en el navegador porque contar partidas por jugador
-- se hace en la base, no trayéndose miles de filas al cliente.
--
-- OJO — los umbrales del premio ($1 por cada 10 partidas, tope $3) están
-- calcados de `claim_referral` (migración 004): si allí cambian, cambian
-- aquí también. Aquí solo se MUESTRA cuánto se ha ganado y cuánto queda; el
-- que de verdad paga sigue siendo aquel RPC.
--
-- Las ventanas usan el día de Venezuela, igual que el resto del panel.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.admin_referral_overview()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  now_l       timestamp   := now() AT TIME ZONE 'America/Caracas';
  today_start timestamptz := date_trunc('day',  now_l) AT TIME ZONE 'America/Caracas';
  yest_start  timestamptz := (date_trunc('day', now_l) - interval '1 day')  AT TIME ZONE 'America/Caracas';
  week_start  timestamptz := date_trunc('week', now_l) AT TIME ZONE 'America/Caracas';
  pweek_start timestamptz := (date_trunc('week', now_l) - interval '7 days') AT TIME ZONE 'America/Caracas';
  d7_start    timestamptz := (date_trunc('day', now_l) - interval '6 days')  AT TIME ZONE 'America/Caracas';
  d30_start   timestamptz := (date_trunc('day', now_l) - interval '29 days') AT TIME ZONE 'America/Caracas';
  result json;
BEGIN
  WITH ref AS MATERIALIZED (
    -- Cada referido con su actividad. Se materializa: el conteo de partidas
    -- por jugador se calcula UNA vez y se reutiliza en todo lo de abajo.
    SELECT
      p.id,
      COALESCE(NULLIF(TRIM(p.username), ''), 'Jugador') AS nombre,
      p.referred_by,
      p.balance::numeric AS balance,
      COALESCE(p.tickets, 0)::int AS tickets,
      COALESCE(p.blocked, false) AS blocked,
      p.created_at,
      COALESCE((
        SELECT COUNT(*) FROM public.game_history h WHERE h.player_id = p.id
      ), 0)::int AS partidas,
      EXISTS (
        SELECT 1 FROM public.ticket_purchases tp
        WHERE tp.player_id = p.id AND tp.status = 'aprobado'
      ) AS compro
    FROM public.players p
    WHERE p.referred_by IS NOT NULL
  ),
  claims AS (
    SELECT referred_id, COALESCE(SUM(amount_usd), 0)::numeric AS cobrado
    FROM public.referral_claims GROUP BY referred_id
  ),
  enriched AS (
    SELECT
      r.*,
      COALESCE(c.cobrado, 0)::numeric AS cobrado,
      LEAST(3.00, (r.partidas / 10) * 1.00)::numeric AS ganado,
      -- Activo = compró tickets Y jugó. Registrarse no es actividad: es la
      -- métrica que separa un referido real de uno que solo abrió el enlace.
      (r.compro AND r.partidas > 0) AS activo
    FROM ref r LEFT JOIN claims c ON c.referred_id = r.id
  ),
  per_referrer AS (
    SELECT
      e.referred_by AS referrer_id,
      COUNT(*)::int AS referidos,
      COUNT(*) FILTER (WHERE e.partidas > 0)::int AS jugando,
      COUNT(*) FILTER (WHERE e.compro)::int AS compraron,
      COUNT(*) FILTER (WHERE e.activo)::int AS activos,
      COALESCE(SUM(e.partidas), 0)::int AS partidas_total,
      COALESCE(SUM(e.cobrado), 0)::numeric AS cobrado,
      COALESCE(SUM(GREATEST(e.ganado - e.cobrado, 0)), 0)::numeric AS pendiente,
      json_agg(
        json_build_object(
          'id', e.id, 'nombre', e.nombre, 'created_at', e.created_at,
          'partidas', e.partidas, 'balance', e.balance, 'tickets', e.tickets,
          'compro', e.compro, 'activo', e.activo, 'blocked', e.blocked,
          'ganado', e.ganado, 'cobrado', e.cobrado
        ) ORDER BY e.activo DESC, e.partidas DESC, e.created_at DESC
      ) AS lista
    FROM enriched e
    GROUP BY e.referred_by
  )
  SELECT json_build_object(
    'summary', json_build_object(
      -- Referidores cuyo enlace SÍ trajo a alguien. No hay forma de saber
      -- quién compartió el enlace sin que nadie se registrara: esto es lo
      -- que se puede medir de verdad.
      'referrers', (SELECT COUNT(*) FROM per_referrer),
      'referred',  (SELECT COUNT(*) FROM enriched),
      'playing',   (SELECT COUNT(*) FROM enriched WHERE partidas > 0),
      'buyers',    (SELECT COUNT(*) FROM enriched WHERE compro),
      'active',    (SELECT COUNT(*) FROM enriched WHERE activo),
      'paid_out',  COALESCE((SELECT SUM(cobrado) FROM enriched), 0),
      'pending',   COALESCE((SELECT SUM(GREATEST(ganado - cobrado, 0)) FROM enriched), 0),
      'pending_personas', (SELECT COUNT(*) FROM per_referrer WHERE pendiente > 0),
      'codes_total', (SELECT COUNT(*) FROM public.players WHERE referral_code IS NOT NULL)
    ),
    'stats', json_build_object(
      'afiliados', json_build_object(
        'hoy',         (SELECT COUNT(*) FROM ref WHERE created_at >= today_start),
        'ayer',        (SELECT COUNT(*) FROM ref WHERE created_at >= yest_start AND created_at < today_start),
        'semana',      (SELECT COUNT(*) FROM ref WHERE created_at >= week_start),
        'semana_prev', (SELECT COUNT(*) FROM ref WHERE created_at >= pweek_start AND created_at < week_start),
        'dias7',       (SELECT COUNT(*) FROM ref WHERE created_at >= d7_start),
        'mes',         (SELECT COUNT(*) FROM ref WHERE created_at >= d30_start)
      ),
      'recomendando', json_build_object(
        'hoy',         (SELECT COUNT(DISTINCT referred_by) FROM ref WHERE created_at >= today_start),
        'ayer',        (SELECT COUNT(DISTINCT referred_by) FROM ref WHERE created_at >= yest_start AND created_at < today_start),
        'semana',      (SELECT COUNT(DISTINCT referred_by) FROM ref WHERE created_at >= week_start),
        'semana_prev', (SELECT COUNT(DISTINCT referred_by) FROM ref WHERE created_at >= pweek_start AND created_at < week_start),
        'dias7',       (SELECT COUNT(DISTINCT referred_by) FROM ref WHERE created_at >= d7_start),
        'mes',         (SELECT COUNT(DISTINCT referred_by) FROM ref WHERE created_at >= d30_start)
      ),
      'jugaron_hoy', json_build_object(
        'total',   (SELECT COUNT(*) FROM ref WHERE created_at >= today_start),
        'activos', (SELECT COUNT(*) FROM ref WHERE created_at >= today_start AND partidas > 0)
      ),
      'jugaron_ayer', json_build_object(
        'total',   (SELECT COUNT(*) FROM ref WHERE created_at >= yest_start AND created_at < today_start),
        'activos', (SELECT COUNT(*) FROM ref WHERE created_at >= yest_start AND created_at < today_start AND partidas > 0)
      ),
      'premio', json_build_object(
        'usd',      COALESCE((SELECT SUM(GREATEST(ganado - cobrado, 0)) FROM enriched), 0),
        'personas', (SELECT COUNT(*) FROM per_referrer WHERE pendiente > 0)
      ),
      'chart', COALESCE((
        SELECT json_agg(
          json_build_object(
            'dia', to_char((gs AT TIME ZONE 'America/Caracas')::date, 'DD/MM'),
            'afiliados', (
              SELECT COUNT(*) FROM ref
              WHERE created_at >= gs AND created_at < gs + interval '1 day'
            )
          ) ORDER BY gs
        )
        FROM generate_series(d7_start, today_start, interval '1 day') AS gs
      ), '[]'::json)
    ),
    'referrers', COALESCE((
      SELECT json_agg(
        json_build_object(
          'id', pr.referrer_id,
          'nombre', COALESCE(NULLIF(TRIM(rp.username), ''), 'Jugador'),
          'referidos', pr.referidos,
          'jugando', pr.jugando,
          'compraron', pr.compraron,
          'activos', pr.activos,
          'partidas_total', pr.partidas_total,
          'cobrado', pr.cobrado,
          'pendiente', pr.pendiente,
          'lista', pr.lista
        ) ORDER BY pr.activos DESC, pr.referidos DESC, pr.partidas_total DESC
      )
      FROM per_referrer pr
      JOIN public.players rp ON rp.id = pr.referrer_id
    ), '[]'::json)
  ) INTO result;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_referral_overview() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_referral_overview() TO service_role;
