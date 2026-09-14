# Veredicto G3 — Aceptación final del Modo Legal Argentina (Civil y Comercial)

Fecha (UTC): 2026-09-14. Evaluator: subagente EVALUATOR, gate G3 (protocolo teamwork).
Repo: `G:\Proyectos\openher-chat`. Alcance: M0–M3 + remediación G1 (F01–F03) + auditoría G2.
Método: lectura del plan (§1, §5, §10, §11, §12), veredictos y hallazgos G1 (Critic/Challenger/Bug-hunter),
informe G2, board, y verificación propia (existencia de archivos, `tsc -b`, suite completa,
`verify-packs.mjs`, greps de cableado G1). No se modificó nada fuera de este archivo.

## Veredicto: ACCEPTED WITH NOTES

Global: **ACCEPTED WITH NOTES** — todos los DoD medibles del plan §5 se cumplen con evidencia
ejecutable; las notas son no bloqueantes (límites honestos ya documentados, un test con cobertura
equivalente pero no literal, y estados administrativos del board sin actualizar).

| Hito | Veredicto | Fundamento |
|---|---|---|
| M0 — Dominio + hardening | ACCEPTED | Tipos/ports, packs+hash JS puro, BM25, citation, plazos+redaction, plantillas+documento, prompt+brief, adversarial, settings domain, C1+C3+M7. Suite verde. |
| M1 — Persistencia + corpus curado | ACCEPTED | IDB v2 con blocked/blocking, repos real+fake con contrato y paridad link/unlink, loader/verifier/corpus async, bypass `sw.js` (`sw.js:36,39`), corpus 3 packs/12 provisiones/16403 bytes (3,2% del tope), `verify-packs.mjs` exit 0. |
| M2 — Integración de chat + tools | ACCEPTED | Turno legal por `legalCaseId`, `ephemeralSuffix`+`reservedTokens`, tools legales por composición, guard de circulación, serialize con guard+watermark. Los 3 bloqueantes de cableado G1 (H1–H3) están remediados y verificados en código (ver Evidencia G1). |
| M3 — Adversarial + documentos + confianza + modos + onboarding | ACCEPTED | 4 personas + síntesis con budget, DocumentStudio con watermark/disclaimer y export bloqueado sin consentimiento/ack, `ModesMenu`+`CaseLinkDialog` ortogonales, 3 vías de activación, docs. T24 montado (ver Evidencia G1). |
| G1 — Remediación (F01–F03) | ACCEPTED | F01/F02/F03 DONE en board; re-verificado con 1356 tests entonces, 1358 hoy. Sin hallazgos CRITICAL/MAJOR abiertos. |
| G2 — Auditoría | ACCEPTED | G2 fue APROBADO CON CAMBIOS con un solo H-01 (recall sin medir). H-01 **cerrado**: `corpus.test.ts:142-171` ejecuta el índice sobre el golden set y aserta recall ≥80% en top-3 (7/7 verde). Resto de G2 (secretos, PII, licencia, tamaño, build) intacto. |

### Evidencia G1-remediación (verificación propia de este gate)

- `ChatPage.tsx:398` y `LegalPage.tsx:346`: `CitationGuardProvider` montado con índice del corpus (H1/H2 del Critic, I-1, B18 → cerrados).
- `ChatPage.tsx:355` (`legal={`), `:79-80` (`LEGAL_CONSENT_TEXT`), `:198-203` (persistencia en `LegalCase.consent`); `Composer.tsx:88-94` (gate + preview) → consentimiento cableado (H3, R-2, B17 → cerrados).
- `LegalPage.tsx:26-27,100,534,560`: `AdversarialPanel`+`DocumentStudio` montados, `syncFromManifest()` invocado al montar (H1, I-4 → cerrados).
- `chatStore.legal.test.ts:358`: test e2e "0 PII en el wire" (R-1 → cerrado al nivel exigido por F01: brief redactado-first).
- `citation.ts`: comillas simples / ventana / cualificadores cubiertos por F02 (C-1, C-2 → cerrados al nivel F02).

## DoD

| DoD (plan §5) | Evidencia | Estado |
|---|---|---|
| 1. Golden set 30 escritos, recall ≥80% | `scripts/legal/__fixtures__/golden-set.json`: 30 queries (20 resolubles + 10 gap, verificado por conteo propio). `corpus.test.ts:142-171` aserta recall ≥80% top-3; 7/7 verde | ✅ PASS |
| 2. 0 citas fuera del pack como `verified` | `citation.test.ts:185` test de propiedad "nunca marca verified una cita ausente del índice" + externos siempre unverified; suite verde | ✅ PASS |
| 3. 100% provisiones con `sourceUrl`+`sourceDate`+`textHash` | `corpus.test.ts:88-102` lo aserta por provisión (12/12) + `verify-packs.mjs` exit 0 (re-ejecutado en este gate) | ✅ PASS |
| 4. 100% documentos/análisis exportados con watermark + contador verified/unverified | `document.ts:16-17` (`DOCUMENT_WATERMARK`), `:120-144` (imposición), `adversarial.ts:868-877` (contador), `document.test.ts:115-143`, `DocumentStudio.test.tsx` (bloqueo sin ack); T24 montado verificado | ✅ PASS |
| 5. System byte-idéntico en 10 turnos | `chatStore.legal.test.ts:233-244` (byte-idéntico entre turnos consecutivos) + `systemPrompt.test.ts` (estabilidad intra-día, 6 tests). Cobertura equivalente, no literal "10 turnos" (nota N-1) | ✅ PASS con nota |
| 6. 0 PII en wire (20 fixtures) | `redaction.test.ts` (14 tests) + e2e `chatStore.legal.test.ts:358` (9 valores crudos, 0 ocurrencias en `ephemeralSuffix`). Conteo literal del plan desactualizado, cobertura equivalente (nota N-2) | ✅ PASS con nota |
| 7. Contrato real+fake, corpus ≤500 KB, `dist/legal` auditado | Contrato verde en suite; 16403 bytes (3,2%); G2-6/G2-7 (sin fuga al bundle inicial, `dist` espeja `public`) sin cambios posteriores que lo invaliden | ✅ PASS |
| 8. Modos ortogonales, 3 vías convergen, sin estado duplicado | `ModesMenu.tsx:52` (deriva), tests de ortogonalidad y convergencia (M3); sin regresión posterior | ✅ PASS |
| 9. `tsc`+`test`(+`build` M1/M3) verdes; baseline re-verificado | Este gate: `tsc -b` exit 0, `pnpm test` **120 archivos / 1358 tests, 0 fallos** (baseline 91/956 superado y corregido: 1356 en remediación + 2 tests H-01), `verify-packs` exit 0. `build` verificado en G2 exit 0 sin cambios de build posteriores salvo tests | ✅ PASS |

Archivos clave verificados existentes: `src/domain/legal/*` (19 ficheros incl. `hash/packs/retrieval/citation/deadlines/redaction/document/prompt/brief/adversarial`),
`src/features/legal/*` (LegalPage, components AdversarialPanel/AnalysisView/DocumentStudio/CaseForm/CaseList, state caseStore/analysisStore/CitationGuardContext),
`src/adapters/legal/*` (LegalCorpus/packLoader/packVerifier/corpus.test), `public/legal/packs/*.json` (3 packs + `index.json`),
`scripts/legal/verify-packs.mjs`, `docs/legal-packs.md`, `public/legal/README.md`.
Board: M0–M3 `COMPLETE`, T01–T27 `DONE`, F01–F03 `DONE`, G1 `DONE`. Desvío administrativo: G2/G3 figuran `BACKLOG`
aunque G2 fue auditado (APROBADO CON CAMBIOS, H-01 ya cerrado) — actualizar a DONE tras este veredicto (nota N-3).

NO-objetivos (§11) respetados: sin jurisprudencia/doctrina en packs, sin todas las provincias (nacional + vocabulario
CABA/PBA/Córdoba), sin PDF/OCR, sin `.docx`/PDF nativo, sin calendario con UI ni `plazo_calc`, sin panel de privacidad
dedicado, sin dependencias nuevas / embeddings / nube, sin plazos no verificados (van `[VERIFICAR]`). No se promete de más.

## Desvíos aceptados

1. **Huérfano `tool-result` sin `tool-call` se descarta, no se sintetiza** (H4 Critic vs §A7). Técnicamente correcto
   (fabricar un call falsearía la conversación). Aceptado; enmienda documental pendiente menor en §A7.
2. **`ToolErrorCode` ganó `'not_executed'`** contra §A8 ("no cambia") (H5). Aditivo y retrocompatible. Aceptado; enmendar §A7/§A8.
3. **`LegalSettings` trae `perspectives` + `defaultTemplates`** no descritos en §4 (H6). Aditivo, consistente en
   tipos/defaults/migrate. Aceptado; actualizar contrato §4.
4. **Recall medido en top-3** (operacionalización no literal del plan). Razonable para un corpus de 12 provisiones. Aceptado.
5. **System byte-idéntico testeado en 2 turnos + estabilidad intra-día**, no literal "10 turnos" (N-1). El mecanismo
   (scaffold sin fecha variable) hace el N irrelevante; aceptado como equivalente.
6. **"20 fixtures" de PII**: 9 valores e2e + batería unitaria (N-2). Cobertura equivalente; aceptado, conteo del plan desactualizado.
7. **Remediación F01–F03 con owners distintos de los T originales.** Sancionado por el protocolo de gate; aceptado
   (tests de regresión en archivos dueños del hallazgo).
8. **Board con G2/G3 en BACKLOG** pese a G2 auditado (N-3). Administrativo; aceptar este veredicto implica pasar G2 a DONE y G3 a DONE.

## Riesgos residuales

- **Corpus deliberadamente chico (12 provisiones, ~16 KB).** La mayoría de las normas que un caso real cita NO están;
  el sistema fallará a `[VERIFICAR]`/gap report por diseño. Es el riesgo principal de experiencia de uso, mitigado por
  el gap report visible que prioriza el próximo pack (Fase 3, `docs/legal-packs.md` §8).
- **Paráfrasis sin comillas pasa el guard de fidelidad** (límite honesto documentado en `docs/legal-packs.md` §9):
  la existencia puede salir `verified` aunque el texto no sea literal. Las tools devuelven siempre el texto de la
  provisión para cotejo humano; el abogado debe cotejar.
- **Redacción = regex + datos estructurados**, no NER libre: menciones parciales en texto libre (apodos, domicilios
  incompletos) pueden fugar al wire. El preview "qué sale del dispositivo" muestra categorías, no garantía total.
- **Licencia CC BY 2.5 AR (InfoLEG) declarada según lo informado por el origen** (`docs/legal-packs.md` §4): el alcance
  exacto sobre cada texto transcripto está a verificar contra InfoLEG; ante duda vale el Boletín Oficial.
- **Sin ejecución en dispositivo/emulador en los gates** (alcance declarado G2): el export Android (portapapeles/compartir)
  y el tamaño en APK se verifican por diseño + `dist/legal`, no en hardware.
- **Menores sin cerrar** (backlog honesto): carrera estrecha `syncFromManifest` vs `ensureIndex` en vuelo (H7/B15),
  `sw.js` con prefijo literal `/legal/` bajo subpath (B37/S-1), toggles cruzados que pueden perder un `publish` de lista
  (B20/M-1), `persistPatch` del chat sin superficie de error de cuota (K-4). Ninguno corrompe datos del expediente.

## Notas para el usuario

1. **Es un asistente de borradores, no un abogado.** Todo lo que genera sale marcado como borrador interno
   ("ANÁLISIS INTERNO — PRIVILEGIADO — BORRADOR, NO PRESENTABLE") y con advertencias. Ningún escrito sale listo
   para presentar: siempre debe revisarlo un profesional antes de usarlo.
2. **Solo conoce 12 artículos de 3 normas** (partes del Código Civil y Comercial, del Código Procesal y de Defensa del
   Consumidor). Si le pregunta por otra ley, otro artículo o jurisprudencia, el sistema lo va a marcar como
   `[VERIFICAR]` en vez de inventar: eso es una protección, no un error. La lista de lo que falta está documentada y
   se amplía por prioridades de uso.
3. **Las citas entre comillas se verifican letra por letra** contra esos 12 artículos; si el texto no coincide exactamente,
   se marca `[VERIFICAR: cita no textual]`. Y aunque una cita figure como verificada, verifique siempre contra el texto
   oficial (Boletín Oficial / InfoLEG), porque el corpus es referencial y puede desactualizarse.
4. **Sus datos quedan en su dispositivo** (no hay nube) y antes del primer envío en modo legal se le pide consentimiento
   con una vista previa de qué sale anonimizado. Aun así: evite dictar datos sensibles innecesarios; la anonimización
   automática cubre DNI/CUIT/CBU/teléfonos/emails y nombres/domicilios cargados como datos, no apodos ni menciones
   indirectas en texto libre.
5. **Los plazos no verificados se muestran como `[VERIFICAR]`** y no hay calendario procesal con avisos en este MVP:
   no use la app como agenda de vencimientos; confirme cada plazo por la vía profesional habitual.
