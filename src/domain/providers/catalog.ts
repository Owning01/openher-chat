import type { ModelInfo, ProviderKind, ProviderQuirks } from '../types/provider';

/** Plantilla para crear un ProviderConfig sin modelos hardcodeados (se descubren por API o a mano). */
export interface ProviderTemplate {
  id: string;
  label: string;
  description: string;
  kind: ProviderKind;
  baseUrl: string;
  requiresKey: boolean;
  models: ModelInfo[];
  defaultModelId: string | null;
  quirks?: ProviderQuirks;
}

export const PROVIDER_TEMPLATES: readonly ProviderTemplate[] = [
  {
    id: 'groq',
    label: 'Groq',
    description: 'Fast OpenAI-compatible inference.',
    kind: 'openai-compatible',
    baseUrl: 'https://api.groq.com/openai/v1',
    requiresKey: true,
    models: [],
    defaultModelId: null,
    quirks: { includeUsage: true, sendToolChoice: true },
  },
  {
    id: 'cerebras',
    label: 'Cerebras',
    description: 'Low-latency OpenAI-compatible API.',
    kind: 'openai-compatible',
    baseUrl: 'https://api.cerebras.ai/v1',
    requiresKey: true,
    models: [],
    defaultModelId: null,
  },
  {
    id: 'openai',
    label: 'OpenAI',
    description: 'OpenAI-hosted models.',
    kind: 'openai-compatible',
    baseUrl: 'https://api.openai.com/v1',
    requiresKey: true,
    models: [],
    defaultModelId: null,
    // Caché: la clave estable mejora el routing y `include_usage` es lo que
    // permite medir `prompt_tokens_details.cached_tokens` en streaming.
    quirks: { promptCache: true, includeUsage: true },
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    description: 'OpenAI-compatible DeepSeek API.',
    kind: 'openai-compatible',
    baseUrl: 'https://api.deepseek.com/v1',
    requiresKey: true,
    models: [],
    defaultModelId: null,
  },
  {
    id: 'ollama',
    label: 'Ollama',
    description: 'Local models served by Ollama.',
    kind: 'openai-compatible',
    baseUrl: 'http://127.0.0.1:11434/v1',
    requiresKey: false,
    models: [],
    defaultModelId: null,
  },
  {
    id: 'lmstudio',
    label: 'LM Studio',
    description: 'Local OpenAI-compatible server.',
    kind: 'openai-compatible',
    baseUrl: 'http://127.0.0.1:1234/v1',
    requiresKey: false,
    models: [],
    defaultModelId: null,
  },
  {
    id: 'vllm',
    label: 'vLLM',
    description: 'Self-hosted OpenAI-compatible server.',
    kind: 'openai-compatible',
    baseUrl: 'http://127.0.0.1:8000/v1',
    requiresKey: false,
    models: [],
    defaultModelId: null,
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    description: 'Claude models via the Anthropic API.',
    kind: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    requiresKey: true,
    models: [],
    defaultModelId: null,
  },
  {
    id: 'opencode-zen',
    label: 'OpenCode Zen',
    description: 'OpenCode gateway: Claude, GPT, Gemini, GLM, Kimi and more with a single API key.',
    kind: 'opencode',
    baseUrl: 'https://opencode.ai/zen/v1',
    requiresKey: true,
    models: [],
    defaultModelId: null,
  },
  {
    id: 'opencode-go',
    label: 'OpenCode Go',
    description: 'OpenCode low-cost subscription for open coding models (MiniMax, GLM, Kimi, Qwen, DeepSeek…).',
    kind: 'opencode',
    baseUrl: 'https://opencode.ai/zen/go/v1',
    requiresKey: true,
    models: [],
    defaultModelId: null,
  },
];

export function getProviderTemplate(id: string): ProviderTemplate | undefined {
  return PROVIDER_TEMPLATES.find((template) => template.id === id);
}
