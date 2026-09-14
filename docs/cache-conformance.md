# Conformidad con el estándar de caché de prompt

Contraste de OpenHer Chat contra el estándar de facto destilado de 13 harnesses
auditados (`OnlyTerp/prompt-cache-skills`, set 2026-05-27), del código de
`sst/opencode` (`packages/opencode/src/provider/transform.ts`) y del paquete
`pi-opencode-go-cache`.

## Criterio de verificación

Un harness "soporta caché" **si y solo si**, en el segundo turno idéntico, el
`usage` de la respuesta trae contadores de caché > 0. Tener `cache_control` en el
request es necesario, no suficiente. Los tests de abajo fijan la forma del wire;
la verificación final es el contador de la respuesta.

## Matriz de conformidad

| Requisito | Estándar | OpenHer Chat | Evidencia (test) |
|---|---|---|---|
| Prefijo byte-estable | Sin timestamp/sesión en system·tools·prefijo | ✅ fecha UTC sin hora | `domain/agent/systemPrompt.test.ts` (byte-estable en el día) |
| Tools deterministas | Array estable, sin reordenar | ✅ definiciones estáticas | `adapters/providers/openaiCompatible.test.ts` |
| Anthropic breakpoints | ≤ 4, system + cola | ✅ 3: system + últimos 2 (escalera móvil) | `adapters/providers/anthropic.test.ts` |
| Anthropic usage | `input` + `cache_read` + `cache_creation` | ✅ sumados en `promptTokens` | `anthropic.test.ts` |
| Anthropic evento final | Contadores de caché en `message_delta` | ✅ fallback si `message_start` no trae usage | `anthropic.test.ts` |
| OpenAI clave estable | `prompt_cache_key` = sesión (nunca UUID) | ✅ `sessionId` de conversación | `openaiCompatible.test.ts` |
| OpenAI medible | `stream_options.include_usage` | ✅ plantilla `openai` | `domain/providers/catalog.test.ts` |
| OpenAI usage | `prompt_tokens_details.cached_tokens` | ✅ | `openaiCompatible.test.ts` |
| Responses usage | `input_tokens_details.cached_tokens` | ✅ | `adapters/providers/openaiResponses.test.ts` |
| DeepSeek usage | `prompt_cache_hit_tokens` de nivel raíz | ✅ | `openaiCompatible.test.ts` |
| OpenCode sesión | `x-opencode-session` estable | ✅ propagado por `runAgent` | `adapters/providers/opencode.test.ts` |
| OpenCode retención | `prompt_cache_retention` | ✅ `24h` en Go | `opencode.test.ts` |
| OpenCode excepciones | GLM rechaza `cache_control` | ✅ omitido (`isOpenCodeCacheUnsupported`) | `opencode.test.ts` |
| Gemini implícita | Nada que setear; prefix estable | ✅ (sin campo) | — |

## Gaps conocidos (documentados, no implementados)

- **TTL 1h en Anthropic.** Solo Claude Code lo usa por defecto y OpenCode tras flag experimental.
  Requiere `anthropic-beta: extended-cache-ttl-2025-04-11` + `cache_control.ttl:"1h"`; el TTL por
  defecto (5 min) cubre el loop de chat. Riesgo: despliegues antiguos rechazan el campo.
- **Gemini explícita (`cachedContents`).** Gap universal entre los harnesses auditados; la
  implícita ya se beneficia del prefijo estable.
- **Bedrock / Vertex.** Sin adapter propio; `cachePoint` (Bedrock) no aplica.
- **OpenRouter.** Requiere `usage: {include: true}` en el body y `cache_control` a nivel de
  contenido; sin plantilla dedicada.
- **`prompt_cache_options` (GPT-5.6+).** Breakpoints explícitos y TTL `30m`; el modo automático
  es suficiente para el caso actual.
- **Compaction.** Codex CLI preserva el `prompt_cache_key` al compactar el historial; OpenHer Chat
  aún no compacta (solo recorta por presupuesto).

## Cómo verificar en la wire

1. Capturar con mitmproxy (`HTTPS_PROXY=http://127.0.0.1:8090`).
2. Mandar el mismo turno dos veces dentro de la ventana de caché.
3. Leer en el 2º turno:
   - Anthropic: `usage.cache_read_input_tokens > 0` y `cache_creation_input_tokens = 0`.
   - OpenAI/Responses: `usage.prompt_tokens_details.cached_tokens > 0` (requiere `include_usage`).
   - DeepSeek: `usage.prompt_cache_hit_tokens > 0`.
4. `cache_creation > 0` en **todos** los turnos ⇒ el breakpoint está sobre contenido volátil.
