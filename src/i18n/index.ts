import type { DefinedDict, DictSpec, Locale, MessageKey, MessageParams } from './types';

export const LOCALES: readonly Locale[] = ['es', 'en'];

const DEFAULT_LOCALE: Locale = 'es';
const FALLBACK_LOCALE: Locale = 'es';

const registry = new Map<string, DictSpec>();
const listeners = new Set<() => void>();

let currentLocale: Locale = DEFAULT_LOCALE;

export function defineDict<const Es extends Record<string, string>>(dict: {
  es: Es;
  en: { [K in keyof Es]: string };
}): DefinedDict<Es> {
  return dict;
}

export function registerDict(namespace: string, dict: DictSpec): void {
  registry.set(namespace, { es: dict.es, en: dict.en });
}

function isDictSpec(value: unknown): value is DictSpec {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { es?: unknown; en?: unknown };
  return (
    typeof candidate.es === 'object' &&
    candidate.es !== null &&
    typeof candidate.en === 'object' &&
    candidate.en !== null
  );
}

const modules = import.meta.glob<Record<string, unknown>>('./dicts/*.ts', { eager: true });

for (const [path, moduleExports] of Object.entries(modules)) {
  const file = path.slice(path.lastIndexOf('/') + 1);
  const namespace = file.replace(/\.tsx?$/, '');

  for (const value of Object.values(moduleExports)) {
    if (isDictSpec(value)) {
      registry.set(namespace, value);
      break;
    }
  }
}

function interpolate(template: string, params?: MessageParams): string {
  if (!params) return template;

  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    if (!Object.prototype.hasOwnProperty.call(params, name)) return match;
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}

/** Lee solo claves propias no vacías: nunca valores heredados del prototipo. */
function ownMessage(source: Record<string, string> | undefined, key: string): string | undefined {
  if (!source || !Object.prototype.hasOwnProperty.call(source, key)) return undefined;
  const value = source[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function t(key: MessageKey, params?: MessageParams): string {
  const [namespace, ...path] = (key as string).split('.');
  const messageKey = path.join('.');
  const dict = namespace ? registry.get(namespace) : undefined;
  const localized = ownMessage(dict?.[currentLocale], messageKey);
  const fallback = ownMessage(dict?.[FALLBACK_LOCALE], messageKey);

  return interpolate(localized ?? fallback ?? (key as string), params);
}

export function setLocale(locale: Locale): void {
  if (locale === currentLocale) return;
  currentLocale = locale;

  for (const listener of listeners) listener();
}

export function getLocale(): Locale {
  return currentLocale;
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getLocales(): readonly Locale[] {
  return LOCALES;
}

export function getRegisteredDicts(): ReadonlyMap<string, DictSpec> {
  return registry;
}
