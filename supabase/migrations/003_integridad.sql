-- ============================================================================
-- 003 — Integridad en la BASE DE DATOS, desde el día uno.
--
-- En el juego hermano estas garantías vivían SOLO en código, con lecturas
-- "leer-luego-escribir" que tienen carrera. Costó dinero real: un jugador
-- cobró la misma partida veinte veces. La frontera de confianza es la BD, así
-- que aquí los invariantes entran ANTES de que haya un solo jugador.
-- ============================================================================

-- Un jugador NO puede tener dos partidas ACTIVAS a la vez.
-- Con esto, el "ya tienes una partida activa" deja de ser una comprobación
-- optimista en el código y pasa a ser imposible.
CREATE UNIQUE INDEX IF NOT EXISTS game_runs_una_activa
  ON public.game_runs (player_id) WHERE game_status = 'ACTIVE';

-- Una partida solo aparece UNA vez en el historial: sin esto, una carrera
-- podría registrar dos veces el mismo premio y descuadrar el RTP del panel.
CREATE UNIQUE INDEX IF NOT EXISTS game_history_run_unico
  ON public.game_history (run_id);
