# Estándar de conexión de proveedores y modelos

Este documento define el **estándar de OpenHer Chat para conectar proveedores LLM** y, en
particular, para integrar la **API de OpenCode** sin que el usuario tenga que tipear modelos
uno por uno.

## 1. Conceptos

| Concepto | Dónde vive | Qué es |
|---|---|---|
| `ProviderKind` | `domain/types/provider.ts` | Familia de transporte: `openai-compatible`, `anthropic`, `openai-responses`, `opencode`. |
| `ModelApi` | `domain/types/provider.ts` | Transporte concreto de un modelo: `chat-completions`, `messages`, `responses`. |
| `ProviderConfig` | `domain/types/provider.ts` | Configuración persistida (base URL, key ref, modelos, quirks). Sin secretos. |
| `ModelInfo.api` | `domain/types/provider.ts` | Override opcional del transporte por modelo (proveedores heterogéneos). |
| `ProviderAdapter` | `domain/ports/ProviderAdapter.ts` | Contrato de chat: `capabilities()`, `listModels()`, `streamChat()`. |
| `createProviderAdapter` | `adapters/providers/index.ts` | Registro que despacha por `kind` a la implementación concreta. |
| Fuente de catálogo | `features/settings/state/*` | Descubre proveedores/modelos externos (p. ej. `opencode serve`). |

Regla de oro: **un proveedor debe exponer sus modelos por descubrimiento** (`listModels`)
siempre que la API lo permita. El alta manual de modelos es el último recurso.

## 2. Cómo se conecta un proveedor hoy

1. Ajustes → Proveedores → *Agregar proveedor* → elegir plantilla (o personalizado).
2. Pegar la API key (se guarda en el KeyVault local).
3. Al guardar, si hay key disponible, la app llama `refreshModels` → `adapter.listModels()`
   y **rellena los modelos automáticamente**. No se tipean IDs.
4. El usuario elige el modelo por defecto en el desplegable.

## 3. OpenCode Zen y Go (proveedor heterogéneo)

Ambos son gateways con **tres familias de endpoint**, pero en bases distintas:

| Gateway | Base URL | Plantilla |
|---|---|---|
| Zen (pago por uso) | `https://opencode.ai/zen/v1` | `opencode-zen` |
| Go ($10/mes, modelos open) | `https://opencode.ai/zen/go/v1` | `opencode-go` |

| Familia | Endpoint | Modelos típicos |
|---|---|---|
| Chat Completions | `POST {base}/chat/completions` | deepseek, glm, kimi, minimax (Zen), longcat, mimo, hy, free |
| Anthropic Messages | `POST {base}/messages` | claude, qwen, **minimax (Go)** |
| OpenAI Responses | `POST {base}/responses` | gpt, grok, muse-spark |

- **Catálogo:** `GET {base}/models` → `{ object: "list", data: [{ id, object, created, owned_by }] }`.
  No declara el endpoint; por eso el router **clasifica por prefijo de id**.
- **Router:** `createOpenCodeAdapter(config, deps, delegates)` recibe las factorías de los tres
  adapters hoja y delega cada `streamChat` según `model.api` o, si falta, según el clasificador
  (`classifyOpenCodeModelApi`). Construye cada adapter hoja una sola vez (memoizado).
- **Variante:** `openCodeVariantFromBaseUrl(baseUrl)` deriva `'zen'` o `'go'` de la base URL. La
  variante solo cambia el ruteo de **MiniMax** (Go → `messages`).
- **UI:** en la sección de modelos del proveedor, cada modelo permite forzar su **Ruta**
  (`Automática` / `Chat completions` / `Messages` / `Responses`).
- **CORS:** el gateway no emite `Access-Control-Allow-Origin` ni responde preflight
  (`OPTIONS` → 404). En el navegador solo funciona por proxy: en `vite dev` el adapter reescribe
  `https://opencode.ai` a la ruta relativa `/zen` (`resolveOpenCodeBaseUrl`, solo con
  `MODE=development`) y `vite.config.ts` proxya `/zen` → `https://opencode.ai`. Android nativo no
  necesita proxy (`CapacitorHttp` esquiva CORS); en build web sin proxy el proveedor no funciona.

Clasificación por prefijo (congelada en `classifyOpenCodeModelApi`):

```
claude*, qwen*                        -> messages
minimax*  (solo variante Go)          -> messages
gpt*, grok*, muse-spark*              -> responses
resto (gemini, glm, kimi, deepseek…)  -> chat-completions
```

> **Go exige `x-opencode-session`.** El adapter envía una sesión estable por conversación
> (`sessionId` = id de la conversación, propagado por `runAgent`) en las requests de chat:
> `buildOpenCodeHeaders` la mapea a la cabecera y los adapters hoja aplican `request.extraHeaders`.
> Sin ella la API responde con un error de enrutado. Además se identifica con
> `x-opencode-client: openher-chat`. El `User-Agent` propio que recomienda la doc no se puede fijar
> desde el navegador (cabecera prohibida); en Android nativo (`CapacitorHttp`) sí aplica.
> La instrumentación de caché derivada de la sesión se detalla en la sección 5.

## 4. OpenAI Responses API (adapter nuevo)

`createOpenAIResponsesAdapter(config, deps)` implementa el shape de `/responses`:

- Payload: `{ model, input, instructions?, tools?, tool_choice?, temperature?, max_output_tokens?, stream: true }`.
- `system` → `instructions`; `assistant.toolCalls` → items `function_call`; `tool` → `function_call_output`.
- SSE: `response.output_text.delta` (texto), `response.reasoning_summary_text.delta` /
  `response.reasoning_text.delta` (razonamiento), `response.function_call_arguments.delta` +
  `response.output_item.done` (tool-call), `response.completed` (usage + stop), `response.failed`/`error`.
- Tolerante: acepta el tipo de evento en `event:` o en `payload.type`.

## 5. Caché de prompt y contexto

El prefijo cacheable es **system + tools + historial**, así que debe ser byte-estable entre turnos.
Reglas aplicadas (patrón de `applyCaching` de OpenCode y del paquete `pi-opencode-go-cache`):

- **Fecha sin hora.** `buildSystemPrompt` escribe `Current date (UTC): YYYY-MM-DD`, no un timestamp
  con segundos: un valor por-turno invalidaría la caché de todo el prefijo.
- **El runner pide caché.** `runAgent` envía `sessionId` (id de conversación) y
  `cache: { cacheControl: true }` en cada request; cada adapter decide cómo materializarlo.
- **Anthropic (`/messages`).** `cache_control: { type: "ephemeral" }` en el bloque `system` (cubre
  tools+system, que van antes en el prefijo) y en los **2 últimos mensajes**: es una escalera móvil,
  la escritura de un turno es la lectura del siguiente. Máximo 3-4 breakpoints.
- **OpenAI-compatible (`/chat/completions`).** Si el provider declara `quirks.promptCache`, añade
  `prompt_cache_key` (= `sessionId`). Si además declara `quirks.cacheControl` (lo inyecta el router de
  OpenCode), envuelve system + últimos 2 mensajes con marcadores. La plantilla `openai` trae
  `promptCache: true`.
- **OpenAI Responses (`/responses`).** `prompt_cache_key` (= `sessionId`).
- **OpenCode Zen/Go.** `x-opencode-session` (routing + caché) y `x-opencode-client`; en Go se añade
  `prompt_cache_retention: "24h"`. Los modelos **GLM/Zhipu** omiten los marcadores
  (`isOpenCodeCacheUnsupported`) porque el gateway no los filtra hacia su upstream y los rechaza.
- **Observabilidad.** `TokenUsage` añade `cachedPromptTokens` y `cacheWritePromptTokens`. En Anthropic
  `input_tokens` **excluye** lo cacheado, así que `promptTokens = input + cache_read + cache_creation`
  (mantiene correcta la calibración del presupuesto); en OpenAI/Responses lo cacheado ya va dentro de
  `prompt_tokens`/`input_tokens`.

## 6. Fuente de catálogo: `opencode serve` local

`fetchOpenCodeServerCatalog(baseUrl, http)` en `features/settings/state/opencodeServer.ts`:

- `GET /global/health` → `{ healthy, version }`.
- `GET /config/providers` → `{ providers: Provider[], default }` (acepta también `{ all }` o array).
- Normaliza cada proveedor a `{ id, label, baseUrl, kind, requiresKey, models }`, reutilizando las
  plantillas del catálogo cuando el `id` coincide (alias `opencode` → plantilla Zen) y aplicando el
  ruteo por modelo a los proveedores `opencode`.
- La UI (Ajustes → *Importar de OpenCode*) muestra los proveedores encontrados y los importa con
  `settingsStore.importProviders(...)` (dedupe por `kind + baseUrl`).

**Alcance y límites** (importante):

- Es una **fuente de catálogo, no un transporte de chat**. `opencode serve` expone un agente con
  sesiones (`/session/:id/message`), no completions planas; no se proxya.
- **Las API keys no se transfieren**: viven en el harness local. Tras importar, cada proveedor que
  las requiera debe recibir su key en OpenHer Chat.
- El esquema exacto de `/config/providers` depende de la versión del servidor; el parser es
  tolerante a variantes y, si no puede normalizar un proveedor (sin base URL ni plantilla), lo omite.

## 7. Cómo añadir un proveedor nuevo

**Caso A — OpenAI-compatible, Anthropic o Responses:** agrega una `ProviderTemplate` en
`domain/providers/catalog.ts` con `kind` y `baseUrl`. No hace falta tocar adapters.

**Caso B — protocolo nuevo:** crea `adapters/providers/<kind>.ts` que implemente `ProviderAdapter`,
añade el `ProviderKind`, regístralo en `createProviderAdapter` (`adapters/providers/index.ts`) y en
`PROVIDER_KINDS` (`features/settings/state/validation.ts`), y agrega las etiquetas i18n
(`providerKind*`). Añade `<kind>Responses`/etc. a `defaultCapabilities` si difiere del default.

**Caso C — proveedor heterogéneo (varios endpoints):** usa `kind: 'opencode'` como plantilla y
reutiliza el patrón de router con `OpenCodeDelegates`, o asigna `ModelInfo.api` por modelo y deja
que `createProviderAdapter` elija el adapter hoja.

## 8. Invariantes

- La API key **nunca** se serializa en `ProviderConfig` (`toStoredProvider` proyecta solo campos
  públicos; refs en `provider:<id>`).
- Todos los adapters: `listModels` con timeout (10 s), `streamChat` con abort y fallback buffered
  cuando el transporte nativo no soporta streaming.
- Los errores de tools/adapter se normalizan a `MessageError`/`ToolResult`; nunca escapan al loop.
- Sin dependencias nuevas: el estándar se apoya en `HttpClient`/`StreamTransport` existentes.

## 9. Verificación

```sh
pnpm exec tsc -b
pnpm test
pnpm build
```

Tests relevantes: `adapters/providers/{opencode,modelList,openaiResponses}.test.ts`,
`features/settings/state/opencodeServer.test.ts`,
`features/settings/state/{providerStorage,providerModels,settingsStore}.test.ts`.
