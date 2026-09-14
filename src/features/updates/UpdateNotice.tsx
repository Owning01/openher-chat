import { useState } from 'react';

import { useServices } from '@/app/services';
import { useT } from '@/i18n/useT';
import { AlertBanner } from '@/app/layout/AlertBanner';

import { useUpdateCheck } from './useUpdateCheck';

const LINK_CLASSES =
  'inline-flex h-8 select-none items-center rounded-md bg-primary px-3 text-sm font-medium text-on-primary transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring';

const DISMISS_CLASSES =
  'inline-flex h-8 items-center rounded-md px-2 text-sm font-medium text-muted transition-colors hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring';

export interface UpdateNoticeProps {
  /** Chequeo automático al arrancar; el usuario puede desactivarlo en Ajustes. */
  enabled: boolean;
}

/** Aviso descartable cuando hay una versión nueva (comprobación al arrancar). */
export function UpdateNotice({ enabled }: UpdateNoticeProps) {
  const t = useT();
  const services = useServices();
  const [dismissed, setDismissed] = useState(false);
  const { state } = useUpdateCheck(services, { auto: enabled });

  if (dismissed || state.status !== 'available') return null;

  return (
    <div className="flex flex-col gap-3 px-4 pt-4">
      <AlertBanner
        variant="info"
        title={t('updates.noticeTitle', { version: state.manifest.version })}
        description={state.manifest.notes ?? t('updates.noticeDescription')}
        action={
          <div className="mt-1 flex items-center gap-2">
            <a href={state.manifest.apkUrl} className={LINK_CLASSES}>
              {t('updates.noticeAction')}
            </a>
            <button type="button" className={DISMISS_CLASSES} onClick={() => setDismissed(true)}>
              {t('updates.noticeDismiss')}
            </button>
          </div>
        }
      />
    </div>
  );
}
