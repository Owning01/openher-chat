/**
 * Manifiesto de actualización. Se publica en `version.json` (rama `main`) y el
 * APK cuelga de `releases/latest/download/...`: ambos enlaces son permanentes.
 */
export interface UpdateManifest {
  version: string;
  versionCode?: number;
  apkUrl: string;
  sha256?: string;
  notes?: string;
  publishedAt?: string;
}

export const UPDATE_MANIFEST_URL =
  'https://raw.githubusercontent.com/Owning01/openher-chat/main/version.json';

/** Valida un manifiesto crudo (ya parseado de JSON). Devuelve `null` si no sirve. */
export function parseUpdateManifest(raw: unknown): UpdateManifest | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const source = raw as Record<string, unknown>;

  const version = readString(source['version']);
  const apkUrl = readString(source['apkUrl']);
  if (version === null || apkUrl === null || !isHttpUrl(apkUrl)) return null;

  const manifest: UpdateManifest = { version, apkUrl };
  const versionCode = readInt(source['versionCode']);
  const sha256 = readString(source['sha256']);
  const notes = readString(source['notes']);
  const publishedAt = readString(source['publishedAt']);
  if (versionCode !== null) manifest.versionCode = versionCode;
  if (sha256 !== null) manifest.sha256 = sha256;
  if (notes !== null) manifest.notes = notes;
  if (publishedAt !== null) manifest.publishedAt = publishedAt;
  return manifest;
}

/** Compara versiones por segmentos numéricos: `>0` si `a` es mayor que `b`. */
export function compareVersions(a: string, b: string): number {
  const left = versionParts(a);
  const right = versionParts(b);
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

/** `true` si `candidate` es estrictamente más nueva que `current`. */
export function isNewerVersion(candidate: string, current: string): boolean {
  return compareVersions(candidate, current) > 0;
}

function versionParts(value: string): number[] {
  return value
    .trim()
    .split(/[.+_-]/)
    .map((part) => {
      const parsed = Number.parseInt(part, 10);
      return Number.isFinite(parsed) ? parsed : 0;
    });
}

function readString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function readInt(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  return Math.floor(value);
}

function isHttpUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol;
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}
