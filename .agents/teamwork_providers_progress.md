# teamwork_providers_progress.md — Registro vivo

Inicio: 2026-09-12 · Modo: development · Ruta: standard · Estado: **COMPLETADO (ACCEPTED)**.

## Estado

- [x] Fase 1 — Entrevista de alcance (Ambas · implementar + documentar · autodescubrir + ruteo).
- [x] Recon: OpenCode Zen (3 familias de endpoint + `/zen/v1/models`), `opencode serve` (catálogo), adapters actuales.
- [x] M0 — Tipos compartidos, catálogo Zen, kinds y persistencia de `ModelInfo.api` (Orchestrator).
- [x] W1 — Worker-Responses: `openaiResponses.ts` + 19 tests (exit 0).
- [x] W2 — Worker-Zen: `opencode.ts` + `modelList.ts` + 21 tests (exit 0).
- [x] M1 — Integración registry + UX + i18n + auto-descubrimiento (Orchestrator).
- [x] W3/M2 — Importador `opencode serve` + UI `ImportOpenCodeServer` + `settingsStore.importProviders`.
- [x] M3 — Docs (`docs/provider-standard.md`, README, architecture).
- [x] G1 — Critic: **FAIL** (1 MAJOR + 4 MINOR); Challenger: 3 bugs (2 LOW, 1 MEDIUM). Todo remediado con tests de regresión.
- [x] G2 — Auditor empírico: **PASS** (tsc/test/build 0; integridad 6/6 PASS).
- [x] G3 — Evaluator: **ACCEPTED** (DoD 6/6; prueba real del catálogo público: 70/70 modelos clasificados).
- [x] M4 (post-aceptación) — **OpenCode Go** (`https://opencode.ai/zen/go/v1`): plantilla `opencode-go`, clasificación por variante (MiniMax→`messages` en Go), catálogo real 37 modelos. Verificado.

## Evidencia final

- `pnpm exec tsc -b` → exit 0.
- `pnpm test` → **80 archivos / 822 tests / 0 fallos** (baseline: 76/718 → +104).
- `pnpm build` → exit 0 (warning preexistente de chunk >500 kB).
- 0 `console.log`; 0 dependencias nuevas; 0 tests borrados; API key nunca serializada en `ProviderConfig`.
- Catálogos públicos verificados: Zen 70 modelos, Go 37 modelos.
- `vite.config.ts`: `testTimeout: 15_000` (la suite creció; 2 tests de UI rozaban el default de 5 s bajo carga paralela).

## Remediaciones del tribunal

| Hallazgo | Fix |
|---|---|
| MAJOR: el override de Ruta se perdía al refrescar | `mergeApiModels`: `previous?.api ?? model.api` (el override del usuario gana; el clasificador solo aplica a modelos nuevos) |
| MEDIUM: `importProviders` con persistencia divergente | Guardar settings primero y, en `catch`, revertir también `providerRepo` (`Promise.allSettled`); devuelve el `skipped` real |
| LOW: `parseOpenAIModelList` aceptaba ids solo-espacios | `.trim()` + descarte de vacíos (id y label) |
| LOW: usage `1e400` → `Infinity` | `Number.isFinite` en `mapResponsesUsage` |
| MINOR: clasificador no recortaba espacios | `classifyOpenCodeModelApi` hace `.trim().toLowerCase()` |
| MINOR: i18n `modelsEmpty` para "0 proveedores" | clave dedicada `importOpencodeEmpty` |
| MINOR: drift de la spec congelada | AMEND §12 en `.agents/teamwork_architect_spec.md` |
| MINOR: cobertura del registry | +2 tests de dispatch (`openai-responses`, `opencode`) |

## Limitaciones aceptadas (documentadas)

1. **Gemini en Zen**: usa un shape Google no soportado; se enruta a `chat-completions` como best-effort. No hay adapter Google.
2. **Servidor local**: importa catálogo (base URLs + modelos), NO proxya el agente ni transfiere API keys.
3. **Sin API key real de Zen**: no hay E2E contra el gateway; verificación por fixtures + lectura pública de `/zen/v1/models` (70 modelos).
4. **Headers HTTP duplicados** por adapter (`buildHeaders`/`findHeader`/`removeHeader`): patrón preexistente; refactor fuera de alcance.
5. **`testTimeout: 15_000` global**: trade-off aceptado frente a timeouts por test.
6. **`classifyOpenCodeModelApi` vive en `adapters/providers`**: moverlo a `domain/providers` es un refactor opcional.
7. **OpenCode Go**: no se envían `x-opencode-session` ni `User-Agent` propios (recomendados para enrutado/caché, no requeridos para autenticar ni para corrección de la respuesta).

## Hallazgos de recon

- `GET https://opencode.ai/zen/v1/models` devuelve `{object:"list", data:[{id,object,created,owned_by}]}`
  sin metadata de endpoint → clasificación por prefijo obligatoria.
- No hay `opencode serve` escuchando en 4096/4097/3000/8080 en la máquina → el conector local no puede
  verificarse en vivo; parser tolerante + tests con fixtures y limitación documentada.
- Adapters previos: `openaiCompatible` (chat/completions) y `anthropic` (messages). Faltaba Responses.
