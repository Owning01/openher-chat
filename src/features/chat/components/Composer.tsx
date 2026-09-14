import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';

import { useT } from '@/i18n/useT';
import { matchCommands, expandSlashInput } from '@/domain/prompts/commands';
import type { SlashCommand } from '@/domain/prompts/commands';
import { Mic, Send, Square, TriangleAlert } from '@/shared/icons';
import { Button, Switch, TextArea, Tooltip } from '@/shared/ui';

import { CommandMenu } from './CommandMenu';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import type { ChatRunStatus } from '../state/chatStore';

/** Errores de micrófono que conviene explicar como permiso, no como "no disponible". */
function isPermissionError(value: string): boolean {
  return /denied|permission|not-allowed|denegado|permiso/i.test(value);
}

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
  const speech = useSpeechRecognition();
  const speechPrefix = useRef('');
  const [voiceNotice, setVoiceNotice] = useState<string | null>(null);
  const [highlighted, setHighlighted] = useState(0);

  // La paleta `/` solo está activa mientras se teclea el nombre del comando.
  const slashQuery =
    text.startsWith('/') && !text.includes(' ') && !text.includes('\n') ? text.slice(1) : null;
  const commands = slashQuery === null ? [] : matchCommands(slashQuery);
  const highlightedIndex = Math.min(highlighted, Math.max(0, commands.length - 1));

  const selectCommand = (command: SlashCommand): void => {
    setText(`/${command.name} `);
    setHighlighted(0);
  };

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
    if (speech.isListening) speech.stop();
    if (!canSend) return;
    onSend(expandSlashInput(text));
    setText('');
    setHighlighted(0);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.nativeEvent.isComposing) return;

    if (commands.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setHighlighted((current) => (current + 1) % commands.length);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setHighlighted((current) => (current - 1 + commands.length) % commands.length);
        return;
      }
      if (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey)) {
        event.preventDefault();
        const command = commands[highlightedIndex];
        if (command !== undefined) selectCommand(command);
        return;
      }
    }

    if (event.key !== 'Enter' || event.shiftKey) return;
    event.preventDefault();
    submit();
  };

  const toggleDictation = useCallback((): void => {
    setVoiceNotice(null);
    if (speech.isListening) {
      speech.stop();
      return;
    }
    if (!speech.supported) {
      setVoiceNotice(t('chat.voiceUnavailable'));
      return;
    }
    // Conserva lo escrito: el dictado se añade después del prefijo actual.
    speechPrefix.current = text;
    void speech
      .start(
        (transcript) => {
          const prefix = speechPrefix.current;
          setText(prefix + (prefix !== '' && transcript !== '' ? ' ' : '') + transcript);
        },
        (code) => setVoiceNotice(isPermissionError(code) ? t('chat.voicePermissionDenied') : t('chat.voiceUnavailable')),
      )
      .catch((error: unknown) => {
        speech.stop();
        const message = error instanceof Error ? error.message : '';
        setVoiceNotice(isPermissionError(message) ? t('chat.voicePermissionDenied') : t('chat.voiceUnavailable'));
      });
  }, [speech, text, t]);

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
      {voiceNotice !== null ? (
        <p role="status" className="text-xs text-warning">
          {voiceNotice}
        </p>
      ) : null}
      <div className="relative flex w-full items-end gap-2">
        {commands.length > 0 ? (
          <CommandMenu
            commands={commands}
            highlighted={highlightedIndex}
            onSelect={selectCommand}
            onHighlight={setHighlighted}
          />
        ) : null}
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
        {speech.supported ? (
          <Button
            type="button"
            variant={speech.isListening ? 'primary' : 'secondary'}
            iconOnly
            disabled={busy}
            aria-label={speech.isListening ? t('chat.voiceListening') : t('chat.voiceInput')}
            aria-pressed={speech.isListening}
            title={speech.isListening ? t('chat.voiceListening') : t('chat.voiceInput')}
            icon={<Mic aria-hidden="true" className="size-4" />}
            onClick={toggleDictation}
          />
        ) : null}
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
