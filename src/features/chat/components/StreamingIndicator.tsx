import { useT } from '@/i18n/useT';

/**
 * Estado "generando": tres puntos con rebote escalonado + etiqueta con
 * barrido de brillo. Decorar con `currentColor`, sin spinners genéricos.
 */
export function StreamingIndicator() {
  const t = useT();

  return (
    <div
      data-testid="chat-streaming-indicator"
      role="status"
      aria-label={t('chat.streaming')}
      className="flex items-center gap-2.5 px-1 py-2 text-xs text-muted"
    >
      <span aria-hidden="true" className="anim-dots">
        <span />
        <span />
        <span />
      </span>
      <span className="anim-shimmer-text font-medium">{t('chat.streaming')}</span>
    </div>
  );
}
