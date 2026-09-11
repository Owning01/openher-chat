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
}
