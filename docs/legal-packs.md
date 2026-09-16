# Packs legales — curación, licencia y actualización

Documentación del corpus normativo local del modo legal (Argentina, civil y
comercial). Detalle de los datos publicados: `public/legal/README.md`.
Mapa de arquitectura del modo legal: `architecture.md` (§12-quater).

Estado: MVP nacional (Fase 1). Todo el corpus vive en el dispositivo como
assets estáticos versionados y verificables por hash. Nada sale del
dispositivo: los packs se validan en runtime antes de indexarse.

## 1. Contenido del corpus (v1.7.0)

| Pack | Norma | Provisiones | Versión |
| --- | --- | --- | --- |
| `ar-ccyc-full` | Código Civil y Comercial completo (Ley 26.994) | 2677 | 1.0.0 |
| `ar-ccyc-core` | CCyC — núcleo de prescripción (arts. 2554-2564) | 4 | 1.0.0 |
| `ar-cpccn-core` | CPCCN — núcleo | 6 | 1.0.0 |
| `ar-ldc-core` | Ley de Defensa del Consumidor — núcleo | 2 | 1.0.0 |
| `ar-cn-core` | Constitución Nacional — derechos y garantías | 12 | 1.0.0 |
| `ar-amparo-core` | Amparo y ley espía (16.986, 25.873, decretos) | 24 | 1.0.0 |
| `ar-tucuman-cpcct` | CPCCT Tucumán (Ley 9531) | 724 | 1.0.0 |
| `ar-tucuman-familia` | Procesal de Familia Tucumán (Ley 9581) | 329 | 1.0.0 |
| `ar-tucuman-laboral` | Procesal Laboral Tucumán (Ley 6204) | 164 | 1.0.0 |
| `ar-tucuman-constitucion` | Constitución de Tucumán (2006) | 187 | 1.0.0 |
| `ar-tucuman-acordadas` | Acordadas CSJ Tucumán | 52 | 1.0.0 |

Total: 11 packs, ~4200 provisiones, ~4.6 MB (los códigos completos son
grandes a propósito: el índice busca en el dispositivo y solo los pasajes
relevantes viajan al modelo). Tope: 6 MB (se audita `dist/legal/**`).
Los packs provinciales se generaron de documentos oficiales aportados por
el usuario (`importante/`) con `verificationMethod: scripted`.


## 2. Formato del pack (`openher.legal.pack/1`)

Cada pack es un JSON con `schema: "openher.legal.pack/1"` y esta estructura:

| Campo | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `schema` | string | sí | Siempre `openher.legal.pack/1`. |
| `id` | string | sí | Identificador estable (p. ej. `ar-ccyc-core`). |
| `title` | string | sí | Título legible del pack. |
| `version` | string | sí | Versión semántica del contenido curado. |
| `publishedAt` | string | sí | Fecha de publicación (`YYYY-MM-DD`). |
| `jurisdiction` | string | sí | `national`, `caba`, `pba` o `cordoba`. |
| `matter` | string | sí | `civil`, `commercial` o `civil-commercial`. |
| `license` | objeto | sí | `name`, `url`, `attribution`; `verifiedAt` opcional (ver §4). |
| `sources` | array | sí | Orígenes consultados: `url`, `retrievedAt`, `note?`. |
| `norms` | array | sí | Normas: `id`, `short`, `long`, `jurisdiction`, `aliases?`, `sourceUrl?`. |
| `provisions` | array | sí | Provisiones (ver tabla siguiente). |
| `hash` | string | sí | SHA-256 del canon del pack (ver §3). |

Campos obligatorios de cada provisión:

| Campo | Descripción |
| --- | --- |
| `id` | Identificador único en el pack (p. ej. `CCyC-2560`). Sin duplicados. |
| `normId` | Norma a la que pertenece (debe existir en `norms`). |
| `article` | Número del artículo como string (p. ej. `"52 bis"`). |
| `title` | Título del artículo (opcional). |
| `text` | Transcripción literal de la fuente. Nunca parafraseada. |
| `jurisdiction` | Jurisdicción de la provisión. |
| `sourceUrl` | URL de la fuente oficial de esta provisión. Obligatoria. |
| `sourceDate` | Fecha de la fuente (`YYYY-MM-DD`). Obligatoria. |
| `textHash` | SHA-256 del texto normalizado (ver §3). Obligatorio. |
| `verificationMethod` | `manual`, `scripted` o `user-provided`. |
| `curatedBy` / `curatedAt` | Quién y cuándo curó la provisión (opcional). |
| `tags` | Etiquetas de materia para retrieval. |
| `synonyms` | Sinónimos opcionales que también se indexan. |
| `verified` | En packs publicados del MVP: siempre `true`. |

Manifiesto (`public/legal/packs/index.json`, `schema: "openher.legal.packs/1"`):
lista cada pack con `id`, `version`, `hash`, `url`, `available: true` y
`bytes` (tamaño real del archivo en disco). Detecta desincronización entre
manifiesto y archivos.

## 3. Integridad por hash

Dos niveles de firma SHA-256, con la misma normalización y el mismo canon
en `src/domain/legal/hash.ts`, `src/domain/legal/packs.ts` y el verificador
`scripts/legal/verify-packs.mjs` (que los replica de forma autónoma, sin
dependencias, con `node:crypto`):

- `textHash` por provisión: `sha256Hex(normalizeForDigest(text))`, donde
  `normalizeForDigest` unifica saltos de línea (`\r\n`/`\r` a `\n`), colapsa
  espacios y tabulaciones repetidos por línea y recorta, reduce 3 o más
  saltos consecutivos a una línea en blanco y recorta los extremos.
- `hash` por pack: `computePackHash(pack)` = SHA-256 de la serialización
  canónica `{schema, id, version, publishedAt, license, sources, norms,
  provisions}` con orden de claves fijo y sin incluir el propio `hash`.

Regla de integridad: hash o `textHash` inválidos implican rechazo del pack
(tanto en el verificador como en runtime vía `packVerifier.ts` /
`LegalCorpus.ensureIndex`). Si el contrato de dominio cambia, el script debe
actualizarse en el mismo commit.

Para verificar todo el corpus desde la raíz del repo (Node, sin
dependencias):

```sh
node scripts/legal/verify-packs.mjs
```

Sale con código 0 si todo coincide (`textHash`, `hash`, `bytes` del
manifiesto y cobertura total del manifiesto) y distinto de 0 en caso
contrario. Además, `src/adapters/legal/corpus.test.ts` aplica las mismas
comprobaciones con `parseLegalPack(raw, { verifyTextHashes: true })` y
`computePackHash`, y corta si el total supera los 500 KB.

## 4. Licencia

Los textos se transcriben de fuentes oficiales:

- InfoLEG, Ministerio de Justicia de la Nación:
  <http://www.infoleg.gob.ar/>.
- Boletín Oficial de la República Argentina:
  <https://www.boletinoficial.gob.ar/>.

Cada pack declara su licencia en el campo `license`. La licencia declarada
por la fuente para esta curaduría es **CC BY 2.5 AR (InfoLEG)**, con
atribución a `InfoLEG — Ministerio de Justicia de la Nación` (`license.name`,
`license.url` y `license.attribution`, con `license.verifiedAt`). Esta
declaración registra lo informado por el origen; no reemplaza los términos
que InfoLEG o el Boletín Oficial publiquen.

Notas de honestidad de licencia:

- El alcance exacto de la cobertura CC BY 2.5 AR sobre cada texto
  transcripto y los términos del aviso legal de InfoLEG están **a verificar**
  contra lo que InfoLEG publique; ante duda, el texto de referencia es el
  del Boletín Oficial.
- Si una licencia no puede confirmarse, el pack debe declararla como no
  verificada (`license.name = 'unverified'`) y la auditoría de integridad
  (G2) no cierra hasta documentarlo.
- Contenido normativo y plantillas son datos es-AR y no pasan por i18n.

## 5. Cómo curar un pack nuevo (paso a paso)

1. Elegir norma y artículos desde un caso de uso típico o desde el gap
   report (§8). El MVP cura por casos de uso, no por código completo.
2. Transcribir cada artículo **literalmente** desde el boletín o registro
   oficial correspondiente. Reglas innegociables: no inventar, no
   parafrasear, no completar artículos. Lo que falte queda fuera y se anota
   en el gap report.
3. Crear el JSON del pack (`public/legal/packs/<id>.json`) con todos los
   campos obligatorios de §2: `sourceUrl`, `sourceDate`,
   `verificationMethod` (`manual` o `scripted` para normativa;
   `user-provided` solo para aportes locales del usuario, ver §7),
   `tags`, `verified` y `license` (o marcada como no verificada).
4. Calcular `textHash` de cada provisión y `hash` del pack con el mismo
   canon de §3 (vía el código de dominio, nunca a mano con otro algoritmo).
5. Registrar el pack en `public/legal/packs/index.json` con `id`, `version`,
   `hash`, `url`, `available: true` y `bytes` reales.
6. Correr el verificador y el test de integridad antes de publicar:

```sh
node scripts/legal/verify-packs.mjs
pnpm exec vitest run src/adapters/legal/corpus.test.ts
```

7. Comprobar el presupuesto de tamaño (total ≤ 500 KB) y actualizar la
   tabla de contenido de `public/legal/README.md` y de este documento.

## 6. Actualización del corpus sin reinstalar

Los packs viajan como assets estáticos (`public/legal/packs/`). Para que una
actualización llegue sin reinstalar la PWA ni recompilar la app:

- `public/sw.js` no aplica cache-first a `/legal/`.
- Las URLs de packs llevan `?v=<hash>` y el manifiesto se pide con
  cache-buster (`manifestUrl` / `packUrl` en `packLoader.ts`).
- La fuente única de packs instalados en runtime es el store IndexedDB
  `legalPacks`; `LegalCorpus.ensureIndex()` es asíncrono, idempotente y
  cacheado por `(packId, packVersion)`.

## 7. Protocolo por fases

- **Fase 1, MVP verificable (actual).** Packs curados por casos de uso
  típicos (CCyC, CPCCN núcleo, LDC). Toda provisión publicada con
  `sourceUrl` + `sourceDate` + `textHash` + `verificationMethod`; cero
  `verified: false`; tope de 500 KB; verificación con `verify-packs.mjs`.
- **Fase 2, aportes del usuario (sin redistribuir).** Normativa provincial u
  otras normas nacionales aportadas por el usuario: pack con `jurisdiction`
  correspondiente y fuente del boletín o registro oficial, con `sourceUrl`,
  `sourceDate` y `license` documentadas (o marcadas como no verificadas).
  Jurisprudencia o doctrina propia: solo como pack **local** con
  `verificationMethod: 'user-provided'`, fuente y licencia obligatorias, que
  **nunca** se distribuye en el repositorio ni en el paquete instalable.
- **Fase 3, medición hacia backlog.** `legal_search` sin resultados y
  `cite_article` no encontrado escriben un gap report local
  (norma, artículo, frecuencia) visible en la UI del expediente; esa métrica
  prioriza el próximo pack.

## 8. Gap report (lo que el MVP no incluye)

- Contratos en particular (compraventa, locación, obra, leasing, mutuo).
- Responsabilidad civil completa; solo su prescripción (arts. 2560/2562/2564).
- Ley General de Sociedades y derecho societario.
- Concursos y quiebras.
- Derechos reales y usucapión (solo acciones posesorias vía art. 2564).
- Derecho de familia y sucesorio.
- Códigos procesales provinciales (el MVP es nacional).
- Jurisprudencia y doctrina (excluidas de los packs redistribuibles por diseño).
- Normas de CABA, PBA y Córdoba (declaradas en el vocabulario, sin pack aún).

El golden set (`scripts/legal/__fixtures__/golden-set.json`) marca con
`expect: null` las consultas de estos dominios: son la entrada del gap
report y de la priorización del próximo pack.

## 9. Límites honestos

- El texto del corpus es **referencial**; el texto auténtico y jurídicamente
  vinculante es el publicado en el Boletín Oficial. La transcripción puede
  contener errores o estar desactualizada: verificar siempre contra la
  fuente oficial antes de presentar cualquier escrito.
- El modo legal no es asesoramiento legal automático ni reemplaza el
  criterio del profesional.
- Garantía del citation guard (existencia + fidelidad): ninguna cita fuera
  del índice se reporta como `verified`; los fragmentos entrecomillados
  deben ser substring verbatim de la provisión o se marcan `[VERIFICAR]`.
  Una paráfrasis sin comillas puede pasar como existencia verificada: por
  eso las tools devuelven siempre el texto de la provisión para cotejo
  humano.
- Alcance del MVP: sin jurisprudencia, doctrina ni códigos comentados; sin
  todas las provincias (nacional más CABA en vocabulario); sin parseo de
  PDF ni OCR; sin `.docx` ni PDF nativo; sin calendario procesal con UI;
  sin panel de privacidad dedicado (sí anonimización obligatoria por
  defecto con vista previa embebida); sin sincronización en la nube.

## 10. Referencias

- Datos: `public/legal/packs/*.json`, `public/legal/packs/index.json`,
  `public/legal/README.md`.
- Verificador: `scripts/legal/verify-packs.mjs`; fixtures:
  `scripts/legal/__fixtures__/golden-set.json`.
- Dominio: `src/domain/legal/hash.ts`, `src/domain/legal/packs.ts`,
  `src/domain/legal/retrieval.ts`, `src/domain/legal/citation.ts`.
- Adapters: `src/adapters/legal/packLoader.ts`,
  `src/adapters/legal/packVerifier.ts`, `src/adapters/legal/LegalCorpus.ts`.
- Plan: `.agents/legal_mode_plan.md` (§8 protocolo de curación, §11
  NO-objetivos); tablero: `.agents/legal_mode_board.json` (T26).
