import { AlertBanner } from '@/app/layout/AlertBanner';
import type { MessageError, MessageErrorCode } from '@/domain/types/chat';
import { useT } from '@/i18n/useT';
import type { MessageKey } from '@/i18n/types';
import { Button } from '@/shared/ui';

const ERROR_KEYS: Record<MessageErrorCode, MessageKey> = {
  auth: 'chat.errorAuth',
  rate_limit: 'chat.errorRateLimit',
  network: 'chat.errorNetwork',
  timeout: 'chat.errorTimeout',
  server: 'chat.errorServer',
  invalid_request: 'chat.errorInvalidRequest',
  context_length: 'chat.errorContextLength',
  aborted: 'chat.errorAborted',
  unknown: 'chat.errorUnknown',
};

export interface ErrorBannerProps {
  error: MessageError;
  onRetry: () => void;
  className?: string;
}

export function ErrorBanner({ error, onRetry, className }: ErrorBannerProps) {
  const t = useT();

  return (
    <AlertBanner
      variant="danger"
      className={className}
      title={t(ERROR_KEYS[error.code])}
      description={error.message}
      action={
        error.retryable ? (
          <Button size="sm" variant="secondary" onClick={onRetry}>
            {t('chat.retry')}
          </Button>
        ) : undefined
      }
    />
  );
}
