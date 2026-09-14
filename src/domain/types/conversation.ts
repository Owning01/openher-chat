export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  providerId: string | null;
  modelId: string | null;
  systemPromptOverride: string | null;
  researchMode: boolean;
  messageCount: number;
  lastMessagePreview: string;
  status: 'active' | 'archived';
  /** Resumen anclado de los turnos antiguos (compactación de contexto). */
  summary?: string;
  /** Id del último mensaje incluido en `summary`; el contexto enviado empieza después. */
  summaryThroughMessageId?: string;
}
