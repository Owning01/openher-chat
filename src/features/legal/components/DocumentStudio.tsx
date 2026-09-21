import { useMemo, useState } from 'react';

import { DOCX_MIME, markdownToDocx } from '@/adapters/documents/docxWriter';
import { sha256Hex } from '@/domain/legal/hash';
import { documentToMarkdown, renderTemplate } from '@/domain/legal/document';
import { auditDocumentCompleteness, buildSectionDraftingPrompt } from '@/domain/legal/documentAuditor';
import { LEGAL_TEMPLATES, getLegalTemplate } from '@/domain/legal/templates/index';
import type {
  AcknowledgmentRecord,
  LegalCase,
  LegalDocument,
  LegalIndex,
  LegalTemplate,
} from '@/domain/types/legal';
import { useT } from '@/i18n/useT';
import { downloadBinaryFile, downloadTextFile, safeFilename } from '@/shared/utils/download';
import { newId } from '@/shared/utils/ids';
import { Badge, Button, Select, TextArea } from '@/shared/ui';

import { countLegalCitations, markLegalText } from '../state/CitationGuardContext';

export interface DocumentStudioProps {
  caseData: LegalCase;
  /** Índice del corpus para el guard; `null`/ausente = marcado conservador. */
  index?: LegalIndex | null;
  initialTemplateId?: string;
  initialMarkdown?: string;
  documentId?: string;
  now?: () => number;
  /**
   * Persiste el `AcknowledgmentRecord` (puerto del repositorio cuando el padre
   * lo cablea). Ausente = consentimiento por sesión, documentado en la UI.
   */
  onAppendAcknowledgment?: (record: AcknowledgmentRecord) => Promise<void>;
  /** Persiste el borrador editado cuando el padre lo cablea al repositorio. */
  onSaveDocument?: (document: LegalDocument) => Promise<void>;
}

type CopyState = 'idle' | 'copied' | 'failed';

/** Resuelve la plantilla pedida con caída a la primera registrada (nunca vacía). */
function resolveTemplate(templateId: string | undefined): LegalTemplate {
  if (templateId !== undefined) {
    const found = getLegalTemplate(templateId);
    if (found !== null) return found;
  }
  // LEGAL_TEMPLATES es una constante no vacía; el bucle siempre retorna.
  for (const template of LEGAL_TEMPLATES) return template;
  throw new Error('Sin plantillas legales registradas');
}

/** Detecta la plataforma nativa sin plugins nuevos (sólo `window.Capacitor`). */
function isNativePlatform(): boolean {
  try {
    if (typeof window === 'undefined') return false;
    const candidate = window as unknown as Record<string, unknown>;
    const capacitor = candidate['Capacitor'] as { isNativePlatform?: unknown } | null | undefined;
    if (capacitor === null || capacitor === undefined) return false;
    if (typeof capacitor.isNativePlatform !== 'function') return false;
    const check = capacitor.isNativePlatform as () => unknown;
    return check() === true;
  } catch {
    return false;
  }
}

/** Copia al portapapeles con fallback a selección manual (sin plugins nuevos). */
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (
      typeof navigator !== 'undefined' &&
      navigator.clipboard !== undefined &&
      typeof navigator.clipboard.writeText === 'function'
    ) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Cae al fallback manual de selección.
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const done = document.execCommand('copy');
    area.remove();
    return done;
  } catch {
    return false;
  }
}

/**
 * Estudio de documentos: elige plantilla, edita el borrador, previsualiza con
 * guard de citas + watermark + disclaimer, y exporta sólo con consentimiento
 * explícito y `AcknowledgmentRecord`. Sin parsers ni dependencias nuevas.
 */
export function DocumentStudio(props: DocumentStudioProps) {
  const { caseData, documentId } = props;
  const now = props.now ?? ((): number => Date.now());
  const guardIndex = props.index ?? null;
  const t = useT();

  const [native] = useState<boolean>(() => isNativePlatform());
  const [createdAt] = useState<number>(() => now());
  const [templateId, setTemplateId] = useState<string>(() => resolveTemplate(props.initialTemplateId).id);
  const [markdown, setMarkdown] = useState<string>(
    () => props.initialMarkdown ?? renderTemplate(resolveTemplate(props.initialTemplateId), { case: caseData }),
  );
  const [consent, setConsent] = useState(false);
  const [ackRecord, setAckRecord] = useState<AcknowledgmentRecord | null>(null);
  const [copyState, setCopyState] = useState<CopyState>('idle');
  const [saved, setSaved] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  type StudioViewMode = 'full' | 'sections' | 'audit';
  const [viewMode, setViewMode] = useState<StudioViewMode>('full');
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(null);
  const [promptFeedback, setPromptFeedback] = useState(false);

  const template = resolveTemplate(templateId);
  const templateOptions = useMemo(
    () => LEGAL_TEMPLATES.map((entry) => ({ value: entry.id, label: entry.title })),
    [],
  );

  const counters = useMemo(
    () => countLegalCitations(markdown, guardIndex),
    [markdown, guardIndex],
  );

  const auditResult = useMemo(
    () => auditDocumentCompleteness(markdown, template),
    [markdown, template],
  );

  const activeSection = useMemo(() => {
    if (auditResult.sections.length === 0) return null;
    return auditResult.sections.find((s) => s.id === selectedSectionId) ?? auditResult.sections[0] ?? null;
  }, [auditResult.sections, selectedSectionId]);

  const handleActiveSectionEdit = (newContent: string): void => {
    if (activeSection === null) return;
    const updated = auditResult.sections.map((s) =>
      s.id === activeSection.id ? { ...s, content: newContent } : s,
    );
    const newMarkdown = updated
      .map((s) => (s.heading === 'Encabezado inicial' ? s.content : `## ${s.heading}\n\n${s.content}`))
      .join('\n\n');
    setMarkdown(newMarkdown);
    invalidateSessionRecord();
  };

  const handleCopySectionPrompt = async (): Promise<void> => {
    if (activeSection === null) return;
    const matchingTemplateSection = template.sections.find(
      (ts) =>
        ts.heading.toLowerCase() === activeSection.heading.toLowerCase() ||
        activeSection.heading.toLowerCase().includes(ts.heading.toLowerCase()),
    );
    const promptText = buildSectionDraftingPrompt({
      caseData,
      sectionHeading: activeSection.heading,
      templateTitle: template.title,
      guidance: matchingTemplateSection?.guidance,
      existingContent: activeSection.content,
    });
    const ok = await copyToClipboard(promptText);
    if (ok) {
      setPromptFeedback(true);
      window.setTimeout(() => setPromptFeedback(false), 3500);
    }
  };

  const draftDocument: LegalDocument = useMemo(
    () => ({
      id: documentId ?? `draft-${template.id}`,
      caseId: caseData.id,
      kind: template.kind,
      title: template.title,
      templateId: template.id,
      markdown,
      status: 'draft',
      citationCounters: counters,
      createdAt,
      updatedAt: createdAt,
    }),
    [documentId, caseData.id, template, markdown, counters, createdAt],
  );

  // El render y el export comparten el mismo texto: Markdown con watermark y
  // disclaimer no descartables, pasado por el guard de citas.
  const exportedMarkdown = useMemo(() => documentToMarkdown(draftDocument), [draftDocument]);
  const markedPreview = useMemo(
    () => markLegalText(exportedMarkdown, guardIndex),
    [exportedMarkdown, guardIndex],
  );

  const invalidateSessionRecord = (): void => {
    setAckRecord(null);
    setSaved(false);
    setCopyState('idle');
    setActionError(null);
  };

  const handleTemplateChange = (value: string): void => {
    const next = resolveTemplate(value);
    setTemplateId(next.id);
    setMarkdown(renderTemplate(next, { case: caseData }));
    invalidateSessionRecord();
  };

  const handleEdit = (value: string): void => {
    setMarkdown(value);
    invalidateSessionRecord();
  };

  /**
   * Registra el reconocimiento del export. Si hay repositorio lo persiste;
   * si no, queda documentado en la sesión (`ackRecord`). Nunca lanza.
   */
  const recordAcknowledgment = async (exportText: string): Promise<boolean> => {
    const record: AcknowledgmentRecord = {
      id: newId('ack'),
      caseId: caseData.id,
      documentId: documentId ?? `draft-${template.id}`,
      at: now(),
      unverifiedCount: counters.unverified,
      contentHash: sha256Hex(exportText),
    };
    if (props.onAppendAcknowledgment !== undefined) {
      try {
        await props.onAppendAcknowledgment(record);
      } catch {
        setActionError(t('legalDocs.ackError'));
        return false;
      }
    }
    setAckRecord(record);
    setActionError(null);
    return true;
  };

  const handleDownload = (): void => {
    if (!consent) return;
    void (async () => {
      const acknowledged = await recordAcknowledgment(markedPreview);
      if (!acknowledged) return;
      try {
        downloadTextFile(`${safeFilename(draftDocument.title, 'documento')}.md`, markedPreview, 'text/markdown');
      } catch {
        setActionError(t('legalDocs.downloadFailed'));
      }
    })();
  };

  const handleDownloadDocx = (): void => {
    if (!consent) return;
    void (async () => {
      const acknowledged = await recordAcknowledgment(markedPreview);
      if (!acknowledged) return;
      try {
        const bytes = markdownToDocx(markedPreview);
        downloadBinaryFile(`${safeFilename(draftDocument.title, 'documento')}.docx`, bytes, DOCX_MIME);
      } catch {
        setActionError(t('legalDocs.docxDownloadFailed'));
      }
    })();
  };

  const handleCopy = (): void => {
    if (!consent) return;
    void (async () => {
      const acknowledged = await recordAcknowledgment(markedPreview);
      if (!acknowledged) return;
      const done = await copyToClipboard(markedPreview);
      setCopyState(done ? 'copied' : 'failed');
    })();
  };

  const handlePrint = (): void => {
    if (!consent) return;
    void (async () => {
      const acknowledged = await recordAcknowledgment(markedPreview);
      if (!acknowledged) return;
      try {
        window.print();
      } catch {
        setActionError(t('legalDocs.printFailed'));
      }
    })();
  };

  const handleSave = (): void => {
    const saveDocument = props.onSaveDocument;
    if (saveDocument === undefined) return;
    void (async () => {
      try {
        await saveDocument(draftDocument);
        setSaved(true);
        setActionError(null);
      } catch {
        setSaved(false);
        setActionError(t('legalDocs.saveFailed'));
      }
    })();
  };

  return (
    <section
      data-testid="document-studio"
      aria-label={t('legalDocs.title')}
      className="flex min-h-0 min-w-0 flex-col gap-3 overflow-y-auto"
    >
      <div className="shrink-0 space-y-1.5">
        <label htmlFor="document-template" className="text-sm font-medium text-text">
          {t('legalDocs.templateLabel')}
        </label>
        <Select
          id="document-template"
          data-testid="document-template"
          value={template.id}
          options={templateOptions}
          onChange={(event) => handleTemplateChange(event.target.value)}
        />
      </div>

      <div className="shrink-0 flex items-center gap-1.5 rounded-lg border border-border bg-surface-subtle p-1">
        <button
          type="button"
          data-testid="document-view-full"
          onClick={() => setViewMode('full')}
          className={`flex-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
            viewMode === 'full' ? 'bg-surface text-text shadow-xs' : 'text-muted hover:text-text'
          }`}
        >
          {t('legalDocs.viewModeFull')}
        </button>
        <button
          type="button"
          data-testid="document-view-sections"
          onClick={() => setViewMode('sections')}
          className={`flex-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
            viewMode === 'sections' ? 'bg-surface text-text shadow-xs' : 'text-muted hover:text-text'
          }`}
        >
          {t('legalDocs.viewModeSections')}
        </button>
        <button
          type="button"
          data-testid="document-view-audit"
          onClick={() => setViewMode('audit')}
          className={`flex-1 flex items-center justify-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
            viewMode === 'audit' ? 'bg-surface text-text shadow-xs' : 'text-muted hover:text-text'
          }`}
        >
          <span>{t('legalDocs.viewModeAudit')}</span>
          <Badge
            variant={
              auditResult.status === 'ready'
                ? 'success'
                : auditResult.status === 'warning'
                  ? 'warning'
                  : 'danger'
            }
          >
            {auditResult.status === 'ready' ? '✓' : auditResult.status === 'warning' ? '!' : '✕'}
          </Badge>
        </button>
      </div>

      <div className={`space-y-3 ${viewMode === 'sections' ? 'block' : 'hidden'}`} data-testid="document-sections-view">
        <div className="flex flex-col gap-2">
          <label className="text-xs font-semibold text-muted uppercase">
            {t('legalDocs.sectionsTitle')}
          </label>
          <div className="flex flex-wrap gap-1.5">
            {auditResult.sections.map((sec) => (
              <button
                key={sec.id}
                type="button"
                data-testid={`document-section-tab-${sec.id}`}
                onClick={() => setSelectedSectionId(sec.id)}
                className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors ${
                  activeSection?.id === sec.id
                    ? 'border-primary bg-primary-soft text-primary font-medium'
                    : 'border-border bg-surface text-text hover:bg-surface-subtle'
                }`}
              >
                <span className="truncate max-w-40">{sec.heading}</span>
                <span className="text-[10px] opacity-75">
                  ({sec.wordCount})
                </span>
                {sec.hasPlaceholders ? (
                  <span className="size-1.5 rounded-full bg-warning shrink-0" title="Contiene datos por completar" />
                ) : null}
              </button>
            ))}
          </div>
        </div>

        {activeSection !== null ? (
          <div className="rounded-lg border border-border bg-surface p-3 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2">
              <div>
                <h4 className="text-sm font-semibold text-text">{activeSection.heading}</h4>
                <p className="text-xs text-muted">
                  {t('legalDocs.sectionWords', { words: activeSection.wordCount })}
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                data-testid="document-section-prompt-btn"
                onClick={handleCopySectionPrompt}
              >
                {t('legalDocs.sectionDraftPrompt')}
              </Button>
            </div>

            {promptFeedback ? (
              <p data-testid="document-section-prompt-feedback" className="text-xs text-success font-medium">
                {t('legalDocs.sectionDraftPromptCopied')}
              </p>
            ) : null}

            <TextArea
              id="document-section-editor"
              data-testid="document-section-editor"
              rows={8}
              value={activeSection.content}
              onChange={(e) => handleActiveSectionEdit(e.target.value)}
              className="font-mono text-xs min-h-32"
            />
          </div>
        ) : null}
      </div>

      <div className={`space-y-3 ${viewMode === 'audit' ? 'block' : 'hidden'}`} data-testid="document-audit-panel">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="rounded-lg border border-border bg-surface p-2.5">
            <span className="text-xs text-muted">{t('legalDocs.metricsWords')}</span>
            <p className="text-lg font-bold text-text">{auditResult.wordCount}</p>
          </div>
          <div className="rounded-lg border border-border bg-surface p-2.5">
            <span className="text-xs text-muted">{t('legalDocs.metricsPages')}</span>
            <p className="text-lg font-bold text-text">{auditResult.estimatedPages}</p>
          </div>
          <div className="rounded-lg border border-border bg-surface p-2.5">
            <span className="text-xs text-muted">{t('legalDocs.metricsPlaceholders')}</span>
            <p className={`text-lg font-bold ${auditResult.missingPlaceholders.length > 0 ? 'text-danger' : 'text-success'}`}>
              {auditResult.missingPlaceholders.length}
            </p>
          </div>
          <div className="rounded-lg border border-border bg-surface p-2.5">
            <span className="text-xs text-muted">{t('legalDocs.counters', { verified: counters.verified, unverified: counters.unverified })}</span>
            <p className="text-lg font-bold text-text">{counters.unverified}</p>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-surface p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-text">{t('legalDocs.metricsFederalReserve')}</span>
            <Badge variant={auditResult.hasFederalReserve ? 'success' : 'warning'}>
              {auditResult.hasFederalReserve ? t('legalDocs.metricsFound') : t('legalDocs.metricsMissing')}
            </Badge>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-text">{t('legalDocs.metricsPetition')}</span>
            <Badge variant={auditResult.hasPetition ? 'success' : 'danger'}>
              {auditResult.hasPetition ? t('legalDocs.metricsFound') : t('legalDocs.metricsMissing')}
            </Badge>
          </div>
        </div>

        {auditResult.missingPlaceholders.length > 0 ? (
          <div className="rounded-lg border border-warning/40 bg-warning-soft/30 p-3 space-y-1.5">
            <h6 className="text-xs font-semibold text-warning">{t('legalDocs.metricsPlaceholders')}</h6>
            <ul className="space-y-1 text-xs text-text">
              {auditResult.missingPlaceholders.map((ph, i) => (
                <li key={i} className="font-mono text-danger font-medium">{ph}</li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-xs text-success font-medium">{t('legalDocs.auditNoPlaceholders')}</p>
        )}
      </div>

      <div className={`space-y-3 ${viewMode === 'full' ? 'block' : 'hidden'}`}>
        <div className="shrink-0 space-y-1.5">
          <h5 className="text-xs font-semibold text-muted uppercase">{t('legalDocs.checklistTitle')}</h5>
          <ul data-testid="document-checklist" className="space-y-1">
            {template.checklist.map((item) => (
              <li key={item.id} className="text-xs break-words text-text">
                <span aria-hidden="true">{'[ ] '}</span>
                {item.label} ({item.normRef})
              </li>
            ))}
          </ul>
        </div>

        <div className="shrink-0 space-y-1.5">
          <label htmlFor="document-editor" className="text-sm font-medium text-text">
            {t('legalDocs.editLabel')}
          </label>
          <TextArea
            id="document-editor"
            data-testid="document-editor"
            rows={8}
            value={markdown}
            onChange={(event) => handleEdit(event.target.value)}
            className="min-h-32 font-mono"
          />
          <p data-testid="document-counters" className="text-xs text-muted">
            {t('legalDocs.counters', { verified: counters.verified, unverified: counters.unverified })}
          </p>
        </div>

        <div className="shrink-0 space-y-1.5">
          <h5 className="text-xs font-semibold text-muted uppercase">{t('legalDocs.previewLabel')}</h5>
          <div
            data-testid="document-preview"
            className="min-w-0 rounded-md border border-border bg-surface p-2"
          >
            <pre className="text-xs break-words whitespace-pre-wrap text-text">{markedPreview}</pre>
          </div>
        </div>
      </div>

      <div className="shrink-0 space-y-1.5">
        <label className="flex cursor-pointer items-start gap-2 text-xs text-text">
          <input
            type="checkbox"
            data-testid="document-consent"
            checked={consent}
            onChange={(event) => {
              setConsent(event.target.checked);
              setAckRecord(null);
              setActionError(null);
            }}
            className="mt-0.5 size-4 shrink-0 accent-primary"
          />
          <span>{t('legalDocs.consentLabel')}</span>
        </label>
        <p className="text-xs text-muted">{t('legalDocs.consentHint')}</p>
        {props.onAppendAcknowledgment === undefined ? (
          <p className="text-xs text-muted">{t('legalDocs.sessionConsentNote')}</p>
        ) : null}
        {ackRecord !== null ? (
          <p data-testid="document-consent-recorded" className="text-xs text-success">
            {t('legalDocs.consentRecorded')}
          </p>
        ) : null}
      </div>

      <div className="shrink-0 space-y-2">
        {consent ? null : (
          <p data-testid="document-export-blocked" className="text-xs font-medium text-warning">
            {t('legalDocs.exportBlocked')}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {native ? null : (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              data-testid="document-export-download"
              disabled={!consent}
              onClick={handleDownload}
            >
              {t('legalDocs.exportDownload')}
            </Button>
          )}
          {native ? null : (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              data-testid="document-export-docx"
              disabled={!consent}
              onClick={handleDownloadDocx}
            >
              {t('legalDocs.exportDocx')}
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            variant="secondary"
            data-testid="document-export-copy"
            disabled={!consent}
            onClick={handleCopy}
          >
            {t('legalDocs.exportCopy')}
          </Button>
          {native ? null : (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              data-testid="document-export-print"
              disabled={!consent}
              onClick={handlePrint}
            >
              {t('legalDocs.exportPrint')}
            </Button>
          )}
          {props.onSaveDocument === undefined ? null : (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              data-testid="document-save"
              onClick={handleSave}
            >
              {t('legalDocs.saveDraft')}
            </Button>
          )}
        </div>
        {copyState === 'idle' ? null : (
          <p data-testid="document-copy-feedback" className="text-xs text-muted">
            {copyState === 'copied' ? t('legalDocs.copied') : t('legalDocs.copyFailed')}
          </p>
        )}
        {saved ? (
          <p data-testid="document-saved" className="text-xs text-success">
            {t('legalDocs.draftSaved')}
          </p>
        ) : null}
        {actionError === null ? null : (
          <p data-testid="document-action-error" role="alert" className="text-xs text-danger">
            {actionError}
          </p>
        )}
      </div>

      <p data-testid="document-limits" className="shrink-0 text-xs text-muted">
        {t('legalDocs.limitsNote')}
      </p>
    </section>
  );
}
