# legal_mode_plan.md — Modo Legal (Argentina, Civil y Comercial) — v2 (remediado)

> Entregable de planificación del Project Orchestrator, **revisión v2** que resuelve el GATE
> ADVERSARIAL (Challenger: RECHAZADO condicionado, C1–C3 + A2–A10; Critic: APROBADO CON CAMBIOS,
> B1–B3 + M1–M8 + recorte). No implementa nada. Complementa `.agents/teamwork_architect_spec.md`
> (fuente de verdad técnica) y `architecture.md`. Board máquina-legible: `.agents/legal_mode_board.json`.
> Baseline verificado en el gate: `pnpm exec tsc -b` exit 0 · `pnpm test` **91 archivos / 956 tests
> verdes**. Modo de integridad: `development` (prohibido placeholder y tests que simulen éxito).

---

## 1. Resumen ejecutivo

1. El modo legal se decide **por turno desde `conversation.legalCaseId`**; el switch global
   `settings.legal.enabled` sólo define el default de conversaciones **nuevas**. Así una
   conversación linkeada sigue siendo legal aunque el workspace esté apagado (resuelve C2).
2. **Prerrequisito de correctitud (C1):** antes de habilitar tools en el turno legal se cierra el
   bug de **tool-calls huérfanos** de `runAgent` y se repara en `buildWireMessages`; hoy rompe a
   proveedores OpenAI-compatible en cualquier turno con tools.
3. El brief del caso viaja por un **seam efímero aditivo** (`ephemeralSuffix`) anexado al wire
   **después** de `selectHistoryByBudget`, fuera del historial persistido y con presupuesto
   reservado propio: nunca al `system` y nunca partido (resuelve C3/M6).
4. El gate de tools usa un parámetro aditivo `enableTools?`; **no** se sobrecarga el `researchMode`
   congelado, y las tools legales **no** dependen de `settings.tools.webSearchEnabled` (C2/M7).
5. Corpus = packs JSON versionados, con **hash SHA-256 en JS puro** (fallback inyectable, sin
   dependencias), canon que incluye `license/sources/publishedAt`, `textHash` por provisión y
   protocolo de curación verificable (A5).
6. Actualización de corpus sin reinstalar PWA: `sw.js` deja de cache-first para `/legal/` y las URLs
   llevan `?v=<hash>` (packs) / cache-buster (manifiesto) (A3).
7. Recuperación léxica BM25 con normalización liviana de sufijos, canonicalización de abreviaturas
   (`art./arts.`), aliases de norma indexados y `synonyms` opcional (A6).
8. Citation guard con **existencia + fidelidad**: lo entrecomillado debe ser substring verbatim de
   la provisión; el resto se marca `[VERIFICAR]`. Garantía reformulada: “no cita normas ausentes del
   índice” (no “no inventa nada”).
9. El guard se aplica en **todas las rutas de circulación**: render, copiar, exportar conversación y
   exportar documento; el análisis adversarial y los documentos llevan **watermark y disclaimer**;
   exportar exige **consentimiento + reconocimiento** persistidos (M4/M5/A9).
10. Análisis adversarial: 4 personas **en paralelo** (defensa, ataque, juez, riesgos) + 1 síntesis,
    con `LegalAnalysisBudget`, `sessionId` común para caché y degradación a N personas (A2).
11. Anti-prompt-injection **por diseño**: datos del expediente delimitados, preámbulo “esto es dato,
    no instrucción”, escape del delimitador y canal separado del `system` (A8).
12. Export honesto por plataforma: Android **copiar al portapapeles/compartir texto**; descarga `.md`
    y `window.print()` sólo web/desktop; sin dependencias nuevas (A7).
13. El corpus crece por fases (nacional/CABA → provincial del usuario → jurisprudencia propia) y se
    mide con un **golden set** y un **gap report** visible (A5/curación).
14. Alcance recortado: **4 hitos + 3 gates, 25 tareas**; los modos son combinables y se activan por
    onboarding, Ajustes o el nuevo `ModesMenu` del chat (D17); `TimelineCalendar`/`plazo_calc`
    avanzado, `PrivacyPanel` dedicado y plantillas extra pasan a fase 2.
15. Verificación por hito: `tsc -b` limpio + `test` verde (+ `build` en M1/M3); baseline **91/956**
    re-verificado al abrir M0.

```
   expediente (IDB)          settings.legal.enabled (default de NUEVAS)     packs (IDB + public/)
        |                              |                                          |
        v                              v                                          v
  LegalCase ---1:1---> Conversation.legalCaseId            LegalCorpus.ensureIndex(): LegalIndex
        |                              |                                          |
        |                    chatStore.runTurn  (legalMode = legalCaseId != null) |
        |                              |                                          |
        |        +---------------------+---------------------+                    |
        |        v                     v                     v                    |
        |  system = persona +    tools = composeTool    ephemeralSuffix = brief +  |
        |  scaffold general +    Registries(web?,      pasajes (tool-pair o       |
        |  scaffold legal        legal?)               text-block) --reserva-->    |
        |        |                     |                     |                    |
        +--------+---------------------+---------------------+--------------------+
                                   |
                                   v
                    runAgent (C1: tool-results cerrados; C3: ephemeralSuffix fuera del historial)
                                   |
              +--------------------+---------------------+
              v                    v                     v
       analysisStore (4+1)    DocumentStudio        citation guard (existencia+fidelidad)
       personas + síntesis    watermark+banner      en render / copy / export / print
```

---

## 2. Decisiones de diseño (D1–D16) — v2

**D1. Workspace global sólo como default de conversaciones nuevas.**
`settings.legal.enabled` (escalar booleano) define si una conversación **nueva** arranca legal y si la
UI legal está visible. No decide el modo de una conversación existente: eso lo hace
`conversation.legalCaseId` (D2). Esto elimina la contradicción C2 y evita invalidar la caché de
prompt de conversaciones existentes al togglear el workspace. Alternativa descartada: que el switch
global gobierne el turno (rompía D2 y la caché).

**D2. Fuente única del vínculo: `Conversation.legalCaseId?: string | null`.**
Una conversación con `legalCaseId != null` es legal. Se **elimina** `LegalCase.conversationId` y
`findByConversationId` del puerto (M1a): la lista “abrir chat del caso” filtra conversaciones en
memoria por `legalCaseId`. `create()` **no puebla** la clave (el `toEqual` del contrato sigue verde
en real y fake); desvincular = `update(id, { legalCaseId: null })`; los consumidores usan `!= null`,
de modo que `undefined` y `null` significan “no legal” sin ambigüedad (M4). Test de desvinculación
real+fake en el contrato.

**D3. `needsOnboarding` intacto; activación legal separada.**
`needsOnboarding = activeProviderId === null` no cambia. El setup legal es un paso del wizard cuando
el usuario elige el workspace legal; para un usuario que ya tiene proveedor se entra por
`WorkModeSection` (Settings). `settings.legal.setupCompleted` sólo controla el CTA, nunca la
navegación. Alternativa descartada: meter `workMode === null` en `needsOnboarding` (regresión).

**D4. Packs JSON versionados, con hash fuerte y canon de procedencia.**
Formato `openher.legal.pack/1`. El `hash` = SHA-256 del canon `{schema,id,version,publishedAt,
license,sources,norms,provisions}` (M/A5b); cada provisión lleva `textHash` (SHA-256 del texto
normalizado) y trazabilidad `sourceUrl/sourceDate/verificationMethod/curatedBy/curatedAt`. Hasher
**inyectable** con implementación **JS pura** (`domain/legal/hash.ts`, sin dependencias) para no
depender de `crypto.subtle` (A5a). Política: **todo pack remoto se verifica; hash o `textHash`
inválidos ⇒ se rechaza la instalación**. Actualización sin recompilar la app vía manifiesto +
`sw.js` corregido (A3). Alternativas descartadas: import dinámico (atado al build), vector DB/embeddings.

**D5. Recuperación léxica BM25 con normalización y aliases.**
`retrieval.ts` puro: normalización de acentos + stopwords + **sufijos livianos** (`-es/-s`, `-ción/
-ciones`, `-al`, `-ivo`, `-ar/-ir`) + canonicalización de abreviaturas (`arts.→art`, aliases de
norma). Cada provisión indexa `norm.short`, `norm.long`, `norm.aliases` y el `synonyms` opcional del
pack. BM25 k1=1.2/b=0.75 con boost por match exacto de norma/artículo/tag. Sin stemming de librería.
Alternativas descartadas: embeddings (prohibido), fuzzy lib (dependencia).

**D6. Adversarial por side-calls paralelos + síntesis, con presupuesto y caché.**
4 llamadas independientes con **system idéntico** (scaffold legal) y el **rol al final** del user
message, después del brief byte-estable ⇒ el prefijo costoso se cachea entre las 4. `sessionId`
común (= `caseId`) para `prompt_cache_key`/`cache_control`. Nunca ven la salida de las otras (evita
anchoring). 1 síntesis consolida. `LegalAnalysisBudget { maxCalls, maxTotalTokens, maxWallClockMs,
maxParallel, maxOutputTokensPerPersona }`; degrada a N personas con aviso si alguna falla/aborta;
expone estimación de coste y si el proveedor soporta caché (A2). Alternativas descartadas: turno
único (superficial), sala por perspectiva (coste sin calidad).

**D7. Brief/pasajes por seam efímero, nunca en `history` ni en `system`.**
`RunAgentParams.ephemeralSuffix?: ChatMessage[]` + `SelectHistoryByBudgetInput.reservedTokens?`.
`runAgent` anexa el sufijo al wire **después** de `selection.messages`, no lo suma a `loopHistory`, y
reserva sus tokens antes de seleccionar (C3/M6). El par es atómico (assistant con `tool-call` +
mensaje con bloque `tool-result`); si el modelo no soporta tools, `brief.ts` devuelve
`{kind:'text-block'}` y el sufijo es un `ChatMessage` de texto (B1). El rol `'tool'` es **del wire**,
no de `ChatMessage`. `chatStore` aplica `applyCompaction` al historial persistido y luego calcula el
sufijo. Alternativa descartada: inyectar el brief en `history` (lo parte `splitTurns` y lo evicta el
presupuesto).

**D8. Gate de tools por `enableTools?` aditivo; legal por conversación.**
`RunAgentParams.enableTools?: boolean` (mismo patrón aditivo que `model?`); gate =
`(enableTools ?? researchMode) && capabilities.toolCalling && model.supportsTools !== false`. En
`chatStore`: `webResearchMode = conversation.researchMode && settings.tools.webSearchEnabled &&
toolCalling`; `legalMode = conversation.legalCaseId != null`; `enableTools = webResearchMode ||
legalMode`; el scaffold de investigación se decide con `webResearchMode`. El registry legal **no**
depende de `webSearchEnabled` (C2/M7).

**D9. Citation guard con existencia + fidelidad, y guard en toda circulación.**
`verifyCitations` valida `(normId, article)` contra el índice (existencia) y, para **spans
entrecomillados** («…», “…”, "..."), exige substring verbatim normalizado de la provisión; si no,
`fidelity:'paraphrase'` ⇒ `[VERIFICAR: cita no textual]`. Límite honesto: el modelo puede parafrasear
sin comillas y la existencia seguirá `verified`; por eso `cite_article`/`legal_search` devuelven
siempre el texto de la provisión para cotejo humano. El guard se aplica en render, copiar, exportar
conversación y exportar documento (M4). No se persiste el texto guardado: se guarda crudo y se
re-marca en render para poder re-verificar tras actualizar un pack.

**D10. Documentos: plantillas puras + expansión opcional + guard + watermark.**
Plantillas data pura con `sections`, `checklist` (con requisito citado, p. ej. art. 330 CPCCN) y
`packProvisions`. `renderTemplate` resuelve slots del caso; la expansión por modelo es opcional y
posterior; siempre pasa por el guard. `documentToMarkdown` **impone** el encabezado
`> ⚠ ANÁLISIS INTERNO — PRIVILEGIADO — BORRADOR, NO PRESENTAR` y el disclaimer InfoLEG. Export:
Android → portapapeles/compartir texto; web/desktop → descarga `.md` + `window.print()` (A7/A9).

**D11. Plazos con reglas versionadas y `verified` (sin UI ni tool en el MVP).**
`computeDeadline`/`computePrescriptionTable` puros con reglas `{jurisdiction, scope, normRef,
days/unit/from, verified, sourceUrl}`. Sólo prescripción CCyC verificada lleva `verified:true`; el
resto se muestra `[VERIFICAR]`. El calendario/`plazo_calc` con UI y la tool quedan en fase 2.

**D12. Confidencialidad: pseudonimización obligatoria + consentimiento.**
`redaction.ts` reemplaza identificadores regex (DNI/CUIT/CBU/email/teléfono) y nombres/domicilios
**estructurados** por tokens (`[PERSONA-1]`, `[DOC-1]`, `[DOM-1]`); mapping local. Modo por defecto
`required`; `LegalCase.consent = { at, text, scope }` exigido antes del primer envío, con doble
confirmación para datos sensibles (Ley 25.326 art. 9) y aviso de secreto profesional (Ley 23.187
art. 6 inc. f). Preview compacto “qué sale del dispositivo” embebido en el composer (A9). Sin logs.

**D13. Herramientas legales por composición, con corpus async inyectado.**
`composeToolRegistries(...)` (puro, ~15 líneas) + `createLegalToolRegistry(corpus, deps)`.
`services.createTools(settings, context?)` recibe el contexto de conversación (C2). El índice léxico
**no** se construye sincrónicamente en `createTools`: `LegalCorpus.ensureIndex()` es async,
idempotente y cacheado por `(packId, packVersion)`; las tools lo invocan en `execute` y `chatStore`
una vez por turno para el brief (A4). Not-found ⇒ `ok:true` con contenido explicativo (M8).

**D14. Presupuesto separado y acotado; `estimateLegalTokens`.**
`LegalRetrievalBudget { maxPassages, maxPassageChars, maxBriefTokens }`; pasajes con
`estimateLegalTokens = ceil(bytes/3)` (el `/4` subestima español). El brief se capa a
`min(maxBriefTokens, 25% de la ventana)` y se trunca con marcador `[brief truncado]`; `reservedTokens`
entra en la selección de historial para que nunca desborde (M6). La compactación sigue contando sólo
mensajes persistidos.

**D15. Entidades persistidas vs derivadas.**
Persistidas: `LegalCase` (partes/hechos/fechas/consent), `LegalDocument`, `CaseAnalysis` (con `raw` y
`synthesis`), `AcknowledgmentRecord`, packs + metadata en IDB. Derivadas: índice léxico, veredictos
de citas/fidelidad, tabla de plazos, gap report, presupuesto. Fuente única de “packs instalados” =
store IDB `legalPacks` (se elimina `settings.legal.packs`, M2b).

**D16. i18n por subfeature; vocabulario de dominio en inglés.**
Un dict por subfeature (`legalCases`, `legalAnalysis`, `legalDocs`, `legalTrust`, `legalSetup`),
cada uno propiedad de su task de UI (m9). Valores canónicos persistidos en inglés (`active/archived`,
`high/medium/low`, `favorable/unfavorable/unclear`); etiquetas es/en vía i18n. Contenido normativo y
plantillas son datos es-AR (no pasan por i18n). Textos para el modelo en inglés.

**D17 (v2.1, enmienda por pedido del usuario). Modos ortogonales y combinables + menú de modos en
el chat.**
`researchMode` (existente, por conversación) y legal (`Conversation.legalCaseId != null`) son
**ortogonales**: General, Investigación, Legal, **Investigación + Legal**. **No** se introduce un enum
de “modo actual” ni un booleano `legalMode` que duplique la fuente: el menú **deriva** el estado de
las dos fuentes. Hay **tres vías de activación no excluyentes**: (1) onboarding en el primer inicio
(solo preconfigura el default), (2) Ajustes → `WorkModeSection` (habilita el workspace), (3) **chat**
→ nuevo `ModesMenu` en la cabecera. Si el modo legal no está configurado y se enciende desde el chat,
el menú ofrece “Configurar modo legal” (navega a Ajustes) o abre `CaseLinkDialog` para elegir/crear el
expediente; apagar pone `legalCaseId = null`. El `Switch` de investigación del `Composer` **se
mantiene** y refleja la misma fuente (`Conversation.researchMode`): el menú es una segunda **entrada**,
no una segunda fuente. El lifecycle del toggle (incluido el draft sin `conversationId`) reutiliza el
de `setResearchMode`/`setLegalCase` del `chatStore`, sin inventar uno nuevo.

---

## 3. Módulos y archivos

| ruta | export principal | responsabilidad | ¿nuevo/mod? |
|---|---|---|---|
| `src/domain/types/legal.ts` | `LegalCase`, `CaseAnalysis`, `LegalPack`, `Citation`, `LegalSettings`, `LegalAnalysisBudget`, `AcknowledgmentRecord` | tipos del dominio + settings legal (vocabulario en inglés) | nuevo |
| `src/domain/ports/LegalCaseRepository.ts` | `LegalCaseRepository`, `CreateLegalCaseInput` | puerto del expediente (sin `conversationId`/`findByConversationId`) | nuevo |
| `src/domain/ports/LegalPackStore.ts` | `LegalPackStore` | puerto de packs (`listInstalled`/`get`/`install`/`remove`) | nuevo |
| `src/domain/ports/index.ts` | reexports | sumar puertos | mod |
| `src/domain/legal/hash.ts` | `sha256Hex`, `normalizeForDigest` | SHA-256 JS puro (fallback inyectable) | nuevo |
| `src/domain/legal/packs.ts` | `parseLegalPack`, `validateLegalPack`, `packDigestInput`, `buildLegalIndex` | parseo/validación/canon + índice | nuevo |
| `src/domain/legal/retrieval.ts` | `searchLegalPassages`, `estimateLegalTokens`, `normalizeToken`, `canonicalizeAbbrev` | BM25 + normalización | nuevo |
| `src/domain/legal/citation.ts` | `extractCitations`, `verifyCitations`, `applyCitationMarkers` | guard de existencia + fidelidad | nuevo |
| `src/domain/legal/deadlines.ts` + `rules/**` | `computeDeadline`, `computePrescriptionTable`, `PRESCRIPTION_RULES_*` | motor de plazos + reglas versionadas | nuevo |
| `src/domain/legal/redaction.ts` | `redactCaseBrief`, `deanonymize` | pseudonimización + mapping | nuevo |
| `src/domain/legal/templates/**` + `document.ts` | `LEGAL_TEMPLATES`, `renderTemplate`, `documentToMarkdown` | plantillas + watermark/disclaimer | nuevo |
| `src/domain/legal/prompt.ts` + `brief.ts` | `buildLegalSystemPrompt`, `buildLegalBriefMessages`, `buildCaseBrief` | scaffold byte-estable + brief anti-injection (tool-pair/text-block) | nuevo |
| `src/domain/legal/adversarial.ts` | `ADVERSARIAL_PERSONAS`, `buildPersonaRequest`, `parseAnalysisResponse`, `buildSynthesisRequest` | orquestación adversarial pura + budget | nuevo |
| `src/domain/tools/composeRegistry.ts` | `composeToolRegistries` | composición de registries | nuevo |
| `src/domain/types/settings.ts` | `AppSettings.legal`, `LegalSettings` | sección legal con `default*`, sin `packs` | mod |
| `src/domain/settings/defaults.ts` | `DEFAULT_LEGAL_SETTINGS` | defaults + clone profundo | mod |
| `src/domain/settings/migrate.ts` | `migrateLegal` | saneo idempotente | mod |
| `src/domain/types/conversation.ts` | `Conversation.legalCaseId?` | vínculo único caso↔conversación | mod |
| `src/domain/agent/runAgent.ts` | hardening C1 + `enableTools?` + `ephemeralSuffix?` | cierre de tool-calls huérfanos, gate y sufijo efímero | mod |
| `src/domain/chat/buildWireMessages.ts` | reparación de pares huérfanos | wire siempre válido | mod |
| `src/domain/chat/selectHistoryByBudget.ts` | `reservedTokens?` | reserva del sufijo | mod |
| `src/domain/chat/serializeConversation.ts` | `ConversationArchive.legalCaseId?` + guard de markdown | round-trip del vínculo + export guardado | mod |
| `src/adapters/storage/idb.ts` | `DB_VERSION=2`, stores legales, handlers `blocked/blocking` | upgrade robusto | mod |
| `src/adapters/storage/IndexedDbLegalCases.ts` | `IndexedDbLegalCases` | repo real expediente/documentos/análisis/consent | nuevo |
| `src/adapters/storage/IndexedDbLegalPacks.ts` | `IndexedDbLegalPacks` | store real de packs (fuente única) | nuevo |
| `src/adapters/storage/legalContract.ts` | `describeLegalRepositoryContract` | contrato compartido | nuevo |
| `src/adapters/storage/conversationContract.ts` | test de link/unlink | paridad link `legalCaseId` real+fake | mod |
| `src/test/fakes/MemoryRepos.ts` | `MemoryLegalCaseRepository`, `MemoryLegalPackStore` | dobles en memoria | mod |
| `src/adapters/legal/packLoader.ts` | `manifestUrl`, `packUrl`, `fetchLegalPack`, `installPackFromUrl` | descarga + cache-buster + verificación | nuevo |
| `src/adapters/legal/packVerifier.ts` | `verifyPackHash`, `verifyProvisionHashes` | verificación obligatoria | nuevo |
| `src/adapters/legal/LegalCorpus.ts` | `createLegalCorpus`, `ensureIndex` | ciclo de vida del índice (async, cacheado) | nuevo |
| `src/adapters/tools/legal/index.ts` | `createLegalToolRegistry` | `legal_search`, `cite_article` | nuevo |
| `src/features/chat/state/chatStore.ts` | turno legal, `ephemeralSuffix`, tools por conversación | integración C2/C3 | mod |
| `src/features/chat/components/{MessageList,MessageActions,Composer}.tsx` + `features/legal/state/CitationGuardContext.tsx` | guard de circulación (hook, sin provider en ChatPage) + preview de privacidad | confianza | mod |
| `src/features/chat/ChatPage.tsx` + `components/{ModesMenu,CaseLinkDialog}.tsx` | menú de modos combinables en la cabecera + vínculo de expediente desde el chat | modos | mod/nuevo |
| `src/features/legal/state/caseStore.ts` + `analysisStore.ts` (+contexts) | stores legales | expediente y análisis | nuevo |
| `src/features/legal/state/CitationGuardContext.tsx` | `CitationGuardProvider`, `useCitationGuard` | guard en render/copy | nuevo |
| `src/features/legal/LegalPage.tsx` + `components/{CaseForm,CaseList}.tsx` | expedientes | gestión | nuevo |
| `src/features/legal/components/{AdversarialPanel,AnalysisView,DocumentStudio}.tsx` | análisis + documentos | UI adversarial/documental | nuevo |
| `src/features/settings/{SettingsPage.tsx,components/WorkModeSection.tsx}` | activación del workspace | switch + setup | mod |
| `src/features/onboarding/**` | paso legal del wizard | preconfiguración | mod |
| `src/app/{services.tsx,routing.tsx,layout/TopBar.tsx,services.test.ts}` | composición + ruta legal | integración | mod |
| `public/sw.js` | bypass cache-first `/legal/` | actualización de corpus | mod |
| `public/legal/packs/*.json` + `index.json` + `README.md` | corpus curado | datos | nuevo |
| `scripts/legal/verify-packs.mjs` | verificación de corpus | curación | nuevo |
| `src/i18n/dicts/legal{Cases,Analysis,Docs,Trust,Setup}.ts` + `modes.ts` + `settings.ts` + `onboarding.ts` | dicts | i18n es/en | nuevo/mod |
| `docs/legal-packs.md`, `architecture.md`, `README.md` | documentación | mapa + curación + licencia | nuevo/mod |

---

## 4. Contratos de tipos clave (propuesta) y AMEND

```ts
// domain/types/legal.ts  (vocabulario canónico en inglés)
export type LegalJurisdiction = 'national' | 'caba' | 'pba' | 'cordoba';
export type LegalMatter = 'civil' | 'commercial' | 'civil-commercial';
export type DocumentKind =
  | 'claim' | 'answer' | 'prior-exceptions' | 'counterclaim' | 'cautelar'
  | 'evidence' | 'closing' | 'appeal' | 'demand-letter' | 'contract' | 'bylaws';
export interface LegalConsent { at: number; text: string; scope: 'sensitive-data' | 'professional-secrecy'; }
export interface LegalCase {
  id: string; title: string; status: 'active' | 'archived';
  jurisdiction: LegalJurisdiction; court: string; matter: LegalMatter;   // fuente única runtime del caso
  clientRole: 'plaintiff' | 'defendant' | 'third-party';
  parties: LegalParty[]; facts: LegalFact[];
  keyDates: { id: string; label: string; date: string }[];
  consent?: LegalConsent;
  createdAt: number; updatedAt: number;
}
export interface LegalProvision {
  id: string; normId: string; article: string; title?: string; text: string;
  jurisdiction: LegalJurisdiction;
  sourceUrl: string; sourceDate: string;
  textHash: string; verificationMethod: 'manual' | 'scripted' | 'user-provided';
  curatedBy?: string; curatedAt?: string;
  tags: string[]; synonyms?: string[]; verified: boolean;
}
export interface LegalPack {
  schema: 'openher.legal.pack/1';
  id: string; title: string; version: string; publishedAt: string;
  jurisdiction: LegalJurisdiction; matter: LegalMatter;
  license: { name: string; url: string; attribution: string; verifiedAt?: string };
  sources: { url: string; retrievedAt: string; note?: string }[];
  norms: LegalNorm[]; provisions: LegalProvision[];
  hash: string;   // sha256 canon {schema,id,version,publishedAt,license,sources,norms,provisions}
}
export interface InstalledPack { id: string; version: string; hash: string; installedAt: number; bytes: number; }
export interface LegalIndex {
  readonly versions: Readonly<Record<string, string>>;
  readonly size: number;
  has(normId: string, article: string): boolean;
  get(normId: string, article: string): LegalProvision | null;
  search(query: string, limit: number): LegalPassage[];
}
export interface LegalPassage { provision: LegalProvision; score: number; packId: string; packVersion: string; }
export interface GapReportEntry { id: string; caseId: string; query: string; missingNorm?: string; missingArticle?: string; at: number; }

// citation guard: existencia + fidelidad
export type CitationKind = 'norm' | 'article' | 'case-law' | 'doctrine' | 'docket';
export type CitationFidelity = 'verbatim' | 'paraphrase' | 'not-applicable';
export interface AnalysisCitation {
  raw: string; normId: string | null; article: string | null;
  packId: string | null; packVersion: string | null;
  status: 'verified' | 'unverified'; fidelity: CitationFidelity;
}
export type CitationVerdict =
  | { status: 'verified'; citation: CitationRef; provision: LegalProvision; fidelity: CitationFidelity; packId: string; packVersion: string }
  | { status: 'unverified'; citation: CitationRef; reason: 'no-index' | 'article-missing' | 'not-a-norm' | 'external-kind' | 'paraphrase' }
  | { status: 'malformed'; raw: string };
export function extractCitations(text: string): CitationRef[];
export function verifyCitations(text: string, index: LegalIndex): CitationGuardResult;
export function applyCitationMarkers(text: string, result: CitationGuardResult): string;

// adversarial
export type AdversarialPerspective = 'defense' | 'attack' | 'judge' | 'risk';
export interface AnalysisItem {
  id: string; perspective: AdversarialPerspective;
  kind: 'attack' | 'defense' | 'counter' | 'judge-lean' | 'risk' | 'question';
  statement: string; basis: AnalysisCitation[]; evidenceRefs: string[];
  strength: 'high' | 'medium' | 'low'; confidence: number;
}
export interface JudgePostureItem {
  id: string; thesis: string; leaning: 'favorable' | 'unfavorable' | 'unclear';
  basis: AnalysisCitation[]; confidence: number;
}
export interface LegalAnalysisBudget { maxCalls: number; maxTotalTokens: number; maxWallClockMs: number; maxParallel: number; maxOutputTokensPerPersona: number; }
export interface CaseAnalysis {
  id: string; caseId: string; createdAt: number; providerId: string; modelId: string;
  packs: { id: string; version: string }[];
  attacks: AnalysisItem[]; defenses: AnalysisItem[];
  judgePosture: JudgePostureItem[]; risks: AnalysisItem[]; openQuestions: AnalysisItem[];
  synthesis: string; citations: { verified: number; unverified: number };
  incomplete: boolean;                      // degradó a N<4 personas
  raw: Record<AdversarialPerspective, string>;
}
export interface AcknowledgmentRecord {
  id: string; caseId: string; documentId: string; at: number;
  unverifiedCount: number; contentHash: string;
}

// settings (defaults de NUEVOS casos; sin packs)
export interface LegalRetrievalBudget { maxPassages: number; maxPassageChars: number; maxBriefTokens: number; }
export interface LegalSettings {
  enabled: boolean;
  defaultJurisdiction: LegalJurisdiction; defaultCourt: string; defaultMatter: LegalMatter;
  retrieval: LegalRetrievalBudget;
  analysis: LegalAnalysisBudget;
  anonymization: 'required' | 'optional';
  setupCompleted: boolean;
}
// AppSettings gana: legal: LegalSettings

export interface CreateLegalCaseInput {
  title: string; jurisdiction: LegalJurisdiction; court: string; matter: LegalMatter;
  clientRole: LegalCase['clientRole'];
}
export interface LegalCaseRepository {
  list(): Promise<LegalCase[]>;
  get(id: string): Promise<LegalCase | null>;
  create(input: CreateLegalCaseInput): Promise<LegalCase>;
  update(id: string, patch: Partial<Omit<LegalCase, 'id' | 'createdAt'>>): Promise<LegalCase>;
  remove(id: string): Promise<void>;
  listAnalyses(caseId: string): Promise<CaseAnalysis[]>;
  appendAnalysis(a: CaseAnalysis): Promise<void>;
  listDocuments(caseId: string): Promise<LegalDocument[]>;
  appendDocument(d: LegalDocument): Promise<void>;
  updateDocument(id: string, patch: Partial<Omit<LegalDocument, 'id' | 'caseId' | 'createdAt'>>): Promise<LegalDocument>;
  removeDocument(id: string): Promise<void>;
  appendAcknowledgment(record: AcknowledgmentRecord): Promise<void>;
  listAcknowledgments(caseId: string): Promise<AcknowledgmentRecord[]>;
  appendGap(entry: GapReportEntry): Promise<void>;
  listGaps(caseId: string): Promise<GapReportEntry[]>;
}
export interface LegalPackStore {
  listInstalled(): Promise<InstalledPack[]>;
  get(id: string): Promise<LegalPack | null>;
  install(pack: LegalPack, bytes: number): Promise<InstalledPack>;
  remove(id: string): Promise<void>;
}
```

### AMEND (aditivo, sin romper contratos congelados)

- **§A1** `Conversation.legalCaseId?: string | null` (aditivo). `create()` NO puebla la clave;
  desvincular = `null`; consumidores usan `!= null`. Un único enlace: se elimina
  `LegalCase.conversationId`.
- **§A2** `RunAgentParams.enableTools?: boolean` (gate = `enableTools ?? researchMode`). El modo legal
  se deriva **por conversación** (`legalCaseId != null`) y no depende de `settings.tools.webSearchEnabled`.
- **§A3** `AppServices.createTools(settings, context?)` con `context?: { conversationId: string | null;
  legalCaseId: string | null }`; `legalCases?`, `legalPacks?`, `legalCorpus?` opcionales (no rompen
  literales de test).
- **§A4** `DB_VERSION 1 → 2`, stores nuevos, `upgradeOpenHerDb` idempotente y handlers
  `blocked`/`blocking` que cierran la conexión vieja (evita upgrade colgado con otra pestaña en v1).
- **§A5** `ConversationArchive.legalCaseId?: string | null` + lectura tolerante en
  `parseConversationArchive`; `conversationToMarkdown` aplica guard + watermark en conversaciones
  legales. Round-trip del vínculo con test.
- **§A6** `RunAgentParams.ephemeralSuffix?: ChatMessage[]` + `SelectHistoryByBudgetInput.reservedTokens?`.
  El sufijo se anexa al wire después de la selección, no entra a `loopHistory`, y sus tokens se
  reservan antes de seleccionar. El rol `'tool'` pertenece al wire (`WireMessage`), no a `ChatMessage`.
- **§A7** Contrato del wire: `runAgent` cierra todo `tool-call` sin resultado en los caminos
  `abortedDuringTools`/`budgetDuringTools`/`failedTwice`/`answerForced` con un `tool-result` sintético
  `{ok:false, error:{code}, content:'[tool not executed: run stopped]'}`; `buildWireMessages` repara
  pares huérfanos en ambos sentidos (sin call → sintetiza el call; sin result → inyecta placeholder).
- **§A8** Tools legales not-found ⇒ `ToolResult { ok:true, content:'[…]' }` (resultado normal, no
  error); `invalid_args` reservado a args malformados. `ToolErrorCode` **no** cambia.

---

## 5. Hitos, esfuerzo, DoD y verificación

| Hito | Contenido | Esfuerzo | DoD | Comando |
|---|---|---|---|---|
| **M0 — Dominio + hardening** | T01–T11: tipos/ports, packs+hash, retrieval, citation (existencia+fidelidad), plazos+redaction, plantillas+documento, prompt+brief, adversarial, settings domain, **C1+C3+M7** (agent hardening). | **L** (~4–5 j) | Dominio puro (sin IO); tests de cada módulo verdes; `runAgent`/`buildWireMessages` cierran huérfanos con regresión en los tests hoy institucionalizados; brief nunca en `system`; system byte-estable. | `pnpm exec tsc -b && pnpm test` |
| **M1 — Persistencia + corpus curado** | T12–T16: IDB v2 (+blocked/blocking), repos real+fake, contrato (link/unlink), loader/verifier/corpus async, `sw.js` bypass, corpus curado + `verify-packs.mjs` + gap report. | **M** (~2–3 j) | Contrato corre real+fake sin ciclo; hash/textHash inválidos rechazan el pack; manifest revalida sin reinstalar PWA; corpus ≤ 500 KB; 100% de provisiones con fuente+fecha+hash. | `pnpm exec tsc -b && pnpm test && pnpm build` |
| **M2 — Integración de chat + tools** | T17–T21: tools legales + compose, settingsStore, services (createTools con contexto), turno legal (`legalCaseId`, `ephemeralSuffix`, enableTools, serialize+guard de export), guard de circulación (render/copy/composer). | **M** (~2–3 j) | Caso linkeado con workspace off ⇒ tools legales + scaffold legal + brief; turno general sin regresión; system byte-idéntico en 10 turnos; copy/export legal con marcadores. | `pnpm exec tsc -b && pnpm test` |
| **M3 — Adversarial + documentos + confianza + modos + onboarding** | T22–T27: stores legales, `#/legal`, UI de análisis y documentos, `ModesMenu`+`CaseLinkDialog` (D17), activación (wizard + WorkModeSection), docs. | **L+** (~5–6 j: +15–20% por el menú de modos, diálogo y a11y) | 4 personas con system idéntico + síntesis; presupuesto corta y persiste parcial; documento con watermark+disclaimer y export bloqueado sin consentimiento/ack; usuario existente entra sin re-onboarding; las 3 vías de activación convergen; golden set ≥80%. | `pnpm exec tsc -b && pnpm test && pnpm build` |
| **G1** | Critic + Bug Hunter + Challenger sobre M2/M3. | S | Hallazgos críticos/mayores remediados con tests de regresión. | `pnpm exec tsc -b && pnpm test` |
| **G2** | Auditor: exit codes reales, corpus/licencia, secretos, tamaño. | S | 0 secretos/PII; licencia documentada; corpus ≤ presupuesto; build OK. | `pnpm exec tsc -b && pnpm test && pnpm build` |
| **G3** | Aceptación del Evaluator. | S | ACCEPTED con evidencia por DoD. | — |

### DoD medibles (transversales, verificables en G2)

1. Golden set de **30 escritos típicos anonimizados**: **≥80%** de sus citas normativas resuelven en
   el corpus instalado; el resto queda en el gap report.
2. **0** citas fuera del pack reportadas como `verified` (test de propiedad sobre el golden set).
3. **100%** de las provisiones publicadas con `sourceUrl` + `sourceDate` + `textHash` válido.
4. **100%** de los documentos/analisis exportados con watermark + contador `verified/unverified`.
5. System prompt **byte-idéntico** (hash SHA-256) en 10 turnos legales consecutivos.
6. **0** tokens de PII en payloads de wire para 20 fixtures de redaction.
7. `tsc -b` + `test` (+ `build` en M1/M3) verdes por hito; baseline **91/956** re-verificado al abrir M0.

---

## 6. DAG de tareas con propiedad exclusiva de archivos (25 tareas + 3 gates)

Sin ciclos. Un archivo = un worker. Waves paralelizables; cada hito cierra verde antes de avanzar.

| ID | Hito | Wave | Owner | Deps | allowedFiles (exclusivos) |
|---|---|---|---|---|---|
| T01 | M0 | 0 | builder-domain-core | — | `domain/types/legal.ts`, `domain/ports/LegalCaseRepository.ts`, `domain/ports/LegalPackStore.ts`, `domain/ports/index.ts` |
| T11 | M0 | 0 | builder-agent | — | `domain/agent/runAgent.ts`, `domain/agent/runAgent.test.ts`, `domain/chat/buildWireMessages.ts`, `domain/chat/buildWireMessages.test.ts`, `domain/chat/selectHistoryByBudget.ts`, `domain/chat/selectHistoryByBudget.test.ts` |
| T02 | M0 | 1 | builder-packs | T01 | `domain/legal/hash.ts`, `domain/legal/packs.ts`, `domain/legal/packs.test.ts`, `domain/legal/hash.test.ts` |
| T10 | M0 | 1 | builder-settings-domain | T01 | `domain/types/settings.ts`, `domain/settings/defaults.ts`, `domain/settings/migrate.ts`, `domain/settings/migrate.test.ts` |
| T05 | M0 | 1 | builder-rules-privacy | T01 | `domain/legal/deadlines.ts`, `domain/legal/rules/index.ts`, `domain/legal/rules/national.ts`, `domain/legal/rules/caba.ts`, `domain/legal/redaction.ts`, `domain/legal/deadlines.test.ts`, `domain/legal/redaction.test.ts` |
| T03 | M0 | 2 | builder-retrieval | T02 | `domain/legal/retrieval.ts`, `domain/legal/retrieval.test.ts` |
| T04 | M0 | 2 | builder-citation | T02 | `domain/legal/citation.ts`, `domain/legal/citation.test.ts` |
| T07 | M0 | 2 | builder-generation | T01 | `domain/legal/templates/index.ts`, `domain/legal/templates/claim.ts`, `domain/legal/templates/answer.ts`, `domain/legal/templates/demandLetter.ts`, `domain/legal/document.ts`, `domain/legal/prompt.ts`, `domain/legal/brief.ts`, `domain/legal/document.test.ts`, `domain/legal/brief.test.ts` |
| T09 | M0 | 3 | builder-adversarial | T04, T07 | `domain/legal/adversarial.ts`, `domain/legal/adversarial.test.ts` |
| T12 | M1 | 3 | builder-storage | T01 | `adapters/storage/idb.ts`, `adapters/storage/idb.test.ts` |
| T16 | M1 | 3 | builder-corpus-data | T02 | `public/legal/packs/index.json`, `public/legal/packs/*.json`, `public/legal/README.md`, `scripts/legal/verify-packs.mjs`, `scripts/legal/__fixtures__/**` |
| T13 | M1 | 4 | builder-storage | T12, T01 | `adapters/storage/IndexedDbLegalCases.ts`, `adapters/storage/IndexedDbLegalPacks.ts` |
| T15 | M1 | 4 | builder-corpus-adapters | T02, T13 | `adapters/legal/packLoader.ts`, `adapters/legal/packVerifier.ts`, `adapters/legal/LegalCorpus.ts`, `adapters/legal/legalAdapters.test.ts`, `public/sw.js` |
| T14 | M1 | 5 | builder-storage | T13 | `src/test/fakes/MemoryRepos.ts`, `adapters/storage/legalContract.ts`, `adapters/storage/legalContract.test.ts`, `adapters/storage/conversationContract.ts` |
| T17 | M2 | 5 | builder-tools | T03, T04, T15 | `domain/tools/composeRegistry.ts`, `domain/tools/composeRegistry.test.ts`, `adapters/tools/legal/index.ts`, `adapters/tools/legal/index.test.ts` |
| T18 | M2 | 5 | builder-settings-domain | T10 | `features/settings/state/settingsStore.ts`, `features/settings/state/settingsStore.test.ts` |
| T19 | M2 | 6 | builder-app | T13, T14, T15, T17, T18 | `app/services.tsx`, `app/services.test.ts` |
| T20 | M2 | 7 | builder-chat | T07, T11, T17, T19 | `domain/types/conversation.ts`, `domain/chat/serializeConversation.ts`, `domain/chat/serializeConversation.test.ts`, `features/chat/state/chatStore.ts`, `features/chat/state/chatStore.legal.test.ts`, `features/conversations/state/conversationsStore.ts`, `features/conversations/state/conversationsStore.test.ts` |
| T21 | M2 | 7 | builder-trust | T04, T07, T20 | `features/chat/components/MessageList.tsx`, `features/chat/components/MessageActions.tsx`, `features/chat/components/Composer.tsx`, `features/legal/state/CitationGuardContext.tsx`, `features/legal/state/CitationGuardContext.test.tsx`, `i18n/dicts/legalTrust.ts` |
| T22 | M3 | 8 | builder-legal-state | T09, T13, T14, T19 | `features/legal/state/caseStore.ts`, `features/legal/state/analysisStore.ts`, `features/legal/state/CaseStoreContext.tsx`, `features/legal/state/AnalysisStoreContext.tsx`, `features/legal/state/legalStores.test.ts` |
| T25 | M3 | 8 | builder-activation | T10, T18 | `features/onboarding/state/wizardReducer.ts`, `features/onboarding/state/wizardReducer.test.ts`, `features/onboarding/components/OnboardingWizard.tsx`, `features/onboarding/components/LegalStep.tsx`, `features/onboarding/components/StepIndicator.tsx`, `features/onboarding/OnboardingPage.test.tsx`, `features/settings/components/WorkModeSection.tsx`, `features/settings/SettingsPage.tsx`, `features/settings/SettingsPage.test.tsx`, `i18n/dicts/settings.ts`, `i18n/dicts/onboarding.ts`, `i18n/dicts/legalSetup.ts` |
| T23 | M3 | 9 | builder-legal-ui | T22, T20 | `features/legal/LegalPage.tsx`, `features/legal/components/CaseForm.tsx`, `features/legal/components/CaseList.tsx`, `features/legal/components/CaseForm.test.tsx`, `app/routing.tsx`, `app/routing.test.ts`, `app/layout/TopBar.tsx`, `i18n/dicts/legalCases.ts` |
| T24 | M3 | 9 | builder-legal-ui | T22, T23 | `features/legal/components/AdversarialPanel.tsx`, `features/legal/components/AnalysisView.tsx`, `features/legal/components/DocumentStudio.tsx`, `features/legal/components/AnalysisView.test.tsx`, `features/legal/components/DocumentStudio.test.tsx`, `i18n/dicts/legalAnalysis.ts`, `i18n/dicts/legalDocs.ts` |
| T27 | M3 | 9 | builder-modes | T20, T22 | `features/chat/components/ModesMenu.tsx`, `features/chat/components/ModesMenu.test.tsx`, `features/chat/components/CaseLinkDialog.tsx`, `features/chat/components/CaseLinkDialog.test.tsx`, `features/chat/ChatPage.tsx`, `features/chat/ChatPage.test.tsx`, `i18n/dicts/modes.ts` |
| T26 | M3 | 10 | builder-docs | T23, T24, T25 | `docs/legal-packs.md`, `architecture.md`, `README.md` |
| G1 | — | 11 | critic + bug-hunter + challenger | T21, T22, T24, T25 | — (regresión en el archivo del hallazgo, con aprobación de ownership) |
| G2 | — | 11 | auditor | G1 | — |
| G3 | — | 12 | evaluator | G2 | — |

Archivos de regresión y su dueño (resuelve B2, y v2.1): `SettingsPage.test.tsx` → T25; `wizardReducer.ts` +
`wizardReducer.test.ts` → T25; `runAgent.test.ts`/`buildWireMessages.test.ts`/
`selectHistoryByBudget.test.ts` → T11; `services.test.ts` → T19; `conversationContract.ts` → T14;
`serializeConversation.ts`/`conversationsStore.ts` → T20; `MessageList.tsx`/`MessageActions.tsx`/
`Composer.tsx` → T21; **`ChatPage.tsx` y `ChatPage.test.tsx` → T27** (reasignados desde T21 en la
enmienda v2.1); `routing.tsx`/`TopBar.tsx` → T23; `public/sw.js` → T15; `architecture.md` → T26.

**Nota v2.1 (reasignación y seam del chat):** `ChatPage.tsx` estaba en T21 (M2) y se reasigna a T27
porque el `ModesMenu` vive en la cabecera del chat. Para no dejar a T21 sin punto de montaje, el
guard de circulación pasa a un **hook** `useCitationGuard()` en `CitationGuardContext.tsx` (T21)
consumido por `MessageList.tsx`/`MessageActions.tsx`; `ChatPage` no necesita provider. Además, T20
(M2, `chatStore.ts`) incorpora la acción `setLegalCase(caseId: string | null)` con el mismo lifecycle
que `setResearchMode` (incluido el draft sin `conversationId`: estado pendiente y persistencia al
crear la conversación), de modo que T27 solo consume stores existentes más `caseStore` (T22).

Corrección del ciclo B1: T14 (fakes + contrato) va en wave 5 y T13 en wave 4; `legalContract.test.ts`
corre el contrato **contra ambos** repos en el mismo task (sin dependencia hacia adelante).

---

## 7. Estrategia de tests

| Capa | Qué se prueba | Principios |
|---|---|---|
| `domain/legal` puro | hash (canon y mismatch, sin `crypto.subtle`); packs (schema, `textHash`, provisión sin fuente); BM25 adversarial (`prescribe→prescripción`, `CPCCN 330`, `arts. 2560 y 2561`, `LDC 52 bis`, sinónimos); citation (existencia, `paraphrase`, fallo→unverified, malformed); plazos (hábiles, ferias, bisiesto, `verified:false`); redaction (round-trip, partículas “de la Cruz”, sin identificadores); plantillas+documento (checklist art. 330, watermark, disclaimer); brief (delimitadores, escape, tool-pair vs text-block, byte-estabilidad); adversarial (system idéntico, rol al final, budget, parser tolerante). | Fakes puros, cero red. |
| `domain/agent` + wire (C1/C3) | `runAgent` cierra huérfanos en `aborted/budget/failedTwice/answerForced`; `buildWireMessages` repara ambos sentidos; `ephemeralSuffix` fuera de `loopHistory`, presente en el wire, `reservedTokens` evita overflow; `enableTools` aditivo. | Reemplaza los tests que hoy aceptan el huérfano (`runAgent.test.ts:990/:1014`, `buildWireMessages.test.ts:75/:83`). |
| Puertos/adapters | `describeLegalRepositoryContract` contra `IndexedDbLegalCases`/`IndexedDbLegalPacks` y `MemoryLegal*`; IDB v1→v2 con dos conexiones (`blocked/blocking`); conversación link/unlink real+fake. | Paridad real/fake. |
| Adapters packs | `manifestUrl`/`packUrl` con cache-buster y `?v=hash`; `verifyPackHash`/`verifyProvisionHashes` (ok/mismatch/rechazo); `LegalCorpus.ensureIndex` idempotente y cacheado. | `HttpClient` fake, sin red. |
| Tools | `legal_search`/`cite_article`: schema, ejecución, args inválidos, not-found `ok:true`, truncado, cita siempre dentro del fixture pack, gap report en miss. | Patrón `tools/index.test.ts`. |
| Chat/guard | Turno legal captura el request: `system` sin brief ni pasajes; sufijo con `role:'tool'`; system byte-idéntico; workspace off + caso linkeado ⇒ legal; copiar/exportar con marcadores; watermark. | Adapter fake. |
| UI | Reducers/selectores de `caseStore`/`analysisStore`; smoke RTL (form de caso, panel adversarial, documento, composer con preview, `ModesMenu`); `SettingsPage` ahora con **siete** secciones; `ModesMenu.test.tsx` (toggles, `role="menuitemcheckbox"`+`aria-checked`, combinación Investigación+Legal, Escape/click afuera), `ChatPage.test.tsx` (abrir menú, legal sin caso ⇒ `CaseLinkDialog`); test de ortogonalidad y de convergencia de las 3 vías al mismo estado persistido. | Sin snapshots. |
| Corpus/golden set | 30 escritos: ≥80% de citas resueltas; 0 falsos `verified`; 100% de provisiones con fuente+fecha+hash. | Test de propiedad. |

---

## 8. Protocolo de curación del corpus por fases + gap report

**Fase 1 (MVP, verificable).** Packs curados por **casos de uso típicos** (no por código completo):
CCyC (obligaciones, contratos, responsabilidad, prescripción), CPCCN (estructura procesal núcleo),
LDC. Cada provisión con `sourceUrl`+`sourceDate`+`textHash`+`verificationMethod`; **0 `verified:false`**
en packs publicados. `scripts/legal/verify-packs.mjs` hace fetch de `sourceUrl`, normaliza y diffea
contra el texto; si InfoLEG bloquea bots, cae a verificación manual registrada (`verificationMethod:
'manual'`, `curatedBy`). Presupuesto de tamaño: **≤ 500 KB** total (el corpus viaja al APK: se audita
`dist/legal/**`). Disclaimer “texto referencial; el auténtico es el Boletín Oficial”.

**Fase 2 (usuario).** “Agregar normativa” / “Agregar jurisprudencia propia”: el abogado aporta texto
con fuente y licencia obligatorias ⇒ pack local `verificationMethod:'user-provided'`,
`verified:'user'`, firmado por hash, **nunca redistribuido**. Jurisdicciones PBA/Córdoba y bases
comerciales (La Ley, El Derecho) quedan expresamente fuera.

**Fase 3 (medición → backlog).** `legal_search` sin resultados y `cite_article` not-found escriben un
**gap report** local (norma/artículo/frecuencia) visible en la UI del expediente; alimenta el próximo
pack. Es la métrica que convierte “cargar todo el conocimiento” en un objetivo gestionable y medible.

Honestidad de licencia (A10): **no se publica el corpus con una licencia afirmada sin verificar**. Se
documenta `licenseVerifiedAt` + URL en `docs/legal-packs.md`; si no se confirma, `license.name =
'unverified'` y **G2 no cierra**. Alternativa preferida: textos del Boletín Oficial (actos oficiales).

---

## 9. Matriz de riesgos

| Riesgo | Impacto | Mitigación |
|---|---|---|
| Tool-calls huérfanos (C1) | Crítico | Fix en `runAgent` + reparación en `buildWireMessages` como **prerrequisito** (T11); tests de regresión. |
| Brief sin asiento / evictado (C3/A1/M6) | Crítico | `ephemeralSuffix` + `reservedTokens`; nunca en `history` ni `system`; test de caso extremo. |
| Modo legal dependiente del switch global (C2) | Alto | Fuente única por conversación; test “workspace off + caso linkeado”. |
| Cita real con texto inventado | Crítico | Fidelidad verbatim de spans entrecomillados + provisión visible; garantía reformulada y honesta. |
| Circulación sin guard (copiar/exportar) | Alto | Guard en render/copy/export/conversation; acknowledgment append-only; export bloqueado. |
| Corpus desactualizado por SW cache-first (A3) | Alto | `sw.js` no cache-first para `/legal/`; `?v=hash` y cache-buster en el manifiesto. |
| `crypto.subtle` ausente (A5) | Medio | SHA-256 JS puro inyectable; política: hash inválido ⇒ rechazo. |
| Coste/rate-limit adversarial (A2) | Medio | `LegalAnalysisBudget`, `maxParallel`, `sessionId` común, degradación a N personas. |
| Prompt injection del expediente (A8) | Alto | Delimitadores + preámbulo + escape + canal separado; citation guard como backstop. |
| Export Android prometido de más (A7) | Medio | Portapapeles/compartir en nativo; `.md`/print sólo web; probado en dispositivo en M3. |
| Fuga de datos del cliente | Crítico | Anonimización obligatoria + consentimiento + preview “qué sale” + sin logs. |
| Licencia del corpus (A10) | Alto | Verificación obligatoria; `docs/legal-packs.md`; bloquea G2. |
| Falsos negativos de anonimización | Alto | Sólo regex + nombres/domicilios estructurados; nunca NER libre como red de seguridad. |
| Romper contratos congelados | Alto | Aditivo opcional; `mergeSettings` enumera `legal`; AMEND §A1–§A8. |
| Subestimación de tokens español | Medio | `estimateLegalTokens` (bytes/3) + presupuesto separado. |
| Corpus infla el APK | Medio | Presupuesto ≤500 KB + auditoría de `dist/legal/**` en G2. |
| Reglas no verificadas tomadas como ciertas | Crítico | `verified:false` ⇒ `[VERIFICAR]`; MVP sólo prescripción CCyC verificada. |
| Scope creep / sobre-confianza | Medio | NO-objetivos + disclaimers no descartables + watermark. |

---

## 10. Decisiones abiertas para el usuario

**RESUELTA por D17 (enmienda v2.1):** “modo global vs por conversación” ⇒ **per-conversación con
defaults globales**. En runtime la fuente de verdad son `Conversation.researchMode` (Investigación) y
`Conversation.legalCaseId` (Legal), ortogonales y combinables; `settings.legal.enabled` y los
`default*` solo definen conversaciones **nuevas**. Quedan realmente abiertas:

1. **Jurisdicción del MVP** → recomendado: nacional + CABA.
2. **Licencia del corpus** (A10) → recomendado: verificar InfoLEG; si no se confirma, usar Boletín
   Oficial y registrar `licenseVerifiedAt`. Bloquea G2 hasta documentarlo.
3. **Anonimización** → recomendado: obligatoria por defecto con opt-out consentido.
4. **Importar jurisprudencia propia** → recomendado: fase 2, con fuente y licencia, sin redistribuir.
5. **Export de documentos** → recomendado: Android portapapeles/compartir; `.md`+print en web/desktop
   (sin dependencias nuevas).
6. **Proveedor/modelo sugerido en el setup** → recomendado: sugerir (tool calling + caché), no bloquear.
7. **Profundidad adversarial** → recomendado: 4 personas + síntesis; degradación visible a N si falla.
8. **Ferias judiciales** → recomendado: calendario editable; pre-cargar sólo nacionales verificadas.
9. **Distribución de packs** → recomendado: `public/legal/packs` + manifiesto revalidable; remoto en fase 2.
10. **Presupuesto de corpus del APK** → recomendado: ≤500 KB en MVP; packs pesados descargables en fase 2.

---

## 11. NO-objetivos del MVP

- No es asesoramiento legal automático ni reemplaza el criterio del abogado.
- No incluye jurisprudencia, doctrina ni códigos comentados (sólo normativa oficial con atribución).
- No cubre todas las provincias (nacional + CABA) ni todos los fueros.
- No parsea PDFs/imágenes ni hace OCR; no genera `.docx` ni PDF nativo.
- No incluye calendario procesal con UI ni tool `plazo_calc` (motor puro sí, fase 2 la UI).
- No incluye panel de privacidad dedicado (sí anonimización + preview embebido).
- No usa embeddings/vector DB/zod ni dependencias nuevas; no sincroniza en la nube.
- No promete plazos no verificados (lo no confirmado va `[VERIFICAR]`) ni honorarios por UMA.
- No genera escritos “listos para presentar”: genera borradores marcados para revisión profesional.

---

## 12. Remediación del gate adversarial

> **Enmienda v2.1 (por pedido del usuario, no proviene del gate):** se agregó **D17** (modos
> ortogonales y combinables + `ModesMenu` en el chat) y la tarea **T27**. Reasigna `ChatPage.tsx`
> de T21 a T27, mueve el guard a un hook sin provider, agrega `setLegalCase` a T20 y crea el dict
> `modes.ts`. Impacto de esfuerzo: M3 pasa de **L** a **L+** (~5–6 j). Ver `consolidationNotes` del
> board para el detalle de propiedad.

| Hallazgo | Cómo se resolvió | Dónde (sección/archivo/test) |
|---|---|---|
| **C1** huérfanos | Saneo en `runAgent` de todo `tool-call` sin resultado en `abortedDuringTools`/`budgetDuringTools`/`failedTwice`/`answerForced` + reparación bidireccional en `buildWireMessages`; tests hoy institucionalizados actualizados. | T11; §A7; `domain/agent/runAgent.ts`, `domain/chat/buildWireMessages.ts`; `runAgent.test.ts`, `buildWireMessages.test.ts` |
| **C2** fuente de verdad | Modo legal **por conversación** (`legalCaseId != null`); switch global = default de nuevas; tools legales no dependen de `webSearchEnabled`; `createTools(settings, context?)`. | D1/D2/D8/D13; §A2/§A3; T19/T20; test “workspace off + caso linkeado” |
| **C3** asiento del brief | `ephemeralSuffix` + `reservedTokens`; par atómico; rol `'tool'` es del wire; nunca en `history`/`system`. | D7; §A6; T11/T20; `chatStore.legal.test.ts` |
| **B1** ciclo T15↔T16 | Contrato corre contra real **y** fake en un único task (T14) tras los repos (T13); fakes antes del contrato. | §6 (waves 4→5); `legalContract.test.ts` |
| **B2** regresión sin dueño | `SettingsPage.test.tsx` y `wizardReducer(.test).ts` → T25; `services.test.ts` → T19; `conversationContract.ts` → T14; `routing/TopBar` → T23; `sw.js` → T15. | §6 (tabla de regresión) |
| **B3** archive pierde el vínculo | `ConversationArchive.legalCaseId?` + lectura tolerante + guard/watermark en `conversationToMarkdown`. | §A5; T20; `serializeConversation.test.ts` round-trip |
| **M1a** doble enlace | Se elimina `LegalCase.conversationId` y `findByConversationId`; fuente única `Conversation.legalCaseId`. | D2/D15; T01/T22 |
| **M1b/M2** packs duplicados | Se quita `settings.legal.packs`; store IDB `legalPacks` única fuente; `migrateLegal` deja de sanear packs. | D15; §4; T10/T15 |
| **M1c/M3** jurisdicción global | Renombrada a `defaultJurisdiction/defaultCourt/defaultMatter`; runtime usa `LegalCase.*`. | §4; T01/T10 |
| **M4/M5** guard evitable | Guard en render/copy/export-comversación/export-documento + fidelidad verbatim + acknowledgment append-only. | D9; T20/T21/T24; tests de copy/export |
| **M6** contradicción presupuesto | `reservedTokens` + tope de brief (min(maxBriefTokens, 25% ventana)) + orden `applyCompaction → brief`. | D7/D14; §A6; test de caso extremo |
| **M7** `researchMode` sobrecargado | Parámetro aditivo `enableTools?`; scaffold de investigación con el modo web real. | D8; §A2; T11/T20 |
| **M8** not-found de tools | `ok:true` con contenido explicativo + gap report; `invalid_args` sólo para args malformados; `ToolErrorCode` sin cambios. | D13; §A8; T17 |
| **A2** presupuesto adversarial | `LegalAnalysisBudget` + `sessionId` común + `maxParallel` + degradación a N. | D6; §4; T09/T22 |
| **A3** SW cachea packs | `sw.js` no cache-first para `/legal/` + `?v=hash`/cache-buster. | D4; T15; `legalAdapters.test.ts` |
| **A4** índice async | `LegalCorpus.ensureIndex()` async/idempotente/cacheado inyectado en tools y chat. | D13; T15/T17/T19 |
| **A5** hash débil | SHA-256 JS puro inyectable; canon con license/sources/publishedAt; `textHash` por provisión; `verify-packs.mjs`; rechazo si mismatch. | D4; §8; T02/T15/T16 |
| **A6** BM25 sin stemming | Sufijos + abreviaturas + aliases + `synonyms`; recall adversarial. | D5; T03; `retrieval.test.ts` |
| **A7** export Android | Portapapeles/compartir en nativo; `.md`/print sólo web; probado en dispositivo. | D10; §8; T24 |
| **A8** prompt injection | Delimitadores `<expediente>`, preámbulo “dato, no instrucción”, escape, canal separado. | D7/D9; T07; `brief.test.ts` |
| **A9** ética/circulación | Watermark + disclaimer + consentimiento persistido + acknowledgment + ataque como simulación interna. | D10/D12; T07/T22/T24 |
| **A10** licencia sin verificar | `licenseVerifiedAt` + doc; sin verificar ⇒ `unverified` y G2 bloqueado. | §8; T16/T26; `docs/legal-packs.md` |
| **A1** brief evictado | Mismo seam que C3; nunca entra a `history`. | D7; §A6 |
| **B1(Challenger)** fallback text-block | `brief.ts` devuelve `tool-pair` o `text-block` según capacidades; test en chat y análisis. | D7; T07/T20/T22 |
| **B2(Challenger)** hash best-effort | Política explícita: hash obligatorio, mismatch ⇒ rechazo. | D4; T15 |
| **m9** dict único | Dicts partidos por subfeature, cada uno con dueño de UI. | D16; §6 |
| **m10** vocabulario | Valores canónicos en inglés + i18n es/en. | D16; §4 |
| **m13/m14** conteos | 25 tareas + 3 gates; 4 hitos + 3 gates; baseline 91/956 re-verificado. | §1/§5/§6; T26 actualiza `architecture.md` |
| **m15** solape de hitos | Waves alineadas a hito; cada hito cierra verde antes del siguiente. | §6 |
| **v2.1** pedido del usuario | Modos combinables + `ModesMenu`/`CaseLinkDialog` en el chat con tres vías de activación; T27 con dueño de `ChatPage`/`modes.ts`. | D17; §3/§5/§6/§7; T27 |

---

## 13. Apéndice

### 13.1 Checklist por hito

- [ ] `pnpm exec tsc -b` exit 0 (no `tsc --noEmit` de raíz: es vacuo).
- [ ] `pnpm test` exit 0 y conteo real registrado (baseline 91/956).
- [ ] Sin `any`, sin `console.log`, sin TODO, sin código muerto.
- [ ] `domain/legal` no importa `adapters/`/`features/`/`app/`.
- [ ] i18n con paridad es/en (compile-time + `i18n.test.ts`).
- [ ] Propiedad de archivos respetada (diff ⊆ allowedFiles).
- [ ] Corpus: fuente+fecha+textHash+hash válido; ≤500 KB; licencia documentada o `unverified`.
- [ ] Sin secretos ni PII real de clientes en repo/fixtures.
- [ ] `pnpm build`: corpus fuera del bundle inicial; auditado `dist/legal/**`.
- [ ] AMEND §A1–§A8 actualizado si se tocan contratos congelados.

### 13.2 Qué auditar adversarialmente (G1)

- **C1**: caminos de aborto/budget/doble-fallo/`answerForced` ⇒ wire sin huérfanos; historial ya
  corrupto reparado por `buildWireMessages`.
- **Citation guard**: inyección de citas vía prompt, artículos inexistentes, spans entrecomillados
  parafraseados, citas en tablas/código; que copiar y exportar no esquiven el guard.
- **Prompt injection**: hechos/documentos con instrucciones; delimitadores escapados; nunca al `system`.
- **Cache/contexto**: system byte-idéntico en 10 turnos; brief sin entrar a `history`; overflow con
  brief gigante + historial largo + compactación.
- **Presupuesto adversarial**: doble click, abort a mitad de las 5 llamadas, fallo de 1 persona,
  `QuotaExceededError`.
- **Privacidad**: DNI/CUIT/CBU/email; nombres con partículas; domicilios sin altura; round-trip; no
  fuga del mapping; consentimiento y acknowledgment exigidos.
- **Persistencia**: IDB v1→v2 con dos conexiones; `crypto.subtle` ausente; pack corrupto/mismatch.
- **Contratos**: `conversationContract` real+fake con link/unlink; `AppServices` opcional; settings
  `legal` enumerado en `mergeSettings`/`migrate`.
- **Tamaño**: `dist/legal/**` y APK dentro del presupuesto.
- **Modos (v2.1)**: que el menú no duplique estado (`aria-checked` derivado de las dos fuentes),
  ortogonalidad (encender uno no altera el otro), cierre con Escape/click afuera, foco al abrir, no
  desborde en viewport móvil, y convergencia de las 3 vías (onboarding/Ajustes/chat) en el mismo
  estado persistido.
