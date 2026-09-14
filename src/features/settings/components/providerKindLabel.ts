import type { ProviderKind } from '@/domain/types/provider';
import type { Translate } from '@/i18n/useT';

/** Etiqueta i18n del tipo de proveedor; centralizada para no repetir ternarios. */
export function providerKindLabel(kind: ProviderKind, t: Translate): string {
  switch (kind) {
    case 'anthropic':
      return t('settings.providerKindAnthropic');
    case 'openai-responses':
      return t('settings.providerKindResponses');
    case 'opencode':
      return t('settings.providerKindOpencode');
    case 'openai-compatible':
    default:
      return t('settings.providerKindOpenai');
  }
}
