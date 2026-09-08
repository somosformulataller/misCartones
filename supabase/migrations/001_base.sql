-- ============================================================================
-- 001 — Base del juego.
--
-- Proyecto NUEVO, desde cero. Las 34 migraciones de La Llave Correcta se
-- consolidan aquí en unas pocas limpias: su historial incluye idas y vueltas
-- (la 004 borró un índice único que la 025 tuvo que reponer DESPUÉS de que dos
-- pagos reales se acreditaran dos veces) que no tiene sentido reproducir.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Jugadores ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.players (
  id            UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username      TEXT,
  first_name    TEXT,
  last_name     TEXT,
  whatsapp      TEXT,
  -- Cédula del REGISTRO: fija la identidad. Distinta de payout_cedula, que es
  -- a la que se le paga; se editan por separado.
  cedula        TEXT,
  balance       DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  tickets       INT           NOT NULL DEFAULT 0,
  total_wagered DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  total_won     DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  role          TEXT          NOT NULL DEFAULT 'player'
                CHECK (role IN ('player', 'admin', 'support')),
  -- Suspendido por el admin: no puede entrar, jugar ni cobrar
  blocked       BOOLEAN       NOT NULL DEFAULT FALSE,
  payout_name   TEXT,
  payout_bank   TEXT,
  payout_cedula TEXT,
  payout_phone  TEXT,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Una cédula = una cuenta. Va desde el día uno.
CREATE UNIQUE INDEX IF NOT EXISTS players_cedula_unica
  ON public.players (cedula) WHERE cedula IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS players_whatsapp_unico
  ON public.players (whatsapp) WHERE whatsapp IS NOT NULL;

-- ── Partidas ────────────────────────────────────────────────────────────────
-- `target_payout` se sella con el RNG al consumir el ticket y NO se envía
-- nunca al cliente. `world_seed` coloca el escenario: la conoce el servidor,
-- así que puede recalcular dónde estaban las bolsas y comprobar que la que
-- reclaman existe. `bags_deposited` es el CERROJO del reclamo atómico.
CREATE TABLE IF NOT EXISTS public.game_runs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id      UUID NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  target_payout  DECIMAL(10,2) NOT NULL,
  world_seed     BIGINT        NOT NULL,
  bags_deposited INT[]         NOT NULL DEFAULT '{}',
  credited       DECIMAL(10,2) NOT NULL DEFAULT 0,
  game_status    TEXT          NOT NULL DEFAULT 'ACTIVE'
                 CHECK (game_status IN ('ACTIVE', 'COMPLETED', 'EXPIRED')),
  -- Guarda de ritmo: el servidor rechaza dos entregas separadas por menos del
  -- viaje más corto físicamente posible.
  last_bag_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  completed_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS game_runs_player_idx ON public.game_runs (player_id, created_at DESC);

-- ── Historial (registro inmutable) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.game_history (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id  UUID NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  run_id     UUID NOT NULL REFERENCES public.game_runs(id),
  payout     DECIMAL(10,2) NOT NULL,
  bags_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS game_history_player_idx
  ON public.game_history (player_id, created_at DESC);

-- ── Analítica ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.app_events (
  id         BIGSERIAL PRIMARY KEY,
  player_id  UUID NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  path       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Un solo índice compuesto: es la tabla que más se escribe, y cada índice de
-- más encarece cada INSERT. En el juego hermano acabaron con dos índices
-- muertos que nunca se usaron y solo estorbaban.
CREATE INDEX IF NOT EXISTS app_events_player_evt_idx
  ON public.app_events (player_id, event_type, created_at DESC);

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- El navegador SOLO LEE lo suyo. Todas las escrituras del juego pasan por el
-- cliente privilegiado del servidor (service role), nunca por el cliente.
ALTER TABLE public.players      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_runs    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_events   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS players_leer_propio ON public.players;
CREATE POLICY players_leer_propio ON public.players
  FOR SELECT USING (auth.uid() = id);

DROP POLICY IF EXISTS runs_leer_propio ON public.game_runs;
CREATE POLICY runs_leer_propio ON public.game_runs
  FOR SELECT USING (auth.uid() = player_id);

DROP POLICY IF EXISTS history_leer_propio ON public.game_history;
CREATE POLICY history_leer_propio ON public.game_history
  FOR SELECT USING (auth.uid() = player_id);

DROP POLICY IF EXISTS events_leer_propio ON public.app_events;
CREATE POLICY events_leer_propio ON public.app_events
  FOR SELECT USING (auth.uid() = player_id);

-- ── Alta de jugador ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.players (id, username, first_name, last_name, whatsapp, cedula)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'username', SPLIT_PART(NEW.email, '@', 1)),
    NEW.raw_user_meta_data->>'first_name',
    NEW.raw_user_meta_data->>'last_name',
    NEW.raw_user_meta_data->>'whatsapp',
    NEW.raw_user_meta_data->>'cedula'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
