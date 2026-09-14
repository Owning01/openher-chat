# teamwork_providers_plan.md — Plan de hitos y DAG

Proyecto: estándar de conexión de proveedores (OpenCode) · Modo: development · Ruta: standard.

## Contratos congelados (no cambiar sin re-despacho)

```ts
// domain/types/provider.ts  (YA APLICADO en M0)
export type ProviderKind = 'openai-compatible' | 'anthropic' | 'openai-responses' | 'opencode';
export type ModelApi = 'chat-completions' | 'messages' | 'responses';
export interface ModelInfo { /* ... */ api?: ModelApi; }

// adapters/providers/modelList.ts (nuevo)
export function parseOpenAIModelList(text: string): ModelInfo[];

// adapters/providers/openaiResponses.ts (nuevo)
export function createOpenAIResponsesAdapter(config: ProviderConfig, deps: AdapterDeps): ProviderAdapter;

// adapters/providers/opencode.ts (nuevo)
export type AdapterFactory = (config: ProviderConfig, deps: AdapterDeps) => ProviderAdapter;
export interface OpenCodeDelegates {
  'chat-completions': AdapterFactory;
  messages: AdapterFactory;
  responses: AdapterFactory;
}
export function createOpenCodeAdapter(config: ProviderConfig, deps: AdapterDeps, delegates: OpenCodeDelegates): ProviderAdapter;
export function classifyOpenCodeModelApi(modelId: string): ModelApi;
```

## DAG de tareas

| ID | Título | Depende de | Wave | Propietario | Archivos exclusivos |
|---|---|---|---|---|---|
| M0 | Tipos, catálogo Zen, kinds, persistencia de `api` | — | 0 | Orchestrator | `types/provider.ts`, `providers/catalog.ts`, `settings/state/validation.ts`, `settings/state/providerStorage.ts`, `settings/state/providerModels.ts` |
| W1 | Adapter OpenAI Responses + fixtures + tests | M0 | 1 | Worker-Responses | `adapters/providers/openaiResponses.ts`, `__fixtures__/openaiResponses.ts`, `openaiResponses.test.ts` |
| W2 | Router OpenCode Zen + clasificador + `modelList` + tests | M0 | 1 | Worker-Zen | `adapters/providers/opencode.ts`, `modelList.ts`, `opencode.test.ts`, `modelList.test.ts`, `__fixtures__/opencode.ts` |
| M1 | Integración registry + UX + i18n + auto-descubrimiento | W1,W2 | 2 | Orchestrator | `adapters/providers/index.ts` (+test), `features/settings/**`, `features/onboarding/**`, `i18n/dicts/{settings,onboarding}.ts` |
| W3 | Importador catálogo `opencode serve` local + tests | M1 | 3 | Worker-Server | `features/settings/state/opencodeServer.ts` (+test) |
| M2 | UI de importación local + wiring | W3 | 3 | Orchestrator | `features/settings/components/ImportOpenCodeServer.tsx`, `ProviderList.tsx` |
| M3 | Docs estándar + README/architecture | M1,W3 | 4 | Orchestrator | `docs/provider-standard.md`, `README.md`, `architecture.md` |
| G1 | Gate Critic + Challenger | M1,W3 | 4 | Critic/Challenger (solo lectura) | — |
| G2 | Auditoría empírica (tsc/test/build) | M1,W3 | 4 | Auditor | — |
| G3 | Aceptación final | G1,G2 | 4 | Evaluator | — |

## Reglas de aislamiento

- Un Worker = un dueño por archivo. Nadie edita archivos fuera de su columna.
- Los Workers de Wave 1 NO ejecutan `tsc -b` ni `pnpm test` completo (el otro Worker puede estar a medio
  escribir). Solo `pnpm exec vitest run <sus tests>`.
- El Orchestrator integra y ejecuta la verificación completa.
- Scratch por agente en `scratch/agent-<id>/` (gitignored).

## Clasificación OpenCode Zen (congelada)

| Prefijo de id | api | Endpoint |
|---|---|---|
| `claude`, `qwen` | `messages` | `POST {base}/messages` |
| `gpt`, `grok`, `muse-spark` | `responses` | `POST {base}/responses` |
| resto (deepseek, glm, kimi, minimax, free…) | `chat-completions` | `POST {base}/chat/completions` |

`base` = `https://opencode.ai/zen/v1`.
