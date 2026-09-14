import type { ProviderAdapter } from '../ports/ProviderAdapter';
import type { WireMessage } from '../types/stream';

/**
 * Puerto del generador de título de OpenCode (`session/prompt.ts`): pide un
 * título al modelo barato y limpia la salida. Tope de 100 caracteres con `...`.
 */
export const GENERATED_TITLE_MAX_CHARS = 100;

const TITLE_SYSTEM_PROMPT =
  'You write conversation titles. Reply with a single short title (max 6 words) in the language of the conversation. No quotes, no trailing punctuation, no preamble.';

export interface GenerateTitleInput {
  provider: ProviderAdapter;
  modelId: string;
  userText: string;
  assistantText: string;
  signal: AbortSignal;
  sessionId?: string;
}

/** Mensajes al estilo OpenCode: instrucción + primer turno real de la conversación. */
export function buildTitleMessages(userText: string, assistantText: string): WireMessage[] {
  return [
    { role: 'user', content: `Generate a title for this conversation:\n\n${excerpt(userText, 600)}` },
    { role: 'assistant', content: excerpt(assistantText, 800) },
  ];
}

function excerpt(text: string, max: number): string {
  const trimmed = text.trim().replace(/\s+/g, ' ');
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max)}…`;
}

/** Normaliza la salida: quita ` thinking`, toma la primera línea y acota a `maxChars`. */
export function sanitizeTitle(raw: string, maxChars = GENERATED_TITLE_MAX_CHARS): string | null {
  const withoutThinking = raw.replace(/<think>[\s\S]*?<\/think>\s*/g, '');
  const firstLine = withoutThinking
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (firstLine === undefined) return null;

  let value = firstLine
    .replace(/^\s*(?:title|título|titulo)\s*[:：-]\s*/i, '')
    .replace(/^#{1,6}\s*/, '')
    .replace(/\*\*/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  // Puntuación final, comillas envolventes y de nuevo puntuación (el orden importa).
  value = value.replace(/[.:;,]+$/u, '').trim();
  value = value.replace(/^["'“”‘’]+/, '').replace(/["'“”‘’]+$/, '').trim();
  value = value.replace(/[.:;,]+$/u, '').trim();

  if (value.length < 2) return null;
  return value.length > maxChars ? `${value.slice(0, maxChars - 3).trimEnd()}...` : value;
}

/** Pide al modelo un título corto; devuelve `null` si no produce texto usable. */
export async function generateTitle(input: GenerateTitleInput): Promise<string | null> {
  let raw = '';
  try {
    for await (const event of input.provider.streamChat({
      modelId: input.modelId,
      system: TITLE_SYSTEM_PROMPT,
      messages: buildTitleMessages(input.userText, input.assistantText),
      temperature: 0.2,
      maxOutputTokens: 32,
      signal: input.signal,
      sessionId: input.sessionId,
      toolChoice: 'none',
    })) {
      if (event.type === 'text-delta') raw += event.delta;
      else if (event.type === 'stop') break;
      else if (event.type === 'error') return null;
    }
  } catch {
    return null;
  }

  return sanitizeTitle(raw);
}
