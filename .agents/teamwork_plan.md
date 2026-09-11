# teamwork_plan.md — OpenHer Chat

Plan de hitos y pistas paralelas. Generado por el Sentinel a partir del diseño del Architect (contratos congelados en `src/domain/types/**` y `src/domain/ports/**`).

## Hitos

| Hito | Tareas | Gate adversarial | Entregable verificable |
|---|---|---|---|
| **M1 Fundaciones** | T01 → T02, T03 | Critic + Auditor | Scaffold compila, design system + i18n + dominio puro testeados |
| **M2 Datos y red** | T04, T05 | Challenger + Auditor | IndexedDB + KeyVault + SSE parser con fixtures |
| **M3 Providers y shell** | T06, T08 → T07, T14 | Critic + Challenger + Auditor | OpenAI-compat + Anthropic + shell de navegación + tools web |
| **M4 Ajustes y agente** | T09, T13 → T10, T11 → T12 | Challenger + Auditor | Settings/onboarding + runAgent + UI de chat |
| **M5 Investigación** | T15 | Challenger + Auditor | Modo investigación con timeline, fuentes y presupuesto |
| **M6 Cierre** | T16 | Success Auditor | Packaging Android/PWA + smoke E2E + DoD global |

## Oleadas (waves) y paralelismo

```
W1: T01
W2: T02 | T03          (paralelo, archivos disjuntos)
W3: T04 | T05
W4: T06 | T08
W5: T07 | T14
W6: T09 | T13
W7: T10 | T11
W8: T12
W9: T15
W10: T16
```

## Reglas de ejecución del swarm

1. **Propiedad exclusiva de archivos:** un solo Worker por archivo; los `allowedFiles` del tablero son exhaustivos.
2. **Contratos congelados:** `src/domain/types/**`, `src/domain/ports/**`, firmas `createProviderAdapter`, `runAgent`, `AppServices` y APIs de stores. Cambiarlos exige re-despacho al Architect.
3. **Integridad `development`:** prohibido placeholders/fabricaciones; todo `WORKER_COMPLETE` incluye salida real de comandos.
4. **Scratch:** scripts temporales de cada agente en `scratch/agent-<id>/` (gitignored), nunca en la raíz.
5. **Dependencias:** solo T01 ejecuta `pnpm add`; la lista aprobada está en el diseño del Architect. Ninguna otra tarea añade paquetes.
6. **Gates por hito:** ningún hito avanza sin Critic (estilo/arquitectura), Challenger (caos/edge cases) y Auditor (ejecución real) sobre el diff acumulado del hito.
7. **Renovación de contexto:** al cerrar cada hito, el estado se resume en `teamwork_progress.md`; el Orchestrator del hito siguiente arranca solo con tablero + plan + progreso (sin arrastrar transcripciones).
8. **Rechazo:** un veredicto REJECTED devuelve la tarea al Worker de origen con la lista de correcciones obligatorias; se re-audita.

## Detalle de tareas

| ID | Título | Deps | Archivos (resumen) | DoD (resumen) |
|---|---|---|---|---|
| T01 | Scaffold, tooling y deps | — | package.json, configs, main/App mínimo, CSS, test setup | install OK; tsc estricto limpio; build OK; Capacitor appId `app.openher.chat` |
| T02 | Design system, tema, i18n | T01 | styles, i18n/**, shared/ui/**, hooks/utils | tokens AA claro/oscuro; primitivas; `defineDict` es/en con paridad; sin strings sueltos |
| T03 | Dominio: contratos y lógica pura | T01 | domain/** (types, ports, chat, settings, providers) | contratos de secciones 2–3; estimateTokens; selectHistoryByBudget ≥12 casos; migrateSettings |
| T04 | Persistencia IDB + settings + KeyVault | T03 | adapters/storage/**, fakes | CRUD completo; cascada; recoverInterrupted; config serializada sin keys |
| T05 | Transportes HTTP/SSE + fallback Android | T03 | adapters/http/**, providers/{sse,errors} | parser SSE robusto ≥8 fixtures; fallback buffered en nativo; mapeo errores |
| T06 | Provider OpenAI-compatible + registry | T03,T05 | adapters/providers/openaiCompatible, index, fixtures | payloads correctos; tool-calls acumulados; buffered parse; errores; ≥15 asserts |
| T07 | Provider Anthropic | T06 | adapters/providers/anthropic, index(edit), fixtures | eventos nombrados; tool_use; buffered; catálogo fallback |
| T08 | App shell + navegación + conversaciones | T02,T04 | app/**, features/conversations/**, dicts | routing hash; services/bootstrap; drawer/sidebar; store conversaciones + tests |
| T09 | Ajustes completos | T02,T04,T06,T07 | features/settings/**, dict settings | providers/models/keys (KeyVault), chat, agente, búsqueda, proxy, apariencia; tests |
| T10 | Onboarding | T09 | features/onboarding/**, routing/App (edit) | wizard 3 pasos reutilizando forms; test conexión; redirect si no hay proveedor |
| T11 | Orquestación chat (store + runAgent) | T04,T06,T07,T08,T13 | features/chat/state/**, hooks | send/stop/regenerate/edit; checkpoints ≥1s; persistencia final; tests con FakeProvider |
| T12 | UI de chat + markdown | T11 | ChatPage, components/**, shared/markdown/**, dict chat | burbujas, acciones, composer, scroll inteligente, links seguros, sin HTML crudo |
| T13 | Agent loop core | T03,T06,T07 | domain/agent/** + tests | pasos, tools serie, dedupe, presupuesto, abort, retries pre-delta, context_length; ≥85% |
| T14 | Tools web: search + open_url | T03,T05 | adapters/tools/**, docs/search-proxy.md | Brave/Tavily/DDG/proxy → SourceRef; urlPolicy ≥15 casos; extractArticle; sin red en tests |
| T15 | Modo investigación UI + wiring | T12,T14 | features/research/**, chat edits, services edit, dict research | toggle por conversación; timeline; cards de tools; fuentes; BudgetMeter; Stop cancela tools |
| T16 | Packaging Android/PWA + cierre | T10,T15 | capacitor.config, scripts, public/**, android/**, docs | cap sync; iconos propios; PWA mínimo; smoke doc; gates finales verdes |

**Esfuerzo estimado:** ~83 h de builder · ~5 días de calendario con 2–3 Workers en paralelo.
