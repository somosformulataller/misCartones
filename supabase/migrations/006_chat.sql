-- 006 — Chat de atención al cliente
--
-- Portado de La Mejor Llave (sus migraciones 005, 007, 014, 022 y 033), en
-- una sola pasada: conversación uno a uno por jugador, mensajes con adjuntos,
-- preguntas rápidas para el jugador y respuestas rápidas del equipo.
--
-- El cliente NUNCA escribe en estas tablas: todo pasa por las rutas del
-- servidor con la clave secreta. Por RLS cada jugador solo lee lo suyo y el
-- equipo (is_admin: admin o atención) lo lee todo.
--
-- Idempotente: se puede correr más de una vez.

-- ── Conversaciones ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.chat_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id UUID NOT NULL UNIQUE REFERENCES public.players(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pendiente'
    CHECK (status IN ('pendiente', 'prioridad', 'resuelto')),
  last_message_at TIMESTAMPTZ,
  player_read_at TIMESTAMPTZ,   -- hasta cuándo leyó el jugador
  admin_read_at TIMESTAMPTZ,    -- hasta cuándo leyó el equipo
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS chat_conversations_last_idx
  ON public.chat_conversations (last_message_at DESC NULLS LAST);

-- ── Mensajes ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.chat_conversations(id) ON DELETE CASCADE,
  sender TEXT NOT NULL CHECK (sender IN ('player', 'support')),
  body TEXT CHECK (char_length(body) <= 2000),
  attachment_path TEXT,
  attachment_name TEXT,
  attachment_type TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (body IS NOT NULL OR attachment_path IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS chat_messages_conv_idx
  ON public.chat_messages (conversation_id, created_at);

-- Quién del equipo respondió, y si un mensaje del equipo se editó.
ALTER TABLE public.chat_messages
  ADD COLUMN IF NOT EXISTS sender_id UUID REFERENCES public.players(id) ON DELETE SET NULL;
ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;
-- Para que Realtime pueda aplicar RLS también a los borrados.
ALTER TABLE public.chat_messages REPLICA IDENTITY FULL;

-- ── Preguntas rápidas (botones que ve el jugador) ──────────────────────────
CREATE TABLE IF NOT EXISTS public.chat_quick_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question TEXT NOT NULL CHECK (char_length(question) BETWEEN 1 AND 200),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  position INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.chat_quick_questions (question, position)
SELECT q, p FROM (VALUES
  ('¿Cómo compro tickets?', 1),
  ('¿Cómo retiro mi saldo?', 2),
  ('No me llegaron mis tickets', 3),
  ('Tengo un problema con un pago', 4),
  ('¿Cómo se juega?', 5)
) AS v(q, p)
WHERE NOT EXISTS (SELECT 1 FROM public.chat_quick_questions);

-- ── Respuestas rápidas del equipo (atajos /N) ──────────────────────────────
CREATE TABLE IF NOT EXISTS public.chat_quick_replies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shortcut INT NOT NULL UNIQUE CHECK (shortcut BETWEEN 1 AND 99999),
  title TEXT CHECK (title IS NULL OR char_length(title) <= 60),
  body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── RLS ────────────────────────────────────────────────────────────────────
ALTER TABLE public.chat_conversations   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_quick_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_quick_replies   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "chat_conv_own_read" ON public.chat_conversations;
CREATE POLICY "chat_conv_own_read" ON public.chat_conversations
  FOR SELECT USING (auth.uid() = player_id);
DROP POLICY IF EXISTS "chat_conv_admin_read" ON public.chat_conversations;
CREATE POLICY "chat_conv_admin_read" ON public.chat_conversations
  FOR SELECT USING (public.is_admin());

DROP POLICY IF EXISTS "chat_msg_own_read" ON public.chat_messages;
CREATE POLICY "chat_msg_own_read" ON public.chat_messages
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM public.chat_conversations c
    WHERE c.id = conversation_id AND c.player_id = auth.uid()
  ));
DROP POLICY IF EXISTS "chat_msg_admin_read" ON public.chat_messages;
CREATE POLICY "chat_msg_admin_read" ON public.chat_messages
  FOR SELECT USING (public.is_admin());

DROP POLICY IF EXISTS "chat_qq_read" ON public.chat_quick_questions;
CREATE POLICY "chat_qq_read" ON public.chat_quick_questions
  FOR SELECT USING (active OR public.is_admin());

DROP POLICY IF EXISTS "chat_qr_admin_read" ON public.chat_quick_replies;
CREATE POLICY "chat_qr_admin_read" ON public.chat_quick_replies
  FOR SELECT USING (public.is_admin());

REVOKE INSERT, UPDATE, DELETE ON public.chat_conversations   FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.chat_messages        FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.chat_quick_questions FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.chat_quick_replies   FROM anon, authenticated;

-- ── Tiempo real: los mensajes llegan al instante ───────────────────────────
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_messages;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Adjuntos: bucket privado de 5 MB ───────────────────────────────────────
-- Sin políticas de storage: solo el servidor (clave secreta) sube y firma.
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('chat-attachments', 'chat-attachments', FALSE, 5242880)
ON CONFLICT (id) DO NOTHING;
