import type { Translate } from '@/i18n/useT';

import type { ResearchWarning } from './selectors';

/** Texto accionable del aviso de configuración de búsqueda/proxy. */
export function researchWarningText(t: Translate, warning: ResearchWarning): string {
  switch (warning.kind) {
    case 'missingKey':
      return warning.provider === 'brave' ? t('research.warningBraveKey') : t('research.warningTavilyKey');
    case 'missingProxyUrl':
      return t('research.warningProxyUrl');
    case 'invalidProxyUrl':
      return t('research.warningInvalidProxyUrl');
    case 'browserWithoutProxy':
      return t('research.warningBrowserProxy');
  }
}
