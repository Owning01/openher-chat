# Corpus normativo — modo legal (MVP)

Este directorio contiene el corpus normativo **local, versionado y verificable por
hash** que alimenta el modo legal de OpenHer Chat. Nada de lo que aquí se publica
sale del dispositivo: los packs se empaquetan como assets estáticos y se validan
en runtime antes de indexarse.

- Packs: `public/legal/packs/*.json`
- Manifiesto: `public/legal/packs/index.json`
- Verificador: `scripts/legal/verify-packs.mjs`
- Golden set de recall: `scripts/legal/__fixtures__/golden-set.json`
- Test de integridad: `src/adapters/legal/corpus.test.ts`

## Contenido (v1.0.0)

| Pack | Norma | Provisiones | Versión |
| --- | --- | --- | --- |
| `ar-ccyc-core` | Código Civil y Comercial de la Nación (Ley 26.994) | 4 (arts. 2554, 2560, 2562, 2564) | 1.0.0 |
| `ar-cpccn-core` | Código Procesal Civil y Comercial de la Nación (Ley 17.454) | 6 (arts. 68, 310, 311, 330, 347, 377) | 1.0.0 |
| `ar-ldc-core` | Ley de Defensa del Consumidor (Ley 24.240) | 2 (arts. 50, 52 bis) | 1.0.0 |

Total: **3 packs, 3 normas, 12 provisiones, ~16 KB** (muy por debajo del tope del
MVP de 500 KB). Todas las provisiones están marcadas `verified: true` y llevan
`sourceUrl` + `sourceDate` + `textHash`.

El corpus es deliberadamente **núcleo y acotado**: cubre los artículos que los
casos de uso típicos de escritos civiles y comerciales citan con más frecuencia
(prescripción, requisitos de la demanda, excepciones previas, caducidad, prueba,
costas y consumo). No es una versión completa de cada código; ver *Gap report*.

## Fuentes y licencia

Los textos se transcriben de fuentes oficiales:

- **InfoLEG** — Ministerio de Justicia de la Nación (sistema de información
  legislativa): <http://www.infoleg.gob.ar/>.
- **Boletín Oficial de la República Argentina**: <https://www.boletinoficial.gob.ar/>.

Cada pack declara su licencia en el campo `license`. La licencia declarada por la
fuente para esta curaduría es **CC BY 2.5 AR (InfoLEG)**, con atribución a
`InfoLEG — Ministerio de Justicia de la Nación`
(`license.name`, `license.url` y `license.attribution`, con `license.verifiedAt`).
Esta declaración registra lo informado por el origen; no reemplaza los términos
que InfoLEG/Boletín Oficial publiquen.

> **Disclaimer.** El texto auténtico y jurídicamente vinculante es el publicado
> en el Boletín Oficial. La transcripción de este corpus se ofrece como material
> de referencia para asistir la redacción y la investigación; puede contener
> errores de transcripción o estar desactualizada. Verificá siempre contra la
> fuente oficial antes de presentar cualquier escrito.

## Integridad por hash

Cada provisión y cada pack se firman con SHA-256 usando la misma normalización y
el mismo canon que `src/domain/legal/hash.ts` y `src/domain/legal/packs.ts`:

- `provision.textHash = sha256Hex(normalizeForDigest(provision.text))`, donde
  `normalizeForDigest` unifica saltos de línea, colapsa espacios repetidos, reduce
  3+ saltos a una línea en blanco y recorta extremos.
- `pack.hash = computePackHash(pack)` = SHA-256 de la serialización canónica
  `{schema, id, version, publishedAt, license, sources, norms, provisions}` (con
  orden de claves fijo y sin el propio `hash`).
- `index.json` reproduce `hash` y `bytes` de cada pack para detectar desincronización.

Para verificar todo el corpus desde la raíz del repo (Node, sin dependencias):

```sh
node scripts/legal/verify-packs.mjs
```

El script sale con código 0 si todo coincide y con código ≠ 0 si algún `textHash`,
`hash`, `bytes` o entrada del manifiesto no cuadra. `src/adapters/legal/corpus.test.ts`
aplica las mismas comprobaciones con `parseLegalPack(raw, { verifyTextHashes: true })`
y `computePackHash`, y además corta si el total supera 500 KB.

### `index.json` (manifiesto)

```json
{
  "schema": "openher.legal.packs/1",
  "packs": [
    { "id": "ar-ccyc-core", "version": "1.0.0", "hash": "…", "url": "legal/packs/ar-ccyc-core.json", "available": true, "bytes": 5251 }
  ]
}
```

## Cómo agregar normativa en fase 2

Las fases futuras (normativa provincial y jurisprudencia propia) siguen reglas
estrictas **sin redistribuir** material de terceros:

1. **Normativa provincial/otras normas nacionales**: crear un pack con
   `jurisdiction` (`pba`, `cordoba`, `caba`, …) y `verificationMethod: 'manual'`
   o `'scripted'`, transcribiendo del boletín/registro oficial correspondiente.
   Documentar `sourceUrl`, `sourceDate` y `license` (o dejarla marcada como no
   verificada). Recomputar todos los hashes.
2. **Jurisprudencia o doctrina propia**: se incorporan como pack **local** con
   `verificationMethod: 'user-provided'`, fuente y licencia obligatorias, y
   **nunca** se distribuyen en el repositorio ni en el bundle.
3. Correr `node scripts/legal/verify-packs.mjs` y
   `pnpm exec vitest run src/adapters/legal/corpus.test.ts` antes de publicar.
4. Cualquier consulta que el retrieval no resuelva debe quedar registrada en el
   gap report local (F3) para priorizar el próximo pack.

Reglas de curaduría innegociables: **no inventar, no parafrasear y no completar
artículos** que no estén en la fuente aportada. Si falta un texto, se deja fuera
y se anota en el gap report.

## Gap report (lo que NO está)

El corpus MVP **no incluye**:

- **Contratos en particular** (compraventa, locación, obra, leasing, mutuo, etc.).
- **Responsabilidad civil completa** (régimen general, daño moral, función
  resarcitoria); solo se cubre su prescripción (arts. 2560/2562/2564).
- **Ley General de Sociedades (LGS)** y derecho societario.
- **Concursos y quiebras**.
- **Derechos reales** y usucapión (solo acciones posesorias vía art. 2564).
- **Derecho de familia y sucesorio**.
- **Códigos procesales provinciales** (el MVP es nacional).
- **Jurisprudencia y doctrina** (prohibidas en packs redistribuibles por diseño).
- Normas de **CABA, PBA y Córdoba** (declaradas en el vocabulario, sin pack aún).

El golden set (`scripts/legal/__fixtures__/golden-set.json`) marca con
`expect: null` las consultas de estos dominios: son la entrada del gap report y de
la priorización del próximo pack.
