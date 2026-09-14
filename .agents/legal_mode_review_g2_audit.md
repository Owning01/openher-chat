# Auditoría G2 — Modo Legal (verificación empírica)

Fecha (UTC): 2026-09-14. Auditor: subagente AUDITOR gate G2. Repo: `G:\Proyectos\openher-chat`.
Método: comandos ejecutados por el auditor con herramientas propias; exit codes y conteos reales, cero salidas simuladas.
No se modificó código de producto (`src/`, `public/`, `scripts/`, configs). Único archivo escrito: este informe.

> Nota de entorno (relevante para reproducibilidad): los binarios en `X:\Dev\...` (`node.exe`, `git.exe`,
> shims de `pnpm`) fallan en esta máquina con exit `-1073741818` (`STATUS_IN_PAGE_ERROR`, drive X: con fallos
> de paginación). Se usó `G:\Dev\nodejs` primero en el `PATH` (`node v24.19.0`, `pnpm 12.4.1`) y
> `C:\Program Files\Git\cmd\git.exe` (`git 2.55.0.windows.5`). Todos los exit codes de abajo son con esos binarios.

## Veredicto: APROBADO CON CAMBIOS

G2 (plan §5, fila G2: 0 secretos/PII, licencia documentada, corpus ≤ presupuesto, build OK) se cumple íntegro
con evidencia empírica. El cambio exigido es no bloqueante para G2 pero debe cerrarse antes de G3: **falta la
medición automatizada del recall ≥80% sobre el golden set (DoD transversal §5.1)** — ver H-01.

## Tabla de verificación

ID | Check | Comando/evidencia | Resultado real | Estado
---|-------|-------------------|----------------|-------
G2-1 | `tsc` limpio | `$env:Path="G:\Dev\nodejs;..."; pnpm exec tsc -b; echo TSC_EXIT:$LASTEXITCODE` | `TSC_EXIT:0`, sin output de errores | ✅ PASS
G2-2 | Suite verde + conteo | `pnpm test` (vitest run) | `Test Files 120 passed (120)`, `Tests 1356 passed (1356)`, `TEST_EXIT:0`, duración 25.91s | ✅ PASS
G2-3 | Conteo: baseline corregido | salida de `pnpm test` vs baselines citados | Baseline histórico 91/956 **superado y corregido**: el gate anterior reportó 120/1356 y **se confirma 120 archivos / 1356 tests**, 0 fallos | ✅ PASS (corrige baseline a 120/1356)
G2-4 | `verify-packs.mjs` | `node scripts/legal/verify-packs.mjs; echo VERIFY_EXIT:$LASTEXITCODE` | `verify-packs: OK (G:\Proyectos\openher-chat\public\legal\packs\)`, `VERIFY_EXIT:0` | ✅ PASS
G2-5 | `build` OK | `pnpm build` (`tsc -b && vite build`) | `✓ built in 427ms`, `BUILD_EXIT:0` (único aviso: chunk `index-*.js` >500KB, preexistente, no causado por el corpus) | ✅ PASS
G2-6 | Corpus fuera del bundle inicial | muestra `provisions[0].text` de `ar-ccyc-core.json` y `ar-cpccn-core.json` → `Select-String` sobre `dist/assets/index-*.js` y sobre `dist/assets/*.js` | `NO_LEAK_IN_INITIAL_BUNDLE` y `NO_LEAK_IN_ANY_ASSET` (0 coincidencias) | ✅ PASS
G2-7 | Corpus publicado en `dist` | `Get-ChildItem -Recurse dist/legal`; `diff public/legal/packs/index.json dist/legal/packs/index.json` | `dist/legal/packs/` contiene los 3 packs + `index.json` + `README.md`; diff público↔dist exit 0 (idénticos) | ✅ PASS
G2-8 | Tamaño corpus ≤ 500 KB | `(Get-ChildItem -Recurse -File public/legal/packs \| Measure Length -Sum).Sum` | **16403 bytes** (`ar-ccyc-core 5251` + `ar-cpccn-core 7298` + `ar-ldc-core 3077` + `index.json 777`), límite 512000 → **3.2% del presupuesto** | ✅ PASS
G2-9 | 0 secretos (trackeados) | `git grep -n -E 'sk-[A-Za-z0-9_-]{20,}'`, `'ghp_'`, `'gsk_'`, `'AIza'`, `'AKIA'`, `'PRIVATE KEY'` sobre `.` | Único hit: `src/adapters/storage/LocalKeyVault.test.ts:41` `const secret = 'sk-live-super-secret-123'` — fixture explícitamente falso cuyo test asserts **no-filtrado** al JSON de settings (veredicto: aceptable, no es secreto real). Resto: sin hits (grep exit 1 = sin coincidencias) | ✅ PASS con observación (O-01)
G2-10 | 0 secretos (no trackeados: corpus/scripts/legal) | `Select-String` sobre `public/legal/**`, `scripts/legal/**`, `src/domain/legal/**`, `src/adapters/legal/**`, `src/features/legal/**` con los mismos 6 patrones | 0 coincidencias (`SCAN_DONE`) | ✅ PASS
G2-11 | `apiKey` sin valores reales | `git grep -n -i -E 'api[_-]?key'` | Solo nombres de campo/parámetro (`apiKey?: string`, `x-api-key`, `TEST_API_KEY='test-key'`), `.env.example` con `VITE_FIREBASE_*` **vacíos** (config pública por diseño, aceptable). Sin asignaciones con valores de ≥12 caracteres reales | ✅ PASS
G2-12 | 0 PII real (emails) | `Get-ChildItem -Recurse -Include *.ts,*.tsx,*.json src,scripts,public/legal \| Select-String '[A-Za-z0-9._%+-]+@...'` | 19 hits, todos ficticios: `@example.com` (dominio reservado), `abogado@estudio.com`, `nuevo@estudio.com`, `tu@correo.com`, `you@email.com`, `google@example.com`, `user@example.com` (vectores de urlPolicy) | ✅ PASS
G2-13 | 0 PII real (DNI/CUIT) | mismo barrido con patrón `[0-9]{2}[-.][0-9]{3,8}[-.][0-9]` | Hits solo en fixtures legales: `12.345.678`, `20-12345678-9`, `27-87654321-5`, `27.876.543` (dígitos secuenciales, obviamente ficticios); resto son IPs literales de `urlPolicy.test.ts`/`openUrl/index.test.ts` (vectores de red privada, no PII) | ✅ PASS
G2-14 | 0 PII real (tel/CBU/nombres) | barrido `11 [0-9]{4}-[0-9]{4}\|CBU\|alias:` + nombres | `11 1234-5678`, `CBU 0170099020000012345678`, `alias: juanperez.mp`, `Calle Falsa 123`, `Av. Siempre Viva 742`, `Juan Carlos García c/ María López` — secuenciales/ficticios, con redacción a tokens (`[CBU-1]`, kinds `person/doc/cuit/email/phone/cbu/address` en `src/domain/legal/redaction.ts:19,48,131-143`) | ✅ PASS
G2-15 | Corpus trazable 12/12 | parseo PowerShell de los 3 packs: campos `sourceUrl+sourceDate+textHash+verificationMethod` por provisión | `ar-ccyc-core 4/4`, `ar-cpccn-core 6/6`, `ar-ldc-core 2/2`, `missingFields=0`, `verified=true` en las 12; licencias `CC BY 2.5 AR (InfoLEG)` en los 3 packs | ✅ PASS
G2-16 | Hashes manifiesto↔packs | `verify-packs.mjs` (exit 0) + `src/adapters/legal/corpus.test.ts` (5 tests: hash canónico, textHash, manifiesto hash+bytes, ≤500KB, golden-set bien formado — todos en los 1356 verdes) | manifiesto `openher.legal.packs/1` lista 3/3 packs con hash y bytes coincidentes | ✅ PASS
G2-17 | Licencia documentada | lectura `public/legal/README.md` (tabla de contenido, fuentes InfoLEG/Boletín Oficial, licencia `CC BY 2.5 AR` + disclaimer de texto auténtico) y `docs/legal-packs.md` (§1 contenido, §2 formato, §3 integridad, curación/actualización) | Documentada en ambos archivos exigidos | ✅ PASS
G2-18 | Higiene: `console.log` | `Select-String 'console\.(log\|debug\|warn\|error\|info\|trace)'` sobre `src/**/*.ts(x)` | **0 coincidencias en `src/`** (`CONSOLE_DONE` vacío). Único `console.log` del repo: `scripts/legal/verify-packs.mjs:270` (salida `OK` del CLI) + `console.error` de reporte — uso legítimo de CLI, no debug debris (O-02) | ✅ PASS con observación
G2-19 | Higiene: TODOs | barrido `TODO\|FIXME\|XXX\|HACK` en alcance legal | 0 TODOs reales (únicos hits: la palabra española "todo" en comentarios de `analysisStore.ts:88`, `CitationGuardContext.tsx:35,68`) | ✅ PASS
G2-20 | Higiene: `any` en alcance legal | `Select-String '\bany\b'` en `src/domain/legal/**`, `src/adapters/legal/**` (+ `eslint-disable\|ts-ignore\|ts-expect-error`) | 0 coincidencias en ambos patrones | ✅ PASS
G2-21 | Sin huérfanos fuera de scope | `git status --short` (binario bueno) | Modificados: ficheros del plan M0–M3 (agent/chat/settings/storage). No trackeados (`??`): solo `.agents/legal_*`, `.env.example`, `docs/firebase.md`, `docs/legal-packs.md`, `firebase.json`, `pnpm-workspace.yaml`, `public/legal/`, `scripts/`, `src/adapters/{auth,legal}/`, `src/adapters/storage/{IndexedDbLegal*,legalContract*}`, `src/adapters/tools/legal/`, `src/app/firebaseConfig*`, `src/domain/{legal,ports/Legal*,tools,types/legal}`, `src/features/{auth,legal}`, `CaseLinkDialog*`, `ModesMenu*`, `chatStore.legal.test`, `LegalStep`, `WorkModeSection`, dicts i18n, `MemoryAuth`. `dist/`, `apk/`, `scratch/`, `coverage/`, `node_modules/` correctamente ignorados por `.gitignore` (no aparecen). Sin strays | ✅ PASS
G2-22 | Historial reciente sin secretos | `git log --oneline -15` | Solo 3 commits, todos **anteriores** al Modo Legal (`0cc2c9a` v1.1.0, `f939117` M1..M6, `8aa8e69` M1+M2); todo el trabajo legal está **sin commitear** en worktree, ya cubierto por G2-9–G2-11. Nada nuevo que auditar en `git log -p` | ✅ PASS (sin objeto: no hay commits nuevos)
G2-23 | `sw.js` no congela el corpus | `Select-String 'legal'` en `public/sw.js` | `sw.js:36,39`: `/legal/` evita cache-first, va siempre a red (conforme a plan A3) | ✅ PASS
G2-24 | `dist/legal` espeja `public/legal` | `diff` de `index.json` publicado vs empaquetado | Idénticos (exit 0) | ✅ PASS

## Conteos reales

- `pnpm exec tsc -b` → **exit 0**.
- `pnpm test` → **120 archivos / 1356 tests, 1356 passed, 0 failed** → **exit 0**. Corrige el baseline: 91/956 queda
  superado; el valor vigente verificado es **120/1356** (coincide con lo reportado por el último gate).
- `node scripts/legal/verify-packs.mjs` → **exit 0** (`verify-packs: OK`).
- `pnpm build` → **exit 0** (`✓ built in 427ms`; aviso de chunk >500KB preexistente, ajeno al corpus).
- Corpus `public/legal/packs/**` → **16403 bytes** (límite 512000; 3.2%).
- Bundle inicial `dist/assets/index-BXiDBIsv.js` → **854991 bytes**; `dist/` total **1189540 bytes**. Textos de
  provisiones (muestras de `ar-ccyc-core` y `ar-cpccn-core`) → **0 coincidencias** en `dist/assets/*.js`.
- Corpus: **3 packs / 3 normas / 12 provisiones**, 12/12 con `sourceUrl`+`sourceDate`+`textHash`+`verificationMethod`+`verified:true`.
- Golden set `scripts/legal/__fixtures__/golden-set.json` → **30 queries** (20 con `expect`, 10 con `expect:null` para gap report).

## DoD medibles del plan §5 — verificabilidad empírica

1. **Golden set 30 escritos, recall ≥80%** → ⚠️ **NO verificable hoy**: el golden set existe (30 queries, schema
   `openher.legal.golden-set/1`) y `corpus.test.ts` solo asserts parseabilidad/forma (línea 129+). Ningún test
   ejecuta retrieval sobre el golden set ni asserts umbral. Ver H-01.
2. **0 citas fuera del pack como `verified`** → ✅ verificable: `citation.test.ts` (40 tests) incluye propiedad
   `nunca marca verified una cita ausente del índice`, más `fallo/doctrina/expediente nunca se verifican`.
3. **100% provisiones con fuente+fecha+hash** → ✅ verificado empíricamente (G2-15/G2-16, 12/12 + `verify-packs` exit 0).
4. **100% documentos/análisis exportados con watermark + contador `verified/unverified`** → ✅ verificable por tests:
   `DOCUMENT_WATERMARK` (`document.ts:16-17`), watermark+disclaimer forzados (`document.ts:120-144`),
   contador `{verified, unverified}` (`adversarial.ts:868-877`), `document.test.ts:115-143` (watermark),
   `DocumentStudio.test.tsx` (consentimiento/bloqueo de export). El "100%" literal es afirmación de revisión de
   código, no demostrable solo desde el gate; sin contraevidencia.
5. **System prompt byte-idéntico en 10 turnos** → ⚠️ **parcial**: `systemPrompt.test.ts` prueba byte-estabilidad
   dentro del mismo día UTC (mecanismo anti-rotura de caché, 6 tests verdes) y `chatStore.legal.test.ts:233`
   toca hash del system; pero **no existe un test literal de "hash idéntico en 10 turnos legales consecutivos"**.
   Sin contraevidencia; se recomienda el test explícito (menor).
6. **0 tokens de PII en wire (20 fixtures)** → ✅ verificable: `redaction.test.ts` (14 tests, tokenización por kinds)
   + e2e `chatStore.legal.test.ts` (`0 PII en el wire: el brief viaja con tokens...`, seed `seedPiiCase` con 9
   valores crudos en `PII_RAW_VALUES`). Nota: el literal "20 fixtures" del plan no es exacto (9 valores e2e +
   batería unitaria); cobertura real equivalente, conteo del plan desactualizado (menor).
7. **`tsc`+`test`(+`build`) verdes; baseline re-verificado** → ✅ verificado (G2-1–G2-5; baseline actualizado a 120/1356).

## Hallazgos

### H-01 (media): sin medición automatizada del recall ≥80% sobre el golden set — DoD §5.1 no exigible hoy
- Evidencia: `src/adapters/legal/corpus.test.ts:129+` (`el golden set es parseable y declara expectativas bien
  formadas`) no ejecuta `searchLegalPassages`/`buildLegalIndex` ni calcula recall; `grep recall|0\.8|80%` en
  `src,scripts,docs` no devuelve ninguna aserción de umbral (solo falsos positivos: `q=0.8` en Accept headers,
  `confidence: 0.8`, `ensureCalls`).
- Impacto: el corpus cubre 12 provisiones y el retrieval tiene 15 tests unitarios (`retrieval.test.ts`), pero el
  claim "≥80% de 30 escritos resuelven" no está medido en CI. Los 10 `expect:null` alimentan el gap report por diseño.
- Acción requerida (pre-G3): test que corra el índice sobre las 20 queries con `expect` y aserte recall ≥80%
  (p. ej. en `corpus.test.ts` o `retrieval.test.ts`), o enmendar el DoD si el umbral cambia.
- No bloquea G2 (la fila G2 del plan no incluye recall), por eso el veredicto es APROBADO CON CAMBIOS y no rechazo.

### O-01 (baja / observación): string con forma de `sk-` en test — falso positivo documentado
- `src/adapters/storage/LocalKeyVault.test.ts:41`: `const secret = 'sk-live-super-secret-123'` (y `sk-secret` en
  `:19-22`, `test-key` en fixtures de providers, `api-key-123` en `firebaseConfig.test.ts:31,38`). Todos son
  fixtures explícitamente falsos; el test de `:40-66` demuestra precisamente que el secreto **no** se filtra al
  JSON serializado. Aceptable por el criterio del gate. Sin acción.

### O-02 (baja / observación): `console.log` legítimo en script CLI
- `scripts/legal/verify-packs.mjs:270` (`console.log('verify-packs: OK...')`) + `console.error` de reporte.
  Es la UX de salida de una herramienta CLI, no debug debris; `src/` tiene **cero** `console.*`. Sin acción
  (opcional: redirigir a stdout ya lo hace; nada que cambiar).

### O-03 (baja / entorno): binarios de `X:\Dev` rotos en esta máquina
- `X:\Dev\nodejs\node.exe` y `X:\Dev\git\{cmd,bin}\git.exe` abortan con `-1073741818`. Reproducir la auditoría
  exige `G:\Dev\nodejs` primero en `PATH` y `C:\Program Files\Git\cmd\git.exe`. No es hallazgo del repo; se deja
  constancia para futuros gates. Sin acción en producto.

## Lo no ejecutado
- Nada del alcance G2 quedó sin ejecutar. `git log -p` de commits nuevos no aplica (no hay commits nuevos; §G2-22).
- No se ejecutó la app en dispositivo/emulador (fuera del alcance del gate G2, que es estático + tests + build).
