# teamwork_progress.md — OpenHer Chat

Registro vivo del swarm. Última actualización: 2026-09-11 (M2 ACCEPTED; M3 en curso).

## Estado

- **Fase:** 2 — Ejecución autónoma.
- **Modo de integridad:** `development`.
- **Hito actual:** M3 — Providers y shell. Oleada W4: T06 BUILDING (T08 tras T06 por dependencia real de compilación).
- **Autorizaciones:** `pnpm install` y ejecución completa del swarm en `G:\Proyectos\openher-chat`.

## Tablero de avance

| Hito | Tareas | Estado |
|---|---|---|
| M1 Fundaciones | T01, T02, T03 ACCEPTED | cerrado |
| M2 Datos y red | T04, T05, H1, H2 ACCEPTED (tras re-gate M2b) | **cerrado** |
| M3 Providers y shell | T06 BUILDING · T07, T08, T14 pendientes | EN CURSO |
| M4 Ajustes y agente | T09–T13 | pendiente |
| M5 Investigación | T15 | pendiente |
| M6 Cierre | T16 | pendiente |

## Gates ejecutados

| Hito | Critic | Challenger | Auditor | Veredicto |
|---|---|---|---|---|
| M1 | PASS | PASS | PASS | ACCEPTED + H1 |
| M2 | PASS | FAIL (2 MAJOR) | PASS | REJECTED parcial |
| M2b (re-check H2) | — | PASS (0 BROKEN / 38 ataques) | PASS (246 tests/build 0) | **ACCEPTED** |

Evidencia final M2: `tsc -b` 0 · 246 tests en 30 archivos · build 0 · scope H2 exacto (13 archivos) · higiene 0 hits · 2 MAJOR corregidos y re-verificados con casos de empate `(createdAt,id)` y BOM.

## Log de eventos

- `2026-09-11` — M1 cerrado (T01–T03 + H1). 231 tests.
- `2026-09-11` — T04/T05 entregados; gate M2 detectó 2 MAJOR; H2 remedió; re-gate M2b PASS. 246 tests.
- `2026-09-11` — Enmienda administrativa del spec §6: `AdapterDeps` incorpora `apiKey?: string` (la key se resuelve desde KeyVault al crear el adapter; nunca se serializa en `ProviderConfig`). Documentado para T06/T09.
- `2026-09-11` — W4 iniciada: T06 (provider OpenAI-compatible + registry) despachado; T08 espera a T06 por dependencia de compilación (`createProviderAdapter`).

## Decisiones

- Desktop = SPA/PWA por ahora; empaquetado nativo se decide en M6.
- Solo T01 agrega dependencias.
- Contratos congelados; `scratch/**` fuera de vitest y git.
- Comandos oficiales: `pnpm exec tsc -b`, `pnpm test`, `pnpm build`.
- Serialización táctica: cuando dos tareas comparten símbolos en compilación (p. ej. T08 importa de T06), se serializan aunque el plan las liste en la misma oleada.
