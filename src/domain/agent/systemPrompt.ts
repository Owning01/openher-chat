import type { Locale } from '../types/settings';

export interface BuildSystemPromptInput {
  researchMode: boolean;
  now: number;
  locale: Locale;
}

const LANGUAGE_INSTRUCTIONS: Record<Locale, string> = {
  es: 'Always answer in Spanish unless the user explicitly asks for another language.',
  en: 'Always answer in English unless the user explicitly asks for another language.',
};

const RESEARCH_INSTRUCTIONS = [
  'Research mode is enabled: you can call the provided web tools.',
  '- Search before stating facts that may have changed recently and prefer the most recent results.',
  '- Cite every borrowed fact with bracketed numbers like [1], [2] that map, in order, to the `sources` array of the tool results you actually used.',
  '- Never invent URLs, titles, or sources; only cite pages returned by the tools.',
  '- If the tools fail or return nothing useful, say so instead of guessing.',
  '- Once you have enough evidence, stop calling tools and write the final answer in the same turn; never end with only tool calls.',
].join('\n');

const BUDGET_NOTE =
  'Budget: this run allows a limited number of steps and tool calls. Use the fewest tool calls that get the job done, stop once you have enough evidence, and always finish with a written answer (never end a turn with only tool calls). Keep the answer concise.';

/**
 * System prompt en inglés (texto para el modelo, spec §3): fecha UTC, idioma de
 * respuesta, instrucciones de investigación (si aplica) y nota de presupuesto.
 * El caller puede prefijar overrides propios.
 *
 * La fecha va sin hora a propósito: este texto encabeza el prefijo cacheable y
 * un timestamp con segundos invalidaría la caché de prompt en cada turno.
 */
export function buildSystemPrompt(input: BuildSystemPromptInput): string {
  const sections = [
    'You are OpenHer, a helpful AI assistant.',
    `Current date (UTC): ${new Date(input.now).toISOString().slice(0, 10)}.`,
    LANGUAGE_INSTRUCTIONS[input.locale],
  ];
  if (input.researchMode) sections.push(RESEARCH_INSTRUCTIONS);
  sections.push(BUDGET_NOTE);
  return sections.join('\n\n');
}
