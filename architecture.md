# Architecture — OpenHer Chat

> Documento de orientación para IAs y desarrolladores. Objetivo: entender el proyecto
> completo en pocos minutos y saber exactamente **dónde tocar** para cada cambio.
> Fuente de verdad técnica: `.agents/teamwork_architect_spec.md` (diseño congelado),
> `AGENTS.md` (reglas) y este archivo (mapa operativo). Si hay conflicto, manda la spec.

---

## 0. TL;DR (30 segundos)

- **Qué es:** cliente de chat personal single-user (Android + desktop/PWA) que habla con
  cualquier LLM que el usuario configure por API key (OpenAI-compatible: Groq, Cerebras,
  OpenAI, DeepSeek, Ollama, LM Studio, vLLM; o Anthropic). Incluye agente con tool calling
  y modo investigación (búsqueda web + lectura de páginas).
- **Sin backend propio.** Todo corre local: conversaciones en IndexedDB, preferencias y
  API keys en localStorage. Solo se sale a Internet hacia el proveedor LLM y las tools web.
- **Stack fijo:** Vite 8 + React 19 + TypeScript 7 estricto + Tailwind CSS 4 + Zustand 5 +
  Capacitor 8 (Android) + `@capacitor-community/speech-recognition` (dictado por voz).
  Tests: Vitest 4 + Testing Library + `fake-indexeddb`. pnpm.
- **Arquitectura:** puertos y adaptadores (hexagonal) + features por dominio.
  `domain/` = contratos y lógica pura; `adapters/` = implementaciones; `features/` = UI+stores;
  `app/` = composición, DI y routing.
- **Estado:** proyecto completado y ampliado con el estándar de proveedores/OpenCode Zen+Go, caché de prompt, dictado por voz,
  features de harness portadas de OpenCode (export/import, buscador de mensajes, continuar generación,
  auto-título, coste/uso, compactación de contexto, comandos `/`, atajos y aprobación de tools) y modo
  legal (Argentina, civil y comercial, ver §12-quater):
  120 archivos de test, 1358 tests (verificado en G2/G3 tras el modo legal + Firebase Auth: T26 no ejecuta
  la suite completa por workers en paralelo), `tsc -b` limpio, build OK, `cap sync` OK. Rama `main`.

Números rápidos:

| Métrica | Valor |
|---|---|
| Archivos de test | 120 (verificado en G2/G3) |
| Tests | 1358 (verificado en G2/G3) |
| Stores Zustand | 3 (chat, conversations, settings) + reducer de onboarding |
| Validador de tipos | `pnpm exec tsc -b` (el `tsc --noEmit` de raíz es vacuo, ver §2) |
| Alias de imports | `@/` → `src/` |

---

## 1. Cómo verificar (antes de dar algo por terminado)

```sh
pnpm install --frozen-lockfile   # sin cambios de lock
pnpm exec tsc -b                 # type-check OFICIAL del workspace (src + configs)
pnpm test                        # Vitest run (120 archivos / 1358 tests; verificado en G2/G3)
pnpm build                       # tsc -b + vite build -> dist/
```

Comandos de desarrollo:

| Comando | Qué hace |
|---|---|
| `pnpm dev` | Vite dev server con HMR |
| `pnpm test:watch` | Vitest en watch |
| `pnpm preview` | Sirve `dist/` (PWA) |
| `pnpm android:sync` | `cap sync android` (copia `dist/` al nativo) |
| `pnpm android:open` | Abre Android Studio (requiere JDK 21) |

**Trampa:** `pnpm exec tsc --noEmit` en la raíz no comprueba `src/` (el `tsconfig.json` de raíz
solo declara `references`). El type-check real siempre es `pnpm exec tsc -b`.

---

## 2. Reglas no negociables (ground rules)

1. **File scoping:** cada cambio limitado a los archivos de su tarea. No refactors oportunistas.
2. **Cero dependencias nuevas** sin aprobación explícita. Lista aprobada: React 19, Zustand, idb,
   react-markdown, remark-gfm, highlight.js, lucide-react, Capacitor core/android/cli, Tailwind 4,
   `@capacitor-community/speech-recognition`.
   Prohibido: router externo, axios, zod, SDKs de proveedores, tokenizers, plugins PWA.
3. **TypeScript estricto:** `strict`, `noUncheckedIndexedAccess`, `noUnusedLocals`,
   `noUnusedParameters`, `verbatimModuleSyntax`, `erasableSyntaxOnly`. Evitar `any` (justificar).
4. **Cero debug debris:** nada de `console.log`, código comentado, archivos huérfanos ni TODOs sueltos.
5. **TDD ligero:** lógica de dominio (agente, providers, presupuesto de tokens, persistencia,
   stores) lleva tests unitarios.
6. **Texto para el modelo en inglés** (descripciones de tools, system prompt). **UI 100% i18n** (es/en).
7. **Secretos** solo en el KeyVault local; nunca en logs, código, tests, fixtures ni repositorio.
   Sin telemetría.
8. **Sin marcas ajenas:** estética inspirada (no copiada) en ChatGPT/Gemini. Cero emojis; iconos lucide.

---

## 3. Arquitectura por capas

```
                         +-------------------------------------------+
   Composicion / DI ---> |  app/  (App, bootstrap, services, routing) |
                         +-------------------------------------------+
                                        |
                 +----------------------+----------------------+
                 v                                             v
        +------------------+                          +------------------+
        |    features/     |  UI + Zustand stores     |    adapters/     |
        | chat, settings,  |  (dependen de domain y   | http, providers, |
        | conversations,   |   app/services)          | storage, tools   |
        | research, onboard|                          +------------------+
        +------------------+                                   |
                 |                                             | implementa
                 v                                             v
        +------------------------------------------------------------------+
        |  domain/  types + ports (contratos) + logica pura (sin IO)       |
        |  agent, chat, providers, settings  <--  NO importa adapters/UI  |
        +------------------------------------------------------------------+
```

**Regla de dependencia:**

- `domain/` no importa de `adapters/`, `features/` ni `app/`. Es puro y testeable sin DOM/red.
- `adapters/` implementa los **puertos** de `domain/ports` y puede importar de `domain/`.
- `features/` orquesta domain + adapters vía `AppServices` (inyectado). Puede importar de ambos.
- `app/` es el único lugar que construye las implementaciones concretas (`createServices`).
- Excepciones pragmáticas existentes: `features/chat/state/chatStore.ts` importa
  `createToolRegistry` (adapters/tools) y `LocalProviderConfigRepository` (features/settings) como
  **defaults** de producción; ambos son inyectables por tests (`deps.tools`, `deps.providers`).

**Por qué importa:** casi toda la lógica de negocio crítica vive en `domain/` y se prueba con
fakes en memoria, sin red y sin navegador. Para cambios funcionales, empieza siempre por `domain/`.

---

## 4. Mapa de archivos (anotado)

### Raíz
| Archivo | Propósito |
|---|---|
| `package.json` | Scripts y dependencias (pnpm). Solo T01 las toca. |
| `vite.config.ts` | React + Tailwind 4, alias `@`, config de Vitest (jsdom, setup, `src/**/*.test.*`). |
| `tsconfig.json` / `.app.json` / `.node.json` | Proyecto app estricto + configs; `tsc -b` compone. |
| `capacitor.config.ts` | `appId app.openher.chat`, `webDir dist`, `androidScheme https`. |
| `index.html` | Shell HTML, manifest, theme-color, `#root`. |
| `public/` | `manifest.webmanifest`, `sw.js` (PWA), `icons/icon.svg`. |
| `android/` | Proyecto Capacitor (Gradle). Iconos default del template (limitación conocida). |
| `docs/` | `dev-setup.md`, `search-proxy.md`, `e2e-smoke.md`, `legal-packs.md` (curación, licencia y hash del corpus legal). |
| `AGENTS.md` | Reglas del repo. |
| `.agents/teamwork_architect_spec.md` | **Spec congelada**. Contratos, reglas del agente, etc. |
| `architecture.md` | Este documento. |

### `src/domain/` — contratos y lógica pura (la joya)

| Archivo | Qué contiene |
|---|---|
| `types/chat.ts` | `ChatMessage`, `MessageContent` (`text`/`reasoning`/`tool-call`/`tool-result`), `ToolCall`, `ToolResult`, `SourceRef`, `TokenUsage`, `MessageError(Code)`, `MessageStatus`, `MessageFinishReason`, `ToolErrorCode`. |
| `types/conversation.ts` | `Conversation` (metadatos de lista + `researchMode`, `systemPromptOverride`). |
| `types/provider.ts` | `ProviderKind` (`openai-compatible`/`anthropic`), `ProviderConfig`, `ModelInfo`, `ProviderQuirks`, `ProviderCapabilities`. |
| `types/settings.ts` | `AppSettings` y secciones: `ChatDefaults`, `HistoryBudget`, `ToolSettings`, `SearchSettings`, `ProxySettings`, `UiSettings` (reutiliza `AgentBudget` de `types/agent.ts`). |
| `types/stream.ts` | `WireMessage` (forma canónica para cualquier adapter), `StreamEvent`, `StopReason`. |
| `types/tools.ts` | `JsonSchema`, `ToolDefinition`, `ToolExecutionContext`, `ToolRegistry`. |
| `types/agent.ts` | `AgentBudget`, `AgentStep`, `AgentEvent`, `AgentRunStatus`. |
| `ports/*.ts` | Interfaces: `ConversationRepository`, `SettingsRepository`, `KeyVault`, `HttpClient` (+`HttpError`, `RedirectMode`, `StreamTransport`, `StreamResult`), `ProviderAdapter` (+`ChatCompletionRequest`, `AdapterDeps`), `SearchProvider`. |
| `chat/estimateTokens.ts` | Heurística de tokens: `max(1, ceil(bytes UTF-8 / 4))` + overhead por mensaje/bloque/tools. |
| `chat/buildWireMessages.ts` | Convierte `ChatMessage[]` → `WireMessage[]`. Omite `reasoning` a propósito. |
| `chat/selectHistoryByBudget.ts` | Selección de historial por turnos que cabe en el presupuesto; recorte head+tail de mensajes gigantes. |
| `chat/truncateText.ts` | Recorte por code points con marcador en inglés (head+tail). |
| `chat/messageFactory.ts` | Creadores puros: `createUserMessage`, `createAssistantMessage`, `finalizeMessage`. |
| `chat/serializeConversation.ts` | Export/import portable: `conversationToMarkdown`/`conversationToJson` y `parseConversationArchive` tolerante. |
| `chat/messageSearch.ts` | Búsqueda full-text pura sobre el contenido de los mensajes + snippet. |
| `agent/runAgent.ts` | **Corazón del agente** (loop async generator). Ver §5.3. |
| `agent/budget.ts` | Estado de presupuesto, calibración de tokens, backoff con jitter, `withTimeout`, `sleepAbortable`. |
| `agent/systemPrompt.ts` | System prompt base (fecha UTC sin hora para no romper la caché, idioma, instrucciones de investigación, nota de presupuesto). |
| `agent/parseToolArguments.ts` | Parseo robusto de argumentos JSON del modelo. |
| `providers/catalog.ts` | Plantillas de proveedor (Groq, Cerebras, OpenAI, DeepSeek, Ollama, LM Studio, vLLM, Anthropic). |
| `providers/capabilities.ts` | `defaultCapabilities(kind)` y `resolveCapabilities(config, model)`. |
| `settings/defaults.ts` | Defaults de settings y presupuestos (versión de esquema = 1). |
| `settings/migrate.ts` | `migrateSettings` nunca lanza: sanea y completa cualquier JSON corrupto. |

### `src/adapters/` — implementaciones

| Archivo | Qué hace |
|---|---|
| `http/FetchHttpClient.ts` | `HttpClient` sobre `fetch`, timeout manual + signal, `supportsRedirectControl = true`. Expone helpers `serializeRequestBody`, `buildRequestHeaders`, `createHttpError`. |
| `http/CapacitorHttpClient.ts` | `HttpClient`: nativo usa `CapacitorHttp` (buffered, **sin** control de redirects); web delega en `FetchHttpClient`. |
| `http/fetchStream.ts` | `postStream`: POST SSE con `fetch`; devuelve `{mode:'sse'}` o `{mode:'buffered'}`. |
| `http/resolveTransport.ts` | `createStreamTransport`: intenta streaming; en nativo, si falla **antes del primer byte**, reintenta buffered con CapacitorHttp. |
| `providers/sse.ts` | Parser SSE tolerante a chunks partidos, CRLF, comentarios, `data:` multilínea, BOM. |
| `providers/errors.ts` | `ProviderError` y `mapHttpStatus` (401/403→auth, 429→rate_limit+Retry-After, 400 context_length, 5xx→server…). |
| `providers/openaiCompatible.ts` | Payload `/chat/completions`, headers, `listModels`, SSE con tool-calls acumulados por `index`, fallback buffered. |
| `providers/anthropic.ts` | Payload `/v1/messages` (system top-level, `max_tokens` obligatorio, `input_schema`, tool_result en user), SSE con eventos nombrados, fallback de modelos. |
| `providers/openaiResponses.ts` | Payload `/responses` (`instructions`/`input`, `function_call`/`function_call_output`), SSE `response.*` con tool-calls acumuladas, usage, errores y fallback buffered. |
| `providers/opencode.ts` | Router de OpenCode Zen/Go: `classifyOpenCodeModelApi` (prefijo→`ModelApi`, con variante Go para MiniMax), `resolveOpenCodeBaseUrl` (proxy de dev Vite para el CORS del gateway) y `createOpenCodeAdapter` que delega cada modelo a `chat-completions`/`messages`/`responses`. Instrumenta la caché de prompt (`x-opencode-session`, `x-opencode-client`, `prompt_cache_key` + retención 24h en Go) y omite los marcadores `cache_control` en GLM. |
| `providers/modelList.ts` | `parseOpenAIModelList`: catálogo tolerante (`{data}`/`{models}`) compartido por Zen y Responses. |
| `providers/index.ts` | `createProviderAdapter(config, deps)` dispatch por `kind` (registra los delegates de Zen). |
| `storage/idb.ts` | `getDb()` singleton de IndexedDB `openher-chat` v1; stores `conversations` + `messages`; `navigator.storage.persist()` best-effort. |
| `storage/IndexedDbConversations.ts` | `ConversationRepository` real (CRUD, cascada, orden, `deleteMessagesFrom`, `recoverInterrupted`). |
| `storage/conversationContract.ts` | Suite de contrato **compartida** entre el repo real y el fake en memoria (paridad garantizada). |
| `storage/LocalSettingsRepository.ts` | Settings en localStorage `openher.settings.v1` + `migrateSettings`. |
| `storage/LocalKeyVault.ts` | Secretos en localStorage `openher.key.<ref>` (refs: `provider:<id>`, `search:brave`, `search:tavily`). |
| `tools/index.ts` | `createToolRegistry(settings, deps)`: define `web_search` y `open_url` con JSON Schema, timeout y cap de resultado. |
| `tools/urlPolicy.ts` | Guarda SSRF: solo http/https, sin credenciales, bloquea localhost/privadas/loopback/link-local IPv4+IPv6 (incl. NAT64). |
| `tools/proxy.ts` | Cliente del proxy opcional (`/v1/search`, `/v1/fetch`) y `resolveProxyBaseUrl` sin bypass silencioso. |
| `tools/errors.ts` | `ToolExecutionError` + `mapTransportError` (mensajes accionables `cors_blocked`, `timeout`…). |
| `tools/platform.ts` | `isNativePlatform()` / `isBrowserEnvironment()` sin importar Capacitor. |
| `tools/html.ts`, `values.ts` | Utilidades de parseo HTML y coercion segura de `unknown`. |
| `tools/webSearch/{index,brave,tavily,exa,duckduckgo,shared}.ts` | Cadena Brave → Tavily → Exa (MCP keyless con CORS) → DuckDuckGo HTML con fallback, dedupe y `provider` informado. |
| `tools/openUrl/{index,extractArticle}.ts` | Descarga + política de URL + extracción de artículo (DOMParser, fallback regex), cap 2 MB; en navegador sin proxy cae a un lector público con CORS (`r.jina.ai`). |

### `src/features/` — UI + stores por dominio

| Ruta | Contenido |
|---|---|
| `chat/ChatPage.tsx` | Página de chat: crea el `chatStore`, une router + markdown + composer + panel de investigación. |
| `chat/state/chatStore.ts` | Store Zustand congelado (API §7). Orquesta un turno completo. |
| `chat/state/ChatStoreContext.tsx` | Contexto/hook `ChatStoreProvider` / `useChatStore`. |
| `chat/hooks/useChatController.ts` | Wiring del store para la UI (usa contexto o store fallback por `AppServices`). |
| `chat/hooks/useAutoScroll.ts` | Auto-scroll al fondo respetando la posición del usuario. |
| `chat/hooks/useSpeechRecognition.ts` | Dictado por voz: nativo (`@capacitor-community/speech-recognition`, Android) y web/Windows (Web Speech API). |
| `chat/hooks/dictationBuffer.ts` | Acumulación pura del dictado; **nunca** borra el texto escrito. |
| `chat/hooks/useProviderCatalog.ts` | Catálogo de proveedores (localStorage) para el selector de modelo del chat. |
| `chat/components/` | `Composer` (enviar, Detener y dictado por voz), `ModelPicker` (modelo agrupado por proveedor y ordenado por nombre), `MessageList`, `MessageActions` (regenerar/editar/borrar/continuar), `ToolCallCard`, `ReasoningBlock`, `StreamingIndicator`, `ErrorBanner`, `EmptyChat`. |
| `conversations/ConversationsPanel.tsx` | Lista lateral + búsqueda por título y **por mensaje** + crear/renombrar/borrar/exportar/importar. |
| `conversations/state/conversationsStore.ts` | Store de lista (API §7), orden/filtro y `merge` sin recargar. |
| `conversations/components/` | `ConversationItem`, `ConversationSearch`, `DeleteConversationDialog`, `RenameConversationDialog`. |
| `conversations/hooks/useCreateConversation.ts` | Crear conversación desde la UI. |
| `settings/SettingsPage.tsx` | Página de ajustes (secciones). |
| `settings/components/` | `ProviderList`, `ProviderForm`, `ModelsSection` (ruta por modelo), `ImportOpenCodeServer`, `ApiKeyField`, `ChatSection`, `AgentBudgetSection`, `HistoryBudgetSection`, `SearchSection`, `ProxySection`, `AppearanceSection`, `SectionCard`, `NumberField`, `providerKindLabel`. |
| `settings/state/settingsStore.ts` | Store de settings/proveedores/keys (API §7). Incluye `importProviders` (importación con dedupe y rollback) y `refreshModels`. |
| `settings/state/providerStorage.ts` | Persistencia local de `ProviderConfig[]` (`openher.providers.v1`) con saneo (incluye `ModelInfo.api`) y proyección explícita (sin secretos). |
| `settings/state/providerModels.ts` | `mergeApiModels` (preserva `api` y overrides), `normalizeDefaultModelId`. |
| `settings/state/opencodeServer.ts` | Fuente de catálogo `opencode serve`: `probeOpenCodeServer`, `fetchOpenCodeServerCatalog`, `mapProviders` (parser tolerante). |
| `settings/state/proxyProbe.ts` | Prueba de conectividad del proxy. |
| `settings/state/validation.ts` | Validación de kind/URL de proveedor (`PROVIDER_KINDS` incluye `openai-responses` y `opencode`). |
| `onboarding/` | Wizard de 3 pasos (`OnboardingPage`, `session.ts`, `state/wizardReducer.ts`, componentes `ProviderStep`/`ModelStep`/`KeyStep`/`StepIndicator`). |
| `research/` | Modo investigación: `ResearchPanel`, `StepsTimeline`, `SourcesList`, `SourceChip`, `BudgetMeter`, `ResearchToggle`, `selectors.ts` (reducer puro de steps + fuentes + warnings), `messages.ts`, `useResearchSettings.ts`. |

### `src/app/` — composición

| Archivo | Qué hace |
|---|---|
| `App.tsx` | Arranque: estados `loading`/`error`/`ready`, providers de stores, avisos (storage/no-provider), redirección a onboarding, `RouteSync` (hash → `activeId`). |
| `bootstrap.ts` | `bootstrapApp`: crea servicios, carga settings, aplica tema/idioma, `recoverInterrupted` (un fallo de IndexedDB no tumba el arranque). |
| `services.tsx` | `AppServices`, `createServices(overrides)` (seam de tests), `ServicesProvider`, `useServices`. |
| `routing.tsx` | Hash routing propio: `parseRoute`, `chatHref`, `navigate`, `useRoute`, `AppRoutes` (settings/onboarding en lazy chunks). |
| `layout/AppShell.tsx` | Shell responsive (sidebar desktop / drawer móvil) + `ToastViewport`. |
| `layout/{Sidebar,TopBar,MobileDrawer,AlertBanner}.tsx` | Navegación, cabecera con tema, drawer accesible (focus trap), banners. |

### `src/shared/` y `src/i18n/`

| Ruta | Contenido |
|---|---|
| `shared/ui/` | UI kit accesible: `Button`, `IconButton`, `Input`, `TextArea`, `Select`, `Switch`, `Dialog`, `Toast`, `Spinner`, `Skeleton`, `Badge`, `Tooltip`, `EmptyState`. |
| `shared/markdown/` | `Markdown` (react-markdown + GFM), `CodeBlock` (highlight.js), `CopyButton`, `highlight.css`. Sin HTML crudo del modelo. |
| `shared/hooks/` | `theme`/`useTheme` (`applyTheme`, modo system), `useDebouncedValue`, `useEscapeKey`, `useMediaQuery`. |
| `shared/utils/download.ts` | `downloadTextFile` + `safeFilename` para exportar conversaciones. |
| `shared/icons/index.ts` | Reexporta iconos de `lucide-react`. |
| `shared/utils/` | `cn`, `ids` (`newId`), `Result`, `json`. |
| `i18n/index.ts` | Registro de diccionarios vía `import.meta.glob('./dicts/*.ts')`; `t()` con interpolación `{param}`, `setLocale`, `subscribe`. |
| `i18n/types.ts` | `I18nSchema` (declaration merging) y tipado de claves `<namespace>.<key>`. |
| `i18n/useT.ts` | `useT()` / `useLocale()` con `useSyncExternalStore`. |
| `i18n/dicts/<feature>.ts` | Un diccionario por feature con `defineDict({es, en})` (paridad es/en en compile-time) + `declare module '../types'`. |
| `styles/index.css` | Tailwind 4 `@theme` con tokens claro/oscuro (clase `.dark`), radios y mono. |
| `test/setup.ts` | `jest-dom` + `fake-indexeddb/auto`. |
| `test/fakes/MemoryRepos.ts` | Dobles en memoria para tests de dominio/stores. |
| `main.tsx` | Monta `<App/>` en `#root`; registra el service worker solo en web de producción. |

### Modo legal — mapa de archivos (ver §12-quater)

| Ruta | Contenido |
|---|---|
| `src/domain/legal/` | Lógica pura: `hash.ts` (SHA-256 JS puro + normalización), `packs.ts` (parseo/validación/canon/índice), `retrieval.ts` (BM25), `citation.ts` (guard existencia+fidelidad), `deadlines.ts` + `rules/` (plazos versionados), `redaction.ts` (pseudonimización), `templates/` + `document.ts` (plantillas, watermark/disclaimer), `prompt.ts` + `brief.ts` (scaffold byte-estable + brief anti-injection), `adversarial.ts` (4 personas + síntesis). |
| `src/domain/types/legal.ts` + `src/domain/ports/LegalCaseRepository.ts` + `src/domain/ports/LegalPackStore.ts` | Tipos del dominio legal y puertos de expediente y packs. `Conversation.legalCaseId?` (en `domain/types/conversation.ts`) es el vínculo único caso↔conversación. |
| `src/domain/tools/composeRegistry.ts` + `src/adapters/tools/legal/index.ts` | Composición de registries y tools `legal_search` / `cite_article`. |
| `src/adapters/legal/` | `packLoader.ts` (descarga + cache-buster + `?v=hash`), `packVerifier.ts` (verificación obligatoria), `LegalCorpus.ts` (índice async idempotente, cacheado por pack+versión). |
| `src/adapters/storage/` | `idb.ts` (DB v2 + stores legales), `IndexedDbLegalCases.ts`, `IndexedDbLegalPacks.ts` (fuente única de packs instalados), `legalContract.ts` (contrato real+fake). |
| `src/features/legal/` | `LegalPage.tsx` (ruta `#/legal`) + `components/` (`CaseForm`, `CaseList`, `AdversarialPanel`, `AnalysisView`, `DocumentStudio`) + `state/` (`caseStore`, `analysisStore`, `CitationGuardContext` con hook `useCitationGuard`). |
| `src/features/chat/components/ModesMenu.tsx` + `CaseLinkDialog.tsx` | Menú de modos combinables (Investigación + Legal) en la cabecera del chat; vínculo de expediente desde el chat. |
| `public/legal/packs/*.json` + `index.json` + `public/legal/README.md` | Corpus curado versionado con hash (3 packs MVP, ≤500 KB). |
| `scripts/legal/verify-packs.mjs` + `scripts/legal/__fixtures__/` | Verificador de integridad del corpus + golden set de recall. |
| `src/i18n/dicts/legal*.ts` + `modes.ts` | Un dict por subfeature legal (`legalCases`, `legalAnalysis`, `legalDocs`, `legalTrust`, `legalSetup`) + `modes.ts`. |

---

## 5. Flujos clave (leer esto antes de tocar)

### 5.1 Arranque

```
main.tsx
  -> <App/> (App.tsx)
       bootstrapApp()                      # services + settings + tema + idioma + recoverInterrupted
         -> createServices()               # implementaciones reales (o overrides de test)
         -> settings.load()
         -> setLocale() / applyTheme()
         -> conversations.recoverInterrupted()   # streaming -> aborted
       -> <ServicesProvider> <ConversationsStoreProvider>
       -> <AppShell> <AppRoutes/>
```

- Si `needsOnboarding(settings)` y aún no se resolvió en la sesión → `navigate('#/onboarding')`.
- Un fallo de IndexedDB no aborta: se muestra `AlertBanner` con `storageError`.
- `RouteSync` mantiene `conversationsStore.activeId` alineado con `#/chat/:id`.

### 5.2 Routing (hash, sin librería)

- `#/chat` y `#/chat/:id` → `ChatPage` (bundle inicial).
- `#/settings` y `#/onboarding` → lazy chunks con `Suspense`.
- Cualquier otra cosa → `#/chat`.

### 5.3 Un turno de chat (secuencia)

```
Composer.onSend
  -> useChatController().send(text)
    -> chatStore.send(text)
       claimRun()                              # guard SINCRONO: evita doble-send (1 user, 1 conversacion)
       startTurn()
         ensureConversation()                  # crea conversacion con titulo (48 chars) si no existe
         repo.get / repo.listMessages          # historial desde IndexedDB
         repo.appendMessage(userMessage)       # persistido al instante
         syncConversationSummary()             # messageCount + lastMessagePreview -> conversationsStore.merge
       runTurn()
         services.settings.load()
         providerSource.load()                 # LocalProviderConfigRepository
         resolveProviderTarget()               # conversacion -> activeProviderId -> providers[0]
         services.createAdapter(provider)      # resuelve API key del KeyVault
         researchMode = conversacion.researchMode
                        && settings.tools.webSearchEnabled
                        && resolveCapabilities(...).toolCalling
                        && adapter.capabilities().toolCalling
         repo.appendMessage(assistantMessage)  # status 'streaming'
         for await (event of runAgent(params, {provider, tools, clock, newId}))
            handleAgentEvent(event)            # actualiza content/liveSteps + checkpoint >=1s
         finalizeTurn()                        # patch final: status/finishReason/usage/error
```

Puntos finos:

- **Cancelación por generación:** cada run recibe un `token = ++generation`. Cualquier evento
  tardío de un run obsoleto se ignora (`isCurrent(token)`). `load()` y `stop()` también invalidan.
- **`stop()`** con run ya reclamado pero sin controller aborta via token; con controller, aborta.
- **Checkpoints** de streaming cada `CHECKPOINT_INTERVAL_MS = 1000` ms (persistencia best-effort).
- **`onConversationUpdated`** pasa por `conversationsStore.merge` → lista visible sin recargar.
- **Regenerate/Edit/Delete** usan `deleteMessagesFrom` y re-ejecutan el turno.

### 5.4 Agent loop (`domain/agent/runAgent.ts`)

`runAgent` es un `AsyncGenerator<AgentEvent>` puro (recibe provider, tools, clock, newId):

1. `run-start`.
2. Por cada **paso** (hasta `maxSteps`):
   - `selectHistoryByBudget` reconstruye contexto (system + último user siempre; descarta turnos
     viejos; recorta mensajes > `truncateMessageAtPercent`).
   - `findBudgetLimit` (steps / toolCalls / tokens calibrados / wall-clock). Si se agota el
     presupuesto **blando** (steps o toolCalls) con tools activas, se reserva un **paso final sin
     tools** (`answerForced`) para que el modelo sintetice en vez de terminar en blanco. Los topes
     duros (tokens / wall-clock) sí cortan con `budget_exceeded` conservando lo parcial.
   - Consume `provider.streamChat()`: `text-delta`, `reasoning-delta`, `tool-call`, `usage`, `stop`.
   - **Retries** solo si no hubo salida previa (`sawOutput === false`) y el error es retryable
     (429/5xx/red/timeout), con backoff+jitter y `Retry-After`, tope `maxRetriesPerStep`.
   - **`context_length`** en el paso 0 → un reintento con el 50 % del historial.
   - Ejecuta tools **en serie** con timeout `min(def.timeoutMs, budget.toolTimeoutMs)`.
     - Tool desconocida / args inválidos → `ToolResult` de error (nunca throw).
     - **Dedupe** por `name + args` canónicos (claves ordenadas); repetición devuelve caché.
     - **2 fallos consecutivos** de tools → `run-end error`.
   - `step-end`; si no hubo tools (o el paso ya iba sin tools), termina con `complete`.
3. `run-end` con `ChatMessage` final (`finishReason` = `complete`/`aborted`/`budget_exceeded`/`error`).

El loop nunca lanza hacia el caller: todo se normaliza a eventos y a `MessageError`.

### 5.5 Providers y transporte

- **`WireMessage`** es la forma canónica; cada adapter la traduce a su payload.
- **OpenAI-compatible:** `POST {baseUrl}/chat/completions`, `Authorization: Bearer`, tools
  `{type:'function',function:{...}}`, SSE `data: {json}` + `[DONE]`. Quirks opcionales:
  `includeUsage` (`stream_options.include_usage`) y `sendToolChoice` (`tool_choice:'auto'`).
- **Anthropic:** `POST {baseUrl}/v1/messages`, `x-api-key` + `anthropic-version` +
  `anthropic-dangerous-direct-browser-access: true`, system top-level, `max_tokens` obligatorio
  (default 2048), tools con `input_schema`, `tool_result` dentro de un mensaje de user.
  `GET /v1/models` con fallback a `ANTHROPIC_FALLBACK_MODELS` si 404.
- **OpenCode Zen / Go:** `POST {baseUrl}/chat/completions` (deepseek, glm, kimi…), `POST {baseUrl}/messages` (claude, qwen, y minimax en Go) y `POST {baseUrl}/responses` (gpt, grok, muse-spark). `createOpenCodeAdapter` enruta cada modelo por `ModelInfo.api` o por prefijo del id (variante Zen/Go derivada de la base URL). El catálogo se descubre en `GET {baseUrl}/models`.
- **OpenAI Responses:** `POST {baseUrl}/responses` con `instructions`/`input`, tools planas y eventos `response.*`. Sin esa familia, los modelos GPT/Grok de Zen no funcionan.
- **`StreamTransport`**: en web, `fetch` + `ReadableStream`. En Android, si el streaming falla
  **antes del primer byte**, reintenta con `CapacitorHttp` buffered y el adapter emite
  `transport-fallback` + parsea JSON/transcripción SSE completa. **Nunca** reintenta tras el primer delta.

### 5.5.1 Estándar de proveedores

Al guardar un proveedor, si hay key disponible la app llama `refreshModels` y **rellena los modelos
automáticamente** (sin tipear IDs). El estándar completo (kinds, `ModelApi`, importación desde
`opencode serve` y cómo añadir un proveedor) vive en `docs/provider-standard.md`.

### 5.6 Tools web y seguridad SSRF

- `createToolRegistry(settings, {http, keys, now})` arma `web_search` y `open_url`.
- **`web_search`**: cadena según `search.mode` (auto = Brave → Tavily → Exa → DuckDuckGo). Con
  proxy configurado, Brave/Tavily/DuckDuckGo se consultan vía `/v1/search`; **Exa va siempre
  directo** (MCP keyless con CORS `*`). Resultados normalizados a `SourceRef[]` con dedupe por URL
  (sin fragmento) y `provider` informado.
- **`open_url`**: valida con `isUrlAllowed` (solo http/https; sin userinfo; sin localhost/privadas/
  loopback/link-local IPv4+IPv6). En directo pide `redirect:'manual'` y **cualquier 3xx/opaca (status 0)
  se bloquea** (`blocked_url`) porque podría alcanzar redes privadas. En plataformas sin control de
  redirects (`Capacitor nativo`) **exige proxy**. El proxy `/v1/fetch` sigue hasta 5 saltos
  revalidando cada `Location` server-side. En **navegador sin proxy**, si el fetch directo falla
  (CORS), `open_url` reintenta con un lector público con CORS (`r.jina.ai`); con proxy no lo usa.
- Límites: `open_url` 15 s y 2 MB (medido en bytes UTF-8 + `content-length`); `web_search` 15 s;
  `extractArticle` cap 8000 code points.
- Errores siempre como `ToolResult { ok:false, error:{code,message} }`, nunca throw al loop.

### 5.7 Persistencia

| Dato | Dónde | Clave / store |
|---|---|---|
| Conversaciones | IndexedDB `openher-chat` v1 | store `conversations`, índice `updatedAt` |
| Mensajes | IndexedDB `openher-chat` v1 | store `messages`, índice `byConversation` `[conversationId, createdAt]` |
| Settings | localStorage | `openher.settings.v1` |
| Proveedores | localStorage | `openher.providers.v1` |
| Secretos | localStorage | `openher.key.<ref>` |

- Orden canónico de mensajes: `(createdAt, id)` ascendente (paridad real/fake).
- `recoverInterrupted()` convierte mensajes `streaming` en `aborted` conservando el texto.
- La API key **jamás** se serializa en `ProviderConfig`: `toStoredProvider` proyecta solo claves públicas.
- `navigator.storage.persist()` best-effort reduce el riesgo de desalojo.

### 5.8 i18n

- Cada feature tiene `src/i18n/dicts/<feature>.ts` con `defineDict({ es, en })` y cierra con
  `declare module '../types' { interface I18nSchema { <feature>: <Type> } }`.
- `i18n/index.ts` descubre los dicts con `import.meta.glob('./dicts/*.ts', { eager: true })`;
  el namespace es el nombre del archivo.
- Uso en React: `const t = useT(); t('chat.send')`. Interpolación `{param}`.
- **Paridad es/en verificada en compile-time** (el tipo `en` exige todas las claves de `es`).

---

## 6. Inyección de dependencias (`AppServices`)

`src/app/services.tsx` es el único punto de composición:

```ts
interface AppServices {
  conversations: ConversationRepository;
  settings: SettingsRepository;
  keys: KeyVault;
  http: HttpClient;
  transport: StreamTransport;
  createAdapter(config: ProviderConfig): Promise<ProviderAdapter>;
  createTools?(settings: AppSettings): ToolRegistry;   // seam opcional para tests
}
```

- Producción: `createServices()` construye `IndexedDbConversations`, `LocalSettingsRepository`,
  `LocalKeyVault`, `CapacitorHttpClient`, `createStreamTransport`, dispatch de adapters y registry de tools.
- Tests: `createServices({ conversations: fake, ... })` inyecta dobles. Los stores también aceptan
  `deps.tools` / `deps.providers` para override directo.
- La UI accede con `useServices()`.

---

## 7. Estado (Zustand) — APIs congeladas

### `chatStore` (`features/chat/state/chatStore.ts`)
Estado: `conversationId`, `messages`, `runStatus: 'idle'|'running'|'stopping'`, `liveSteps`,
`lastError`, `researchMode`.
Acciones: `load`, `send`, `stop`, `regenerate`, `editUserMessage`, `deleteMessage`, `retryLast`,
`setResearchMode`, `setModel`.
Helper puro: `resolveModelTarget(conversation, settings, providers)` — precedencia
conversación → proveedor activo → primer proveedor, y modelo → último usado → default → primer modelo
(compartido por el turno del agente y por el `ModelPicker`).

### `conversationsStore` (`features/conversations/state/conversationsStore.ts`)
Estado: `items`, `activeId`, `query`, `status`, `error`.
Acciones: `load`, `create`, `rename`, `remove`, `select`, `setQuery`, `visible()`, `dismissError`,
`merge(conversation)` (actualización puntual sin recargar).
Helpers puros: `sortConversationsByUpdatedAt`, `filterConversations`.

### `settingsStore` (`features/settings/state/settingsStore.ts`)
Estado: `settings`, `providers`, `keyPresence`, `ready`, `status`, `error`, `refreshingProviderId`.
Acciones: `load`, `patch`, `save`, `addProvider`, `updateProvider`, `removeProvider`, `saveApiKey`,
`refreshModels`, `setActiveProvider`, `setModelForProvider`, `dismissError`, y selectores
`chatDefaults()`, `agentBudget()`, `historyBudget()`, `search()`, `proxy()`, `appearance()`.
`patch` descarta valores no finitos (`NaN`/`Infinity`) para no pisar defaults.

### Onboarding
Reducer puro en `features/onboarding/state/wizardReducer.ts` + `session.ts`
(`needsOnboarding`, `isOnboardingResolvedThisSession`).

---

## 8. Seguridad y privacidad

- API keys solo en el KeyVault local (`localStorage`), nunca en logs/código/tests/repo. Sin telemetría.
- Sin backend propio ni analytics; solo tráfico al proveedor LLM y a las tools configuradas.
- `open_url` directo **nunca** sigue redirects; proxy obligatorio donde el transporte no puede
  verificar destinos. `urlPolicy` bloquea esquemas, credenciales y rangos privados/reservados.
- `SourceChip` solo enlaza `http(s)`; otros esquemas se renderizan como texto (evita `javascript:`/`data:`).
- Markdown del modelo se renderiza sin HTML crudo.
- El proxy de búsqueda nunca debe loguear `X-Api-Key`/`Authorization` (contrato en `docs/search-proxy.md`).

---

## 9. Tests y convenciones

- **Runner:** Vitest 4, entorno `jsdom`, `globals: false` (importar `describe/it/expect` de `vitest`).
  Setup: `@testing-library/jest-dom/vitest` + `fake-indexeddb/auto`.
- **Localización:** junto al código (`*.test.ts` / `*.test.tsx`). Fixtures en `__fixtures__/`.
- **Sin red real.** HTTP/transport/adapters se inyectan o se falsean; fixtures SSE para providers.
- **Contrato compartido:** `adapters/storage/conversationContract.ts` se ejecuta contra el repo real
  y el fake para garantizar paridad.
- **Fakes:** `src/test/fakes/MemoryRepos.ts`, `features/chat/state/__fixtures__/chatTestHarness.ts`.
- Sin snapshots. UI con reducers/selectores + smoke RTL.
- `pnpm test` debe quedar verde; `pnpm exec tsc -b` limpio.

---

## 10. Recetas rápidas

### Agregar un proveedor nuevo
- Si es OpenAI-compatible o Anthropic: añade una plantilla a `domain/providers/catalog.ts`
  (id, label, baseUrl, requiresKey, quirks). **No** hace falta tocar adapters: el dispatch es por `kind`.
- Si es un protocolo distinto: nuevo `adapters/providers/<kind>.ts` + rama en `createProviderAdapter`
  + nuevo `ProviderKind` en `types/provider.ts` (implica actualizar `capabilities` y la spec).

### Agregar una tool web
1. Implementa `ToolDefinition` en `adapters/tools/` (JSON Schema, `timeoutMs`, `maxResultChars`).
2. Regístrala en `createToolRegistry` (`list()` y `get()`).
3. Si el modelo debe saber cuándo usarla, actualiza `domain/agent/systemPrompt.ts`.
4. Añade tests con `HttpClient` fake. Errores como `ToolResult`, nunca throw.

### Agregar un ajuste (setting)
1. `domain/types/settings.ts` (campo) + `domain/settings/defaults.ts` + `domain/settings/migrate.ts`
   (saneo e idempotencia).
2. Extiende `SettingsPatch`/`mergeSettings` en `settingsStore.ts` si es sección anidada.
3. Componente de sección en `features/settings/components/` + textos en `i18n/dicts/settings.ts` (es/en).

### Agregar una ruta
- `app/routing.tsx`: amplía el tipo `Route`, `parseRoute`, añade un `*_HREF` si aplica y renderiza
  en `AppRoutes` (usa `lazy` si es ruta secundaria).

### Agregar un texto de UI
- Edita el dict de la feature (`i18n/dicts/<feature>.ts`) en **es y en** (el tipo fuerza la paridad).
  Usa `useT()` en el componente; nunca strings hardcodeados.

### Agregar un store
- Crea `features/<x>/state/<x>Store.ts` con `create<State>()`, un `*StoreContext.tsx`
  (`createContext` + provider + hook) y, si aplica, un hook de wiring. Inyecta dependencias por deps.

### Depurar el agente
- `domain/agent/runAgent.test.ts` y `adapters/providers/*.test.ts` con fixtures SSE son el punto de
  partida. El presupuesto y la calibración viven en `domain/agent/budget.ts` (funciones puras).
- `runAgent` emite `AgentEvent`; el reducer de UI que los consume es `features/research/selectors.ts`.

---

## 11. Gotchas / trampas conocidas

1. `pnpm exec tsc --noEmit` en la raíz **no** chequea `src/`. Usa `pnpm exec tsc -b`.
2. No añadir dependencias: el stack está congelado y la lista aprobada es cerrada.
3. El gate real de investigación es una **conjunción** de cuatro condiciones (ver §5.3). El system
   prompt debe anunciar tools solo si de verdad se enviarán.
4. `buildWireMessages` omite `reasoning` a propósito (no debe realimentar el modelo).
5. `open_url` directo nunca sigue redirects; en Android nativo exige proxy. No "arreglar" esto
   permitiendo redirects: es la mitigación SSRF.
6. Los secretos no se guardan en `ProviderConfig`; no añadir campos de key a esa estructura.
7. El streaming nativo solo cae a buffered **antes del primer byte**; tras un delta no se reintenta.
8. La persistencia durante el streaming es best-effort: el estado en memoria es la verdad inmediata;
   un cierre abrupto lo corrige `recoverInterrupted` (streaming → aborted).
9. `researchMode` se persiste por conversación, pero el toggle solo se activa si
   `settings.tools.webSearchEnabled`.
10. En navegador, las tools web pueden fallar por CORS si no hay proxy configurado
    (`cors_blocked` con aviso accionable); en Android funcionan directas (salvo `open_url` con redirect).

---

## 12. Glosario

| Término | Significado |
|---|---|
| **WireMessage** | Forma canónica de un mensaje lista para cualquier adapter (`system`/`user`/`assistant`/`tool`). |
| **StreamEvent** | Evento de bajo nivel del adapter (`text-delta`, `tool-call`, `usage`, `stop`…). |
| **AgentEvent** | Evento del loop del agente hacia la UI (`step-start`, `tool-start/end`, `run-end`…). |
| **Step** | Una iteración del loop: una llamada al modelo + las tools que produzca. |
| **Checkpoint** | Snapshot del mensaje assistant persistido durante el streaming (≥1 s entre snapshots). |
| **Budget / calibración** | Límites (steps/tools/tokens/tiempo); la estimación de tokens se recalibra con el `usage` real. |
| **Research mode** | Activa tool calling con `web_search`/`open_url` y el panel de investigación. |
| **SourceRef** | Fuente web normalizada (`url`, `title`, `snippet?`, `accessedAt`), deduplicada por URL. |
| **KeyVault ref** | Identificador del secreto: `provider:<id>`, `search:brave`, `search:tavily`. |
| **Puerto** | Interfaz de `domain/ports` que los adapters implementan. |
| **AppServices** | Contenedor de dependencias inyectadas en la UI (`useServices`). |

---

## 12-bis. Harness portado de OpenCode

Capacidades de harness replicadas desde `G:/Proyectos/opencode2` (repo real de OpenCode),
adaptadas a la arquitectura de este cliente de chat:

| Capacidad | Fuente OpenCode | Implementación aquí |
|---|---|---|
| Auto-título | `session/prompt.ts` (agente `title`, strip `<think>`, 1ª línea, 100 → `...`) | `domain/agent/generateTitle.ts` + hook en `chatStore` (solo primer turno, no pisa renombrados) |
| Compactación | `core/src/session/compaction.ts` (plantilla anclada, `select`, umbral overflow) | `domain/agent/compaction.ts` + `Conversation.summary`/`summaryThroughMessageId` + `applyCompaction` |
| Coste / uso | `provider/provider.ts` + `acp/usage.ts` (`cost`, `cache.read/write`) | `domain/providers/pricing.ts` + `components/MessageUsage.tsx` |
| Comandos `/` | `command/index.ts` (`$ARGUMENTS`, hints) | `domain/prompts/commands.ts` + `components/CommandMenu.tsx` |
| Permisos de tools | `permission/index.ts` (`ask`/`reply`, allow/deny/always) | `ports/ToolPermission.ts` + gate en `runAgent` + `components/ToolApprovalDialog.tsx` |

Notas de diseño:
- Los side-calls (título, resumen) van **después** de cerrar el turno (`runStatus: 'idle'`) y no bloquean la UI.
- La compactación conserva los `preserveRecentBudget` tokens recientes (25% de la ventana, acotado a [2k, 15k]).
- El gate de permisos se activa con `settings.tools.requireApproval`; "Permitir siempre" recuerda la tool durante la sesión.
- **Layout móvil**: `AppShell` fija la app al viewport (`h-dvh overflow-hidden`) y `main` es el único contenedor con scroll de página; el chat y el panel de investigación scrollean por separado. Las safe areas de Android usan las variables que inyecta Capacitor (`--safe-area-inset-top/bottom`), no `env()`.
- **Panel ocultable**: la cabecera del panel lo oculta y el header del chat lo restaura (`settings.ui.researchPanelVisible`, persistido). Ocultarlo no apaga el modo investigación: el toggle del composer sigue activo y el chat usa el ancho completo.
- **Selector de modelo**: en la cabecera del chat, agrupado por proveedor y ordenado por nombre; persiste en la conversación y en `settings.lastModelByProvider`.

---

## 12-ter. Distribución y autoactualización

El APK se publica en **GitHub Releases** de un repo **público** (`Owning01/openher-chat`), lo que da
enlaces **permanentes** (no expiran):

| Enlace | Uso |
|---|---|
| `https://raw.githubusercontent.com/Owning01/openher-chat/main/version.json` | Manifiesto que consulta la app |
| `https://github.com/Owning01/openher-chat/releases/latest/download/OpenHer-Chat.apk` | APK de la última release |

Flujo en la app (`features/updates/`):

- `manifest.ts` — `UpdateManifest`, `parseUpdateManifest` (valida y degrada a `null`) y `compareVersions`/`isNewerVersion` (segmentos numéricos; sufijos no numéricos se ignoran). `UPDATE_MANIFEST_URL` es el enlace raw de arriba.
- `checkForUpdate.ts` — `GET` vía el puerto `HttpClient`; nunca lanza, devuelve `available | up-to-date | error`.
- `useUpdateCheck.ts` — hook con aborto al desmontar; `{ auto: true }` comprueba una vez al montar.
- `UpdateNotice.tsx` — aviso descartable al arrancar (solo si `settings.ui.autoCheckUpdates`, default `true`). Es la **única llamada de red en segundo plano**: no envía datos, solo descarga el manifiesto.
- `components/UpdatesSection.tsx` — sección de Ajustes: versión instalada, buscar actualización, notas, SHA-256 y descarga.

`APP_VERSION` (`app/version.ts`) debe coincidir con `versionName` de `android/app/build.gradle`.

### Publicar una versión nueva

1. Subir `APP_VERSION`, `versionCode` y `versionName` (p. ej. `1.2.0`).
2. `pnpm exec tsc -b && pnpm test && pnpm build && pnpm android:sync`.
3. `assembleDebug` con `JAVA_HOME` del JDK 21 y firmar/verificar con `apksigner`.
4. Crear la release con el asset fijo `OpenHer-Chat.apk` y actualizar `version.json` (versión + `sha256`).
5. Las apps instaladas detectan la versión nueva al abrir (o desde Ajustes → Actualizaciones) y descargan el APK por el enlace `latest/download`, que nunca cambia.

Notas de seguridad de la distribución:
- Auditoría previa a publicar: sin API keys ni secretos (solo fixtures de test), sin `local.properties`, sin keystores, sin `.env`, sin tokens en lockfile, sin datos personales.
- El APK va firmado con la **clave debug de Android**, que es pública: cualquiera podría firmar un APK con la misma identidad. Para un canal público conviene una keystore de release propia (fuera del repo) y reinstalar una vez.
- El manifiesto incluye `sha256` del APK para que el usuario pueda contrastar la descarga.

---

## 12-quater. Modo legal (Argentina, civil y comercial)

Asistente de redacción e investigación para escritos civiles y comerciales con
corpus normativo local, verificable por hash y 100% en el dispositivo. No es
asesoramiento legal automático ni reemplaza el criterio del profesional. El
texto del corpus es referencial; el auténtico es el Boletín Oficial.
Detalle de curación, licencia y hash: `docs/legal-packs.md` y
`public/legal/README.md`.

- **Activación por conversación, no global.** Una conversación es legal si
  `conversation.legalCaseId != null`. `settings.legal.enabled` solo define el
  default de conversaciones **nuevas**. Modos ortogonales y combinables:
  General, Investigación (`researchMode`), Legal, Investigación + Legal. Tres
  vías de activación convergentes: onboarding, Ajustes (`WorkModeSection`) y
  `ModesMenu` en la cabecera del chat (con `CaseLinkDialog` si no hay
  expediente vinculado).
- **Turno legal.** `chatStore` deriva `legalMode = legalCaseId != null`
  (independiente del switch global y de `webSearchEnabled`), compone tools
  web + legales (`createTools` con contexto de conversación) y anexa el brief
  del caso por un seam efímero (`ephemeralSuffix`, con `reservedTokens`):
  nunca en el historial persistido ni en el `system`.
- **Dónde vive cada pieza:**
  - Dominio puro: `src/domain/legal/` (hash, packs, retrieval BM25, citation
    guard, plazos, redacción, plantillas, prompt/brief, adversarial) +
    tipos/puertos (`types/legal.ts`, `ports/LegalCaseRepository.ts`,
    `ports/LegalPackStore.ts`).
  - Adapters: `src/adapters/legal/` (loader, verifier, corpus) y
    `src/adapters/storage/` (IndexedDB v2: `legalCases`, `legalDocuments`,
    `legalAnalyses`, `legalPacks`, `acknowledgments`, `gaps`) + tools
    `legal_search` / `cite_article` (`src/adapters/tools/legal/`).
  - UI: `src/features/legal/` (página `#/legal`, expediente, análisis
    adversarial de 4 personas + síntesis, estudio de documentos con
    watermark/disclaimer) + `ModesMenu`/`CaseLinkDialog` en
    `src/features/chat/components/`.
  - Datos: `public/legal/packs/` (corpus MVP: 3 packs, 12 provisiones,
    ~16 KB de 500 KB) + manifiesto `index.json` + verificador
    `scripts/legal/verify-packs.mjs`.
- **Confianza.** Citation guard (existencia + fidelidad verbatim, resto
  `[VERIFICAR]`) aplicado en render, copiar, exportar conversación y
  exportar documento; documentos y análisis con watermark y disclaimer;
  export exige consentimiento + reconocimiento persistidos;
  pseudonimización obligatoria por defecto antes de cualquier envío al
  proveedor.
- **Ruta `#/legal`.** Hash routing propio (`app/routing.tsx`): `#/legal` y
  `#/legal/:caseId`; entrada también desde `TopBar`. Lazy chunk.
- **Crecimiento por fases.** F1: MVP nacional verificable. F2: normativa
  provincial y jurisprudencia propia aportadas por el usuario (pack local
  `user-provided`, sin redistribuir). F3: gap report local (misses de
  `legal_search`/`cite_article`) visible en el expediente; alimenta el
  próximo pack.

---

## 13. Referencias

- Diseño congelado y reglas del agente: `.agents/teamwork_architect_spec.md`.
- Reglas del repo: `AGENTS.md`.
- Tablero y veredictos: `.agents/teamwork_board.json`, `.agents/teamwork_progress.md`.
- Setup: `docs/dev-setup.md`. Smoke E2E: `docs/e2e-smoke.md`.
- Contrato del proxy de búsqueda: `docs/search-proxy.md`.
- Estándar de proveedores y OpenCode: `docs/provider-standard.md`.
- Modo legal: `docs/legal-packs.md` (curación, licencia, hash, fases) y `public/legal/README.md` (contenido del corpus y gap report).
- Conformidad de caché de prompt vs. harnesses auditados: `docs/cache-conformance.md`.
- Visión de producto: `README.md`.
