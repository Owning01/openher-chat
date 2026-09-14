import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';

import { useT } from '@/i18n/useT';
import type { Translate } from '@/i18n/useT';
import type { RedactionKind } from '@/domain/legal/redaction';
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

/** Conteo de tokens anonimizados por categoría (sin mapping ni valores originales). */
export type LegalRedactionCounts = Partial<Record<RedactionKind, number>>;

export interface ComposerLegal {
  /** Redacción activa: muestra el preview y exige consentimiento antes del primer envío. */
  redactionActive: boolean;
  /** Tokens anonimizados por categoría que saldrán del dispositivo con el envío. */
  redactedCounts: LegalRedactionCounts;
  /** Consentimiento ya persistido (p. ej. `LegalCase.consent`); abre el gate. */
  consentAccepted?: boolean;
  /** Notifica el cambio para que el padre lo persista; si no se persiste, el gate vale por sesión. */
  onConsentChange?: (accepted: boolean) => void;
}

export interface ComposerProps {
  status: ChatRunStatus;
  onSend: (text: string) => void;
  onStop: () => void;
  research?: ComposerResearch;
  /** Ausente = modo general (sin preview ni gate). Lo cablea T27 al vincular el expediente. */
  legal?: ComposerLegal;
}

/** Categorías de redacción en orden estable para el preview (mismo orden que `redaction.ts`). */
const REDACTION_KINDS: readonly RedactionKind[] = ['person', 'doc', 'cuit', 'email', 'phone', 'cbu', 'address'];

/** Etiqueta i18n por categoría de dato anonimizado. */
function redactionLabel(t: Translate, kind: RedactionKind): string {
  switch (kind) {
    case 'person':
      return t('legalTrust.redactionPerson');
    case 'doc':
      return t('legalTrust.redactionDoc');
    case 'cuit':
      return t('legalTrust.redactionCuit');
    case 'email':
      return t('legalTrust.redactionEmail');
    case 'phone':
      return t('legalTrust.redactionPhone');
    case 'cbu':
      return t('legalTrust.redactionCbu');
    case 'address':
      return t('legalTrust.redactionAddress');
  }
}

export function Composer({ status, onSend, onStop, research, legal }: ComposerProps) {
  const t = useT();
  const [text, setText] = useState('');
  const busy = status !== 'idle';
  // Gate de confidencialidad (modo legal con redacción activa): bloquea el primer
  // envío hasta el consentimiento explícito. El consentimiento vale por sesión de
  // montaje salvo que el padre lo persista (vía `onConsentChange` → `LegalCase.consent`,
  // T22/T27); sin prop `legal` el composer no cambia.
  const legalGate = legal !== undefined && legal.redactionActive;
  const [sessionConsent, setSessionConsent] = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(true);
  const consentPersisted = legal?.consentAccepted === true;
  const consentGiven = !legalGate || consentPersisted || sessionConsent;
  const needsConsent = legalGate && !consentGiven;
  const canSend = text.trim() !== '' && !busy && !needsConsent;
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

  const handleConsentChange = (accepted: boolean): void => {
    setSessionConsent(accepted);
    legal?.onConsentChange?.(accepted);
  };

  // Entradas del preview: sólo categorías con conteo > 0 (el mapping nunca sale).
  const redactionEntries =
    legalGate && legal !== undefined
      ? REDACTION_KINDS.map((kind) => ({ kind, count: legal.redactedCounts[kind] ?? 0 })).filter(
          (entry) => entry.count > 0,
        )
      : [];

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
      {legalGate && legal !== undefined ? (
        <section
          data-testid="legal-privacy-preview"
          aria-label={t('legalTrust.privacyTitle')}
          className="rounded-xl border border-border bg-surface px-3 py-2 text-xs text-text"
        >
          <div className="flex items-center gap-2">
            <span className="font-medium">{t('legalTrust.privacyTitle')}</span>
            <button
              type="button"
              aria-expanded={privacyOpen}
              onClick={() => setPrivacyOpen((open) => !open)}
              className="ml-auto shrink-0 font-medium text-muted underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
            >
              {privacyOpen ? t('legalTrust.privacyHide') : t('legalTrust.privacyShow')}
            </button>
          </div>
          {privacyOpen ? (
            <div className="mt-1.5 space-y-1.5">
              {redactionEntries.length === 0 ? (
                <p className="text-muted">{t('legalTrust.privacyEmpty')}</p>
              ) : (
                <ul className="flex flex-wrap gap-x-3 gap-y-0.5 text-muted">
                  {redactionEntries.map((entry) => (
                    <li key={entry.kind}>
                      {redactionLabel(t, entry.kind)}: {entry.count}
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-muted">{t('legalTrust.privacyNote')}</p>
              {consentGiven ? (
                <p role="status" className="font-medium">
                  {t('legalTrust.consentAccepted')}
                </p>
              ) : (
                <>
                  <label className="flex cursor-pointer items-start gap-2">
                    <input
                      type="checkbox"
                      checked={sessionConsent}
                      onChange={(event) => handleConsentChange(event.target.checked)}
                      className="mt-0.5 size-4 shrink-0"
                    />
                    <span>{t('legalTrust.consentLabel')}</span>
                  </label>
                  <p className="text-warning">{t('legalTrust.consentRequired')}</p>
                </>
              )}
              <p className="text-muted">{t('legalTrust.secrecyNotice')}</p>
              <p className="text-muted">{t('legalTrust.watermarkLabel')}</p>
            </div>
          ) : null}
        </section>
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
