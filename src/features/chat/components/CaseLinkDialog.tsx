import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';

import type { CreateLegalCaseInput } from '@/domain/ports/LegalCaseRepository';
import type { LegalCase, LegalJurisdiction } from '@/domain/types/legal';
import { useCaseStoreApi } from '@/features/legal/state/caseStore';
import type { CaseStore } from '@/features/legal/state/caseStore';
import { useT } from '@/i18n/useT';
import { Button, Dialog } from '@/shared/ui';

export interface CaseLinkDialogProps {
  open: boolean;
  /** Expediente ya vinculado (se marca como tal en la lista). */
  linkedCaseId?: string | null;
  /** Workspace legal configurado; si no, se ofrece configurarlo en vez de fallar. */
  legalConfigured: boolean;
  /** Jurisdicción por defecto del expediente mínimo (viene de `settings.legal`). */
  defaultJurisdiction?: LegalJurisdiction;
  /** Vincula el expediente elegido o creado (el padre llama `setLegalCase`). */
  onLink: (caseId: string) => void;
  onConfigureLegal: () => void;
  onClose: () => void;
}

const JURISDICTIONS: readonly LegalJurisdiction[] = ['national', 'caba', 'pba', 'cordoba', 'tucuman'];

/**
 * Acceso opcional al caseStore (T22): sin provider montado arriba, el diálogo
 * degrada con un mensaje en vez de romper (el hook con throw se aísla acá).
 */
function useOptionalCaseStore(): CaseStore | null {
  try {
    return useCaseStoreApi();
  } catch {
    return null;
  }
}

/**
 * Diálogo para vincular un expediente al chat: elige uno existente del
 * caseStore o crea uno mínimo (título + jurisdicción) y lo vincula.
 */
export function CaseLinkDialog({
  open,
  linkedCaseId = null,
  legalConfigured,
  defaultJurisdiction = 'national',
  onLink,
  onConfigureLegal,
  onClose,
}: CaseLinkDialogProps) {
  const t = useT();
  const api = useOptionalCaseStore();
  const [cases, setCases] = useState<LegalCase[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [jurisdiction, setJurisdiction] = useState<LegalJurisdiction>(defaultJurisdiction);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setJurisdiction(defaultJurisdiction);
  }, [defaultJurisdiction]);

  // Al abrir, hidrata la lista del store y la sigue en vivo; sin provider no hace nada.
  useEffect(() => {
    if (!open || api === null) return undefined;
    let active = true;
    setLoadError(null);
    setCases([...api.getState().cases]);
    const unsubscribe = api.subscribe((state) => {
      if (active) setCases([...state.cases]);
    });
    void api
      .getState()
      .list()
      .then(() => {
        if (active) setCases([...api.getState().cases]);
      })
      .catch((error: unknown) => {
        if (active) setLoadError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [open, api]);

  // Limpia el formulario en cada apertura.
  useEffect(() => {
    if (open) {
      setTitle('');
      setFormError(null);
    }
  }, [open]);

  const handleLink = (caseId: string): void => {
    onLink(caseId);
    onClose();
  };

  const handleCreate = (event: FormEvent): void => {
    event.preventDefault();
    if (api === null || saving) return;
    const trimmed = title.trim();
    if (trimmed === '') {
      setFormError(t('modes.dialogTitleRequired'));
      return;
    }
    setFormError(null);
    setSaving(true);
    const input: CreateLegalCaseInput = {
      title: trimmed,
      jurisdiction,
      court: '',
      matter: 'civil-commercial',
      clientRole: 'plaintiff',
    };
    void api
      .getState()
      .create(input)
      .then((created) => {
        setSaving(false);
        if (created === null) {
          setFormError(api.getState().error ?? t('modes.dialogCreateFailed'));
          return;
        }
        setTitle('');
        onLink(created.id);
        onClose();
      });
  };

  const jurisdictionLabel = (value: LegalJurisdiction): string => {
    switch (value) {
      case 'national':
        return t('modes.jurisdictionNational');
      case 'caba':
        return t('modes.jurisdictionCaba');
      case 'pba':
        return t('modes.jurisdictionPba');
      case 'cordoba':
        return t('modes.jurisdictionCordoba');
      case 'tucuman':
        return t('modes.jurisdictionTucuman');
    }
  };

  if (api === null) {
    return (
      <Dialog
        open={open}
        onClose={onClose}
        title={t('modes.dialogTitle')}
        footer={
          <>
            {legalConfigured ? null : (
              <Button type="button" variant="secondary" onClick={onConfigureLegal}>
                {t('modes.configureLegal')}
              </Button>
            )}
            <Button type="button" variant="primary" onClick={onClose}>
              {t('modes.dialogCancel')}
            </Button>
          </>
        }
      >
        <p>{t('modes.dialogNoStore')}</p>
      </Dialog>
    );
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('modes.dialogTitle')}
      footer={
        <Button type="button" variant="secondary" onClick={onClose}>
          {t('modes.dialogCancel')}
        </Button>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-muted">{t('modes.dialogDescription')}</p>
        {legalConfigured ? null : (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface-subtle px-3 py-2">
            <p className="min-w-0 flex-1 text-xs text-muted">{t('modes.dialogNotConfigured')}</p>
            <Button type="button" variant="secondary" size="sm" onClick={onConfigureLegal}>
              {t('modes.configureLegal')}
            </Button>
          </div>
        )}
        <section aria-label={t('modes.dialogListLabel')}>
          {loadError !== null ? (
            <p role="alert" className="text-sm text-danger">
              {loadError}
            </p>
          ) : cases.length === 0 ? (
            <p data-testid="case-link-empty" className="text-sm text-muted">
              {t('modes.dialogEmpty')}
            </p>
          ) : (
            <ul className="max-h-56 space-y-1 overflow-y-auto">
              {cases.map((legalCase) => {
                const linked = legalCase.id === linkedCaseId;
                return (
                  <li
                    key={legalCase.id}
                    className="flex items-center gap-2 rounded-lg px-3 py-2 hover:bg-surface-subtle"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{legalCase.title}</span>
                      <span className="block text-xs text-muted">{jurisdictionLabel(legalCase.jurisdiction)}</span>
                    </span>
                    {linked ? (
                      <span data-testid={`case-link-linked-${legalCase.id}`} className="shrink-0 text-xs font-medium text-primary">
                        {t('modes.dialogLinked')}
                      </span>
                    ) : (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        data-testid={`case-link-option-${legalCase.id}`}
                        onClick={() => handleLink(legalCase.id)}
                      >
                        {t('modes.dialogLink')}
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
        <form onSubmit={handleCreate} className="space-y-2 border-t border-border pt-3">
          <label htmlFor="case-link-title" className="block text-xs font-medium">
            {t('modes.dialogTitleLabel')}
          </label>
          <input
            id="case-link-title"
            data-testid="case-link-title"
            type="text"
            value={title}
            maxLength={120}
            placeholder={t('modes.dialogTitlePlaceholder')}
            onChange={(event) => setTitle(event.target.value)}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          />
          <label htmlFor="case-link-jurisdiction" className="block text-xs font-medium">
            {t('modes.dialogJurisdictionLabel')}
          </label>
          <select
            id="case-link-jurisdiction"
            data-testid="case-link-jurisdiction"
            value={jurisdiction}
            onChange={(event) => setJurisdiction(event.target.value as LegalJurisdiction)}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          >
            {JURISDICTIONS.map((option) => (
              <option key={option} value={option}>
                {jurisdictionLabel(option)}
              </option>
            ))}
          </select>
          {formError !== null ? (
            <p role="alert" className="text-xs text-danger">
              {formError}
            </p>
          ) : null}
          <Button type="submit" variant="primary" size="sm" loading={saving} data-testid="case-link-create">
            {t('modes.dialogCreateAndLink')}
          </Button>
        </form>
      </div>
    </Dialog>
  );
}
