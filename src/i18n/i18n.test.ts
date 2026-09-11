import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getLocale, getRegisteredDicts, registerDict, setLocale, subscribe, t } from './index';
import type { MessageKey } from './types';

const FALLBACK_NAMESPACE = 'test-fallback';
const fallbackKey = `${FALLBACK_NAMESPACE}.hello` as unknown as MessageKey;

registerDict(FALLBACK_NAMESPACE, { es: { hello: 'Hola' }, en: { hello: '' } });

const PROTO_NAMESPACE = 'test-proto';
registerDict(PROTO_NAMESPACE, {
  es: { greeting: 'Hola {constructor}', toString: 'Propia' },
  en: { greeting: 'Hi {constructor}', toString: 'Own' },
});

describe('i18n', () => {
  beforeEach(() => setLocale('es'));
  afterEach(() => setLocale('es'));

  it('todos los dicts registrados tienen paridad es/en', () => {
    const dicts = getRegisteredDicts();
    expect(dicts.size).toBeGreaterThan(0);

    for (const dict of dicts.values()) {
      expect(Object.keys(dict.en).sort()).toEqual(Object.keys(dict.es).sort());
    }
  });

  it('interpola parámetros {param}', () => {
    expect(t('common.confirmDelete', { name: 'Viaje' })).toContain('Viaje');
    setLocale('en');
    expect(t('common.confirmDelete', { name: 'Trip' })).toContain('Trip');
  });

  it('cambia de locale', () => {
    expect(t('common.save')).toBe('Guardar');
    setLocale('en');
    expect(getLocale()).toBe('en');
    expect(t('common.save')).toBe('Save');
  });

  it('cae a es cuando la traducción del locale activo está vacía', () => {
    setLocale('en');
    expect(t(fallbackKey)).toBe('Hola');
  });

  it('cae a la clave cuando no existe namespace o clave', () => {
    expect(t('common.unknown' as unknown as MessageKey)).toBe('common.unknown');
    expect(t('unknown.key' as unknown as MessageKey)).toBe('unknown.key');
  });

  it('no resuelve propiedades heredadas del prototipo', () => {
    expect(t('common.toString' as unknown as MessageKey)).toBe('common.toString');
    expect(t('common.constructor' as unknown as MessageKey)).toBe('common.constructor');
    expect(t('common.__proto__' as unknown as MessageKey)).toBe('common.__proto__');
    expect(t('__proto__.hello' as unknown as MessageKey)).toBe('__proto__.hello');
  });

  it('resuelve claves propias aunque colisionen con Object.prototype', () => {
    expect(t('test-proto.toString' as unknown as MessageKey)).toBe('Propia');
    setLocale('en');
    expect(t('test-proto.toString' as unknown as MessageKey)).toBe('Own');
  });

  it('no interpola parámetros heredados del prototipo', () => {
    expect(t('test-proto.greeting' as unknown as MessageKey, { other: 1 })).toBe('Hola {constructor}');
  });

  it('notifica a los suscriptores al cambiar de locale', () => {
    const listener = vi.fn();
    const unsubscribe = subscribe(listener);

    setLocale('en');
    expect(listener).toHaveBeenCalledTimes(1);

    setLocale('en');
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    setLocale('es');
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
