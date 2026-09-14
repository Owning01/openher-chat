#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Verificador de integridad del corpus normativo (Node ESM puro, sin deps).
//
// Uso:  node scripts/legal/verify-packs.mjs
// Salida: 0 si todos los packs y su manifiesto son consistentes; != 0 si algo
// no coincide (textHash de provisión, hash de pack, bytes del manifiesto o
// falta de cobertura del manifiesto).
//
// La normalización y el canon de hashing se copian VERBATIM de:
//   - src/domain/legal/hash.ts   -> `normalizeForDigest`
//   - src/domain/legal/packs.ts  -> `packDigestInput` (canonicalLicense/Source/
//     Norm/Provision) y `computePackHash`
// El SHA-256 se resuelve con `node:crypto` (builtin, no es una dependencia) y
// produce el mismo hex que la implementación JS pura de `hash.ts`. Si el
// contrato de dominio cambia, este script debe actualizarse en el mismo commit.
// ---------------------------------------------------------------------------

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT_URL = new URL('../../', import.meta.url);
const PACKS_DIR_URL = new URL('public/legal/packs/', REPO_ROOT_URL);
const MANIFEST_URL = new URL('index.json', PACKS_DIR_URL);
const MANIFEST_SCHEMA = 'openher.legal.packs/1';
const PACK_SCHEMA = 'openher.legal.pack/1';

// --- Copiado de src/domain/legal/hash.ts ------------------------------------

/**
 * Normaliza un texto para calcular su `textHash`:
 *  1. `\r\n` y `\r` -> `\n`.
 *  2. Cada línea colapsa espacios/tabs repetidos a uno y hace `trim`.
 *  3. Colapsa 3+ saltos consecutivos a una única línea en blanco.
 *  4. Recorta las líneas en blanco al inicio y al final.
 */
export function normalizeForDigest(text) {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t\f\v]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** SHA-256 de un string UTF-8 en hex minúsculas (idéntico a `sha256Hex`). */
export function sha256Hex(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

// --- Copiado de src/domain/legal/packs.ts -----------------------------------

function canonicalLicense(license) {
  const canonical = {
    name: license.name,
    url: license.url,
    attribution: license.attribution,
  };
  if (license.verifiedAt !== undefined) canonical.verifiedAt = license.verifiedAt;
  return canonical;
}

function canonicalSource(source) {
  const canonical = {
    url: source.url,
    retrievedAt: source.retrievedAt,
  };
  if (source.note !== undefined) canonical.note = source.note;
  return canonical;
}

function canonicalNorm(norm) {
  const canonical = {
    id: norm.id,
    short: norm.short,
    long: norm.long,
    jurisdiction: norm.jurisdiction,
  };
  if (norm.aliases !== undefined) canonical.aliases = norm.aliases;
  if (norm.sourceUrl !== undefined) canonical.sourceUrl = norm.sourceUrl;
  return canonical;
}

function canonicalProvision(provision) {
  const canonical = {
    id: provision.id,
    normId: provision.normId,
    article: provision.article,
    text: provision.text,
    jurisdiction: provision.jurisdiction,
    sourceUrl: provision.sourceUrl,
    sourceDate: provision.sourceDate,
    textHash: provision.textHash,
    verificationMethod: provision.verificationMethod,
    tags: provision.tags,
    verified: provision.verified,
  };
  if (provision.title !== undefined) canonical.title = provision.title;
  if (provision.synonyms !== undefined) canonical.synonyms = provision.synonyms;
  if (provision.curatedBy !== undefined) canonical.curatedBy = provision.curatedBy;
  if (provision.curatedAt !== undefined) canonical.curatedAt = provision.curatedAt;
  return canonical;
}

/** Canon del pack: `{schema,id,version,publishedAt,license,sources,norms,provisions}`. */
export function packDigestInput(pack) {
  return JSON.stringify({
    schema: pack.schema,
    id: pack.id,
    version: pack.version,
    publishedAt: pack.publishedAt,
    license: canonicalLicense(pack.license),
    sources: pack.sources.map(canonicalSource),
    norms: pack.norms.map(canonicalNorm),
    provisions: pack.provisions.map(canonicalProvision),
  });
}

/** SHA-256 del canon del pack. */
export function computePackHash(pack) {
  return sha256Hex(packDigestInput(pack));
}

// --- Verificación ------------------------------------------------------------

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function checkPack(raw, label, errors) {
  if (!isRecord(raw)) {
    errors.push(`${label}: el pack no es un objeto`);
    return;
  }
  if (raw.schema !== PACK_SCHEMA) {
    errors.push(`${label}.schema: se esperaba ${PACK_SCHEMA}`);
  }
  if (!Array.isArray(raw.provisions)) {
    errors.push(`${label}.provisions: se esperaba un array`);
    return;
  }
  const seen = new Set();
  raw.provisions.forEach((provision, index) => {
    const path = `${label}.provisions[${index}]`;
    if (!isRecord(provision)) {
      errors.push(`${path}: no es un objeto`);
      return;
    }
    if (typeof provision.text !== 'string') {
      errors.push(`${path}.text: se esperaba un string`);
      return;
    }
    if (typeof provision.textHash !== 'string') {
      errors.push(`${path}.textHash: falta el hash del texto`);
    } else {
      const expected = sha256Hex(normalizeForDigest(provision.text));
      if (expected !== provision.textHash) {
        errors.push(`${path}.textHash: no coincide con el texto normalizado`);
      }
    }
    if (typeof provision.sourceUrl !== 'string' || provision.sourceUrl.trim() === '') {
      errors.push(`${path}.sourceUrl: requerido`);
    }
    if (typeof provision.sourceDate !== 'string' || provision.sourceDate.trim() === '') {
      errors.push(`${path}.sourceDate: requerido`);
    }
    if (provision.verified !== true) {
      errors.push(`${path}.verified: se exige true en packs publicados`);
    }
    if (typeof provision.id === 'string') {
      if (seen.has(provision.id)) errors.push(`${path}.id: duplicado (${provision.id})`);
      seen.add(provision.id);
    }
  });

  if (typeof raw.hash !== 'string') {
    errors.push(`${label}.hash: falta el hash del pack`);
  } else {
    const expected = computePackHash(raw);
    if (expected !== raw.hash) {
      errors.push(`${label}.hash: no coincide con el canon del pack`);
    }
  }
}

function verify() {
  const errors = [];
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(MANIFEST_URL, 'utf8'));
  } catch (error) {
    return [`index.json: no se pudo leer/parsear (${error.message})`];
  }

  if (!isRecord(manifest) || manifest.schema !== MANIFEST_SCHEMA) {
    errors.push(`index.json.schema: se esperaba ${MANIFEST_SCHEMA}`);
  }
  if (!isRecord(manifest) || !Array.isArray(manifest.packs)) {
    errors.push('index.json.packs: se esperaba un array');
    return errors;
  }

  const filesOnDisk = readdirSync(PACKS_DIR_URL)
    .filter((name) => name.endsWith('.json') && name !== 'index.json')
    .sort();
  const listedUrls = new Set();

  manifest.packs.forEach((entry, index) => {
    const path = `index.json.packs[${index}]`;
    if (!isRecord(entry) || typeof entry.url !== 'string') {
      errors.push(`${path}.url: requerido`);
      return;
    }
    listedUrls.add(entry.url);
    const packUrl = new URL(entry.url.replace(/^legal\/packs\//, ''), PACKS_DIR_URL);
    let raw;
    let actualBytes;
    try {
      const contents = readFileSync(packUrl, 'utf8');
      raw = JSON.parse(contents);
      actualBytes = statSync(packUrl).size;
    } catch (error) {
      errors.push(`${path}.url: no se pudo leer el pack (${error.message})`);
      return;
    }
    const label = entry.url;
    checkPack(raw, label, errors);
    if (isRecord(raw)) {
      if (raw.id !== entry.id) errors.push(`${path}.id: no coincide con ${label}.id`);
      if (raw.version !== entry.version) {
        errors.push(`${path}.version: no coincide con ${label}.version`);
      }
      if (raw.hash !== entry.hash) {
        errors.push(`${path}.hash: no coincide con ${label}.hash`);
      }
    }
    if (entry.available !== true) errors.push(`${path}.available: se esperaba true`);
    if (entry.bytes !== actualBytes) {
      errors.push(`${path}.bytes: declarado ${entry.bytes}, real ${actualBytes}`);
    }
  });

  for (const file of filesOnDisk) {
    const url = `legal/packs/${file}`;
    if (!listedUrls.has(url)) errors.push(`index.json: falta listar ${url}`);
  }
  if (manifest.packs.length !== filesOnDisk.length) {
    errors.push(
      `index.json.packs: ${manifest.packs.length} entradas para ${filesOnDisk.length} packs en disco`,
    );
  }
  return errors;
}

// --- Entrada ----------------------------------------------------------------

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  const errors = verify();
  if (errors.length > 0) {
    console.error(`verify-packs: ${errors.length} problema(s) encontrado(s)`);
    for (const error of errors) console.error(`  - ${error}`);
    process.exitCode = 1;
  } else {
    const packsDir = fileURLToPath(PACKS_DIR_URL);
    console.log(`verify-packs: OK (${packsDir})`);
    process.exitCode = 0;
  }
}
