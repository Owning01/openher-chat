# teamwork_providers_brief.md — Estándar de conexión de proveedores (OpenCode)

> Fase 1 (entrevista de alcance) cerrada con el usuario. Ruta: **teamwork standard**.
> Modo de integridad: **development**. Proyecto: `G:\Proyectos\openher-chat`.

## 1. Objetivo y audiencia

Que cualquier persona pueda conectar proveedores LLM en OpenHer Chat **sin tipear modelo por
modelo**, con foco en la **API de OpenCode**:

- **OpenCode Zen** (`https://opencode.ai/zen/v1`): gateway con tres familias de endpoint
  (`/chat/completions`, `/messages`, `/responses`) y catálogo en `/zen/v1/models`.
- **`opencode serve` local** (`http://127.0.0.1:4096`): fuente de catálogo de proveedores/modelos
  ya configurados en el harness local.

Producción interna single-user (app personal). No es demo ni benchmark.

## 2. Bloques de requerimientos (Qué, no Cómo)

- **R1 — Descubrimiento automático de modelos.** Al conectar un proveedor, los modelos se
  descargan de la API (`/models` o el catálogo del gateway) y quedan listos; el usuario no escribe IDs.
- **R2 — Ruteo automático por endpoint.** Un solo proveedor OpenCode Zen expone todos los modelos,
  cada uno enviado a la familia correcta (`chat/completions`, `messages`, `responses`).
- **R3 — Adapter OpenAI Responses API.** Hoy no existe; es el gap que impide usar GPT/Grok/Muse.
  Debe soportar streaming, tool calling, usage y abort, tolerante a fallos.
- **R4 — Conectar con `opencode serve` local.** Importar proveedores/modelos del servidor local
  (catálogo best-effort) para no tipearlos. Documentar que NO proxya el agente.
- **R5 — Estándar documentado.** `docs/provider-standard.md` con el contrato para añadir proveedores
  y para crear conversores de catálogo.
- **R7 — OpenCode Go.** Soportar también el gateway de suscripción `https://opencode.ai/zen/go/v1`
  (modelos open) con su ruteo propio (MiniMax → `/messages`), sin tipear modelos.
- **R6 — Sin regresiones.** `pnpm exec tsc -b`, `pnpm test` y `pnpm build` verdes. Sin `console.log`,
  sin secretos persistidos, sin dependencias nuevas.

## 3. Mecanismo de verificación independiente

- Suite Vitest del repo (sin red real; fixtures SSE) + tests nuevos por unidad.
- Verificación de esquema real del catálogo Zen (lectura pública, sin key) como evidencia manual del Auditor:
  `GET https://opencode.ai/zen/v1/models` → `{object:"list", data:[{id, object, created, owned_by}]}`.
- Gates adversariales: Critic (capas/estilo), Challenger (caos en parser/router), Auditor (terminal real),
  Evaluator (DoD).

## 4. Criterios de aceptación (DoD)

1. Existe el proveedor plantilla **OpenCode Zen** y al pulsar "Actualizar" descubre los ~70 modelos
   reales, cada uno con su `api` asignada.
2. El router envía `claude*`/`qwen*` → `/messages`, `gpt*`/`grok*`/`muse-spark*` → `/responses`,
   resto → `/chat/completions`; sin metadata, default `chat-completions`.
3. Existe `createOpenAIResponsesAdapter` con streaming (`text-delta`, `reasoning-delta`, `tool-call`,
   `usage`, `stop`), payload con `instructions`/`input` y `function_call_output` para tool results.
4. El catálogo local de `opencode serve` se importa de forma tolerante (múltiples shapes) o falla con
   error accionable; nunca rompe la app.
5. `docs/provider-standard.md` describe el estándar; `architecture.md`/`README.md` referencian.
6. `tsc -b`, `pnpm test`, `pnpm build` verdes; 0 `console.log`; key nunca serializada.

## 5. Directrices del usuario (restricciones)

- "Lo más simple posible": un proveedor → todos los modelos; cero tipeo manual.
- Sin dependencias nuevas (stack congelado por `AGENTS.md`).
- Mantener el enfoque hexagonal: contratos en `domain/`, IO en `adapters/`, UI+stores en `features/`.

## 6. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| `/zen/v1/models` no declara el endpoint de cada modelo | Clasificador por prefijo + override `ModelInfo.api` + default chat-completions documentado |
| Gemini usa un 4º shape (Google SDK) no soportado | Se enruta a chat-completions como best-effort y se documenta como limitación |
| Schema de `opencode serve` no verificable (sin server en la máquina) | Parser tolerante multi-shape + tests con fixtures; limitación documentada |
| Respuestas API varía entre proveedores | Parser tolerante por `type` del evento o del payload; tests con fixtures representativos |
