import type { LegalCircuitRole } from './legal';

export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  providerId: string | null;
  modelId: string | null;
  systemPromptOverride: string | null;
  researchMode: boolean;
  /**
   * Vínculo único caso↔conversación (fuente del modo legal).
   * `!= null` = conversación legal; ausente/`null` = general.
   * `create()` nunca lo puebla (contrato T14).
   */
  legalCaseId?: string | null;
  /**
   * Rol del chat en el circuito adversarial del expediente (`redactor` →
   * `atacante` → `juez` → `sintesis`). Ausente/`null` = sin rol (chat legal común).
   * `create()` nunca lo puebla (contrato T14, igual que `legalCaseId`).
   */
  legalRole?: LegalCircuitRole | null;
  messageCount: number;
  lastMessagePreview: string;
  status: 'active' | 'archived';
  /** Resumen anclado de los turnos antiguos (compactación de contexto). */
  summary?: string;
  /** Id del último mensaje incluido en `summary`; el contexto enviado empieza después. */
  summaryThroughMessageId?: string;
}
