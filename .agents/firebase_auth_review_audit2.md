# Auditoría — storage particionado por usuario + landing/login (audit2)

Fecha (UTC): 2026-09-14. Repo: `G:\Proyectos\openher-chat` (working tree con cambios sin commitear; los dos frentes están en el árbol de trabajo, no en HEAD).
Rol: AUDITOR (protocolo teamwork). No se modificó código de producto. Todo lo afirmado se ejecutó o leyó directamente.

## Veredicto: APROBADO

Los 4 gates están verdes con exit codes reales, las particiones/marcador existen en código con tests de aislamiento, la migración es fail-closed, el remount y el gate de auth verifican, la higiene es limpia y `docs/firebase.md` documenta particiones + nota de seguridad honesta.

| ID | Check | Evidencia | Resultado | Estado |
|----|-------|-----------|-----------|--------|
| 1 | `tsc -b` limpio | `G:\Dev\nodejs\node.exe .\node_modules\typescript\bin\tsc -b` → `TSC_EXIT:0` | exit 0, sin errores | ✅ |
| 2 | `pnpm test` conteo real | `vitest.mjs run` → `Test Files 122 passed (122)`, `Tests 1385 passed (1385)`, `VITEST_EXIT:0`, duración 34.55 s | **confirma 122/1385** (no corrige el gate previo) | ✅ |
| 3 | `verify-packs.mjs` | `node scripts/legal/verify-packs.mjs` → `verify-packs: OK (…\public\legal\packs\)`, `VERIFY_EXIT:0` | exit 0 | ✅ |
| 4 | `pnpm build` (tras 1-3 verdes) | `tsc -b` → `TSC_EXIT:0` + `vite.js build` → `✓ built in 492ms`, `VITE_EXIT:0` (sólo warning de chunk >500 kB, preexistente) | exit 0 | ✅ |
| 5a | Partición settings `openher.settings.v1:<uid>` | `src/adapters/storage/LocalSettingsRepository.ts:5` (`SETTINGS_STORAGE_KEY`), `:11-14` (`settingsStorageKey` sufija `:<owner>`); test `LocalSettingsRepository.test.ts:61-65,67-81` (aislamiento owner-a/owner-b/global) | existe + test de aislamiento | ✅ |
| 5b | Partición keys `openher.key.<uid>:<ref>` | `src/adapters/storage/LocalKeyVault.ts:3` (`KEY_STORAGE_PREFIX`), `:6-12` (`keyStorageKey` → `openher.key.<owner>:<ref>`); test `LocalKeyVault.test.ts:74-78,80-96` (vaultA/vaultB/global aislados) | existe + test de aislamiento | ✅ |
| 5c | Partición IDB `openher-chat:<uid>` | `src/adapters/storage/idb.ts:25` (`DB_NAME='openher-chat'`), `:133-136` (`ownerDbName` → `` `${DB_NAME}:${sanitizeOwnerId}` ``); repos con `ownerId` (`IndexedDbConversations.ts:12,22,27`, `IndexedDbLegalCases.ts:26,38,43`, `IndexedDbLegalPacks.ts:8,19,23`); test `src/app/services.test.ts:201-253` (conversaciones, expedientes y packs aislados alice/bob/legacy) | existe + tests de aislamiento | ✅ |
| 5d | Marcador `openher.migrated.v1:<uid>` | `src/adapters/storage/ownerMigration.ts:17` (`MIGRATION_MARKER_PREFIX`), `:20-22` (`migrationMarkerKey`); tests `:96-99,104-113` (sella `'1'`; sin legacy también sella) | existe + tests | ✅ |
| 5e | Migración legacy cubierta | `ownerMigration.test.ts:74-102` (copia settings/keys/conv/mensajes/legal + limpia legacy), `:115-134` (idempotencia), `:136-158` y `:160-175` (fail-closed), `:177-188` (owner inválido no toca nada) | 6 tests, todos verdes en el run | ✅ |
| 6 | Fail-closed: borrado sólo tras verificación por conteo; marcador sólo en éxito; nunca lanza | `ownerMigration.ts:130-153` (`copyIndexedDbToOwner`, verifica por `count()`), `:161-181` (`cleanupLegacyIfVerified`: retorna `false` si `!storesVerified \|\| skippedLegacyItems>0`; `deleteDB`+`removeItem` y `setItem(marker,'1')` sólo dentro del `try` exitoso), `:183-199` (`copyStoreIfEmpty`: no toca destino no vacío, `verified=(count dest)>=legacyCount`), `:49-83` (`try/catch` global que devuelve `report` sin lanzar) + `App.tsx:99-104` (el caller además envuelve en try/catch best-effort) | verificado por lectura + tests 5e | ✅ |
| 7a | Remount `key={uid}` + `closeOwnerDb` en cleanup | `src/app/App.tsx:130-137` (`<AppShellContent key={uid} …/>`), `:118-121` (cleanup `closeOwnerDb(uid)`), import `:3` | verificado | ✅ |
| 7b | `createServices` con `userId` no rompe overrides | `src/app/services.tsx:73-90` (`options.userId ?? null`; overrides ganan con `??` en `:88-95`); test `services.test.ts:255-262` (legacy intacto sin options) y `:264-275` (dobles ignoran userId) | verificado | ✅ |
| 7c | `bootstrapApp` sin options intacto | `src/app/bootstrap.ts:21-24` (defaults `overrides={}`, `options={}`; `createServices(overrides, options)`); `bootstrap.test.ts:23-35,37-43` (firma vieja `bootstrapApp({...})` sigue pasando) | verificado | ✅ |
| 8a | Landing sin PII ni red | `LandingPage.tsx:1-5` (imports: sólo routing, i18n, iconos, ui — sin fetch/http); cuerpo `:24-112` (todo texto vía `t('auth.…')`; el ejemplo es genérico `sampleQuestion/sampleAnswer/sampleCite`; CTA → `navigate(LOGIN_HREF)`); grep `fetch\|XMLHttpRequest\|WebSocket\|axios\|http` en el archivo: 0 hits | verificado | ✅ |
| 8b | `#/login` parsea | `src/app/routing.tsx:39` (`head==='login'`), `:65` (`LOGIN_HREF='#/login'`); test `routing.test.tsx:32-35` | verificado | ✅ |
| 8c | AuthGate: landing por defecto, login en `#/login` | `src/features/auth/AuthGate.tsx:49` (`user===null → route.name==='login' ? <LoginScreen/> : <LandingPage/>`); tests `AuthGate.test.tsx:29-52` (portada sin sesión; login con `#/login`; sesión monta app; reacciona a sign-out) | verificado | ✅ |
| 8d | Paridad es/en dict `auth` | `src/i18n/dicts/auth.ts`: conteo por script → es 50 claves, en 50 claves, mismos conjuntos (el 51º match de `en` es `auth: AuthMessages` de la declaración de módulo, línea 120); además el test global de paridad `src/i18n/i18n.test.ts:21-28` (auto-registro por `import.meta.glob`, `src/i18n/index.ts:35`) pasó dentro del run verde | verificado por script + test | ✅ |
| 9a | 0 `console.*` en archivos nuevos/cambiados | grep `console\.` en `ownerMigration.ts`, `LandingPage.tsx`, `App.tsx`, `services.tsx`: 0 hits | limpio | ✅ |
| 9b | 0 TODOs/FIXMEs | grep case-sensitive `\bTODO\b\|\bFIXME\b` en ownerMigration/LandingPage/AuthGate/LoginScreen/services/App/bootstrap: 0 hits (nota: grep insensible anterior daba falsos positivos con el español "todo") | limpio | ✅ |
| 9c | 0 `any` en ellos | grep case-sensitive `\bany\b` en `ownerMigration.ts`, `LandingPage.tsx`, `App.tsx`, `services.tsx`: 0 hits | limpio | ✅ |
| 9d | 0 secretos/PII en fixtures nuevos | Fixtures usan valores sintéticos: `sk-legacy`, `sk-alice`, `sk-live-super-secret-123`, `sk-compartida`, `abogado@estudio.com`/`nuevo@estudio.com` (dominios de ejemplo), uids `uid-migracion-N`, `owner-a/b`. Sin API keys reales, sin `AIza`, sin claves privadas, sin PII real | sólo fakes de test | ✅ |
| 10 | `docs/firebase.md` documenta particiones + nota honesta | `:58-64` (partición por UID + arranque en dos fases + `key={uid}`), `:74-82` (claves legacy vs `:<uid>`, saneado, marcador), `:84-89` (migración copia-y-limpia-tras-verificar), `:91-96` (logout), `:98-105` (NOTA: localStorage/IndexedDB sin cifrado, sin aislamiento OS; keys nunca a logs, sólo al proveedor) | verificado | ✅ |

## Conteos reales

- `tsc -b` → exit `0` (vía `G:\Dev\nodejs\node.exe .\node_modules\typescript\bin\tsc -b`).
- `vitest run` → **122 archivos / 1385 tests, todos passed**, `VITEST_EXIT:0`, duración 34.55 s. Confirma el gate previo 122/1385 (sin corrección).
- `node scripts/legal/verify-packs.mjs` → `verify-packs: OK`, exit `0`.
- `vite build` → `✓ built in 492ms`, exit `0` (warning: chunk `index-DEmqsD-7.js` 866 kB > 500 kB — preexistente, no bloquea).
- i18n `auth`: 50 claves es / 50 claves en, conjuntos idénticos.
- `ownerMigration.test.ts`: 6 tests; `services.test.ts` bloque particionado: 7 tests; `AuthGate.test.tsx`: 4; `LandingPage.test.tsx`: 2; `routing.test.tsx` login: 1 (`#/login`).

## Hallazgos

1. [INFO] Entorno: `pnpm`/`node`/`git` en el `PATH` resuelven primero a `X:\Dev\…` (unidad inexistente) y crashean (`-1073741818`, sin salida). Ejecuté todo con binarios reales: `G:\Dev\nodejs\node.exe` (v24.19.0), `G:\Dev\nodejs\node.exe .\node_modules\vitest\vitest.mjs`, `G:\Dev\Git\cmd\git.exe`. Los exit codes citados son de esas ejecuciones. Recomendación no bloqueante: anteponer `G:\Dev\nodejs` y `G:\Dev\Git\cmd` al `PATH` de la sesión.
2. [INFO/BAJA] `App.tsx:192` — `AppShellContent` envuelve el shell en un segundo `AuthGate` además del de `BootedApp` (`App.tsx:76`). Con sesión ambos dejan pasar; es redundancia inofensiva, no defecto. Se deja como observación.
3. [INFO] `ownerMigration.ts:206-211` — `legacyKeyRef` excluye sufijos con >2 `:` (ya migradas o refs futuras con `:` extra). Esas claves cuentan como no-copiables y, por `:167` (`skippedLegacyItems>0 → false`), bloquean la limpieza (fail-closed, conservador y correcto). Sin acción.
4. [INFO] `IndexedDbConversations.test.ts` no tiene tests directos de `ownerId`, pero el aislamiento de conversaciones/expedientes/packs por owner está cubierto en `services.test.ts:201-253` contra los stores reales. Cobertura suficiente; sin acción.
5. [INFO] `git status` (con git real) muestra los dos frentes como cambios sin commitear en el árbol de trabajo (incluye `ownerMigration.ts`, `LandingPage.tsx`, `AuthGate`, `docs/firebase.md`, `services.tsx`, `App.tsx`, `idb.ts`, `LocalKeyVault.ts`, `LocalSettingsRepository.ts` y sus tests). La auditoría se hizo sobre ese árbol.

Nada que impida el merge. Sin `REJECTED`, sin cambios exigidos.
