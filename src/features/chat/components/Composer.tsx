import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';

import { useT } from '@/i18n/useT';
import type { Translate } from '@/i18n/useT';
import type { RedactionKind } from '@/domain/legal/redaction';
import type { ChatMessage } from '@/domain/types/chat';
import { computeContextBreakdown } from '@/domain/chat/estimateTokens';
import { AUTOCOMPACT_THRESHOLD_TOKENS } from '@/domain/agent/compaction';
import {
  composeMessageWithAttachments,
  isSupportedAttachment,
  MAX_ATTACHMENTS,
  readAttachmentText,
  readFileBuffer,
  toAttachmentDraft,
} from '@/domain/chat/attachments';
import type { AttachmentDraft } from '@/domain/chat/attachments';
import {
  classifyDocument,
  isLegacyDoc,
  MAX_DOCUMENT_BYTES,
  MAX_IMAGES_PER_MESSAGE,
  toDocumentDraftText,
} from '@/domain/documents/documents';
import type { ImageDraft } from '@/domain/documents/documents';
import { extractDocxMarkdown } from '@/adapters/documents/docx';
import { extractPdf } from '@/adapters/documents/pdf';
import { compressImageFile, ImageTooLargeError } from '@/adapters/documents/images';
import { matchCommands, expandSlashInput } from '@/domain/prompts/commands';
import type { SlashCommand } from '@/domain/prompts/commands';
import { Brain, Globe, Mic, Paperclip, Plus, Send, Sparkles, Square, TriangleAlert, X } from '@/shared/icons';
import { Button, IconButton, Switch, TextArea, Tooltip } from '@/shared/ui';
import { newId } from '@/shared/utils/ids';

import { CommandMenu } from './CommandMenu';
import { ContextDialog } from './ContextDialog';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import type { ChatRunStatus } from '../state/chatStore';

/** Errores de micrófono que conviene explicar como permiso, no como "no disponible". */
function isPermissionError(value: string): boolean {
  return /denied|permission|not-allowed|denegado|permiso/i.test(value);
}

interface ExtractedDocument {
  attachment: AttachmentDraft;
  renderedImages: { name: string; mime: string; dataUrl: string }[];
}

/**
 * Extrae texto de Word/PDF en el dispositivo. El texto se inyecta como
 * adjunto delimitado; las páginas escaneadas del PDF vuelven como imágenes.
 */
async function extractDocument(file: File, kind: 'docx' | 'pdf'): Promise<ExtractedDocument> {
  const buffer = await readFileBuffer(file);
  if (kind === 'docx') {
    // Markdown estructural (títulos, listas, tablas): misma información con
    // menos ambigüedad para la IA; con HTML vacío cae solo al texto crudo.
    const text = await extractDocxMarkdown(buffer);
    if (text.trim() === '') throw new Error('empty-document');
    const draft = toDocumentDraftText(text);
    const attachment = toAttachmentDraft(newId('att'), file.name, draft.text);
    return {
      attachment: { ...attachment, sourceLabel: 'Documento Word', truncated: attachment.truncated || draft.truncated },
      renderedImages: [],
    };
  }
  const pdf = await extractPdf(file.name.replace(/\.[^.]*$/, ''), buffer);
  if (pdf.text.trim() === '' && pdf.renderedImages.length === 0) throw new Error('empty-document');
  const draft = toDocumentDraftText(pdf.text);
  const attachment = toAttachmentDraft(newId('att'), file.name, draft.text);
  return {
    attachment: {
      ...attachment,
      sourceLabel: 'Documento PDF',
      truncated: attachment.truncated || draft.truncated || pdf.truncatedPages,
    },
    renderedImages: pdf.renderedImages,
  };
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
  onSend: (text: string, images?: readonly ImageDraft[]) => void;
  onStop: () => void;
  research?: ComposerResearch;
  /** Ausente = modo general (sin preview ni gate). Lo cablea T27 al vincular el expediente. */
  legal?: ComposerLegal;
  messages?: readonly ChatMessage[];
  summary?: string;
  modelName?: string;
}

/**
 * Handle imperativo del composer: permite adjuntar archivos soltados sobre
 * zonas de la página que quedan fuera de su formulario (overlay de arrastre).
 */
export interface ComposerHandle {
  /** Reusa el mismo camino que el clip y el drop interno (límites y avisos incluidos). */
  addFiles(files: readonly File[]): Promise<void>;
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

function formatTokens(count: number): string {
  if (count >= 1_000_000) {
    const m = count / 1_000_000;
    return `${m % 1 === 0 ? m : m.toFixed(1)}M`;
  }
  if (count >= 1_000) {
    const k = count / 1_000;
    return `${k % 1 === 0 ? k : k.toFixed(1)}k`;
  }
  return count.toLocaleString();
}

export const Composer = forwardRef<ComposerHandle, ComposerProps>(function Composer(
  { status, onSend, onStop, research, legal, messages = [], summary, modelName },
  ref,
) {
  const t = useT();
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<AttachmentDraft[]>([]);
  const [images, setImages] = useState<ImageDraft[]>([]);
  const [attachNotice, setAttachNotice] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  // Guardia anti-carrera: dos gestos pegados (doble click en el clip, soltar
  // dos veces) disparan `addFiles` en paralelo y mezclan chips con avisos
  // viejos. El segundo se ignora; el estado sólo lo escribe una invocación.
  const readingRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
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
  const canSend =
    (text.trim() !== '' || attachments.length > 0 || images.length > 0) && !busy && !needsConsent && !reading;
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

  const contextBreakdown = useMemo(
    () =>
      computeContextBreakdown({
        messages,
        summary,
        autocompactThreshold: AUTOCOMPACT_THRESHOLD_TOKENS,
      }),
    [messages, summary],
  );

  useEffect(() => {
    if (!sourcesOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Element;
      if (!target.closest('[data-testid="chat-composer"]')) {
        setSourcesOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [sourcesOpen]);

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
    const composed = composeMessageWithAttachments(expandSlashInput(text), attachments);
    if (images.length > 0) onSend(composed, images);
    else onSend(composed);
    setText('');
    setAttachments([]);
    setImages([]);
    setAttachNotice(null);
    setHighlighted(0);
  };

  /**
   * Lee archivos locales y los agrega como adjuntos de texto o imágenes.
   * Texto plano, Word `.docx` y PDF se extraen en el dispositivo e inyectan
   * delimitados; las imágenes viajan comprimidas al modelo con visión.
   */
  const addFiles = useCallback(
    async (files: readonly File[]): Promise<void> => {
      if (files.length === 0 || busy || readingRef.current) return;
      readingRef.current = true;
      setReading(true);
      setAttachNotice(null);
      try {
        const accepted: AttachmentDraft[] = [];
        const acceptedImages: ImageDraft[] = [];
        let notice: string | null = null;
        for (const file of files) {
          if (isLegacyDoc(file.name, file.type)) {
            notice = t('chat.attachLegacyDoc');
            continue;
          }
          const kind = classifyDocument(file.name, file.type);
          if (kind === 'image') {
            if (acceptedImages.length + images.length >= MAX_IMAGES_PER_MESSAGE) {
              notice = t('chat.attachTooManyImages');
              continue;
            }
            try {
              const compressed = await compressImageFile(file);
              acceptedImages.push({ id: newId('img'), name: file.name, mime: compressed.mime, dataUrl: compressed.dataUrl });
            } catch (error) {
              notice = error instanceof ImageTooLargeError ? t('chat.attachTooLarge') : t('chat.attachUnreadable');
            }
            continue;
          }
          if (accepted.length + attachments.length >= MAX_ATTACHMENTS) {
            notice = t('chat.attachTooMany');
            break;
          }
          if (kind === 'docx' || kind === 'pdf') {
            if (file.size > MAX_DOCUMENT_BYTES) {
              notice = t('chat.attachDocTooLarge');
              continue;
            }
            const extracted = await extractDocument(file, kind).catch(() => null);
            if (extracted === null) {
              notice = t('chat.attachUnreadable');
              continue;
            }
            accepted.push(extracted.attachment);
            for (const rendered of extracted.renderedImages) {
              if (acceptedImages.length + images.length >= MAX_IMAGES_PER_MESSAGE) {
                notice = t('chat.attachTooManyImages');
                break;
              }
              acceptedImages.push({ id: newId('img'), name: rendered.name, mime: rendered.mime, dataUrl: rendered.dataUrl });
            }
            continue;
          }
          if (!isSupportedAttachment(file.name, file.type)) {
            notice = t('chat.attachUnsupported');
            continue;
          }
          try {
            const content = await readAttachmentText(file);
            accepted.push(toAttachmentDraft(newId('att'), file.name, content));
          } catch {
            notice = t('chat.attachUnreadable');
          }
        }
        if (accepted.length > 0) setAttachments((current) => [...current, ...accepted].slice(0, MAX_ATTACHMENTS));
        if (acceptedImages.length > 0) {
          setImages((current) => [...current, ...acceptedImages].slice(0, MAX_IMAGES_PER_MESSAGE));
        }
        if (notice !== null) setAttachNotice(notice);
      } finally {
        readingRef.current = false;
        setReading(false);
      }
    },
    [attachments.length, busy, images.length, t],
  );

  // Superficie imperativa para los adjuntos soltados fuera del formulario.
  useImperativeHandle(ref, () => ({ addFiles }), [addFiles]);

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
      onDragOver={(event) => {
        if (!busy) event.preventDefault();
      }}
      onDrop={(event) => {
        if (busy) return;
        const dropped = Array.from(event.dataTransfer?.files ?? []);
        if (dropped.length === 0) return;
        event.preventDefault();
        void addFiles(dropped);
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
      <div
        className={`relative isolate flex flex-col w-full rounded-2xl border border-border bg-surface shadow-xs transition-all duration-150 focus-within:border-primary focus-within:ring-1 focus-within:ring-primary/40 p-2 gap-2${
          busy ? ' anim-breathe' : ''
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          aria-hidden="true"
          tabIndex={-1}
          accept=".txt,.md,.markdown,.json,.csv,.log,.yaml,.yml,.xml,.html,.css,.js,.ts,.tsx,.py,.docx,.pdf,.png,.jpg,.jpeg,.webp,text/plain,text/markdown,application/json,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/png,image/jpeg,image/webp"
          onChange={(event) => {
            void addFiles(Array.from(event.target.files ?? []));
            event.target.value = '';
          }}
        />

        {/* Adjuntos e imágenes en la parte superior del composer */}
        {attachments.length > 0 || images.length > 0 ? (
          <div className="flex flex-wrap gap-1.5 px-1 pt-0.5">
            {attachments.map((attachment) => (
              <span
                key={attachment.id}
                className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border/80 bg-surface-subtle px-2.5 py-1 text-xs text-text shadow-xs"
                style={{ animation: 'pop-in 180ms ease-out both' }}
              >
                <Paperclip aria-hidden="true" className="size-3 text-muted shrink-0" />
                <span className="min-w-0 max-w-44 truncate" title={attachment.name}>
                  {attachment.name}
                  {attachment.truncated ? ` · ${t('chat.attachTruncated')}` : ''}
                </span>
                <button
                  type="button"
                  aria-label={t('chat.attachRemove', { name: attachment.name })}
                  className="hit-expand shrink-0 rounded-full p-0.5 text-muted transition-colors hover:text-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-focus-ring"
                  onClick={() =>
                    setAttachments((current) => current.filter((entry) => entry.id !== attachment.id))
                  }
                >
                  <X aria-hidden="true" className="size-3.5" />
                </button>
              </span>
            ))}
            {images.map((image) => (
              <span
                key={image.id}
                className="inline-flex max-w-full items-center gap-2 rounded-xl border border-border/80 bg-surface-subtle py-1 pl-1 pr-2 text-xs text-text shadow-xs"
                style={{ animation: 'pop-in 180ms ease-out both' }}
              >
                <img src={image.dataUrl} alt={image.name} title={image.name} className="h-8 w-8 rounded-lg object-cover" />
                <span className="min-w-0 max-w-36 truncate" title={image.name}>
                  {image.name}
                </span>
                <button
                  type="button"
                  aria-label={t('chat.attachRemove', { name: image.name })}
                  className="hit-expand shrink-0 rounded-full p-1 text-muted transition-colors hover:text-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-focus-ring"
                  onClick={() => setImages((current) => current.filter((entry) => entry.id !== image.id))}
                >
                  <X aria-hidden="true" className="size-3.5" />
                </button>
              </span>
            ))}
          </div>
        ) : null}

        {commands.length > 0 ? (
          <CommandMenu
            commands={commands}
            highlighted={highlightedIndex}
            onSelect={selectCommand}
            onHighlight={setHighlighted}
          />
        ) : null}

        {/* Textarea del prompt */}
        <TextArea
          autoResize
          variant="ghost"
          rows={1}
          value={text}
          disabled={busy}
          placeholder={t('chat.composerPlaceholder')}
          aria-label={t('chat.composerPlaceholder')}
          className="w-full px-2 py-1 text-sm leading-relaxed"
          onChange={(event) => {
            setText(event.target.value);
            setSourcesOpen(false);
          }}
          onKeyDown={handleKeyDown}
        />

        {/* Barra de controles inferior — estilo Beautiful UI Prompt Bar */}
        <div className="flex items-center justify-between gap-1 pt-1.5 border-t border-border/40 px-0.5">
          {/* Lado izquierdo: +, Medidor de Contexto (250k), Modelo */}
          <div className="relative flex items-center gap-1.5 min-w-0">
            <div className="relative">
              <IconButton
                size="sm"
                label={t('chat.attach')}
                icon={<Plus aria-hidden="true" className="size-4" />}
                disabled={busy || reading || (attachments.length >= MAX_ATTACHMENTS && images.length >= MAX_IMAGES_PER_MESSAGE)}
                onClick={() => setSourcesOpen((open) => !open)}
                className="shrink-0 transition-transform active:scale-95"
              />

              {/* Menú pop-in de Fuentes / @ / Adjuntos */}
              {sourcesOpen ? (
                <div
                  role="menu"
                  className="absolute bottom-full left-0 z-20 mb-2 w-56 rounded-xl border border-border bg-surface p-1.5 shadow-raised"
                  style={{ animation: 'pop-in 180ms cubic-bezier(0.23, 1, 0.32, 1) both', transformOrigin: 'bottom left' }}
                >
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setSourcesOpen(false);
                      fileInputRef.current?.click();
                    }}
                    className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs font-medium text-text transition-colors hover:bg-surface-subtle"
                  >
                    <Paperclip aria-hidden="true" className="size-4 text-muted shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="text-text font-medium">{t('chat.attach')}</div>
                      <div className="text-[11px] text-muted truncate">Fotos, documentos y texto</div>
                    </div>
                  </button>

                  {research !== undefined && !research.disabled ? (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        research.onToggle(!research.enabled);
                        setSourcesOpen(false);
                      }}
                      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs font-medium text-text transition-colors hover:bg-surface-subtle"
                    >
                      <Globe aria-hidden="true" className="size-4 text-accent shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="text-text font-medium">{t('research.toggleLabel')}</div>
                        <div className="text-[11px] text-muted truncate">
                          {research.enabled ? 'Activado' : 'Desactivado'}
                        </div>
                      </div>
                    </button>
                  ) : null}

                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setText('/');
                      setSourcesOpen(false);
                    }}
                    className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs font-medium text-text transition-colors hover:bg-surface-subtle"
                  >
                    <Sparkles aria-hidden="true" className="size-4 text-primary shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="text-text font-medium">Comandos /</div>
                      <div className="text-[11px] text-muted truncate">Comandos y atajos rápidos</div>
                    </div>
                  </button>
                </div>
              ) : null}
            </div>

            {/* Medidor visual de Tokens de Contexto hacia 250k (Autocompact) */}
            <button
              type="button"
              aria-label="Ver estado de contexto"
              title={`Contexto: ${contextBreakdown.totalTokens.toLocaleString()} / 250k tokens (${contextBreakdown.percentage}%). Clic para detalles.`}
              onClick={() => setContextOpen(true)}
              className="flex h-7 items-center gap-1.5 rounded-lg border border-border/70 bg-surface-subtle/70 px-2 text-[11px] font-medium text-muted transition-colors hover:border-primary/60 hover:text-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-focus-ring"
            >
              <Brain aria-hidden="true" className="size-3.5 text-primary shrink-0" />
              <span>{formatTokens(contextBreakdown.totalTokens)}</span>
              <span className="text-muted/60">/ 250k</span>
              <span
                className={`size-1.5 rounded-full shrink-0 ${
                  contextBreakdown.percentage >= 80 ? 'bg-amber-500' : 'bg-emerald-500'
                }`}
              />
            </button>

            {modelName ? (
              <span className="hidden sm:inline-flex items-center gap-1 rounded-lg border border-border/50 bg-surface-subtle/50 px-2 py-0.5 text-[11px] font-mono text-muted max-w-36 truncate">
                ⚡ {modelName}
              </span>
            ) : null}
          </div>

          {/* Lado derecho: Dictado y Enviar/Detener */}
          <div className="flex items-center gap-1.5 shrink-0">
            {speech.supported ? (
              <Button
                type="button"
                variant={speech.isListening ? 'primary' : 'secondary'}
                iconOnly
                disabled={busy}
                aria-label={speech.isListening ? t('chat.voiceListening') : t('chat.voiceInput')}
                aria-pressed={speech.isListening}
                title={speech.isListening ? t('chat.voiceListening') : t('chat.voiceInput')}
                icon={
                  speech.isListening ? (
                    <span className="flex h-3.5 items-center gap-[2.5px]" aria-hidden="true">
                      {[0, 1, 2].map((i) => (
                        <span
                          key={i}
                          className="w-[2.5px] rounded-full bg-current"
                          style={{
                            height: '100%',
                            animation: `eq-bounce 800ms ease-in-out ${i * 160}ms infinite`,
                          }}
                        />
                      ))}
                    </span>
                  ) : (
                    <Mic aria-hidden="true" className="size-4" />
                  )
                }
                onClick={toggleDictation}
                className="transition-transform active:scale-95"
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
                className="transition-transform active:scale-95"
              >
                {t('chat.stop')}
              </Button>
            ) : (
              <Button
                type="submit"
                disabled={!canSend}
                icon={<Send aria-hidden="true" className="size-4" />}
                className="transition-transform enabled:active:scale-95 shadow-xs"
              >
                {t('chat.send')}
              </Button>
            )}
          </div>
        </div>
      </div>

      <ContextDialog
        open={contextOpen}
        onClose={() => setContextOpen(false)}
        messages={messages}
        summary={summary}
      />

      {legalGate && images.length > 0 ? (
        <p role="note" className="text-xs text-warning">
          {t('chat.attachImageLegalWarn')}
        </p>
      ) : null}
      {attachNotice !== null ? (
        <p role="status" className="text-xs text-warning">
          {attachNotice}
        </p>
      ) : null}
    </form>
  );
});
