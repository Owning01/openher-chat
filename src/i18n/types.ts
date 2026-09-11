export type Locale = 'es' | 'en';

export interface I18nSchema {}

export type Namespace = keyof I18nSchema;

export type MessageKey = {
  [NS in keyof I18nSchema]: `${NS & string}.${keyof I18nSchema[NS] & string}`;
}[keyof I18nSchema];

export type MessageParams = Record<string, string | number>;

export type DictSpec = {
  es: Record<string, string>;
  en: Record<string, string>;
};

export interface DefinedDict<Es extends Record<string, string>> {
  es: Es;
  en: { [K in keyof Es]: string };
}
