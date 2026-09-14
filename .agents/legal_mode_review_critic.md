# legal_mode_review_critic.md — Revisión independiente (Critic)

> Alcance: `.agents/legal_mode_plan.md` + `.agents/legal_mode_board.json` contra
> `.agents/teamwork_architect_spec.md` (contratos congelados), `architecture.md` y el código real.
> No se modificó el plan, `src/` ni código. Baseline verificado en esta revisión:
> `pnpm exec tsc -b` exit 0; `pnpm test` **91 archivos / 956 tests / 0 fallos** (13.6 s).
> Fecha: 2026-09-14.

## Veredicto: APROBADO CON CAMBIOS

El plan es sólido, honesto en su framing y respeta la arquitectura hexagonal. Sin embargo, **no es
ejecutable tal como está** sin tocar 3 fuentes de verdad duplicadas, cerrar el círculo del citation
guard y corregir 2 defectos del DAG/board (dependencia circular y archivos de regresión sin dueño).
Ninguno es irreparable desde el plan; por eso no lo rechazo. Los hallazgos **B1–B3, M1–M8** son
condición de arranque; el resto son mejoras.

---

## Hallazgos

| ID | Sev | Hallazgo | Evidencia | Corrección propuesta | Sección del plan |
|---|---|---|---|---|---|
| B1 | **BLOQUEANTE (DAG)** | `T15` y `T16` se necesitan mutuamente: T15 exige el fake de T16 para su DoD y T16 declara a T15 como dependencia. Una wave no puede cerrar verde. | `board.json` T15: `deps [T13,T14]`, DoD «Contrato corre contra real y fake (T16)»; T16: `deps [T15]`, DoD «Contrato T15 verde contra `MemoryLegalCaseRepository`». | Mover T16 (fakes) a wave 4 y T15 a wave 5 con `deps [T13,T14,T16]`; o separar la suite en `describeLegalRepositoryContract` (sin fake) + test de paridad que importa T16. | §6 DAG / §5 M1 |
| B2 | **BLOQUEANTE (board)** | El plan modifica archivos de regresión que **ningún task posee**, garantizando waves rojas: `SettingsPage.test.tsx:76` afirma «muestra las seis secciones» y T27 agrega la séptima sin dueño; `wizardReducer.ts` (paso legal, D3) no está en `allowedFiles` de T26. | `src/features/settings/SettingsPage.test.tsx:76`; `src/features/onboarding/state/wizardReducer.ts:4-8` (`WIZARD_STEPS = ['provider','key','model']`); ownership verificado: `SettingsPage.test` y `wizardReducer` = *NOT OWNED*. | Añadir `SettingsPage.test.tsx` a T27 (o T34) y `wizardReducer.ts` + `wizardReducer.test.ts` a T26; o ubicar el setup legal fuera del reducer. Especificar el hook de onboarding. | §6 T26/T27 |
| B3 | **BLOQUEANTE (contratos)** | `AMEND §A1–§A4` está incompleto: no declara `ConversationArchive`/`conversationToMarkdown`, que enumeran campos de `Conversation` y descartan `legalCaseId` (pérdida silenciosa del vínculo legal en export/import). | `src/domain/chat/serializeConversation.ts:5-16` (`ConversationArchive`) y `:67-80` (`conversationToArchive`); spec §5 fija `Conversation` como congelado. | Añadir **§A5**: `ConversationArchive.legalCaseId?: string` opcional + lectura tolerante en `parseConversationArchive`; o declarar explícitamente que el vínculo no se exporta (peor). | §4 AMEND |
| M1 | Mayor | **Doble enlace caso↔conversación.** `LegalCase.conversationId` **y** `Conversation.legalCaseId` se escriben por caminos distintos → pueden divergir. | Plan §4 `LegalCase.conversationId` (l.282) y puerto `findByConversationId` (l.415); T28 invariant «Conversación creada y linkeada vía `update()`» (`board` T28). No hay test de consistencia. | Fuente única = `Conversation.legalCaseId`. **Eliminar** `LegalCase.conversationId` y `findByConversationId` del puerto (la lista «abrir chat del caso» filtra conversaciones por `legalCaseId` en memoria). Si se conserva, **obligar** test bidireccional en `describeLegalRepositoryContract`. | §4 D2/D15, §6 T28 |
| M2 | Mayor | **`settings.legal.packs` vs store IDB `legalPacks`.** Dos fuentes de verdad de «packs instalados»; localStorage sobrevive a una evicción de IndexedDB y quedan packs fantasma. | Plan §4 `LegalSettings.packs: InstalledPack[]` (l.395) y §3 store `legalPacks` (l.221) + `LegalPackStore.listInstalled()` (l.424). | Fuente única = IDB `legalPacks`. Quitar `packs` de `LegalSettings`; si hace falta estado rápido, guardar solo `disabledPackIds?: string[]`. Elimina además el saneo de packs en `migrateLegal`. | §4 D4/D15, §6 T11 |
| M3 | Mayor | **Jurisdicción/fuero/materia global vs por caso.** Se leen en retrieval/plazos sin definir precedencia → el análisis puede usar la jurisdicción equivocada. | Plan §4 `LegalSettings.jurisdiction/fuero/materia` (l.394) vs `LegalCase.jurisdiction/fuero/materia` (l.280). | Renombrar el global a `defaultJurisdiction/defaultFuero/defaultMateria` (defaults de *nuevos* casos) y declarar `LegalCase.*` como única fuente en runtime de un caso. | §4 D1/D15 |
| M4 | Mayor | **El citation guard se esquiva en copiar/exportar/imprimir.** El usuario copia el texto crudo del chat o exporta la conversación legal sin marcadores. | `MessageList.tsx:117` calcula `messageText` crudo y lo pasa a `MessageActions` → `CopyButton.tsx:32` (`writeText(text)` sin guard); `conversationsStore.ts:197-209` → `conversationToMarkdown` (`serializeConversation.ts:19`) → `ConversationsPanel.tsx:86-89` `downloadTextFile`; `window.print()`. Ninguno aplica `applyCitationMarkers`. | (a) Render legal con `applyCitationMarkers`; (b) `CopyButton` en contexto legal copia el texto post-guard; (c) `conversationToMarkdown`/export legal aplica guard + watermark + disclaimer; (d) editor de documento ejecuta guard al pegar/importar; (e) bloquear export/print hasta reconocimiento. Requiere ownership de `MessageList.tsx`, `serializeConversation.ts`, `conversationsStore.ts` (hoy sin dueño). | §2 D9, §4 |
| M5 | Mayor | **El guard valida existencia, no fidelidad.** Una cita a un artículo **real** con texto inventado pasa `verified`; el plan afirma «el sistema no inventa artículos» (demasiado fuerte). | `verifyCitations` compara `(normId, article)` contra el índice (plan l.336-346); no hay comparación semántica/verbatim. | Reformular la garantía: «no cita normas ausentes del índice». Mostrar el texto de la provisión junto a cada cita (`cite_article`/`get_legal_passage`) y marcar como `[VERIFICAR]` todo entrecomillado que no sea substring verbatim de la provisión. | §2 D9, §8 riesgo 1 |
| M6 | Mayor | **Inyección del brief y presupuesto contradictorios.** D7 dice «solo para el wire» y D14 «nunca se evicta»; si el brief no entra en `history`, `estimatedPromptTokens` no lo cuenta y puede desbordar la ventana. | `selectHistoryByBudget.ts:101-149` solo cuenta `input.history` + system + user; `chatStore.ts:545` pasa `applyCompaction(input.history, conversation)`. | Fijar el punto: **append del brief a `history` después de `applyCompaction`** (así se cuenta y, al ser el último turno, no se evicta). Test de regresión: brief gigante + historial largo no excede presupuesto y el brief aparece en el wire. | §2 D7/D14 |
| M7 | Mayor | **D8 sobrecarga un concepto congelado.** `researchMode` significa «scaffold de investigación» en el system prompt, pero se reusa como «gate de tools» legal. | Gate: `runAgent.ts:143` (`p.researchMode && capabilities.toolCalling && p.model?.supportsTools !== false`); el scaffold se decide aparte en `chatStore.ts:544,956-961`; `researchMode` efectivo es una conjunción de 4 condiciones en `chatStore.ts:499-504`. | Param aditivo opcional `enableTools?: boolean` en `RunAgentParams` (mismo patrón AMEND que `model?`, `runAgent.ts:57-64`): gate = `(p.enableTools ?? p.researchMode) && …`. Coste mínimo y backward-compatible; conserva la semántica de `researchMode`. | §2 D8, §4 §A2 |
| M8 | Mayor | **`ToolErrorCode` no cubre «provisión ausente del índice».** El plan afirma que no cambia, pero no define el resultado de las tools legales ante not-found. | Union real ya divergió de la spec: `chat.ts:17-28` agrega `invalid_proxy/missing_proxy/denied`; `runAgent.ts:560-572` mapea **todos** los miembros (record exhaustivo). `board` frozenContracts: «`ToolErrorCode` NO cambian». | Devolver **`ok:true` con contenido explicativo** cuando la provisión no está en el corpus (es un resultado normal, no error) y reservar `invalid_args` para args malformados. Si se quiere error tipado, declarar **§A6** añadiendo p.ej. `not_found` **y** actualizar `TOOL_FAILURE_MESSAGE_CODES`. | §2 D13, §4 |
| m9 | Menor | **`legal.ts` con dueño único (T21) vs UI T30–T33** que necesitan decenas de claves; T21 no puede preverlas. | `board` T21 `allowedFiles=['src/i18n/dicts/legal.ts']`; i18n descubre `dicts/*.ts` (`i18n/index.ts:35-47`). | Partir el dict por subfeature y asignarlo a cada task de UI (`legal-cases.ts`, `legal-analysis.ts`, `legal-docs.ts`, `legal-privacy.ts`). | §3, §6 |
| m10 | Menor | **Vocabulario de dominio mezcla español en entidades persistidas** mientras el repo usa unions en inglés + i18n para UI. | Repo: `ToolErrorCode`, `Role`, `SearchMode` en inglés; plan §4: `status:'activo'|'archivado'`, `strength:'alta'|'media'|'baja'`, `leaning:'favorable'|'desinformativa'…`. | Valores canónicos en inglés (`active/archived`, `high/medium/low`, `favorable/unfavorable/unclear`) y etiquetas es/en vía i18n. Aplica D16. | §4, §2 D16 |
| m11 | Menor | **Hash «best-effort» sin política.** Si falta `crypto.subtle`, no se puede verificar y el plan no define qué hacer. | Plan §3 `packVerifier.verifyPackHash` «SHA-256 best-effort» (l.220). | Política explícita: sin verificación de hash, el pack **no** se marca `verified` y se avisa; nunca instalar como verificado. | §2 D4, §8 |
| m12 | Menor | **Licencia afirmada sin verificar** («InfoLEG CC BY 2.5 AR»). Riesgo legal del corpus. | Plan §1.13 (l.42) y §8 (l.533). | Verificar términos reales antes de publicar (los textos normativos oficiales suelen no estar sujetos a copyright, Ley 11.723) y registrar la decisión en `docs/legal-packs.md`. | §1, §8 |
| m13 | Menor | **Conteos y baseline inconsistentes entre documentos.** | `architecture.md:34-36` dice 87/926; `teamwork_progress.md:10` dice 76/718; el plan dice 91/956. Medición de esta revisión: **91/956 verdes**. | Actualizar `architecture.md` al cerrar M0 (ya está en T34) y explicitar que 91/956 es el baseline real. | §7 nota |
| m14 | Menor | **Conteos del plan/board imprecisos**: «37 tareas» = 34 de producto + G1–G3 (el board lista 37 entradas). «6 hitos» omite las 3 gates (el board tiene 9 entradas M0–M5+G1–G3). | `board.json` `tasks.Count = 37` (incluye G1/G2/G3); milestones = 9. | Corregir a «34 tareas + 3 gates; 6 hitos + 3 gates». `LegalCaseRepository` tiene **12** métodos (plan l.409-422), no 11. `ConversationRepository` tiene **11** (no 17): `ConversationRepository.ts:5-18`. | §5, §6 |
| m15 | Menor | **M4 comparte wave 8 con M3** y **M1 (T16, wave 5) termina después de que M2 (T19/T22, wave 4) arranca**: la verificación por hito se solapa. | `board` waves T31/T32/T33 = 8; T16 = 5 > T19/T22 = 4. | Gate por milestone real (no por wave global) o reordenar T16 a wave 4 (coincide con B1). | §6 |

---

## Confirmaciones (lo que el plan acierta)

- **§A1 es correcto**: `create()` no puebla `legalCaseId` ⇒ el `toEqual` del contrato ignora propiedades opcionales ausentes y sigue verde en real y fake.
  Evidencia: `conversationContract.ts:26-44` y `MemoryRepos.ts:40-57`.
- **§A3 es de bajo riesgo**: `services.test.ts` no fija la forma del objeto `AppServices`, y `chatTestHarness.ts:121-135` construye un literal que sigue compilando con campos opcionales.
- **§A4 es necesario**: `idb.ts:7,45-54` fija `DB_VERSION=1` con upgrade idempotente; subir a 2 con `contains()` es el patrón correcto.
- **`ToolRegistryDeps` no se toca**: `ToolRegistry` es una interfaz plana (`types/tools.ts:118`), así que la composición de registries es viable sin ampliar deps.
- **`needsOnboarding` intacto (D3)**: `session.ts:10-14` depende solo de `activeProviderId === null`; la propuesta no lo secuestra.
- **`mergeSettings` debe enumerar `legal`**: `settingsStore.ts:514-527` reemplaza secciones anidadas; un `...patch` de `legal` parcial destruiría subcampos. El plan lo advierte.
- **`migrateSettings` enumera claves explícitas** (`migrate.ts:40-55`): si T11 olvida `legal`, la sección se pierde en cada load/save. Mantener el test «legal corrupto → defaults».

---

## Recorte recomendado del alcance

**MVP mínimo útil y honesto (4 hitos + gates, ~22–24 tareas):**

| Hito fusionado | Contenido imprescindible | Sale del plan actual |
|---|---|---|
| **M0 — Dominio** | tipos legales, packs+hash, retrieval BM25, citation guard, reglas de prescripción verificadas, redaction, settings | igual, sin `TimelineCalendar` |
| **M1 — Persistencia + corpus curado** | IDB v2 (cases/documents/analyses/packs), repos real+fake, contrato, loader/verifier, corpus **núcleo curado** (no 3 packs sueltos) | `plazo_calc` |
| **M2 — Integración de chat** | 2–3 tools (`legal_search`, `cite_article`; `get_legal_passage` fusionado en search), scaffold + brief, turno legal, switch de settings | `composeToolRegistries` si >20 líneas |
| **M3 — Adversarial + documentos + confianza + onboarding** | 4 personas + síntesis; 2–3 plantillas (demanda, contestación, carta-documento) con guard+watermark; `#/legal`; preconfig legal en el primer inicio; i18n y docs | ver abajo |

**A fase 2 (diferir/eliminar sin perder el pedido):**

- **`TimelineCalendar` UI** y el motor de plazos **con UI**: conservar `computeDeadline`/`prescription` puros + tests, pero sin calendario ni tool `plazo_calc`. El usuario pidió conocimiento, documentos de ataque/defensa y postura del juez, **no** un calendario.
- **`PrivacyPanel` como componente**: conservar `redaction` obligatoria y un preview compacto «qué sale del dispositivo» embebido en el composer; el panel dedicado es fase 2.
- **`settings.legal.perspectives` / `defaultTemplates` configurables**: fijar las 4 personas y 3 plantillas en MVP (YAGNI).
- **Jurisdicciones PBA/Córdoba**, jurisprudencia, OCR/PDF, `.docx`, manifiesto remoto.
- **`LegalPackStore.get`/`remove`** si el MVP solo instala el manifiesto del repo: reducir el puerto a `listInstalled/install`.

**Estrategia de corpus/curación por fases (responde a «cargar todo el conocimiento necesario»):**

- **Fase 1 (MVP, verificable):** packs curados por *casos de uso de una demanda/contestación típica*, no por código completo: CCyC (obligaciones, contratos, responsabilidad, prescripción, familia/sucesiones mínimo), CPCCN (estructura procesal núcleo), LDC, y las normas que el golden set exija. Cada provisión con `sourceUrl`+`sourceDate`+`hash`; 0 `verified:false` en packs publicados.
- **Fase 2 (usuario):** importación de normativa provincial y jurisprudencia propia como texto con `verified:user` y fuente obligatoria; nunca redistribuida. Botón "Agregar normativa" que produce un pack local firmado por hash.
- **Fase 3 (medición → backlog):** `legal_search` sin resultados emite un **gap report** local (norma/artículo faltante) que alimenta el próximo pack. Es la métrica que convierte «cargar todo» en un objetivo gestionable.

**Objetivo medible (Definition of Success), por fuente de conocimiento:**

1. Golden set de **30 escritos típicos** anonimizados: **≥80%** de sus citas normativas resuelven en el corpus instalado; el resto aparece en el gap report.
2. **0** citas `verified` fuera del índice (test de propiedad sobre el golden set).
3. **100%** de las provisiones publicadas con `sourceUrl` + `sourceDate` + `hash` válido.
4. **100%** de los documentos exportados con watermark + contador `verified/unverified`.
5. System prompt **byte-idéntico** en 10 turnos legales consecutivos (hash igual).
6. **0** tokens de PII en payloads de wire para 20 fixtures de redaction.
7. `tsc -b` + `test` (+ `build` en M1/M3) verdes por hito; baseline **91/956** re-verificado al abrir M0.

---

## Ética/profesionalismo del framing (M4/M5 ampliado)

El plan blinda lo básico (disclaimers no descartables, `[VERIFICAR]`, anonimización, sin telemetría,
«no genera escritos listos para presentar»). Falta blindar la **circulación** del documento de ataque:

1. **Watermark en render y en todo export**: «BORRADOR DE TRABAJO — uso interno letrado — no presentar sin revisión — {fecha} · {verified}/{unverified}».
2. **Doble confirmación con registro de consentimiento**: modal que enumera las citas `unverified` y exige tipear/confirmar; se persiste un `AcknowledgmentRecord {caseId, documentId, at, unverifiedCount, hashContent}` en IDB (append-only). Sin él, export/print/copy permanecen bloqueados.
3. **Separación visual ataque vs presentable**: los ítems de `AdversarialPerspective:'attack'` se muestran como **estrategia interna** (banner «No citar al cliente/contraparte»), nunca fusionados con el documento presentable.
4. **Marcas en el nombre de archivo** (`INTERNO_…`) y footer con el aviso en el Markdown exportado y en la vista de impresión.
5. **Cierre del círculo técnico** (M4): guard también en pegar/importar (DocumentStudio) y en el export de conversación (`serializeConversation`), para que no exista una ruta sin marcadores.

Con esto, el mal uso deja de depender del criterio del usuario en el momento de copiar.

---

## Top 5 mejoras

1. **Fuente única de verdad** en los 3 pares detectados: quitar `LegalCase.conversationId`, quitar `settings.legal.packs`, renombrar el global a `default*` (B/M1–M3). Resuelve 3 olores a bug y simplifica `migrate`/`mergeSettings`.
2. **Cerrar el citation guard** con ownership de `MessageList.tsx`, `CopyButton`/`MessageActions`, `serializeConversation.ts` y `conversationsStore.ts`; y reformular la garantía a «no cita normas ausentes del índice» (M4/M5), con watermark + registro de consentimiento.
3. **Reparar el board**: invertir T15/T16, asignar `SettingsPage.test.tsx` y `wizardReducer.ts`, partir los dicts legales por subfeature (B1/B2/m9) y declarar **§A5** (`ConversationArchive.legalCaseId`, opcional) y **§A6** (política de not-found).
4. **Reemplazar la sobrecarga de `researchMode` por `enableTools?` aditivo** (M7): mismo coste que el AMEND actual, sin degradar la semántica de un concepto congelado.
5. **Corpus por fases con gap report y objetivo medible** (≥80% del golden set), más el recorte de M3+M4+M5 a un solo hito (m12/M12 y recorte).

---

## Verificaciones realizadas

- Leídos: `.agents/legal_mode_plan.md`, `.agents/legal_mode_board.json`, `.agents/teamwork_architect_spec.md`, `architecture.md`, `.agents/teamwork_progress.md`.
- Código real: `types/{conversation,chat,settings}.ts`, `ports/{ConversationRepository,index,ToolPermission}.ts`, `settings/{defaults,migrate}.ts`, `chat/{serializeConversation,buildWireMessages,selectHistoryByBudget}.ts`, `agent/{runAgent,systemPrompt}.ts`, `adapters/storage/{idb,conversationContract}.ts`, `adapters/tools/index.ts`, `app/services.tsx`, `app/routing.tsx`, `features/chat/state/{chatStore,__fixtures__/chatTestHarness}.ts`, `features/chat/components/{MessageList,MessageActions}.tsx`, `features/settings/state/settingsStore.ts`, `features/settings/{SettingsPage.tsx,SettingsPage.test.tsx}`, `features/conversations/{ConversationsPanel.tsx,state/conversationsStore.ts}`, `features/onboarding/{session.ts,state/wizardReducer.ts}`, `shared/markdown/{Markdown,CopyButton}.tsx`, `test/fakes/MemoryRepos.ts`, `i18n/index.ts`, `package.json`, `vite.config.ts`.
- Ejecutado: `pnpm exec tsc -b` → **exit 0**; `pnpm test` → **91 archivos / 956 tests passed / 0 fallos** (baseline del plan confirmado; `architecture.md` y `teamwork_progress.md` están desactualizados).
- Board verificado programáticamente: **37 entradas de task** (34 de producto + G1–G3), **0 archivos con doble dueño**, milestones M0=12, M1=8, M2=6, M3=4, M4=2, M5=2 (+G1/G2/G3). Archivos clave sin dueño confirmados: `SettingsPage.test.tsx`, `wizardReducer.ts`, `services.test.ts`, `conversationContract.ts`, `serializeConversation.ts`, `conversationsStore.ts`, `MessageList.tsx`.
