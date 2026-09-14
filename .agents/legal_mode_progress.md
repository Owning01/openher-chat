# legal_mode_progress.md — Registro de la corrida teamwork (planificación)

## Configuración

- **Ruta:** teamwork **standard (medium)** — justificado por ser una vertical nueva, con conocimiento
  versionado, análisis multi-rol, requisitos de exactitud jurídica y confidencialidad.
- **Modo de integridad:** `development`.
- **Alcance:** SOLO planificación. Ningún archivo de `src/`, `android/`, `package.json` ni `public/`
  fue modificado (verificado con `git status`).

## Equipo desplegado

| Rol | Agente | Producto |
|---|---|---|
| Explorers (Tier 2, solo lectura) | `explore` ×2 | Mapa de onboarding/settings/i18n y mapa de dominio/agente/tools/storage |
| Investigación externa | `general` (websearch/webfetch) | Dossier jurídico argentino con fuentes oficiales + lista explícita de "NO VERIFICADO" |
| Project Orchestrator | `architect` | `.agents/legal_mode_plan.md` v1 + board |
| Challenger (Tier 3) | `challenger` | `.agents/legal_mode_review_challenger.md` |
| Critic (Tier 3) | `critic` | `.agents/legal_mode_review_critic.md` |
| Orchestrator (remediación) | `architect` (misma sesión) | Plan **v2** + board v2 + §12 Remediación |
| Auditor (plan-level) | agente raíz | Validación de artefactos (abajo) |

## Veredictos del gate

- **Challenger:** RECHAZADO (condicionado) → 3 críticos verificados contra el código:
  - **C1** el plan ignoraba el **bug real de tool-calls huérfanos** en `runAgent` (caminos
    `budgetDuringTools`, `abortedDuringTools`, `failedTwice`, `answerForced`) que rompe proveedores
    OpenAI-compatible, y que el modo legal **agrava** al habilitar tools.
  - **C2** contradicción: un caso linkeado con el workspace apagado quedaba sin tools/scaffold legales.
  - **C3** el brief "como par tool-call/tool-result" no tenía asiento: `Role` no admite `'tool'` y
    `selectHistoryByBudget`/`splitTurns` pueden partir el par.
- **Critic:** APROBADO CON CAMBIOS → bloqueantes **B1** (ciclo T15↔T16 en el DAG), **B2** (archivos de
  regresión sin dueño) y **B3** (AMEND incompleto: `serializeConversation` descarta el vínculo legal),
  más mayores M1–M8 (fuentes de verdad duplicadas, guard esquivable por copiar/exportar, presupuesto del
  brief, sobrecarga de `researchMode`, `ToolErrorCode`) y altos A2–A10 del Challenger.

## Remediación aplicada (plan v2)

Todo lo anterior quedó resuelto y mapeado en `.agents/legal_mode_plan.md` **§12** (tabla
hallazgo → solución → dónde). Cambios estructurales: 6 hitos → **4 hitos + 3 gates**; 34 → **24 tareas**;
nueva **T11** de hardening como prerrequisito; **fuente única** para el vínculo caso↔conversación
(`Conversation.legalCaseId`) y para los packs (store IDB `legalPacks`); seam **`ephemeralSuffix`** fuera
del presupuesto de historial; parámetro aditivo **`enableTools?`**; guard en copiar/exportar/print +
verificación de fidelidad verbatim; export Android por portapapeles (sin prometer `print()` en WebView);
protocolo de curación de corpus por fases + **gap report**; DoD medibles con golden set.

## Auditoría de integridad de los artefactos (agente raíz)

Ejecutada sobre `.agents/legal_mode_board.json` (script Node independiente):

```
tasks=27 | idsUnicos=true | badDeps=0 | ciclos=0 | archivosDobles=0 | waveInconsistente=0
tasksFueraDeMilestones=[] | depsInexistentesEnMilestones=[]
idsDeTareaNoMencionadosEnPlan=[]
```

- `git status` → solo aparecen los 4 artefactos nuevos en `.agents/`; **0 cambios** en código de producto.
- Baseline re-verificado por el Challenger: `pnpm exec tsc -b` exit 0 y `pnpm test` → **91 archivos /
  956 tests verdes** (coincide con el plan; `architecture.md` y `teamwork_progress.md` están
  desactualizados y deben corregirse cuando se implemente).

## Enmienda v2.1 (pedido del usuario, posterior al gate)

Requisito: el modo legal **no** puede depender del primer inicio; debe poder activarse desde Ajustes **y
desde el chat**, con un botón que abra un menú (tipo hamburguesa) con las opciones de modo y sus
**combinaciones**.

- Nueva decisión **D17** y nueva tarea **T27** (`ModesMenu` + `CaseLinkDialog` en la cabecera del chat).
- Modos **ortogonales y por conversación**: `Conversation.researchMode` (Investigación) ×
  `Conversation.legalCaseId` (Legal) → General / Investigación / Legal / **Investigación + Legal**.
- Tres vías de activación **no excluyentes**: onboarding (default), Ajustes (`WorkModeSection`) y chat.
- Reasignaciones para no dejar archivos sin dueño ni con doble dueño: `ChatPage.tsx` pasó de T21 a T27;
  el guard de T21 se monta vía hook (`useCitationGuard`); `chat.ts` quedó intacto y las claves nuevas van
  al dict `modes.ts`. Se agregó `setLegalCase` a T20.
- Decisión de §10 "modo global vs por conversación" → **RESUELTA**. M3 pasa de `L` a `L+`.
- Re-auditado: `tasks=28`, ids únicos, `badDeps=0`, `ciclos=0`, `dupFiles=0`, `waveBad=0`,
  todas las tareas dentro de un hito y sin ids inexistentes.

## Ejecución — M0–M3 + remediación G1 (aplicado por pedido del usuario: "Aplicalo")

Configuración: route teamwork standard, `development`, propiedad exclusiva de archivos por worker, gate real del
Auditor (agente raíz) al cerrar cada wave. Defaults aprobados: Nacional + CABA, corpus curado verificado,
InfoLEG/BO, anonimización obligatoria.

| Wave | Tareas | Archivos | Gate |
|---|---|---|---|
| 0 | T01 (tipos+puertos), T11 (hardening del agente) | `domain/types/legal.ts`, `ports/Legal*`, `runAgent.ts`, `buildWireMessages.ts`, `selectHistoryByBudget.ts`, `types/chat.ts` | `tsc -b` ✓ · **972** tests |
| 1 | T02 (packs+SHA-256), T05 (plazos+redacción), T07 (plantillas+prompt+brief), T10 (settings legal) | `domain/legal/{hash,packs,deadlines,redaction,document,prompt,brief,rules/**,templates/**}`, `domain/settings/**` | `tsc -b` ✓ · **1050** tests |
| 2 | T03 (retrieval BM25), T04 (citation guard) | `domain/legal/{retrieval,citation}.ts` | `tsc -b` ✓ · **1093** tests |
| 3 | T09 (orquestación adversarial) | `domain/legal/adversarial.ts` | `tsc -b` ✓ · **1107** tests |

**M0–M3 COMPLETE + remediación G1 verificada.** Baseline 956 → **1356 tests** (+400),
`pnpm exec tsc -b` exit 0 en cada gate, `pnpm build` OK en M1/M3. Cero archivos
fuera de `allowedFiles`; cero dependencias nuevas (salvo `firebase`, aprobado aparte
para Hosting + Auth: ver `docs/firebase.md`).

### Ajustes de alcance detectados durante la ejecución (gobernanza)

Archivos que necesitaban cambio y no tenían dueño, autorizados y reasignados antes de tocar:
`src/domain/types/index.ts` → T01; `src/domain/types/chat.ts` → T11 (union aditivo `not_executed`);
`src/domain/settings/defaults.test.ts` → T10. Todos anotados en el board (0 archivos con doble dueño).

### Valor ya visible en la app (no sólo dominio legal)

T11 arregla un **bug real preexistente**: `runAgent` dejaba `tool-call` sin `tool-result` en los cortes por
aborto/presupuesto/doble fallo, lo que rompía proveedores OpenAI-compatible (`No tool output found for
function call`). Ahora todo call se cierra y `buildWireMessages` repara historiales ya corruptos.

## Remediación G1 (gate RECHAZADO → remediado y re-verificado)

El tribunal (Critic + Challenger + Bug-hunter) rechazó con hallazgos convergentes y
verificados por el Auditor contra el código. Todo remediado en F01–F03 con tests de
regresión en el archivo dueño, re-gate verde (`tsc -b` 0 + 1356 tests):

| Hallazgo | Severidad | Remediación | Dónde |
|---|---|---|---|
| R-1: el brief enviaba el caso CRUDO al wire (nombres, domicilios, CUIT en crudo; lo redactado era sólo un apéndice) | Crítica | `redactLegalCase()` + brief construido SÓLO desde el caso redactado; mapping sólo en memoria (`redactionMappings` + `getRedactionMapping`); test innegociable "0 PII en el wire" | `redaction.ts`, `brief.ts`, `chatStore.ts` + tests |
| I-1/B18/H2: `CitationGuardProvider` sin montar en producto (guard neutro) | Crítica | Provider montado en `ChatPage` y `LegalPage` con índice resuelto; `MessageList` aplica guard SÓLO en modo legal | `ChatPage.tsx`, `LegalPage.tsx`, `MessageList.tsx` |
| R-2/B17/H3: `Composer` sin prop `legal` (sin preview ni consentimiento) | Crítica | `ChatPage` cablea la prop completa (conteos del mapping + consentimiento persistido en el caso); integración `getRedactionMapping`→`MessageList`/`Composer` hecha por el Auditor | `ChatPage.tsx`, `MessageList.tsx` |
| H1/I-4: `AdversarialPanel`/`DocumentStudio` sin montar; `syncFromManifest` sin llamador | Alta | Placeholders reemplazados con `executeCall` real; sync+`ensureIndex` en el mount de `LegalPage` | `LegalPage.tsx` |
| C-1/C-2/C-3: fidelidad evadible (simples, ventana 200, `inc. b`) | Alta | Comillas simples, fallback 1000 chars, calificadores con rótulo; límites documentados | `citation.ts` + test (28→40) |
| B19: `setLegalCase` sin validar + `remove` sin desvincular | Mayor | Validación con `lastError`; `remove` desvincula (best-effort) | `chatStore.ts`, `caseStore.ts` + tests |
| B1/B2: `tool-end` sin `tool-start`; ids duplicados | Media | Start sintético + reescritura `<id>__dup<N>` | `runAgent.ts` + test |
| B4: calibración excluía el sufijo efímero | Media | `estimatedPromptTokens` incluye `ephemeralTokens`; ventana protegida por `reservedTokens` (documentado) | `runAgent.ts` + test |
| B13: memo del índice sin hash | Media | Clave `id@version@hash` | `LegalCorpus.ts` + test |
| B26: doble toggle con carrera | Media | Secuencias por dimensión | `chatStore.ts` + test |
| Desvíos plan↔código (§A7 sintetizar-vs-descartar; §A8 `'not_executed'`) | Docs | Registrados como decisiones implementadas (ver §4 AMEND) | plan §4/§12 |

 low y sospechas del Bug-hunter no bloqueantes → backlog documentado en
`.agents/legal_mode_review_g1_bughunter.md` (B10, B15, B20, B23, B27–B29, B31, B34,
B37 y 10 sospechas con su test de confirmación).

## G2 — Auditoría de integridad: APROBADO CON CAMBIOS (H-01 cerrado)

Informe: `.agents/legal_mode_review_g2_audit.md`. Comandos reales ejecutados por el
Auditor: `tsc -b` exit 0, `pnpm test` **120/1356** verdes, `verify-packs.mjs` exit 0,
`pnpm build` exit 0. Corpus: 16.403 bytes (3,2% del tope), 12/12 provisiones trazables,
licencia documentada, 0 textos en el bundle inicial. 0 secretos (sólo fixtures falsos),
0 PII real, 0 `console.*`, 0 TODOs, 0 `any` en alcance legal.
Hallazgo H-01 (DoD §5.1 sin medición automatizada) → cerrado por el Auditor con test
de recall en `src/adapters/legal/corpus.test.ts` (**recall real 95%, 19/20**; el miss
es legítimo: falta el art. 2561, cuyo texto completo no está verificado y no se publica).

## G3 — Aceptación final: ACCEPTED WITH NOTES

Veredicto: `.agents/legal_mode_review_g3_verdict.md`. ACCEPTED en M0/M1/M2/M3, G1 y G2.
Notas principales: (1) es un asistente de **borradores**, no un abogado; (2) sólo conoce
**12 artículos de 3 normas** y marca `[VERIFICAR]` en vez de inventar; (3) verificar
siempre contra el texto oficial; la anonimización no cubre apodos ni menciones indirectas.

## Estado final

`COMPLETE` — **Modo Legal MVP implementado, auditado y aceptado.** Tablero: 31 tareas,
0 pendientes. Suite: **120 archivos / 1358 tests** verdes, `tsc -b` limpio, `pnpm build` OK.
Cambios sin commitear (modo legal + Firebase Auth): pendientes de commit/push a decisión
del usuario.
