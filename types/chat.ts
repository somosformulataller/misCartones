// Tipos del chat de atención al cliente (jugador ↔ admin).
// Solo hay dos remitentes posibles: el jugador y soporte (admin).
export type ChatSender = 'player' | 'support';
export type ChatConversationStatus = 'pendiente' | 'prioridad' | 'resuelto';

export interface ChatAttachmentInfo {
  path: string;
  name: string;
  type: string; // MIME: image/…, application/pdf, audio/…
}

export interface ChatMessage {
  id: string;
  conversation_id: string;
  sender: ChatSender;
  body: string | null;
  attachment_path: string | null;
  attachment_name: string | null;
  attachment_type: string | null;
  created_at: string;
  /** Fecha de la última corrección hecha por soporte (migración 014) */
  edited_at?: string | null;
  /** Qué persona del equipo lo escribió (migración 022). Solo en los
   *  mensajes de soporte; el panel lo enseña, la app del jugador no. */
  sender_id?: string | null;
  sender_name?: string | null;
}

// Etiqueta/nota interna del staff sobre un jugador ("testimonio
// pedido", "cliente fastidioso"…). El jugador nunca las ve.
export type PlayerTagColor = 'neutral' | 'gold' | 'green' | 'red' | 'blue';

export interface PlayerTag {
  id: string;
  player_id: string;
  label: string;
  note: string | null;
  color: PlayerTagColor;
  created_at: string;
  updated_at: string;
}

export interface ChatConversation {
  id: string;
  player_id: string;
  status: ChatConversationStatus;
  last_message_at: string | null;
  player_read_at: string | null;
  admin_read_at: string | null;
  created_at: string;
}

export interface ChatQuickQuestion {
  id: string;
  question: string;
  active: boolean;
  position: number;
}

// Respuesta rápida del STAFF (guion/canned response). No confundir con
// ChatQuickQuestion (botones sugeridos del jugador). Solo el equipo la
// usa: escribir "/{shortcut}" en el chat, o el botón ⚡, la inserta.
export interface ChatQuickReply {
  id: string;
  shortcut: number;
  title: string | null;
  body: string;
}

// Respuesta del GET /api/chat (lado jugador)
export interface PlayerChatResponse {
  conversation: ChatConversation | null;
  messages: ChatMessage[];
  quickQuestions: ChatQuickQuestion[];
  unread: number;
  error?: string;
}

// Fila de la lista de conversaciones del admin
export interface AdminChatListItem {
  id: string;
  player_id: string;
  status: ChatConversationStatus;
  last_message_at: string | null;
  username: string | null;
  email: string | null;
  tickets: number;
  unread: number;
  /** Vista previa del último mensaje ("Tú: …", "📎 Adjunto", …) */
  preview: string;
  /** Etiquetas internas del jugador (para verlas sin abrir el chat) */
  tags: PlayerTag[];
}
