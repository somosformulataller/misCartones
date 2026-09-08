-- ============================================================================
-- 002 — Los RPC de dinero del juego.
--
-- Van con SECURITY DEFINER y search_path fijo: se ejecutan con los permisos
-- del dueño y se saltan RLS a propósito, porque son la ÚNICA vía por la que
-- el saldo y los tickets se mueven. El navegador nunca escribe esas columnas.
-- ============================================================================

-- Consumir 1 ticket al iniciar una partida. El FOR UPDATE es lo que hace que
-- dos peticiones simultáneas no puedan gastar el mismo ticket.
CREATE OR REPLACE FUNCTION public.spend_ticket(p_player UUID)
RETURNS INT AS $$
DECLARE
  v_tickets INT;
  v_blocked BOOLEAN;
BEGIN
  SELECT tickets, blocked INTO v_tickets, v_blocked
  FROM public.players WHERE id = p_player FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Jugador no encontrado'; END IF;
  IF v_blocked THEN RAISE EXCEPTION 'CUENTA_BLOQUEADA'; END IF;
  IF v_tickets < 1 THEN RAISE EXCEPTION 'SIN_TICKETS'; END IF;

  UPDATE public.players
  SET tickets = tickets - 1,
      total_wagered = total_wagered + 2.00
  WHERE id = p_player;

  RETURN v_tickets - 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Acreditar lo que soltó una bolsa al vaciarse en la carretilla.
CREATE OR REPLACE FUNCTION public.credit_prize(p_player UUID, p_payout DECIMAL)
RETURNS VOID AS $$
DECLARE v_blocked BOOLEAN;
BEGIN
  IF p_payout IS NULL OR p_payout < 0 THEN RAISE EXCEPTION 'Premio inválido'; END IF;

  SELECT blocked INTO v_blocked FROM public.players WHERE id = p_player;
  IF v_blocked THEN RAISE EXCEPTION 'CUENTA_BLOQUEADA'; END IF;

  UPDATE public.players
  SET balance = balance + p_payout,
      total_won = total_won + p_payout
  WHERE id = p_player;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ¿Quien llama es del equipo? Se usa en las políticas del panel.
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.players
    WHERE id = auth.uid() AND role IN ('admin', 'support')
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;
