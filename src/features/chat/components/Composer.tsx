import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';

import { useT } from '@/i18n/useT';
import { Send, Square, TriangleAlert } from '@/shared/icons';
import { Button, Switch, TextArea, Tooltip } from '@/shared/ui';

import type { ChatRunStatus } from '../state/chatStore';

/**
 * Ventana de gracia tras un envío: el segundo click de un doble click cae sobre
 * el botón Stop recién montado y cancelaría el turno (0 requests, draft perdido).
 */
export const STOP_GUARD_MS = 400;

export interface ComposerResearch {
  enabled: boolean;
  disabled: boolean;
  hint: string | null;
  onToggle: (enabled: boolean) => void;
}

export interface ComposerProps {
  status: ChatRunStatus;
  onSend: (text: string) => void;
  onStop: () => void;
  research?: ComposerResearch;
}

export function Composer({ status, onSend, onStop, research }: ComposerProps) {
  const t = useT();
  const [text, setText] = useState('');
  const busy = status !== 'idle';
  const canSend = text.trim() !== '' && !busy;
  const wasBusy = useRef(busy);
  const [stopReady, setStopReady] = useState(true);

  // Solo bloquea el Stop si el turno arrancó estando montado (evita el click del doble envío);
  // un run que ya venía corriendo al montar deja detener de inmediato.
  useEffect(() => {
    const started = !wasBusy.current && busy;
    wasBusy.current = busy;
    if (!started) {
      if (!busy) setStopReady(true);
      return undefined;
    }
    setStopReady(false);
    const timeout = window.setTimeout(() => setStopReady(true), STOP_GUARD_MS);
    return () => window.clearTimeout(timeout);
  }, [busy]);

  const submit = (): void => {
    if (!canSend) return;
    onSend(text.trim());
    setText('');
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key !== 'Enter' || event.shiftKey) return;
    if (event.nativeEvent.isComposing) return;
    event.preventDefault();
    submit();
  };

  return (
    <form
      data-testid="chat-composer"
      className="mx-auto flex w-full max-w-3xl flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      {research !== undefined ? (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Tooltip label={t('research.toggleLabel')}>
            <Switch
              checked={research.enabled}
              disabled={research.disabled}
              label={t('research.toggleLabel')}
              onCheckedChange={research.onToggle}
            />
          </Tooltip>
          <span className="font-medium text-text">{t('research.toggleLabel')}</span>
          {research.disabled ? <span className="text-muted">{t('research.toggleUnavailable')}</span> : null}
          {research.hint !== null ? (
            <span role="status" className="inline-flex min-w-0 items-center gap-1 text-warning">
              <TriangleAlert aria-hidden="true" className="size-3.5 shrink-0" />
              <span className="min-w-0 truncate" title={research.hint}>
                {research.hint}
              </span>
            </span>
          ) : null}
        </div>
      ) : null}
      <div className="flex w-full items-end gap-2">
        <TextArea
          autoResize
          rows={1}
          value={text}
          disabled={busy}
          placeholder={t('chat.composerPlaceholder')}
          aria-label={t('chat.composerPlaceholder')}
          className="flex-1"
          onChange={(event) => setText(event.target.value)}
          onKeyDown={handleKeyDown}
        />
        {busy ? (
          <Button
            type="button"
            variant="secondary"
            loading={status === 'stopping'}
            disabled={status === 'stopping' || !stopReady}
            icon={<Square aria-hidden="true" className="size-4" />}
            onClick={onStop}
          >
            {t('chat.stop')}
          </Button>
        ) : (
          <Button type="submit" disabled={!canSend} icon={<Send aria-hidden="true" className="size-4" />}>
            {t('chat.send')}
          </Button>
        )}
      </div>
    </form>
  );
}
