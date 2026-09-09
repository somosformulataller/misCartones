-- ============================================================================
-- 004 — Cuentas, pagos, billetera y referidos.
--
-- Portado de La Llave Correcta, donde esto son 30 migraciones escritas a lo
-- largo de meses. Aquí entran de una vez y ya corregidas: cada garantía que
-- allá se aprendió pagando (referencias repetidas, cobros duplicados, la
-- huella de origen) nace en la base, no en el código.
--
-- Regla que atraviesa todo el archivo: el navegador LEE lo suyo y no ESCRIBE
-- nada de dinero. Cada movimiento de saldo o de tickets pasa por un RPC con
-- SECURITY DEFINER, y los que mueven dinero de verdad solo los puede ejecutar
-- el servidor (service_role).
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- 1 · El jugador: lo que le faltaba a la ficha
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.players
  -- Cuándo aceptó los términos. La fecha, no un booleano: si mañana cambian,
  -- hay que saber QUÉ versión aceptó cada quien.
  ADD COLUMN IF NOT EXISTS accepted_terms_at TIMESTAMPTZ,
  -- Su código de invitación (6 caracteres) y quién lo trajo.
  ADD COLUMN IF NOT EXISTS referral_code TEXT,
  ADD COLUMN IF NOT EXISTS referred_by UUID REFERENCES public.players(id) ON DELETE SET NULL,
  -- Cuándo recuperó la contraseña. Durante 24 h desde esa hora no puede
  -- retirar ni cobrar referidos: es exactamente la ventana en la que una
  -- cuenta recién robada intentaría sacar el dinero.
  ADD COLUMN IF NOT EXISTS password_reset_at TIMESTAMPTZ,
  -- Áreas del panel para el equipo de atención. NULL en un admin = todas.
  ADD COLUMN IF NOT EXISTS panel_areas TEXT[];

CREATE UNIQUE INDEX IF NOT EXISTS players_referral_code_unico
  ON public.players (referral_code) WHERE referral_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS players_referred_by_idx
  ON public.players (referred_by) WHERE referred_by IS NOT NULL;

-- Códigos sin caracteres que se confundan al dictarlos por WhatsApp: ni O ni
-- 0, ni I ni 1, ni L. Un código que el invitado teclea mal es un referido
-- perdido, y la culpa se la lleva el juego.
CREATE OR REPLACE FUNCTION public.nuevo_codigo_referido()
RETURNS TEXT AS $$
DECLARE
  abecedario TEXT := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  candidato TEXT;
  i INT;
BEGIN
  LOOP
    candidato := '';
    FOR i IN 1..6 LOOP
      candidato := candidato ||
        substr(abecedario, floor(random() * length(abecedario) + 1)::int, 1);
    END LOOP;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.players WHERE referral_code = candidato);
  END LOOP;
  RETURN candidato;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Alta de jugador, ahora con términos, código propio y quién lo invitó.
-- Reemplaza a la de la migración 001.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  v_referidor UUID;
  v_codigo TEXT;
BEGIN
  v_codigo := UPPER(NULLIF(TRIM(NEW.raw_user_meta_data->>'ref'), ''));
  IF v_codigo IS NOT NULL THEN
    SELECT id INTO v_referidor FROM public.players WHERE referral_code = v_codigo;
    -- Nadie se refiere a sí mismo. Y un código que no existe simplemente se
    -- ignora: NADIE se queda sin cuenta por un link mal copiado.
    IF v_referidor = NEW.id THEN v_referidor := NULL; END IF;
  END IF;

  INSERT INTO public.players (
    id, username, first_name, last_name, whatsapp, cedula,
    accepted_terms_at, referral_code, referred_by
  )
  VALUES (
    NEW.id,
    COALESCE(
      NULLIF(TRIM(CONCAT(
        NEW.raw_user_meta_data->>'first_name', ' ',
        NEW.raw_user_meta_data->>'last_name'
      )), ''),
      SPLIT_PART(NEW.email, '@', 1)
    ),
    NEW.raw_user_meta_data->>'first_name',
    NEW.raw_user_meta_data->>'last_name',
    NEW.raw_user_meta_data->>'whatsapp',
    NEW.raw_user_meta_data->>'cedula',
    CASE WHEN (NEW.raw_user_meta_data->>'accepted_terms') = 'true' THEN NOW() END,
    public.nuevo_codigo_referido(),
    v_referidor
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Los jugadores que ya existan se quedan sin código: se les pone uno.
UPDATE public.players SET referral_code = public.nuevo_codigo_referido()
WHERE referral_code IS NULL;

-- ════════════════════════════════════════════════════════════════════════════
-- 2 · Compras de tickets
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.ticket_purchases (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id          UUID NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  quantity           INT NOT NULL CHECK (quantity BETWEEN 1 AND 100),
  amount_usd         DECIMAL(10,2) NOT NULL,
  -- Lo que debía pagar en bolívares y con qué tasa se calculó. La tasa se
  -- guarda para auditar: sin ella, un reclamo de hace dos semanas no se
  -- puede revisar, porque el BCV ya cambió.
  amount_ves         DECIMAL(14,2),
  exchange_rate_used DECIMAL(14,4),
  reference          TEXT NOT NULL,
  -- La forma CANÓNICA de una referencia son sus últimos 6 dígitos, que es
  -- por donde empareja el banco. Guardar el texto crudo dejó pasar el mismo
  -- pago dos veces en el juego hermano: «124754» y «6124754» parecían
  -- distintos y las dos compras se aprobaron.
  reference_norm     TEXT GENERATED ALWAYS AS
                     (right(regexp_replace(reference, '\D', '', 'g'), 6)) STORED,
  status             TEXT NOT NULL DEFAULT 'pendiente'
                     CHECK (status IN ('pendiente','validando','aprobado','rechazado')),
  origin             TEXT CHECK (origin IN ('auto','manual')),
  status_note        TEXT,
  bank_response      JSONB,
  -- Bitácora de las consultas al banco (el panel enseña "verificado N veces").
  last_checked_at    TIMESTAMPTZ,
  check_count        INT NOT NULL DEFAULT 0,
  -- Lo leído del comprobante por OCR. Va filtrado: NUNCA guarda nuestros
  -- propios datos de destino, solo de dónde salió el pago.
  ocr_reference      TEXT,
  ocr_full_reference TEXT,
  ocr_amount         NUMERIC,
  ocr_bank           TEXT,
  ocr_origin         TEXT,
  ocr_origin_type    TEXT,
  ocr_origin_bank    TEXT,
  ocr_origin_cedula  TEXT,
  ocr_is_ubii        BOOLEAN,
  ocr_confidence     NUMERIC,
  ocr_raw            JSONB,
  ocr_at             TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  validated_at       TIMESTAMPTZ
);

-- Índice NORMAL, no único: una referencia repetida SÍ se registra, y va a
-- revisión de una persona. Rechazarla en la base castigaría al jugador que
-- se equivocó de un dígito tanto como al que intenta colar un pago falso.
CREATE INDEX IF NOT EXISTS ticket_purchases_ref_norm_idx
  ON public.ticket_purchases (reference_norm);
CREATE INDEX IF NOT EXISTS ticket_purchases_player_idx
  ON public.ticket_purchases (player_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ticket_purchases_pendientes_idx
  ON public.ticket_purchases (created_at) WHERE status IN ('pendiente','validando');

-- ════════════════════════════════════════════════════════════════════════════
-- 3 · Retiros
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.withdrawals (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id  UUID NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  amount_usd DECIMAL(10,2) NOT NULL CHECK (amount_usd > 0),
  status     TEXT NOT NULL DEFAULT 'pendiente'
             CHECK (status IN ('pendiente','pagado','cancelado')),
  source     TEXT NOT NULL DEFAULT 'saldo' CHECK (source IN ('saldo','referido')),
  -- Referencia del Pago Móvil que hizo el equipo al pagarlo.
  reference  TEXT,
  admin_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS withdrawals_player_idx
  ON public.withdrawals (player_id, created_at DESC);
-- Un retiro pendiente por jugador, garantizado por la BASE y no por una
-- lectura previa que tiene carrera.
CREATE UNIQUE INDEX IF NOT EXISTS withdrawals_uno_pendiente
  ON public.withdrawals (player_id) WHERE status = 'pendiente';

-- ════════════════════════════════════════════════════════════════════════════
-- 4 · Referidos
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.referral_claims (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id UUID NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  referred_id UUID NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  amount_usd  DECIMAL(10,2) NOT NULL,
  partidas    INT NOT NULL,
  -- Qué dólar de los tres es este cobro (1, 2 o 3).
  tramo       INT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- EL candado del programa: cada tramo de cada referido se cobra UNA vez.
-- Sin esto, dos peticiones a la vez cobran el mismo dólar dos veces — que es
-- exactamente la forma del bug que en el juego hermano pagó una partida
-- veinte veces.
CREATE UNIQUE INDEX IF NOT EXISTS referral_claims_tramo_unico
  ON public.referral_claims (referred_id, tramo);
CREATE INDEX IF NOT EXISTS referral_claims_referrer_idx
  ON public.referral_claims (referrer_id, created_at DESC);

-- ════════════════════════════════════════════════════════════════════════════
-- 5 · Defensas: lista negra, límite de tasa, huella de origen
-- ════════════════════════════════════════════════════════════════════════════

-- Una referencia que ya se usó para colar un pago inexistente no vuelve a
-- servir, ni de ese jugador ni de otro. Bloquear es SIEMPRE decisión de una
-- persona: la mayoría de los rechazos son un dígito mal copiado.
CREATE TABLE IF NOT EXISTS public.blocked_references (
  reference_norm TEXT PRIMARY KEY,
  motivo         TEXT NOT NULL,
  purchase_id    UUID REFERENCES public.ticket_purchases(id) ON DELETE SET NULL,
  created_by     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS blocked_references_created_idx
  ON public.blocked_references (created_at DESC);

-- Golpes por ventana de tiempo: frena el registro masivo (por IP) y el spam
-- de retiros (por jugador). El código FALLA ABIERTO a propósito.
CREATE TABLE IF NOT EXISTS public.rate_limit_hits (
  id         BIGSERIAL PRIMARY KEY,
  bucket     TEXT NOT NULL,
  actor      TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS rate_limit_hits_lookup
  ON public.rate_limit_hits (bucket, actor, created_at);

-- Cada jugador paga siempre desde la misma cuenta. Si cambia, el pago NO se
-- rechaza: pasa a revisión de una persona. Cierra la puerta a las estafas
-- triangulares (usar el juego para mover dinero de cuentas ajenas).
--
-- Es una tabla aparte y no "el último pago aprobado" a propósito: si fuera
-- eso, aprobar una compra a mano movería la huella sola y la regla se
-- vaciaría de sentido.
CREATE TABLE IF NOT EXISTS public.player_payment_origins (
  player_id         UUID PRIMARY KEY REFERENCES public.players(id) ON DELETE CASCADE,
  banco             TEXT,
  -- Qué dato identifica al pagador: cedula | cuenta4 | tel4 | nombre
  ancla_tipo        TEXT,
  -- El valor comparable. Los últimos 4 dígitos, NUNCA el texto del recibo:
  -- el mismo banco escribe «Cta. Ahorro BNC: ***6666» una vez y
  -- «Cta. Ahorro ***6666» la siguiente.
  ancla             TEXT,
  muestra           TEXT,
  fijado_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- NULL = la fijó el sistema con el primer pago. Con valor = alguien del
  -- equipo la cambió a propósito.
  fijado_by         UUID REFERENCES public.players(id) ON DELETE SET NULL,
  fijado_por_nombre TEXT,
  motivo            TEXT
);

-- Notas internas del equipo sobre un jugador. NUNCA las ve el jugador: por
-- eso los avisos automáticos van aquí y no en withdrawals.admin_note, que sí
-- viaja a su navegador.
CREATE TABLE IF NOT EXISTS public.player_tags (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id  UUID NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  label      TEXT NOT NULL,
  color      TEXT,
  note       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS player_tags_player_idx ON public.player_tags (player_id);

-- Diario de la conciliación automática. Es lo que permite responder «¿está
-- entrando al banco?» sin adivinar.
CREATE TABLE IF NOT EXISTS public.cron_pasadas (
  id          BIGSERIAL PRIMARY KEY,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ok          BOOLEAN NOT NULL,
  motivo      TEXT,
  latido      TEXT,
  movimientos INT,
  cola_al_dia TIMESTAMPTZ,
  pendientes  INT,
  aprobadas   INT,
  ms          INT
);
CREATE INDEX IF NOT EXISTS cron_pasadas_created_idx ON public.cron_pasadas (created_at DESC);

-- ════════════════════════════════════════════════════════════════════════════
-- 6 · Recuperación de contraseña
--
-- Sin correo de por medio: el jugador demuestra quién es con tres datos que
-- solo él sabe (correo, cédula y teléfono del registro) y recibe un permiso
-- de un solo uso con caducidad. Se guarda el HASH del permiso, nunca el
-- permiso: quien lea la tabla no puede usarlo.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.password_reset_attempts (
  id         BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  email      TEXT NOT NULL,
  -- Si la cuenta se borra, la fila se queda: la bitácora de un intento de
  -- robo no debe irse con la cuenta que intentaron robar.
  player_id  UUID REFERENCES public.players(id) ON DELETE SET NULL,
  ip         TEXT,
  resultado  TEXT NOT NULL CHECK (resultado IN (
               'verificado','no_coincide','sin_cuenta','staff',
               'bloqueado','frenado','cambiada'))
);
CREATE INDEX IF NOT EXISTS password_reset_attempts_email_idx
  ON public.password_reset_attempts (email, created_at DESC);
CREATE INDEX IF NOT EXISTS password_reset_attempts_ip_idx
  ON public.password_reset_attempts (ip, created_at DESC);

CREATE TABLE IF NOT EXISTS public.password_reset_grants (
  id         BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  token_hash TEXT NOT NULL UNIQUE,
  player_id  UUID NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ,
  ip         TEXT
);

-- ════════════════════════════════════════════════════════════════════════════
-- 7 · RLS
--
-- El jugador lee lo suyo. Las tablas de defensa no las lee NADIE desde el
-- navegador: RLS encendida y sin políticas deja fuera a anon y authenticated,
-- y el service_role la salta.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.ticket_purchases        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.withdrawals             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_claims         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blocked_references      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rate_limit_hits         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_payment_origins  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_tags             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cron_pasadas            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.password_reset_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.password_reset_grants   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS purchases_leer_propio ON public.ticket_purchases;
CREATE POLICY purchases_leer_propio ON public.ticket_purchases
  FOR SELECT USING (auth.uid() = player_id);
DROP POLICY IF EXISTS purchases_leer_equipo ON public.ticket_purchases;
CREATE POLICY purchases_leer_equipo ON public.ticket_purchases
  FOR SELECT USING (public.is_admin());

DROP POLICY IF EXISTS withdrawals_leer_propio ON public.withdrawals;
CREATE POLICY withdrawals_leer_propio ON public.withdrawals
  FOR SELECT USING (auth.uid() = player_id);
DROP POLICY IF EXISTS withdrawals_leer_equipo ON public.withdrawals;
CREATE POLICY withdrawals_leer_equipo ON public.withdrawals
  FOR SELECT USING (public.is_admin());

DROP POLICY IF EXISTS referral_claims_leer_propio ON public.referral_claims;
CREATE POLICY referral_claims_leer_propio ON public.referral_claims
  FOR SELECT USING (auth.uid() = referrer_id);

-- Ni una escritura desde el navegador en nada que sea dinero.
REVOKE INSERT, UPDATE, DELETE ON public.ticket_purchases FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.withdrawals      FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.referral_claims  FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.game_runs        FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.game_history     FROM anon, authenticated;
REVOKE UPDATE, DELETE          ON public.players         FROM anon, authenticated;
REVOKE ALL ON public.blocked_references      FROM anon, authenticated;
REVOKE ALL ON public.rate_limit_hits         FROM anon, authenticated;
REVOKE ALL ON public.player_payment_origins  FROM anon, authenticated;
REVOKE ALL ON public.player_tags             FROM anon, authenticated;
REVOKE ALL ON public.cron_pasadas            FROM anon, authenticated;
REVOKE ALL ON public.password_reset_attempts FROM anon, authenticated;
REVOKE ALL ON public.password_reset_grants   FROM anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 8 · RPCs que puede llamar el JUGADOR (authenticated)
--
-- Cada uno vuelve a comprobar TODO por su cuenta. El cliente puede llamarlos
-- directo, saltándose la pantalla: lo que decide aquí es la base, nunca el
-- formulario.
-- ════════════════════════════════════════════════════════════════════════════

-- Cambiar saldo por tickets.
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

  -- FOR UPDATE: dos canjes simultáneos se ponen en fila en vez de leer los
  -- dos el mismo saldo y gastarlo dos veces.
  SELECT * INTO v_player FROM public.players WHERE id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Jugador no encontrado'; END IF;
  IF v_player.blocked THEN RAISE EXCEPTION 'CUENTA_BLOQUEADA'; END IF;
  IF v_player.balance < v_cost THEN
    RAISE EXCEPTION 'Saldo insuficiente para canjear % ticket(s)', p_qty;
  END IF;

  UPDATE public.players
  SET balance = balance - v_cost, tickets = tickets + p_qty
  WHERE id = auth.uid();

  RETURN json_build_object(
    'balance', v_player.balance - v_cost,
    'tickets', v_player.tickets + p_qty
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Pedir un retiro. El monto sale del saldo EN EL ACTO: si se quedara hasta
-- que el equipo pague, el jugador podría pedir el mismo dinero dos veces.
CREATE OR REPLACE FUNCTION public.request_withdrawal(p_amount DECIMAL)
RETURNS JSON AS $$
DECLARE
  v_player public.players%ROWTYPE;
  v_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'No autorizado'; END IF;
  IF p_amount IS NULL OR p_amount < 1.00 THEN
    RAISE EXCEPTION 'El monto mínimo de retiro es $1.00';
  END IF;

  SELECT * INTO v_player FROM public.players WHERE id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Jugador no encontrado'; END IF;
  IF v_player.blocked THEN RAISE EXCEPTION 'CUENTA_BLOQUEADA'; END IF;

  -- Freno de 24 h tras recuperar la contraseña: es la ventana exacta en la
  -- que una cuenta recién robada intentaría vaciarse.
  IF v_player.password_reset_at IS NOT NULL
     AND v_player.password_reset_at > NOW() - INTERVAL '24 hours' THEN
    RAISE EXCEPTION 'Por seguridad, puedes retirar 24 horas después de haber recuperado tu cuenta.';
  END IF;

  IF v_player.balance < p_amount THEN
    RAISE EXCEPTION 'El monto sobrepasa el saldo de tu billetera.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.withdrawals WHERE player_id = auth.uid() AND status = 'pendiente'
  ) THEN
    RAISE EXCEPTION 'Ya tienes un retiro en proceso. Podrás solicitar otro cuando sea pagado.';
  END IF;

  UPDATE public.players SET balance = balance - p_amount WHERE id = auth.uid();
  INSERT INTO public.withdrawals (player_id, amount_usd) VALUES (auth.uid(), p_amount)
  RETURNING id INTO v_id;

  RETURN json_build_object('id', v_id, 'balance', v_player.balance - p_amount);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Datos de Pago Móvil donde el jugador recibe sus premios.
CREATE OR REPLACE FUNCTION public.save_payout_info(
  p_name TEXT, p_bank TEXT, p_cedula TEXT, p_phone TEXT
) RETURNS VOID AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'No autorizado'; END IF;
  UPDATE public.players
  SET payout_name   = NULLIF(TRIM(p_name), ''),
      payout_bank   = NULLIF(TRIM(p_bank), ''),
      payout_cedula = NULLIF(TRIM(p_cedula), ''),
      payout_phone  = NULLIF(TRIM(p_phone), '')
  WHERE id = auth.uid();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Mis referidos, con lo que llevan jugado y lo ya cobrado por cada uno.
CREATE OR REPLACE FUNCTION public.my_referrals()
RETURNS JSON AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'No autorizado'; END IF;
  RETURN json_build_object(
    'codigo', (SELECT referral_code FROM public.players WHERE id = auth.uid()),
    'referidos', COALESCE((
      SELECT json_agg(x ORDER BY x.partidas DESC)
      FROM (
        SELECT
          p.id,
          COALESCE(NULLIF(TRIM(p.username), ''), 'Jugador') AS nombre,
          (SELECT COUNT(*) FROM public.game_history h WHERE h.player_id = p.id)::int
            AS partidas,
          COALESCE((
            SELECT SUM(c.amount_usd) FROM public.referral_claims c
            WHERE c.referred_id = p.id AND c.referrer_id = auth.uid()
          ), 0) AS cobrado_usd,
          (
            SELECT MAX(c.created_at) FROM public.referral_claims c
            WHERE c.referred_id = p.id AND c.referrer_id = auth.uid()
          ) AS cobrado_at
        FROM public.players p
        WHERE p.referred_by = auth.uid()
      ) x
    ), '[]'::json)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Cobrar lo que ha ganado un referido. $1 por cada 10 partidas suyas, hasta
-- $3. Los números viven AQUÍ, no en el cliente: el navegador puede llamar el
-- RPC directo y no se le puede dejar decidir cuánto cobra.
CREATE OR REPLACE FUNCTION public.claim_referral(p_referred UUID)
RETURNS JSON AS $$
DECLARE
  TOPE_USD        CONSTANT DECIMAL := 3;
  TRAMO_USD       CONSTANT DECIMAL := 1;
  TRAMO_PARTIDAS  CONSTANT INT := 10;
  v_yo       public.players%ROWTYPE;
  v_partidas INT;
  v_ganado   DECIMAL;
  v_cobrado  DECIMAL;
  v_pagar    DECIMAL;
  v_saldo    DECIMAL;
  d INT;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'No autorizado'; END IF;

  SELECT * INTO v_yo FROM public.players WHERE id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Jugador no encontrado'; END IF;
  IF v_yo.blocked THEN
    RAISE EXCEPTION 'Tu cuenta está bloqueada. Escríbenos por el chat de atención al cliente.';
  END IF;
  IF v_yo.password_reset_at IS NOT NULL
     AND v_yo.password_reset_at > NOW() - INTERVAL '24 hours' THEN
    RAISE EXCEPTION 'Por seguridad, puedes cobrar 24 horas después de haber recuperado tu cuenta.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.players WHERE id = p_referred AND referred_by = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Ese jugador no es tu referido.';
  END IF;

  SELECT COUNT(*)::int INTO v_partidas
  FROM public.game_history WHERE player_id = p_referred;

  v_ganado := LEAST(TOPE_USD, (v_partidas / TRAMO_PARTIDAS) * TRAMO_USD);

  SELECT COALESCE(SUM(amount_usd), 0) INTO v_cobrado
  FROM public.referral_claims
  WHERE referred_id = p_referred AND referrer_id = auth.uid();

  v_pagar := v_ganado - v_cobrado;

  IF v_pagar <= 0 THEN
    IF v_partidas < TRAMO_PARTIDAS THEN
      RAISE EXCEPTION 'Tu referido lleva % de % partidas para tu primer $1.',
        v_partidas, TRAMO_PARTIDAS;
    ELSIF v_cobrado >= TOPE_USD THEN
      RAISE EXCEPTION 'Ya cobraste los $3 completos de este referido.';
    ELSE
      RAISE EXCEPTION 'Ya cobraste lo disponible por ahora. Vuelve cuando tu referido juegue 10 partidas más.';
    END IF;
  END IF;

  -- Una fila por cada dólar nuevo. El UNIQUE (referred_id, tramo) es el
  -- candado duro: si se colara una petición repetida, revienta aquí en vez
  -- de abonar dos veces.
  d := 1;
  WHILE d <= v_pagar LOOP
    INSERT INTO public.referral_claims
      (referrer_id, referred_id, amount_usd, partidas, tramo)
    VALUES (auth.uid(), p_referred, TRAMO_USD, v_partidas, (v_cobrado + d)::int);
    d := d + 1;
  END LOOP;

  UPDATE public.players SET balance = balance + v_pagar
  WHERE id = auth.uid() RETURNING balance INTO v_saldo;

  RETURN json_build_object('amount', v_pagar, 'balance', v_saldo);
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'Ese premio ya fue cobrado.';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.redeem_tickets(INT)                      FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.request_withdrawal(DECIMAL)              FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.save_payout_info(TEXT,TEXT,TEXT,TEXT)    FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.my_referrals()                           FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.claim_referral(UUID)                     FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.redeem_tickets(INT)                       TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_withdrawal(DECIMAL)               TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_payout_info(TEXT,TEXT,TEXT,TEXT)     TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_referrals()                            TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_referral(UUID)                      TO authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 9 · RPCs que SOLO puede llamar el servidor (service_role)
-- ════════════════════════════════════════════════════════════════════════════

-- Aprobar una compra y entregar los tickets. Es idempotente: si ya estaba
-- aprobada devuelve lo mismo sin volver a sumar. La conciliación reintenta
-- por diseño, y sin esto un reintento regalaría los tickets otra vez.
CREATE OR REPLACE FUNCTION public.approve_purchase(
  p_purchase UUID, p_origin TEXT, p_bank JSONB DEFAULT NULL, p_note TEXT DEFAULT NULL
) RETURNS JSON AS $$
DECLARE
  v_purchase public.ticket_purchases%ROWTYPE;
  v_tickets INT;
BEGIN
  SELECT * INTO v_purchase FROM public.ticket_purchases WHERE id = p_purchase FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Compra no encontrada'; END IF;

  IF v_purchase.status = 'aprobado' THEN
    SELECT tickets INTO v_tickets FROM public.players WHERE id = v_purchase.player_id;
    RETURN json_build_object('status', 'aprobado', 'tickets', v_tickets);
  END IF;

  UPDATE public.ticket_purchases
  SET status = 'aprobado', origin = p_origin,
      bank_response = COALESCE(p_bank, bank_response),
      status_note = p_note, validated_at = NOW()
  WHERE id = p_purchase;

  UPDATE public.players SET tickets = tickets + v_purchase.quantity
  WHERE id = v_purchase.player_id RETURNING tickets INTO v_tickets;

  RETURN json_build_object('status', 'aprobado', 'tickets', v_tickets);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Rechazar. Si ya estaba aprobada, devuelve los tickets entregados.
CREATE OR REPLACE FUNCTION public.reject_purchase(p_purchase UUID, p_note TEXT)
RETURNS VOID AS $$
DECLARE v_purchase public.ticket_purchases%ROWTYPE;
BEGIN
  SELECT * INTO v_purchase FROM public.ticket_purchases WHERE id = p_purchase FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Compra no encontrada'; END IF;
  IF v_purchase.status = 'rechazado' THEN RETURN; END IF;

  UPDATE public.ticket_purchases
  SET status = 'rechazado', status_note = p_note, validated_at = NOW()
  WHERE id = p_purchase;

  IF v_purchase.status = 'aprobado' THEN
    UPDATE public.players SET tickets = GREATEST(0, tickets - v_purchase.quantity)
    WHERE id = v_purchase.player_id;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.pay_withdrawal(
  p_withdrawal UUID, p_reference TEXT, p_note TEXT DEFAULT NULL
) RETURNS VOID AS $$
DECLARE v_w public.withdrawals%ROWTYPE;
BEGIN
  SELECT * INTO v_w FROM public.withdrawals WHERE id = p_withdrawal FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Retiro no encontrado'; END IF;
  IF v_w.status <> 'pendiente' THEN RAISE EXCEPTION 'El retiro no está pendiente'; END IF;
  UPDATE public.withdrawals
  SET status = 'pagado', reference = p_reference, admin_note = p_note, paid_at = NOW()
  WHERE id = p_withdrawal;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Cancelar un retiro pendiente: el dinero VUELVE a la billetera.
CREATE OR REPLACE FUNCTION public.cancel_withdrawal(p_withdrawal UUID)
RETURNS VOID AS $$
DECLARE v_w public.withdrawals%ROWTYPE;
BEGIN
  SELECT * INTO v_w FROM public.withdrawals WHERE id = p_withdrawal FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Retiro no encontrado'; END IF;
  IF v_w.status <> 'pendiente' THEN RAISE EXCEPTION 'El retiro no está pendiente'; END IF;
  UPDATE public.withdrawals SET status = 'cancelado' WHERE id = p_withdrawal;
  UPDATE public.players SET balance = balance + v_w.amount_usd WHERE id = v_w.player_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Marcar que el jugador acaba de recuperar su contraseña: arranca el freno
-- de 24 h de request_withdrawal y claim_referral.
CREATE OR REPLACE FUNCTION public.marcar_recuperacion(p_player UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE public.players SET password_reset_at = NOW() WHERE id = p_player;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.approve_purchase(UUID,TEXT,JSONB,TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reject_purchase(UUID,TEXT)             FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.pay_withdrawal(UUID,TEXT,TEXT)         FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cancel_withdrawal(UUID)                FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.marcar_recuperacion(UUID)              FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_purchase(UUID,TEXT,JSONB,TEXT)  TO service_role;
GRANT EXECUTE ON FUNCTION public.reject_purchase(UUID,TEXT)              TO service_role;
GRANT EXECUTE ON FUNCTION public.pay_withdrawal(UUID,TEXT,TEXT)          TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_withdrawal(UUID)                 TO service_role;
GRANT EXECUTE ON FUNCTION public.marcar_recuperacion(UUID)               TO service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- 10 · Almacenamiento
--
--  · payment-proofs — PRIVADO. Es la captura del pago de una persona: lleva
--    su nombre, su banco y su cuenta. Se abre con URL firmada desde el panel.
--  · avatars — PÚBLICO. La foto de perfil se enseña en el ranking.
--
-- Las dos las escribe SOLO el servidor con la clave de servicio, así que no
-- llevan políticas de subida: el nombre del avatar es siempre el id del
-- propio usuario y nadie puede pisar la foto de otro.
-- ════════════════════════════════════════════════════════════════════════════

INSERT INTO storage.buckets (id, name, public)
VALUES ('payment-proofs', 'payment-proofs', FALSE)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', TRUE)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS avatars_lectura_publica ON storage.objects;
CREATE POLICY avatars_lectura_publica ON storage.objects
  FOR SELECT USING (bucket_id = 'avatars');

-- ── Un remiendo de la 001 ──
-- app_events quedó con RLS encendida y SOLO política de lectura, así que
-- /api/track no podía escribir: la analítica de navegación estaba muerta y
-- en silencio. El cliente puede apuntar SUS eventos y nada más; los de
-- partida los escribe el servidor con la clave de servicio.
DROP POLICY IF EXISTS events_insertar_propio ON public.app_events;
CREATE POLICY events_insertar_propio ON public.app_events
  FOR INSERT WITH CHECK (auth.uid() = player_id);
REVOKE UPDATE, DELETE ON public.app_events FROM anon, authenticated;
