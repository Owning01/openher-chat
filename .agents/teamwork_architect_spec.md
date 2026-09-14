# teamwork_architect_spec.md — OpenHer Chat (diseño congelado)

> Fuente de verdad técnica del swarm. Los Workers deben leer este archivo antes de implementar.
> Los contratos marcados como CONGELADOS no se cambian sin re-despacho al Architect.

## 1. Estructura de carpetas

```
G:\Proyectos\openher-chat\
├─ package.json · pnpm-lock.yaml · vite.config.ts · tsconfig(.app|.node).json
├─ index.html · capacitor.config.ts · public/{manifest.webmanifest,sw.js,icons/}
├─ docs/{dev-setup.md,search-proxy.md,e2e-smoke.md}
└─ src/
   ├─ main.tsx
   ├─ app/  {App.tsx, bootstrap.ts, services.tsx, routing.tsx, layout/**
   ├─ domain/
   │  ├─ types/{provider,chat,conversation,stream,tools,agent,settings,index}.ts
   │  ├─ ports/{ProviderAdapter,ConversationRepository,SettingsRepository,KeyVault,HttpClient,SearchProvider,index}.ts
   │  ├─ chat/{estimateTokens,buildWireMessages,truncateText,messageFactory}.ts
   │  ├─ agent/{runAgent,budget,toolRegistry,systemPrompt,parseToolArguments}.ts
   │  ├─ providers/{catalog,capabilities}.ts
   │  └─ settings/{defaults,migrate}.ts
   ├─ adapters/
   │  ├─ providers/{sse,errors,openaiCompatible,anthropic,index}.ts + __fixtures__/
   │  ├─ http/{FetchHttpClient,CapacitorHttpClient,fetchStream,resolveTransport}.ts
   │  ├─ tools/{index,urlPolicy}.ts · tools/webSearch/{index,brave,tavily,duckduckgo}.ts
   │  │        · tools/openUrl/{index,extractArticle}.ts
   │  └─ storage/{idb,IndexedDbConversations,LocalSettingsRepository,LocalKeyVault}.ts
   ├─ features/
   │  ├─ chat/{ChatPage.tsx, state/chatStore.ts, hooks/, components/}
   │  ├─ conversations/ · settings/ · onboarding/ · research/
   ├─ shared/{ui/**, markdown/{Markdown,CodeBlock,CopyButton}.tsx, icons/index.ts, hooks/**, utils/{cn,ids,Result,json}.ts}
   ├─ i18n/{index.ts, types.ts, useT.ts, dicts/<feature>.ts}   # 1 dict por feature, defineDict
   └─ styles/index.css                    # Tailwind 4 @theme + tokens light/dark
```

Alias `@/` → `src/`. Sin router externo (hash routing propio). Zustand para stores.

## 2. Dependencias aprobadas (SOLO T01 ejecuta pnpm add/install)

react 19.2.8 · react-dom 19.2.8 · zustand · idb · react-markdown · remark-gfm · highlight.js · lucide-react · @capacitor/core 8.5.0 · @capacitor/android 8.5.0 · @capacitor/cli 8.5.0 ·
vite ^8.2 · @vitejs/plugin-react ^6.1 · typescript 7.0.2 · @types/react(dom) 19.2 · tailwindcss 4.3 · @tailwindcss/vite ·
vitest 4.1.8 · jsdom 27.3 · fake-indexeddb · @testing-library/react 16.3 · @testing-library/jest-dom 6.9.1

Prohibido: router, axios, zod, SDKs de proveedores, tokenizers, plugins PWA, cualquier otra librería.

## 3. Convenciones

- tsconfig: `strict`, `noUncheckedIndexedAccess`, `noUnusedLocals`, `noUnusedParameters`, `verbatimModuleSyntax`. `tsc --noEmit` limpio.
- Cero `console.log`, código comentado, TODOs sueltos. Cero `any` (si es inevitable, justificar en WORKER_COMPLETE).
- Textos para el modelo (descripciones de tools, system prompt) en inglés; UI 100% i18n (`defineDict({es,en})` por feature, paridad en compile-time).
- Tests sin red real (fetch/adapters inyectados o fake). Fixtures en `__fixtures__/`.
- Scratch de agentes: `scratch/agent-<id>/` (gitignored), nunca archivos temporales en la raíz.

## 4. Contratos de dominio (CONGELADOS)

```ts
// domain/types/provider.ts
export type ProviderKind = 'openai-compatible' | 'anthropic';
export interface ModelInfo { id: string; label: string; contextWindow?: number; supportsTools?: boolean; supportsStreaming?: boolean; source: 'api' | 'manual'; }
export interface ProviderQuirks { includeUsage?: boolean; sendToolChoice?: boolean; }
export interface ProviderConfig {
  id: string; label: string; kind: ProviderKind; baseUrl: string; requiresKey: boolean;
  keyRef: string | null; extraHeaders?: Record<string, string>; models: ModelInfo[];
  defaultModelId: string | null; quirks?: ProviderQuirks; createdAt: number; updatedAt: number;
}
export interface ProviderCapabilities { streaming: boolean; toolCalling: boolean; systemPrompt: boolean; listModels: boolean; images: boolean; }

// domain/types/chat.ts
export type Role = 'system' | 'user' | 'assistant';
export interface ToolCall { id: string; name: string; argumentsText: string; arguments?: unknown; }
export interface SourceRef { url: string; title: string; snippet?: string; accessedAt: number; }
export type ToolErrorCode = 'timeout'|'network'|'cors_blocked'|'blocked_url'|'no_provider'|'invalid_args'|'http_error'|'parse_error';
export interface ToolResult { ok: boolean; content: string; sources?: SourceRef[]; provider?: string; error?: { code: ToolErrorCode; message: string }; durationMs: number; }
export type MessageErrorCode = 'auth'|'rate_limit'|'network'|'timeout'|'server'|'invalid_request'|'context_length'|'aborted'|'unknown';
export interface MessageError { code: MessageErrorCode; message: string; retryable: boolean; }
export type MessageStatus = 'pending'|'streaming'|'complete'|'aborted'|'error';
export type MessageFinishReason = 'complete'|'aborted'|'budget_exceeded'|'error';
export interface TokenUsage { promptTokens?: number; completionTokens?: number; totalTokens?: number; }
export type MessageContent =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'tool-call'; toolCall: ToolCall }
  | { type: 'tool-result'; toolCallId: string; toolName: string; result: ToolResult };
export interface ChatMessage {
  id: string; conversationId: string; role: Role; status: MessageStatus; content: MessageContent[];
  createdAt: number; updatedAt: number; providerId?: string; modelId?: string; usage?: TokenUsage;
  finishReason?: MessageFinishReason; error?: MessageError;
}

// domain/types/stream.ts
export type WireMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: { id: string; name: string; argumentsText: string }[] }
  | { role: 'tool'; content: string; toolCallId: string; toolName?: string };
export type StopReason = 'end_turn'|'tool_use'|'max_tokens'|'stop_sequence'|'aborted';
export type StreamEvent =
  | { type: 'start' } | { type: 'text-delta'; delta: string } | { type: 'reasoning-delta'; delta: string }
  | { type: 'tool-call'; toolCall: ToolCall } | { type: 'usage'; usage: TokenUsage }
  | { type: 'transport-fallback'; reason: 'cors'|'stream_unsupported'|'network' }
  | { type: 'stop'; reason: StopReason } | { type: 'error'; error: MessageError };

// domain/types/conversation.ts
export interface Conversation {
  id: string; title: string; createdAt: number; updatedAt: number;
  providerId: string | null; modelId: string | null; systemPromptOverride: string | null;
  researchMode: boolean; messageCount: number; lastMessagePreview: string; status: 'active'|'archived';
}

// domain/types/tools.ts
export interface JsonSchema { type: 'object'|'string'|'number'|'integer'|'boolean'|'array'; description?: string; properties?: Record<string, JsonSchema>; required?: string[]; items?: JsonSchema; enum?: string[]; }
export interface ToolExecutionContext { signal: AbortSignal; conversationId: string; }
export interface ToolDefinition<Args = Record<string, unknown>> {
  name: string; description: string; parameters: JsonSchema; timeoutMs: number; maxResultChars: number;
  execute(args: Args, context: ToolExecutionContext): Promise<ToolResult>;
}
export interface ToolRegistry { list(): ToolDefinition[]; get(name: string): ToolDefinition | undefined; }

// domain/types/agent.ts
export interface AgentBudget { maxSteps: number; maxToolCalls: number; maxToolResultChars: number; maxTotalTokens: number; maxWallClockMs: number; maxRetriesPerStep: number; toolTimeoutMs: number; }
export interface AgentStep { index: number; status: 'running'|'complete'|'error'; startedAt: number; endedAt?: number; stopReason?: StopReason; usage?: TokenUsage; text: string; toolCalls: ToolCall[]; toolResults: ToolResult[]; }
export type AgentRunStatus = 'complete'|'aborted'|'budget_exceeded'|'error';
export type AgentEvent =
  | { type: 'run-start'; runId: string } | { type: 'step-start'; stepIndex: number }
  | { type: 'text-delta'; stepIndex: number; delta: string } | { type: 'reasoning-delta'; stepIndex: number; delta: string }
  | { type: 'tool-start'; stepIndex: number; toolCall: ToolCall } | { type: 'tool-end'; stepIndex: number; toolCall: ToolCall; result: ToolResult }
  | { type: 'step-end'; stepIndex: number; stopReason: StopReason; usage?: TokenUsage }
  | { type: 'run-end'; status: AgentRunStatus; message: ChatMessage; error?: MessageError };

// domain/types/settings.ts
export type Locale = 'es'|'en'; export type ThemeMode = 'light'|'dark'|'system';
export type SearchMode = 'auto'|'brave'|'tavily'|'duckduckgo'; export type Freshness = 'any'|'day'|'week'|'month'|'year';
export interface ChatDefaults { systemPrompt: string; temperature: number; maxOutputTokens: number | null; }
export interface HistoryBudget { mode: 'auto'|'fixed'; maxPromptTokens: number | null; reservedOutputTokens: number; keepLastTurns: number; truncateMessageAtPercent: number; }
export interface ToolSettings { webSearchEnabled: boolean; openUrlEnabled: boolean; }
export interface SearchSettings { mode: SearchMode; maxResults: number; defaultFreshness: Freshness; safeSearch: boolean; }
export interface ProxySettings { mode: 'direct'|'custom'; baseUrl: string | null; }
export interface AppSettings { schemaVersion: number; locale: Locale; theme: ThemeMode; activeProviderId: string | null; lastModelByProvider: Record<string,string>; chat: ChatDefaults; history: HistoryBudget; agent: AgentBudget; tools: ToolSettings; search: SearchSettings; proxy: ProxySettings; onboardingCompleted: boolean; updatedAt: number; }
```

## 5. Puertos (CONGELADOS)

```ts
export interface ConversationRepository {
  list(): Promise<Conversation[]>; get(id: string): Promise<Conversation | null>;
  create(input?: { title?: string; providerId?: string | null; modelId?: string | null }): Promise<Conversation>;
  update(id: string, patch: Partial<Omit<Conversation,'id'|'createdAt'>>): Promise<Conversation>;
  remove(id: string): Promise<void>;
  listMessages(conversationId: string): Promise<ChatMessage[]>;
  appendMessage(message: ChatMessage): Promise<void>;
  updateMessage(id: string, patch: Partial<Omit<ChatMessage,'id'|'conversationId'|'createdAt'>>): Promise<void>;
  deleteMessagesFrom(conversationId: string, messageId: string): Promise<void>;
  recoverInterrupted(): Promise<string[]>;
}
export interface SettingsRepository { load(): Promise<AppSettings>; save(s: AppSettings): Promise<void>; }
export interface KeyVault { has(ref: string): Promise<boolean>; get(ref: string): Promise<string | null>; set(ref: string, secret: string): Promise<void>; remove(ref: string): Promise<void>; }
export class HttpError extends Error { kind!: 'network'|'timeout'|'aborted'; status?: number; }
export interface HttpRequest { url: string; method: 'GET'|'POST'; headers?: Record<string,string>; body?: unknown; timeoutMs?: number; signal?: AbortSignal; redirect?: 'follow'|'error'|'manual'; }
export interface HttpResponse { status: number; headers: Record<string,string>; text: string; }
export interface HttpClient { request(r: HttpRequest): Promise<HttpResponse>; readonly supportsRedirectControl?: boolean; }
// AMEND (2026-09-11, H3): `redirect` y `supportsRedirectControl` habilitan la politica SSRF de open_url:
// el modo directo NUNCA sigue redirects (3xx/opaque -> blocked_url); seguirlos es responsabilidad del proxy de lectura.
export type StreamResult = { mode: 'sse'; stream: ReadableStream<Uint8Array> } | { mode: 'buffered'; status: number; text: string };
export interface StreamTransport { post(r: { url: string; headers: Record<string,string>; body: unknown; signal: AbortSignal }): Promise<StreamResult>; }
export interface SearchProvider { readonly id: 'brave'|'tavily'|'duckduckgo'; search(input: { query: string; maxResults: number; freshness: Freshness; signal: AbortSignal }): Promise<SourceRef[]>; }
```

Refs de KeyVault: `provider:<id>`, `search:brave`, `search:tavily`. La key NUNCA se serializa en ProviderConfig (test obligatorio).

## 6. ProviderAdapter (CONGELADO)

```ts
export interface ChatCompletionRequest {
  modelId: string; system?: string; messages: WireMessage[]; tools?: ToolDefinition[];
  toolChoice?: 'auto'|'none'; temperature?: number; maxOutputTokens?: number | null; signal: AbortSignal;
}
export interface ProviderAdapter {
  readonly providerId: string; readonly kind: ProviderKind;
  capabilities(): ProviderCapabilities;
  listModels(signal?: AbortSignal): Promise<ModelInfo[]>;
  streamChat(request: ChatCompletionRequest): AsyncIterable<StreamEvent>;
}
export interface AdapterDeps { transport: StreamTransport; http: HttpClient; now: () => number; apiKey?: string; }
export function createProviderAdapter(config: ProviderConfig, deps: AdapterDeps): ProviderAdapter;
// AMEND (2026-09-11, Orchestrator): `apiKey` viaja en AdapterDeps (resuelta desde KeyVault por el llamador).
// `ProviderConfig` sigue SIN contener secretos; el test de no-fuga lo verifica.
export class ProviderError extends Error { constructor(message: string, code: MessageErrorCode, options: { retryable: boolean; status?: number; retryAfterMs?: number }); }
```

| Aspecto | OpenAI-compatible | Anthropic |
|---|---|---|
| Endpoint | `POST {baseUrl}/chat/completions` | `POST {baseUrl}/v1/messages` |
| Auth | `Authorization: Bearer` | `x-api-key` + `anthropic-version: 2023-06-01` + `anthropic-dangerous-direct-browser-access: true` |
| System | mensaje rol system | campo top-level `system` |
| Tools | `{type:'function',function:{name,description,parameters}}` | `{name,description,input_schema}` |
| Tool call | `content:null` + `tool_calls[]` | `content:[{type:'tool_use',id,name,input}]` |
| Tool result | `{role:'tool',tool_call_id,content}` | `{role:'user',content:[{type:'tool_result',tool_use_id,content}]}` |
| SSE | `data: {json}` + `[DONE]`; `delta.content`, `delta.tool_calls[i].function.arguments` | eventos nombrados: message_start, content_block_start/delta (`text_delta`/`input_json_delta`), message_delta, message_stop, ping, error |
| max tokens | opcional | obligatorio (default 2048) |

Transporte Android: `resolveTransport()` intenta fetch+ReadableStream; si falla ANTES del primer byte en nativo, reintenta con CapacitorHttp sin stream → `{mode:'buffered'}` y el adapter emite `transport-fallback` + un único text-delta. Nunca reintentar después del primer delta.

## 7. Agent loop (`domain/agent/runAgent.ts`)

```ts
export interface RunAgentDeps { provider: ProviderAdapter; tools: ToolRegistry; clock: () => number; newId: () => string; }
export interface RunAgentParams {
  providerId: string; modelId: string; conversationId: string; systemPrompt: string;
  history: ChatMessage[]; userMessage: ChatMessage;
  defaults: { temperature: number; maxOutputTokens: number | null };
  budget: AgentBudget; historyBudget: HistoryBudget; researchMode: boolean; signal: AbortSignal;
  model?: ModelInfo;
}
// AMEND (2026-09-11, Orchestrator): `model?` aditivo. §7 exige el gate `model.supportsTools !== false`
// y contextWindow para el presupuesto; si se omite, se asume compatible.
export function runAgent(p: RunAgentParams, d: RunAgentDeps): AsyncGenerator<AgentEvent, void, void>;
```

Reglas: máx `maxSteps`; contexto reconstruido por paso con `selectHistoryByBudget` (system + último user siempre; se descartan turnos viejos completos; mensaje >40% → `truncateText` head+tail); tools SOLO si `researchMode && capabilities.toolCalling && model.supportsTools !== false`; ejecución de tools en serie con timeout; tool desconocida → resultado de error, no throw; JSON inválido → resultado de error al modelo; dedupe por `name+args` (repetición devuelve cacheado); 2 fallos consecutivos de tools → `run-end error`; presupuesto (steps/toolCalls/tokens/tiempo) verificado antes de cada paso con calibración real/estimado; agotado → `budget_exceeded` conservando parcial; abort en cualquier await cerrando reader; retries solo pre-primer-delta para 429/5xx/red/timeout con backoff+jitter y Retry-After, tope `maxRetriesPerStep`; `context_length` en paso 0 → un reintento con 50% de historial; `run-end` con `ChatMessage` final de bloques ordenados y `finishReason` correcto. `systemPrompt` incluye fecha ISO actual, idioma, instrucciones de investigación (citar `[n]`, no inventar URLs) y nota de presupuesto.

## 8. Tools web

- `web_search({query, count?, freshness?})` y `open_url({url})`, descripciones en inglés, JSON Schema formal.
- Cadena auto: Brave → Tavily → DDG HTML. Brave: header `X-Subscription-Token`, `freshness=pd|pw|pm|py`. Tavily: `topic/days`. DDG: HTML best-effort (parser tolerante). Resultado normalizado a `SourceRef[]` con dedupe por URL; `provider` informado; errores `no_provider`/`cors_blocked` accionables.
- `open_url`: solo http/https; bloquea userinfo, localhost, rangos privados (127/8, 10/8, 172.16/12, 192.168/16, 169.254/16, ::1, fe80::/10) revalidado por redirect (máx 5), timeout 15s, tope 2MB. `extractArticle` con DOMParser (fallback regex en tests): título + descripción + texto de article/main, whitespace normalizado, truncado.
- Proxy opcional (docs/search-proxy.md): `POST {baseUrl}/v1/search` `{provider,query,count,freshness}` con key en `X-Api-Key`; `POST {baseUrl}/v1/fetch` `{url}` → `{title,text,contentType,truncated}`. Sin logging de claves.

## 9. UI, stores e i18n

- `AppServices { conversations, settings, keys, http, transport, createAdapter(config) }` + `useServices()`.
- `chatStore` API CONGELADA: `load/send/stop/regenerate/editUserMessage/deleteMessage/retryLast` + estado `{conversationId, messages, runStatus: 'idle'|'running'|'stopping', liveSteps, lastError}`. Checkpoints throttled ≥1s (`streaming`), persistencia final con `finishReason`. Título de conversación = primeros 48 chars del primer user.
- `settingsStore`: settings/ready/load/patch/chatDefaults/agentBudget/addProvider/updateProvider/removeProvider/saveApiKey/refreshModels/setActiveProvider/setModelForProvider.
- `conversationsStore`: items/activeId/query/load/create/rename/remove/select/setQuery/visible().
- i18n: cada feature posee `src/i18n/dicts/<feature>.ts` con `defineDict`; `i18n/index.ts` descubre por `import.meta.glob('./dicts/*.ts')`; tipado por declaration merging; `useT()` con `useSyncExternalStore`; interpolación `{param}`; paridad es/en verificada en compile-time + test.
- Estética: lenguaje ChatGPT/Gemini (drawer de historial, header con selector de modelo, composer píldora, streaming con cursor, bloques de código con copiar). Tokens claro/oscuro con contraste AA. Sin marcas ajenas. Cero emojis; iconos lucide.

## 10. Tests

| Capa | Cobertura |
|---|---|
| domain puro | estimateTokens, selectHistoryByBudget (≥12 casos), buildWireMessages, truncateText, defaults/migrate, catálogo. ≥85% |
| domain/agent | runAgent con FakeProvider/tools: multi-paso, presupuestos, abort, timeout, JSON inválido, dedupe, retry 429, context_length. ≥85% |
| adapters/providers | fixtures SSE chunked; payloads exactos; buffered; errores; abort |
| adapters/storage | fake-indexeddb: CRUD, cascada, migración, recoverInterrupted, key no serializada |
| adapters/tools | fixtures por proveedor; urlPolicy ≥15 casos; extractArticle; fallback chain. Cero red |
| UI | reducers/selectores + 3–4 smoke RTL. Sin snapshots |
| Excluido | Capacitor real, Gradle, PWA install → checklist manual T16 |

## 11. Riesgos conocidos (no bloquean)

1. Streaming Android: fallback buffered con aviso.
2. Tools en navegador sin proxy: error `cors_blocked` accionable; Android directo.
3. Presupuesto de tokens heurístico: reserva 35%, calibración con usage, reintento único ante context_length.
4. IndexedDB puede ser desalojada: `navigator.storage.persist()` + recoverInterrupted.
5. Desktop nativo se decide al final (Tauri/Electron vs PWA).

## 12. AMEND (2026-09-12) — Estándar de proveedores y OpenCode

Cambios aprobados sobre los contratos congelados de §4/§6, documentados en
`docs/provider-standard.md` y con tests propios:

- `ProviderKind` se amplía: `'openai-compatible' | 'anthropic' | 'openai-responses' | 'opencode'`.
- Nuevo `ModelApi = 'chat-completions' | 'messages' | 'responses'` y `ModelInfo.api?`.
  Ruteo por modelo para proveedores heterogéneos; el override manual del usuario
  sobrevive al refresco del catálogo.
- Nuevos adapters: `openaiResponses.ts` (OpenAI Responses API) y `opencode.ts`
  (router de OpenCode Zen con `OpenCodeDelegates` inyectados). `createProviderAdapter`
  despacha también `openai-responses` y `opencode`.
- Plantilla `opencode-zen` (`https://opencode.ai/zen/v1`) y fuente de catálogo local
  `features/settings/state/opencodeServer.ts` (`opencode serve`, solo lectura de catálogo;
  no proxya el agente ni transfiere API keys).
- `vite.config.ts`: `testTimeout: 15_000` (la suite creció a 80 archivos / 772 tests).

