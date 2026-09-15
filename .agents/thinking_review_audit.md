# Auditoría — Ajuste "Pensamiento" (thinking Off/Low/Medium/High/Max)

Fecha (UTC): 2026-09-15 · Auditor: protocolo teamwork · Repo: `G:\Proyectos\openher-chat` (rama `main`, trabajo sin commitear).
Alcance real del diff (verificado con `git status --short` + `git diff --numstat`): 19 archivos modificados
(+285/−8) y 2 nuevos sin tracking (`src/domain/providers/thinking.ts`, `src/domain/providers/thinking.test.ts`).
No se modificó código de producto en esta auditoría; sólo se ejecutaron comandos y lecturas.

## Veredicto: APROBADO

Todos los gates ejecutados en esta sesión pasan y cada check 1–10 se verificó por lectura real con
archivo:línea. Único hallazgo de severidad baja: indentación cosmética en `chatStore.ts:665-669`
(sin efecto funcional; `tsc` y tests en verde).

## Tabla de checks

| ID | Check | Evidencia | Resultado | Estado |
|----|-------|-----------|-----------|--------|
| 1 | `pnpm exec tsc -b` → exit code | `tsconfig.app.json:12` (`noEmit:true`), `tsconfig.json:1-7` (refs app+node). Ejecución directa `node tsc -b --force` → exit 0 (×2); `pnpm exec tsc -b` final → exit 0 | exit 0, sin errores de tipos | ✅ PASS |
| 2 | `pnpm test` → conteo real (gate previo: 123/1404) | `vitest-run2.txt`: `Test Files 123 passed (123)`, `Tests 1404 passed (1404)`, `Duration 20.04s`, exit 0 | 1404/1404 tests, 123/123 files — el "123/1404" previo era files/tests, se confirma y corrige la lectura | ✅ PASS |
| 3 | `node scripts/legal/verify-packs.mjs` → exit code | Salida literal `verify-packs: OK (…\public\legal\packs\)` | exit 0, sin regresión del corpus | ✅ PASS |
| 4 | `thinking:'off'` (default) = payloads byte-idénticos; `toEqual` exactos intactos | `anthropic.ts:279-286` (off→budget null→sin clave `thinking`, temperature passthrough); `openaiResponses.ts:204-206` (sólo si ≠off); `openaiCompatible.ts:227` (gate `thinkingSupported===true`). `git diff --numstat`: test files 37/0, 33/0, 31/0 (cero borrados, sólo agregados). `toEqual` exactos preexistentes p. ej. `anthropic.test.ts:81,117,202` siguen verdes en suite 1404/1404 | Sin parámetros nuevos con off; tests viejos sin tocar | ✅ PASS |
| 5 | Anthropic: budget proporcional, `temperature:1` sólo con thinking, omisión con ventana chica | `thinking.ts:46-53` (`thinkingBudgetTokens`: fracciones `low .1/medium .25/high .5/max .8`, clamp `[1024, maxTokens-1]`, `null` si no cabe); `anthropic.ts:255-257` (tipo payload), `anthropic.ts:279-286` (fuerza `temperature:1` sólo en rama thinking; si budget null → conserva la pedida). Tests `anthropic.test.ts` (3 nuevos: off sin clave / medium→16000+temp 1 con max 64000 / high con max 512→omitido+temp 0.3) | Proporcional + forzado condicional + fail-safe verificados | ✅ PASS |
| 6 | Responses: `reasoning:{effort,summary:'auto'}` y `max→high` documentada | `openaiResponses.ts:169-180` (tipo `reasoning`), `:182-187` (`toReasoningEffort` + comentario "se degrada a `high` en vez de arriesgar un 400"), `:204-206` (sólo si definido y ≠off). Tests: off sin `reasoning`, high→`{effort:'high',summary:'auto'}`, max→high | Forma exacta + degradación documentada y testeada | ✅ PASS |
| 7 | Compatible: gate `thinkingSupported`, `max→high`, quirk `enableThinking` | `openaiCompatible.ts:190-203` (tipos `reasoning_effort`/`enable_thinking`), `:225-230` (gate `request.thinkingSupported===true` + comentario fail-safe 400; `max→'high'`; quirk `enableThinking`); `provider.ts:38-42` (doc del quirk DashScope/Mistral). Tests: sin soporte→nada; medium+soporte→`reasoning_effort`; max+quirk→`high`+`enable_thinking:true` | Gate conservador + degradación + quirk verificados | ✅ PASS |
| 8 | Resolución en `runAgent` (flag explícito vs inferencia) y `defaults.thinking` requerido + 2 call-sites | `runAgent.ts:53` (`defaults` exige `thinking: ThinkingLevel`), `:248-249` (`thinking: p.defaults.thinking`, `thinkingSupported: p.model?.supportsThinking ?? inferThinkingSupport(p.modelId)` — `??`: flag explícito gana, si falta se infiere del id). Call-sites: `chatStore.ts:665-669` (prod, único — grep `runAgent\(` confirma un solo uso en prod en `chatStore.ts:691`) y `runAgent.test.ts:120` (`makeParams` actualizado). `tsc` exit 0 prueba que no falta ningún otro (campo requerido) | Resolución y cableado completos; "2 call-sites" = prod + helper de test (aclaración, no defecto) | ✅ PASS |
| 9 | Settings: default `off`, saneo enum en `migrateChat`, UI `Select` + i18n es/en con paridad | `defaults.ts:41-46` (`thinking:'off'`); `migrate.ts:11` (import `THINKING_LEVELS`), `:93` (`readEnum(...,THINKING_LEVELS,fallback)` — inválido→`off`); `ChatSection.tsx:17-24` (guard `isThinkingLevel` + mapa de claves), `:44-47` (opciones desde `THINKING_LEVELS`), `:88-104` (`Select` + hint). `dicts/settings.ts`: es `:107-113`, en `:286-292` — 7 claves en ambos (`chatThinking`, `chatThinkingHint`, `_off/_low/_medium/_high/_max`). `i18n.test.ts:21-28` (test de paridad es/en sobre todos los dicts) verde en corrida focalizada 9 files/227 tests exit 0 | Default, saneo, UI y paridad i18n verificados | ✅ PASS |
| 10 | Higiene: 0 `console.*`, 0 TODOs, 0 `any` en archivos del diff | Grep case-sensitive sobre los 21 archivos del diff: `console\.` → 0; `\b(TODO\|FIXME\|XXX\|HACK)\b` → 0 (los 3 hits case-insensitive previos eran el español "todo/todos": `openaiResponses.ts:182`, `runAgent.ts:421`, `chatStore.ts:211`); `:\s*any\b\|as\s+any\b\|<\s*any` → 0 (los 3 hits de `any` eran el literal `'any'` del enum `Freshness`: `migrate.ts:32`, `types/settings.ts:8`, `dicts/settings.ts:321`) | Limpio | ✅ PASS |

## Conteos reales

- `tsc -b` → **exit 0** (dos corridas directas con `--force` + una final vía `pnpm exec tsc -b`).
- `vitest run` (suite completa) → **Test Files 123 passed (123)** · **Tests 1404 passed (1404)** · 20.04s · **exit 0**.
  El gate previo "123/1404" queda confirmado y reinterpretado: 123 archivos / 1404 tests, todo en verde.
- Corrida focalizada thinking+i18n (9 files: i18n, thinking, 3 adapters, runAgent, defaults, migrate,
  SettingsPage) → **9 passed · 227 passed · exit 0**.
- `node scripts/legal/verify-packs.mjs` → `verify-packs: OK` · **exit 0**.
- Diff: `git diff --numstat` = 19 files, +285/−8; archivos nuevos: `thinking.ts` (53 líneas),
  `thinking.test.ts` (43 líneas, 5 tests). Deleciones sólo en `anthropic.ts` (2), `runAgent.ts` (2),
  `ProviderAdapter.ts` (1), `chatStore.ts` (1), `ChatSection.tsx` (1): las líneas reemplazadas por el
  cableado thinking (verificadas una por una en el diff).

## Hallazgos

- **Baja · cosmética — `src/features/chat/state/chatStore.ts:665-669`**: las claves del objeto
  `defaults` (`temperature`, `maxOutputTokens`, `thinking`) quedaron con indentación desalineada
  respecto a la llave de apertura (artefacto del edit). Sin efecto funcional (tsc + tests verdes).
  Sugerencia: reformatear el bloque al estilo del resto del archivo.
- **Informativa · entorno (no código)**: este host sufre caídas esporádicas del proceso Node con exit
  `-1073741818` (`STATUS_IN_PAGE_ERROR`, I/O de disco): afectó 2 intentos de `tsc -b --force` vía pnpm
  y 1 intento de `pnpm test` con salida a archivo. Todos los comandos terminaron en verde al reintentar
  (vía `pnpm exec` o `node` directo con `G:\Dev\nodejs\node.exe` v24.19.0 / pnpm 12.4.1). Nada quedó sin
  ejecutar: los tres gates tienen resultado final registrado arriba.
- **Aclaración · ID 8**: el enunciado pedía "2 call-sites actualizados". El grep de `runAgent\(` muestra
  un único call-site de producción (`chatStore.ts:691`, con `defaults` en `:665-669`); el segundo sitio
  actualizado es el helper `makeParams` de `runAgent.test.ts:120` (más los literales de los 3 tests nuevos
  en `:296,306`-zona thinking). Al ser `defaults.thinking` requerido (`runAgent.ts:53`) y `tsc -b` exit 0,
  queda demostrado que no existe ningún otro constructor de `RunAgentParams` sin actualizar.
- **Aclaración · ID 5 (límite conocido, por diseño)**: con `maxOutputTokens` entre 1026 y ~2047 el mínimo
  Anthropic de 1024 cabe pero deja ≤1023 tokens de salida real (p. ej. `thinkingBudgetTokens('low',2048)=1024`
  cubierto por test en `thinking.test.ts:35`). Es el comportamiento documentado en `thinking.ts:40-45`
  ("el mínimo manda mientras quepa"), no un defecto; se registra para que el builder lo tenga presente.
