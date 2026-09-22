import type { Locale } from '../types/settings';
import type { SkillPromptEntry } from '../types/skill';

export interface SystemPromptCapabilities {
  webResearch?: boolean;
  legalDocuments?: boolean;
  skills?: boolean;
  vision?: boolean;
}

export interface BuildSystemPromptInput {
  researchMode: boolean;
  now: number;
  locale: Locale;
  /**
   * Skills disponibles (nombre + descripción). Vacío u omitido ⇒ el prompt no
   * cambia (el prefijo cacheable de los turnos sin skills queda intacto).
   */
  skills?: readonly SkillPromptEntry[];
  /** Plataforma de ejecución detectada (Android vs Web/Desktop PWA). */
  platform?: 'android' | 'web';
  /** Resumen de capacidades y herramientas activas en este turno. */
  capabilities?: SystemPromptCapabilities;
}

const LANGUAGE_INSTRUCTIONS: Record<Locale, string> = {
  es: 'Always answer in Spanish unless the user explicitly asks for another language.',
  en: 'Always answer in English unless the user explicitly asks for another language.',
};

// Estilo base: profundidad por defecto alta. El usuario ya se quejó de
// respuestas "muy resumidas y poco explicativas": este bloque es lo que
// define el contrato de calidad de las respuestas normales.
const STYLE_INSTRUCTIONS = [
  'Answer depth and format:',
  '- ALWAYS structure and format your complete response using clean, standard Markdown (GFM). Use clear headings (##, ###), bulleted or numbered lists, tables for comparisons and structured data, bold/italic text for visual emphasis, and code blocks with language tags.',
  '- Never output unstructured walls of plain text. Break information into logical paragraphs and visual sections.',
  '- Default to thorough, explanatory answers: develop the reasoning, give context, and explain the why, not just the what.',
  '- When the request needs steps (how to, procedure, setup), give numbered steps with concrete details: where to click, exact values, expected result, and how to verify it worked.',
  '- When you present data, features, comparisons, or metrics, use Markdown tables or structured lists instead of dense paragraphs.',
  '- Short answers are for simple factual questions only; if the question is simple, stay brief, but never cut off information the user needs to act.',
  '- If something is uncertain or you could not verify it, say it explicitly instead of omitting it.',
  '- End answers to informational requests with the next practical step or what to watch out for.',
].join('\n');

const RESEARCH_INSTRUCTIONS = [
  'Research mode is enabled: you can call the provided web tools.',
  '- EVERY time the user asks to research, look up, check, or asks about current events, you MUST call the web tools before answering; never answer such requests from memory alone.',
  '- Multi-query exploration: perform fan-out searches with varied keywords and timeframes instead of relying on a single query.',
  '- Deep inspection: use `open_url` to inspect complete source pages when snippets lack depth or when verifying technical/factual details.',
  '- Search before stating facts that may have changed recently and prefer the most recent results.',
  '- Fact-checking & gotchas: actively look for failure modes, counter-evidence, hidden costs, or discrepancies across sources. State agreements and contradictions explicitly.',
  '- Cite every borrowed fact with bracketed numbers like [1], [2] that map, in order, to the `sources` array of the tool results you actually used.',
  '- Never invent URLs, titles, or sources; only cite pages returned by the tools.',
  '- If the tools fail or return nothing useful, say so instead of guessing.',
  '- Once you have enough evidence, stop calling tools and write the final answer in the same turn; never end with only tool calls.',
  '- Research answers must be THOROUGH, not summaries: explain the findings step by step, include concrete data (numbers, dates, names), describe what each source says, note agreements and contradictions between sources, and state what could not be verified. Write a complete briefing the reader could act on without opening the links.',
  '- Visual Reports: When the user requests a visual report, dashboard, or visual synthesis, format it as a self-contained, beautifully styled HTML document inside a ```html code block with interactive metric cards, comparison matrices, and clear sectioning.',
].join('\n');

const BUDGET_NOTE =
  'Budget: this run allows a limited number of steps and tool calls. Use the fewest tool calls that get the job done, stop once you have enough evidence, and always finish with a written answer (never end a turn with only tool calls). "Fewest tool calls" is about efficiency, never about shortening the final answer.';

const SKILLS_INSTRUCTIONS = [
  'Skills (reusable instructions saved by the user):',
  '- When the user request matches the purpose of one of the skills listed below, call `load_skill` with its exact name BEFORE starting the task, then follow the loaded instructions.',
  '- Load only the skills the current request needs; loading more than one is fine when all of them apply.',
  '- Never invent a skill or guess its content: if a skill looks relevant, load it and follow what it says.',
  '- Do not list, summarize, or mention the skills unless the user asks about them.',
].join('\n');

/** Lista de skills para el prompt: una línea por skill, sin cuerpos (ahorra tokens). */
function composeSkillsSection(skills: readonly SkillPromptEntry[]): string {
  const lines = skills.map((skill) => `- ${skill.name}: ${skill.description}`);
  return `${SKILLS_INSTRUCTIONS}\n${lines.join('\n')}`;
}

/** Manifiesto de entorno y contexto de ejecución del dispositivo (Agent Harness). */
function composeEnvironmentSection(
  platform?: 'android' | 'web',
  capabilities?: SystemPromptCapabilities,
  researchMode?: boolean,
  hasSkills?: boolean,
): string {
  const hostLabel =
    platform === 'android'
      ? 'Android mobile device (Capacitor native shell)'
      : 'Web browser / desktop PWA';

  const lines = [
    'Environment & Execution Context:',
    `- Host: OpenHer Chat client running on ${hostLabel}.`,
    '- Architecture: Single-user local-first application. All chats, legal cases, settings, and API keys are stored solely on the user device (IndexedDB/KeyVault). There is no intermediate server, proxy, or tracking backend.',
  ];

  const caps: string[] = [];
  if (capabilities?.webResearch ?? researchMode) caps.push('Web search & page retrieval (web_search, fetch_page)');
  if (capabilities?.legalDocuments) caps.push('Legal document studio (read, patch, chunk search, forensic linting/audit)');
  if (capabilities?.skills ?? hasSkills) caps.push('User skills (load_skill)');
  if (capabilities?.vision) caps.push('Multimodal image perception');

  if (caps.length > 0) {
    lines.push(`- Active capabilities in this session: ${caps.join(', ')}.`);
  }

  return lines.join('\n');
}

/**
 * System prompt en inglés (texto para el modelo, spec §3): fecha UTC, idioma de
 * respuesta, estilo de respuesta, instrucciones de investigación (si aplica) y
 * nota de presupuesto. El caller puede prefijar overrides propios.
 *
 * La fecha va sin hora a propósito: este texto encabeza el prefijo cacheable y
 * un timestamp con segundos invalidaría la caché de prompt en cada turno.
 */
export function buildSystemPrompt(input: BuildSystemPromptInput): string {
  const hasSkills = input.skills !== undefined && input.skills.length > 0;
  const sections = [
    'You are OpenHer, a helpful AI assistant.',
    `Current date (UTC): ${new Date(input.now).toISOString().slice(0, 10)}.`,
    composeEnvironmentSection(input.platform, input.capabilities, input.researchMode, hasSkills),
    LANGUAGE_INSTRUCTIONS[input.locale],
    STYLE_INSTRUCTIONS,
  ];
  if (input.researchMode) sections.push(RESEARCH_INSTRUCTIONS);
  if (hasSkills && input.skills !== undefined) {
    sections.push(composeSkillsSection(input.skills));
  }
  sections.push(BUDGET_NOTE);
  return sections.join('\n\n');
}
