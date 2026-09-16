// ---------------------------------------------------------------------------
// Packs normativos: parseo/validación puros, canon estable y hashing SHA-256.
// Sin IO, sin dependencias y sin lanzar: los errores degradan a `null`/`errors`.
// ---------------------------------------------------------------------------

import { normalizeForDigest, sha256Hex, type Hasher } from './hash';
import type {
  LegalJurisdiction,
  LegalMatter,
  LegalNorm,
  LegalPack,
  LegalProvision,
} from '../types/legal';

/** Opciones de validación/parseo de packs. */
export interface PackValidationOptions {
  /** Hasher inyectable; por defecto SHA-256 JS puro. */
  hasher?: Hasher;
  /** Si es `true`, recomputa `textHash` sobre el texto normalizado y exige match. */
  verifyTextHashes?: boolean;
}

type LegalPackLicense = LegalPack['license'];
type LegalSource = LegalPack['sources'][number];
type LegalVerificationMethod = LegalProvision['verificationMethod'];

const JURISDICTIONS: readonly string[] = ['national', 'caba', 'pba', 'cordoba', 'tucuman'];
const MATTERS: readonly string[] = ['civil', 'commercial', 'civil-commercial'];
const VERIFICATION_METHODS: readonly string[] = ['manual', 'scripted', 'user-provided'];

// ---------------------------------------------------------------------------
// Guardas de tipo (sin `any`).
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item: unknown) => typeof item === 'string');
}

function isJurisdiction(value: unknown): value is LegalJurisdiction {
  return typeof value === 'string' && JURISDICTIONS.includes(value);
}

function isMatter(value: unknown): value is LegalMatter {
  return typeof value === 'string' && MATTERS.includes(value);
}

function isVerificationMethod(value: unknown): value is LegalVerificationMethod {
  return typeof value === 'string' && VERIFICATION_METHODS.includes(value);
}

// ---------------------------------------------------------------------------
// Canon estable: orden fijo de claves, independiente del orden de inserción
// del objeto de entrada. Excluye `hash` (se deriva del canon) y, por contrato
// congelado, `title`/`jurisdiction`/`matter`.
// ---------------------------------------------------------------------------

function canonicalLicense(license: LegalPackLicense): Record<string, unknown> {
  const canonical: Record<string, unknown> = {
    name: license.name,
    url: license.url,
    attribution: license.attribution,
  };
  if (license.verifiedAt !== undefined) canonical.verifiedAt = license.verifiedAt;
  return canonical;
}

function canonicalSource(source: LegalSource): Record<string, unknown> {
  const canonical: Record<string, unknown> = {
    url: source.url,
    retrievedAt: source.retrievedAt,
  };
  if (source.note !== undefined) canonical.note = source.note;
  return canonical;
}

function canonicalNorm(norm: LegalNorm): Record<string, unknown> {
  const canonical: Record<string, unknown> = {
    id: norm.id,
    short: norm.short,
    long: norm.long,
    jurisdiction: norm.jurisdiction,
  };
  if (norm.aliases !== undefined) canonical.aliases = norm.aliases;
  if (norm.sourceUrl !== undefined) canonical.sourceUrl = norm.sourceUrl;
  return canonical;
}

function canonicalProvision(provision: LegalProvision): Record<string, unknown> {
  const canonical: Record<string, unknown> = {
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

/**
 * Serialización canónica y determinista del pack para hashear:
 * `{schema,id,version,publishedAt,license,sources,norms,provisions}`.
 * El orden de las claves (y de los arrays) es el aquí definido.
 */
export function packDigestInput(pack: LegalPack): string {
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

/** SHA-256 del canon del pack; acepta un hasher inyectable. */
export function computePackHash(pack: LegalPack, hasher: Hasher = sha256Hex): string {
  return hasher(packDigestInput(pack));
}

// ---------------------------------------------------------------------------
// Lectura defensiva de la forma (sin construir nada si hay un tipo inválido).
// ---------------------------------------------------------------------------

function readLicenseShape(raw: unknown): LegalPackLicense | null {
  if (!isRecord(raw)) return null;
  const { name, url, attribution, verifiedAt } = raw;
  if (!isNonEmptyString(name) || !isNonEmptyString(url) || !isNonEmptyString(attribution)) {
    return null;
  }
  if (verifiedAt !== undefined && !isNonEmptyString(verifiedAt)) return null;
  const license: LegalPackLicense = { name, url, attribution };
  if (verifiedAt !== undefined) license.verifiedAt = verifiedAt;
  return license;
}

function readSourceShape(raw: unknown): LegalSource | null {
  if (!isRecord(raw)) return null;
  const { url, retrievedAt, note } = raw;
  if (!isNonEmptyString(url) || !isNonEmptyString(retrievedAt)) return null;
  if (note !== undefined && !isNonEmptyString(note)) return null;
  const source: LegalSource = { url, retrievedAt };
  if (note !== undefined) source.note = note;
  return source;
}

function readNormShape(raw: unknown): LegalNorm | null {
  if (!isRecord(raw)) return null;
  const { id, short, long, aliases, jurisdiction, sourceUrl } = raw;
  if (!isNonEmptyString(id) || !isNonEmptyString(short) || !isNonEmptyString(long)) return null;
  if (!isJurisdiction(jurisdiction)) return null;
  if (aliases !== undefined && !isStringArray(aliases)) return null;
  if (sourceUrl !== undefined && !isNonEmptyString(sourceUrl)) return null;
  const norm: LegalNorm = { id, short, long, jurisdiction };
  if (aliases !== undefined) norm.aliases = aliases;
  if (sourceUrl !== undefined) norm.sourceUrl = sourceUrl;
  return norm;
}

/**
 * Valida la forma de una provisión y la construye tipada.
 * `sourceUrl`, `sourceDate` y `textHash` son obligatorios: sin ellos es inválida.
 */
function readProvisionShape(raw: unknown): LegalProvision | null {
  if (!isRecord(raw)) return null;
  const {
    id,
    normId,
    article,
    title,
    text,
    jurisdiction,
    sourceUrl,
    sourceDate,
    textHash,
    verificationMethod,
    curatedBy,
    curatedAt,
    tags,
    synonyms,
    verified,
  } = raw;
  if (
    !isNonEmptyString(id) ||
    !isNonEmptyString(normId) ||
    !isNonEmptyString(article) ||
    !isNonEmptyString(text) ||
    !isJurisdiction(jurisdiction) ||
    !isNonEmptyString(sourceUrl) ||
    !isNonEmptyString(sourceDate) ||
    !isNonEmptyString(textHash) ||
    !isVerificationMethod(verificationMethod) ||
    !isStringArray(tags) ||
    typeof verified !== 'boolean'
  ) {
    return null;
  }
  if (title !== undefined && !isNonEmptyString(title)) return null;
  if (synonyms !== undefined && !isStringArray(synonyms)) return null;
  if (curatedBy !== undefined && !isNonEmptyString(curatedBy)) return null;
  if (curatedAt !== undefined && !isNonEmptyString(curatedAt)) return null;

  const provision: LegalProvision = {
    id,
    normId,
    article,
    text,
    jurisdiction,
    sourceUrl,
    sourceDate,
    textHash,
    verificationMethod,
    tags,
    verified,
  };
  if (title !== undefined) provision.title = title;
  if (synonyms !== undefined) provision.synonyms = synonyms;
  if (curatedBy !== undefined) provision.curatedBy = curatedBy;
  if (curatedAt !== undefined) provision.curatedAt = curatedAt;
  return provision;
}

function readPackShape(raw: unknown): LegalPack | null {
  if (!isRecord(raw)) return null;
  const {
    schema,
    id,
    title,
    version,
    publishedAt,
    jurisdiction,
    matter,
    license,
    sources,
    norms,
    provisions,
    hash,
  } = raw;

  if (schema !== 'openher.legal.pack/1') return null;
  if (
    !isNonEmptyString(id) ||
    !isNonEmptyString(title) ||
    !isNonEmptyString(version) ||
    !isNonEmptyString(publishedAt)
  ) {
    return null;
  }
  if (!isJurisdiction(jurisdiction) || !isMatter(matter)) return null;
  if (!isNonEmptyString(hash)) return null;

  const parsedLicense = readLicenseShape(license);
  if (parsedLicense === null) return null;

  if (!Array.isArray(sources) || !Array.isArray(norms) || !Array.isArray(provisions)) return null;

  const parsedSources: LegalSource[] = [];
  for (const source of sources) {
    const parsedSource = readSourceShape(source);
    if (parsedSource === null) return null;
    parsedSources.push(parsedSource);
  }

  const parsedNorms: LegalNorm[] = [];
  for (const norm of norms) {
    const parsedNorm = readNormShape(norm);
    if (parsedNorm === null) return null;
    parsedNorms.push(parsedNorm);
  }

  const parsedProvisions: LegalProvision[] = [];
  for (const provision of provisions) {
    const parsedProvision = readProvisionShape(provision);
    if (parsedProvision === null) return null;
    parsedProvisions.push(parsedProvision);
  }

  return {
    schema: 'openher.legal.pack/1',
    id,
    title,
    version,
    publishedAt,
    jurisdiction,
    matter,
    license: parsedLicense,
    sources: parsedSources,
    norms: parsedNorms,
    provisions: parsedProvisions,
    hash,
  };
}

// ---------------------------------------------------------------------------
// Validación semántica (hash de provisión y referencias entre normas).
// ---------------------------------------------------------------------------

interface ProvisionValidationResult {
  provision: LegalProvision | null;
  errors: string[];
}

function validateProvision(
  raw: unknown,
  options: PackValidationOptions,
  path: string,
): ProvisionValidationResult {
  const provision = readProvisionShape(raw);
  if (provision === null) {
    return {
      provision: null,
      errors: [
        `${path}: provisión inválida; requiere id, normId, article, text, jurisdiction válida, ` +
          'sourceUrl, sourceDate, textHash, verificationMethod, tags[] y verified',
      ],
    };
  }
  const errors: string[] = [];
  if (options.verifyTextHashes) {
    const hasher = options.hasher ?? sha256Hex;
    const expected = hasher(normalizeForDigest(provision.text));
    if (expected !== provision.textHash) {
      errors.push(`${path}.textHash: no coincide con el texto normalizado`);
    }
  }
  return errors.length === 0 ? { provision, errors } : { provision: null, errors };
}

/** `true` si la provisión cumple forma y, si se pide, su `textHash`. Nunca lanza. */
export function isProvisionValid(raw: unknown, options: PackValidationOptions = {}): boolean {
  return validateProvision(raw, options, 'provision').provision !== null;
}

/**
 * Valida un pack completo: campos de cabecera, licencia, fuentes, normas y cada
 * provisión (con `textHash` si `verifyTextHashes`), más integridad referencial y
 * duplicados. Devuelve `{ ok, errors }`; nunca lanza.
 */
export function validateLegalPack(
  pack: LegalPack,
  options: PackValidationOptions = {},
): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  try {
    if (!isRecord(pack)) {
      return { ok: false, errors: ['pack: debe ser un objeto'] };
    }
    if (pack.schema !== 'openher.legal.pack/1') {
      errors.push('schema: debe ser openher.legal.pack/1');
    }
    if (!isNonEmptyString(pack.id)) errors.push('id: string no vacío requerido');
    if (!isNonEmptyString(pack.version)) errors.push('version: string no vacío requerido');
    if (!isNonEmptyString(pack.title)) errors.push('title: string no vacío requerido');
    if (!isNonEmptyString(pack.publishedAt)) errors.push('publishedAt: string no vacío requerido');
    if (!isJurisdiction(pack.jurisdiction)) errors.push('jurisdiction: valor no permitido');
    if (!isMatter(pack.matter)) errors.push('matter: valor no permitido');
    if (readLicenseShape(pack.license) === null) {
      errors.push('license: {name,url,attribution} requerido');
    }

    if (!Array.isArray(pack.sources)) {
      errors.push('sources: array requerido');
    } else {
      pack.sources.forEach((source, index) => {
        if (readSourceShape(source) === null) {
          errors.push(`sources[${index}]: {url,retrievedAt} requerido`);
        }
      });
    }

    const normIds = new Set<string>();
    if (!Array.isArray(pack.norms)) {
      errors.push('norms: array requerido');
    } else {
      pack.norms.forEach((norm, index) => {
        const parsed = readNormShape(norm);
        if (parsed === null) {
          errors.push(`norms[${index}]: norma inválida`);
          return;
        }
        if (normIds.has(parsed.id)) errors.push(`norms[${index}].id: duplicado (${parsed.id})`);
        normIds.add(parsed.id);
      });
    }

    const provisionIds = new Set<string>();
    if (!Array.isArray(pack.provisions)) {
      errors.push('provisions: array requerido');
    } else {
      pack.provisions.forEach((provision, index) => {
        const path = `provisions[${index}]`;
        const result = validateProvision(provision, options, path);
        if (result.provision === null) {
          errors.push(...result.errors);
          return;
        }
        if (provisionIds.has(result.provision.id)) {
          errors.push(`${path}.id: duplicado (${result.provision.id})`);
        }
        provisionIds.add(result.provision.id);
        if (!normIds.has(result.provision.normId)) {
          errors.push(`${path}.normId: norma desconocida (${result.provision.normId})`);
        }
      });
    }
  } catch {
    return { ok: false, errors: ['pack: no se pudo validar (estructura hostil)'] };
  }
  return { ok: errors.length === 0, errors };
}

/**
 * Parsea y valida un pack desde JSON crudo (string u objeto). Si algo no cumple,
 * degrada a `null`; nunca lanza. Si `verifyTextHashes`, exige `textHash` correcto.
 */
export function parseLegalPack(
  raw: unknown,
  options: PackValidationOptions = {},
): LegalPack | null {
  try {
    const value: unknown = typeof raw === 'string' ? (JSON.parse(raw) as unknown) : raw;
    const pack = readPackShape(value);
    if (pack === null) return null;
    return validateLegalPack(pack, options).ok ? pack : null;
  } catch {
    return null;
  }
}
