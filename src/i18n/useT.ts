import { useSyncExternalStore } from 'react';

import { getLocale, subscribe, t } from './index';
import type { Locale, MessageKey, MessageParams } from './types';

export type Translate = (key: MessageKey, params?: MessageParams) => string;

export function useT(): Translate {
  useSyncExternalStore(subscribe, getLocale, getLocale);
  return t;
}

export function useLocale(): Locale {
  return useSyncExternalStore(subscribe, getLocale, getLocale);
}
