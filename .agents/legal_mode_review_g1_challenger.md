# G1 Challenger — Modo Legal (M0–M3) — informe adversarial

> Rol: CHALLENGER (protocolo teamwork, gate G1). Repo: `G:\Proyectos\openher-chat`.
> Alcance: romper el código nuevo del Modo Legal y verificar las mitigaciones del plan §13.2
> contra el código real (no contra los tests). No se modificó código de producto.
> Método: lectura directa de `src/domain/legal/*`, `src/domain/agent/runAgent.ts`,
> `src/domain/chat/*`, `src/features/chat/*`, `src/features/legal/*`,
> `src/adapters/legal/*`, `src/adapters/storage/idb.ts`, `src/app/services.tsx`,
> `public/sw.js`, más `findstr` para cableado (quién monta a quién, quién llama a quién).

## Veredicto: RECHAZADO

Tres mitigaciones prometidas como cerradas **no existen en runtime** (el guard de
render/copiar, el gate de consentimiento y la redacción del brief), y el guard de citas
tiene bypasses reales de fidelidad. Además hay dos pantallas construidas pero sin montar
y un sync de corpus sin llamador, de modo que lo que sí está cableado opera en el peor
modo posible (corpus vacío + PII cruda al wire + citas sin marcar en el chat).
Los detalles puros (wire C1, BM25, hash, upgrade IDB, stores) sí aguantan — ver
"Mitigaciones que SÍ funcionan" al final. Condición para revertir el veredicto: corregir
obligatoriamente **R-1, I-1, R-2, C-1, C-2** (los 5 Críticos/Altos de seguridad) con tests
de regresión en el archivo dueño indicado, y responder o planificar **I-4, B-2, P-1**.

---

## Tabla de hallazgos

| ID | Sev | Ataque / Prueba | Evidencia | Resultado | Remediación | Archivo dueño |
|---|---|---|---|---|---|---|
| R-1 | Crítico | El brief legal lleva PII cruda al wire: `buildLegalEphemeralSuffix` pasa el `LegalCase` completo a `buildCaseBrief`, y el texto redactado sólo se **agrega** como sección extra. Nombres, domicilios, CUIT, título, juzgado y fechas viajan sin pseudonimizar. El mapping se descarta y `deanonymize` no se llama en ningún código de producto. | `src/features/chat/state/chatStore.ts:518-561` (brief con `case: legalCase` crudo + `redactedText` sólo como extra); `src/domain/legal/brief.ts:30-91` (`# ${title}`, parties, facts y `redactedText` como sección adicional, todo con `escaped()` que sólo neutraliza el delimitador); `src/domain/legal/redaction.ts:172-185` (mapping local descartado por el caller) | **falla** | Redactar **antes** de armar el brief: `buildCaseBrief` debe recibir el caso ya pseudonimizado (o recibir `redactedText` como única fuente de partes/hechos), y el mapping debe quedarse en memoria de la sesión para `deanonymize` en render. Test: fixture con DNI/CUIT/nombre en partes+hechos+título ⇒ 0 ocurrencias en el `ephemeralSuffix` capturado. | `src/features/chat/state/chatStore.ts` (T20) + `src/domain/legal/brief.ts` (T07) |
| I-1 | Crítico | El guard de render/copiar no existe en runtime: `CitationGuardProvider` sólo se monta en tests; en la app nadie lo monta, así que `useCitationGuard()` devuelve el guard **neutro (identidad)** en `MessageList` y `MessageActions`. El chat legal renderiza y copia texto crudo sin `[VERIFICAR]`. | `src/features/legal/state/CitationGuardContext.tsx:101-108` (fallback neutro documentado); `src/features/chat/ChatPage.tsx` (ningún `CitationGuardProvider` en todo el árbol); `src/features/chat/components/MessageList.tsx:118-135`, `src/features/chat/components/MessageActions.tsx:38-43` (consumen el hook) | **falla** | Montar `CitationGuardProvider` con el índice real (`legalCorpus.getIndex()` post-`ensureIndex`, `null` ⇒ modo conservador) envolviendo `MessageList`/`MessageActions` en `ChatPage`, o mover el `mark` al selector de mensajes del store. Test RTL: sin índice, copiar una respuesta con `CCyC art. 2560` incluye `[VERIFICAR]`. | `src/features/chat/ChatPage.tsx` (T27) |
| R-2 | Crítico | Gate de consentimiento muerto en el chat real: `ChatPage` renderiza `Composer` **sin** la prop `legal` (`ComposerLegal`), por lo que `legalGate` es falso, no hay preview de privacidad ni checkbox, y el envío nunca se bloquea. El store además nunca consulta `LegalCase.consent` antes de adjuntar el brief. | `src/features/chat/ChatPage.tsx:264-276` (`Composer` sin prop `legal`); `src/features/chat/components/Composer.tsx:88-94` (gate sólo si `legal.redactionActive`); `src/features/chat/state/chatStore.ts:501-565` (sin lectura de `consent`) | **falla** | Cablear `legal={{ redactionActive: legalCaseId != null, redactedCounts, consentAccepted: case.consent != null, onConsentChange: persistir }}` en `ChatPage` **y** exigir `consent` en `buildLegalEphemeralSuffix` (sin consent ⇒ sin sufijo, o turno bloqueado). Test: caso sin consent ⇒ `ephemeralSuffix === undefined`. | `src/features/chat/ChatPage.tsx` (T27) + `src/features/chat/state/chatStore.ts` (T20) |
| C-1 | Alto | Evasión de fidelidad con comillas simples: `findQuotedSpans` sólo reconoce `“…”`, `«…»` y `"…"`; una cita inventada entre `'...'` (o con énfasis markdown `*…*`, o blockquote `>`) nunca se compara contra la provisión ⇒ `fidelity: 'not-applicable'` ⇒ `verified`. El system prompt (que pide comillas sólo para verbatim) no lo impide estructuralmente. | `src/domain/legal/citation.ts:357-366` (regex sin alternativa de comilla simple); `src/domain/legal/citation.ts:492-502` (`quotes.length === 0 ⇒ 'not-applicable'`); `src/domain/legal/citation.ts:547-560` (verified con fidelity not-applicable) | **falla** | Agregar `'...'` (con cuidado de apóstrofes: exigir longitud mínima y cierre) y opcionalmente `*…*` a `findQuotedSpans`, o documentar como límite honesto en el mismo lugar donde se documenta la paráfrasis sin comillas. Test: `art. 2560 CCyC 'texto inventado'` ⇒ `paraphrase`. | `src/domain/legal/citation.ts` (T04) |
| C-2 | Alto | Ventana de asociación cita↔quote (`QUOTE_WINDOW = 200`): una comilla inventada a más de 200 caracteres de la cita no se asocia ⇒ la cita queda `verified` aunque el texto citado sea falso. Ataque trivial: rellenar entre cita y "cita textual". | `src/domain/legal/citation.ts:70-71` (`QUOTE_WINDOW = 200`); `src/domain/legal/citation.ts:374-409` (asociación por distancia, sin asociación ⇒ sin chequeo) | **falla** | Estrategia documentada: o bien todo span entrecomillado no asociado se marca `[VERIFICAR: cita no textual]` (fail-closed, con riesgo de falsos positivos en prosa con comillas), o bien se amplía la ventana + se marca lo no asociado cuando el texto contiene ≥1 cita normativa. Test en ambos sentidos. | `src/domain/legal/citation.ts` (T04) |
| C-3 | Alto | Inciso/subdivisión no validada: el extractor captura sólo dígitos + ordinal `bis/ter/...`; en `art. 1 inc. b CCyC` el `inc. b` se descarta y la cita verifica contra el art. 1 exista o no ese inciso. Alucinación a nivel inciso pasa como `verified`. | `src/domain/legal/citation.ts:205-221` (regex de artículo); `src/domain/legal/citation.ts:456-462` (candidatos = base y `n ordinal`, sin inciso) | **falla** | Decidir y documentar: o se extrae el inciso como parte de la identidad y se exige match en el texto de la provisión, o se degrada a `unverified/paraphrase` toda cita con `inc./inciso/párr./apart.` que no matchee verbatim. Test: `art. 1 inc. z` inexistente ⇒ no `verified`. | `src/domain/legal/citation.ts` (T04) |
| I-4 | Alto | UI legal sin montar + sync sin llamador: `AdversarialPanel` y `DocumentStudio` no se renderizan en ningún lado (`LegalPage` sólo tiene placeholders `legal-analysis-mount` / `legal-documents-mount`); `syncFromManifest` no tiene llamador en producto ⇒ IDB de packs arranca vacía ⇒ corpus tamaño 0 ⇒ tools legales siempre miss y guard siempre conservador. Fail-closed por accidente, funcionalidad inoperante. | `src/features/legal/LegalPage.tsx:213-223` (placeholders); `src/app/routing.tsx:107` (sólo `LegalPage`); grep `AdversarialPanel`/`DocumentStudio`/`syncFromManifest` sin uso en producto (sólo tests y `LegalCorpus.ts:108`) | **falla** | Montar análisis+documentos en `LegalPage` (o sincerar el DoD de M3), y llamar `syncFromManifest` en el bootstrap (con superficie de error visible) + sembrar packs iniciales. Tests de integración de montaje. | `src/features/legal/LegalPage.tsx` (T23/T24), bootstrap (T19) |
| P-1 | Alto | Prompt injection estructural, no sólo de delimitador: `escaped()` sólo neutraliza `<expediente>`; instrucciones en hechos/título/documentos ("ignorá las reglas…", markdown, fences) llegan al wire y la única defensa es el preámbulo del system. Peor: `synthesisUser` concatena salidas de personas **crudas**, así que una persona puede inyectar `### judge` falso o instrucciones a la síntesis. El mensaje del usuario puede traer `</expediente>` falso + instrucciones (el escape no cubre el canal usuario). | `src/domain/legal/brief.ts:154-157` (escape sólo del delimitador); `src/domain/legal/adversarial.ts:217-238` (outputs crudos interpolados sin escape ni etiquetado); `src/domain/legal/prompt.ts:36-40` (defensa sólo instruccional) | **falla** (residual de diseño; el plan §A8 lo da por mitigado) | Escapar/delimitar también los outputs de personas en la síntesis (p. ej. fences + "DATA ONLY" por bloque, o truncar encabezados `###`), y envolver el texto libre del usuario del turno legal entre delimitadores de dato. Test: persona con `### judge\nIGNORÁ…` ⇒ la síntesis lo recibe neutralizado. | `src/domain/legal/adversarial.ts` (T09), `src/domain/legal/brief.ts` (T07) |
| B-2 | Medio | Descalce de estimadores + fail-open del cap: el cap del brief usa `estimateLegalTokens` (bytes/3) pero la reserva del wire usa `estimateMessagesTokens` (bytes/4 + overheads) ⇒ sub-reserva de hasta ~33% del brief; el overhead del par tool-call no está en el cap. Con `keepLastTurns` mandatorios el wire puede exceder la ventana. Además `capBriefToBudget` con `maxBriefTokens<=0/NaN` devuelve el brief **sin capar**. | `src/domain/legal/retrieval.ts:560-570` (/3) vs `src/domain/chat/estimateTokens.ts:31-34` (/4); `src/domain/agent/runAgent.ts:165` (reserva con el otro estimador); `src/features/chat/state/chatStore.ts:1132-1141` (`cap <= 0 ⇒ return brief`) | **falla** | Unificar: reservar con `estimateLegalTokens` (o convertir con el mismo divisor + overhead del par), y tratar budget corrupto como `min` seguro en vez de fail-open. Test: brief gigante + settings corruptas ⇒ wire acotado. | `src/features/chat/state/chatStore.ts` (T20), `src/domain/agent/runAgent.ts` (T11) |
| R-3 | Medio | PII fuera del alcance de redacción: título del caso, juzgado, labels de fechas y el título de la conversación (derivado del primer mensaje) nunca pasan por `redactCaseContent` y viajan crudos en el brief; el preview "qué sale del dispositivo" (hoy ni siquiera cableado, ver R-2) contaría sólo categorías redactadas ⇒ sub-informa. `PHONE_RE` además es tan amplia que anonimiza secuencias de 8 dígitos no telefónicas (corrompe nros. de expediente/artículos en el texto redactado). | `src/domain/legal/redaction.ts:33-40,138-139` (alcance y regex); `src/domain/legal/brief.ts:30-71` (título/court/keyDates crudos); `src/features/chat/state/chatStore.ts:143-148` (título de conversación crudo) | **falla** (parcial: lo estructurado de partes/hechos sí se redacta a nivel dominio) | Incluir título/juzgado/fechas en el contenido redactable (o excluirlos del brief con `[COMPLETAR]`), y acotar `PHONE_RE` (exigir prefijo `+54`/guiones/parentesis, no 8 dígitos pelados). | `src/domain/legal/redaction.ts` + `src/domain/legal/brief.ts` (T05/T07) |
| I-2 | Medio | Rutas de salida con distinto nivel de guard: `exportMarkdown` del store llama a `conversationToMarkdown` **sin índice** (marca conservadora: todo detectado ⇒ `[VERIFICAR]`, se pierde el conteo verified pero es seguro); `exportJson` circula citas crudas sin marcas/watermark/contadores; `window.print`/copiar-por-selección del DOM del chat imprimen lo renderizado (hoy crudo por I-1); `searchMessages` expone snippets crudos. | `src/features/conversations/state/conversationsStore.ts:205-217` (export sin índice, JSON crudo); `src/domain/chat/serializeConversation.ts:106-138` (conservador sin índice — bien); `src/features/chat/ChatPage.tsx` (sin CSS de impresión ni handler) | **pasa con observaciones** | Pasar el índice real a `exportMarkdown` cuando haya corpus (conserva verified/unverified); documentar que el JSON es backup crudo; tras corregir I-1, el print/selección heredan el marcado del render. | `src/features/conversations/state/conversationsStore.ts` (T20) |
| M-2 | Medio | Legal sin corpus instalado: el turno igual expone `legal_search`/`cite_article` (siempre miss `ok:true` + `reportGap` ⇒ **un `appendGap` por miss sin dedupe ni throttle**, crecimiento acotado sólo por uso) y envía el brief en text-block con PII cruda (R-1). Degradación funcional correcta, efectos colaterales no. | `src/features/chat/state/chatStore.ts:598-601` (`enableTools = legalMode` sin exigir índice); `src/app/services.tsx:102-114` (registry siempre compuesto con caso); `src/adapters/tools/legal/index.ts:261-292` (miss ⇒ gap) | **falla** (parcial) | Deduplicar gaps (misma norma/artículo/ventana temporal) y, sin corpus, aviso visible + budget de gaps. Test: N miss idénticos ⇒ 1 gap. | `src/app/services.tsx` (T19), `src/adapters/tools/legal/index.ts` (T17) |
| C-4 | Bajo | Dedup ignora el ordinal (`52` vs `52 bis` comparten clave) y la ventana `NORM_WINDOW=40` puede asociar mal con dos citas cercanas (el `usedNorm` greedy asigna la más próxima, correcto en el caso común). `verify` prueba ambas variantes así que el veredicto es fail-closed; sólo afecta conteo/marcado. | `src/domain/legal/citation.ts:122-136` (`refKey`), `281-295` (`nearestNorm`), `456-462` (candidatos) | **pasa con nota** | Incluir el ordinal en `refKey` para no fusionar `52`/`52 bis` en contadores. | `src/domain/legal/citation.ts` (T04) |
| C-5 | Bajo | Citas en tablas/código: el detector escanea el markdown crudo (incluye fences) y `applyCitationMarkers` inserta marcas **dentro** de bloques de código/tablas — seguro por exceso, pero corrompe código copiable y puede romper tablas. Sin índice el marcado conservador agrava el ruido. | `src/domain/legal/citation.ts:572-592`, `665-705` (sin noción de fence) | **pasa con nota** (seguridad primero) | Opcional: excluir fences de código del marcado (manteniendo la detección para contadores) o marcar al pie. No bloquea G1. | `src/domain/legal/citation.ts` (T04) |
| K-4 | Bajo | `persistPatch` traga **todo** error de IDB en silencio (incluida cuota): memoria e IDB divergen sin señal; un refresh pierde el turno. El análisis sí distingue `QuotaExceededError` (`ANALYSIS_QUOTA_ERROR`); el chat no. | `src/features/chat/state/chatStore.ts:305-321` (catch vacío) | **pasa con nota** | Superficie de error de persistencia (toast/banner) o al menos contador; unificar criterio con `analysisStore.ts:302-317`. | `src/features/chat/state/chatStore.ts` (T20) |
| M-1 | Bajo | `setResearchMode` y `setLegalCase` comparten `toggleSeq`: toggles rápidos cruzados pueden suprimir un `publishConversation` (sólo afecta la lista, el estado local ya está bien). `onToggleLegal(true)` del menú es inalcanzable (`ChatPage` sólo cablea el apagado; el encendido va por diálogo) — prop engañosa pero inofensiva. | `src/features/chat/state/chatStore.ts:239,976-1005`; `src/features/chat/ChatPage.tsx:162-165`; `src/features/chat/components/ModesMenu.tsx:73-81` | **pasa con nota** | Separar secuencias por toggle o eliminar `onToggleLegal(true)` del contrato del menú. | `src/features/chat/state/chatStore.ts` (T20) |
| S-1 | Bajo | `sw.js` evita cache-first para `/legal/` pero **sin fallback a caché** (offline ⇒ corpus muerto aunque estuviera instalado en HTTP-caché; IDB igual lo salva si ya sincronizó — pero nada sincroniza, ver I-4). El match es `pathname.startsWith('/legal/')`: con `base` distinto de `/` no matchea y vuelve a cache-first (packs viejos pegados). `status:'final'` en `documentToMarkdown` quita el watermark; hoy nada lo setea salvo `updateDocument` directo. | `public/sw.js:36-44`; `src/domain/legal/document.ts:130-146` | **pasa con nota** | Prefijar con el `base` de build o matchear `includes('/legal/')`; agregar fallback `cache.match` en el bypass; exigir ack también para pasar a `final` (o mantener watermark siempre). | `public/sw.js` (T15), `src/domain/legal/document.ts` (T07) |

---

## Verificación punto por punto del foco pedido

### 1. Citation guard bypass
- **Citas inventadas**: NO llegan a `verified` — `verifyNormCitation` exige `index.has/get`
  (`citation.ts:531-545`) y norma ausente ⇒ `no-index` (`538-544`); todo envuelto en
  `safeHas/safeGet` que ante throw degradan a falso (`415-429`). **Mitigación de existencia: funciona.**
- **`art. 1 inc. b` malformados**: el `inc. b` se ignora (C-3) — **falla**.
- **Citas en tablas/código**: se detectan y marcan (C-5) — **pasa (ruidoso)**.
- **`"ignorá el guard"` como instrucción**: el system lo prohíbe (`prompt.ts:42-47`) y el
  marcado es post-hoc, pero el marcado sólo existe donde está cableado — en el chat no
  (I-1). **Falla por cableado, no por lógica.**
- **Spans parafraseados como verbatim**: con `"…"`/`«…»` se detectan (`492-502`,
  comparación sólo con espacios colapsados — estricta, bien); con `'...'` o lejos de la
  cita, evaden (C-1, C-2). **Falla parcial.**
- Nada fuera del índice queda `verified` **a nivel dominio** — los tests de propiedad del
  dominio son creíbles; el problema es que el dominio no está enchufado en el chat (I-1).

### 2. Prompt injection desde el expediente
- Delimitadores + preámbulo + escape del delimitador + canal separado (tool-pair):
  implementados como se prometió (`brief.ts:21-96,111-140`, `prompt.ts:36-40`). **Funciona
  para el caso que cubre** (falso `</expediente>` no rompe el bloque — hay test).
- Resto del espacio de ataque sin cubrir: otras instrucciones (P-1), canal usuario (P-2),
  título (foco 7/P-3), outputs de personas hacia la síntesis (P-1). **§A8 sobrestado:
  es mitigación parcial, no "por diseño" completa.**

### 3. Brief y presupuesto
- Sufijo nunca en `history`/`loopHistory`/`system`, par atómico, `reservedTokens`,
  orden compactación→brief, cap `min(maxBriefTokens, 25%)` con marcador: **todo
  implementado como se prometió** (`runAgent.ts:165,192-199,229-233,496-499`;
  `selectHistoryByBudget.ts:112-162`; `chatStore.ts:642,652,1127-1141`). **Pasa.**
- Con dos peros: descalce de estimadores + fail-open (B-2) y PII cruda en el contenido
  del brief (R-1). El continente está bien; el contenido no.

### 4. Concurrencia / abort
- **Doble click en Analizar**: `claimRun` sincrónico del store lo rechaza (`analysisStore.ts:137-143`);
  el botón se deshabilita al correr (`AdversarialPanel.tsx:70-79`); el chat igual
  (`chatStore.ts:426-432` + `STOP_GUARD_MS`). **Mitigación funciona** (aunque el panel no
  está montado — I-4).
- **`stop()` en medio de las 5 llamadas**: controladores por llamada + `abortRun` sin
  persistir (`analysisStore.ts:105-134,150-181,337-348`). **Funciona.**
- **Fallo de 2 personas**: degradación a N con `failed[]` + flag `incomplete` + nota en la
  síntesis (`228-300,355-370,713-783`). **Funciona** (lógica pura bien testeada).
- **`QuotaExceededError`**: distinguido en análisis (`395-400`, `302-317`); tragado en
  silencio en el chat (K-4). **Parcial.**
- **Abort del turno con tools legales en vuelo**: cierre sintético `not_executed` en los 4
  caminos + `catch` (`runAgent.ts:288-300,311-323,398-416`), y reparación bidireccional
  de historiales ya corruptos (`buildWireMessages.ts:58-91`). **T11/C1: funciona,
  es el mejor trozo del hito.**

### 5. Redacción
- Regex + estructurados + mapping local + preview por categorías: el **dominio** hace lo
  que dice (`redaction.ts`), incluyendo orden domicilio→identificadores→nombres y
  partículas vía frase exacta. **A nivel dominio: pasa.**
- A nivel sistema: **falla** — el brief envía el caso crudo (R-1), el título/juzgado no
  están en el alcance (R-3), el consentimiento no está cableado (R-2) y el mapping no se
  usa para nada (`deanonymize` sin llamadores en producto). El DoD "0 tokens de PII en
  el wire" es hoy falso por construcción. Nombres con partículas y domicilios sin altura
  sólo se cubren si coinciden **exactos** con lo estructurado; menciones parciales en
  hechos libres fugan (límite documentado en el propio módulo, pero el plan lo vende como
  mitigación suficiente).

### 6. Export / copiar
- `conversationToMarkdown` con guard + watermark + disclaimer: **implementado y
  fail-closed sin índice** (`serializeConversation.ts:44-138`). **Funciona.**
- Pero: el store exporta sin índice (I-2, degradación aceptable), el chat no marca nada
  en render/copiar (I-1, **falla**), el print/selección del DOM heredan ese fallo (I-2),
  el JSON es crudo por diseño (documentado como backup, aceptable), y el export de
  documentos con consent+ack+watermark existe sólo en un componente sin montar (I-4).
  **M4/M5 a nivel de app: falla.**

### 7. Modos
- Ortogonalidad real (`researchMode` vs `legalCaseId`), derivación sin duplicar estado
  (`ModesMenu.tsx:52`), workspace-off + caso linkeado ⇒ legal (`chatStore.ts:598`),
  draft sin `conversationId` con pendiente aplicado (`chatStore.ts:441-444`), encendido
  sin caso ⇒ diálogo, Escape/click-afuera/foco/viewport (`ModesMenu.tsx:55-110),
  `researchDisabled` coherente con el switch del composer. **Todo lo pedido en §13.2/D17:
  funciona**, salvo minucias (M-1) y el gap sin corpus (M-2).

### 8. Persistencia
- Upgrade v1→v2 idempotente sin borrar (`idb.ts:160-236`), handlers
  `blocked/blocking/terminated` (`137-153`), pack corrupto/mismatch ⇒ rechazo con
  errores (`packLoader.ts:105-148`, `packVerifier.ts:27-63`, `LegalCorpus.ts:104-125`),
  `install` sólo alcanzable vía ruta verificada, `crypto.subtle` ausente ⇒ SHA-256 JS
  puro siempre (`hash.ts:185-193`), manifiesto inválido ⇒ no-op silencioso. **Todo lo de
  §13.2: funciona.** Reserva: el no-op silencioso + `syncFromManifest` sin llamador
  (I-4) convierten la robustez en irrelevante hasta que alguien lo invoque; y la cuota
  en el chat se traga (K-4).

---

## Mitigaciones del plan que SÍ funcionan (crédito explícito)

1. **C1 / wire sin huérfanos** (`runAgent.ts` + `buildWireMessages.ts`): cierre en
   `aborted/budget/failedTwice/answerForced` + reparación bidireccional de historiales
   corruptos. La evidencia de código es sólida y cubre también el `catch` del registry.
2. **Asiento del brief (C3/A1/M6)**: seam efímero, `reservedTokens`, par atómico,
   nunca en `system`/`history`, orden tras compactación. El mecanismo es correcto.
3. **Existencia del guard**: ninguna cita fuera del índice queda `verified` a nivel
   dominio; externos siempre `unverified`.
4. **BM25 + normalización (A6)**: sufijos, abreviaturas, aliases y sinónimos
   implementados; recall adversarial razonable sin dependencias.
5. **Hash fuerte + canon (A5)**: SHA-256 puro inyectable, canon con
   license/sources/publishedAt, `textHash` por provisión, rechazo ante mismatch.
6. **IDB v2 + contrato real/fake + link/unlink** (T12–T14): upgrade, stores, contrato.
7. **Gate de tools aditivo + composición por conversación** (M7/C2): `enableTools?`,
   registry legal independiente de `webSearchEnabled`, workspace-off + linkado ⇒ legal.
8. **Doble-run y abort del análisis**: `claimRun`, controladores por llamada, degradación
   a N personas con `incomplete` visible, cuota distinguida.
9. **Export markdown fail-closed y documento con watermark no descartable en draft** (a
   nivel función pura).
10. **`sw.js` bypass de `/legal/`** (con las reservas de S-1).

---

## Condiciones para APROBADO (G1 re-review)

1. R-1: brief redactado de punta a punta (0 PII cruda en el sufijo) + test con fixture.
2. I-1: provider del guard montado en el chat (render + copiar marcados, incl. sin índice).
3. R-2: consentimiento cableado chat↔caso (sin consent no hay sufijo al wire).
4. C-1 + C-2: comillas simples y spans no asociados tratados (o límite documentado donde
   ya se documentan los otros límites del guard, `serializeConversation.ts:37-43`).
5. C-3: inciso decidido (validar o degradar, con test).
6. Responder I-4 (montar o recortar DoD), B-2 (unificar estimadores, cerrar fail-open),
   P-1 (neutralizar outputs de personas en la síntesis).
7. `pnpm exec tsc -b` + `pnpm test` verdes con los tests de regresión en los archivos
   dueños de la tabla.

*Notas de alcance: no se ejecutó la app (revisión estática contra código real, como pide
el protocolo para este gate); los conteos "1319 tests / tsc limpio" no se re-verificaron
porque el gate evalúa propiedades de seguridad, no el semáforo. Los hallazgos citan
archivo:línea exactos y son todos reproducibles por lectura.*
