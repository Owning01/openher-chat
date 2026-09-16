import { useState } from 'react';
import type { FormEvent } from 'react';

import type { CreateLegalCaseInput } from '@/domain/ports/LegalCaseRepository';
import type { LegalJurisdiction, LegalMatter, LegalPartyRole } from '@/domain/types/legal';
import { useT } from '@/i18n/useT';
import type { Translate } from '@/i18n/useT';
import { Button, Input, Select } from '@/shared/ui';
import type { SelectOption } from '@/shared/ui';

export interface CaseFormProps {
  /** Deshabilita el envío mientras el alta está en curso. */
  pending?: boolean;
  /** Error del intento de alta anterior; se muestra junto al botón de envío. */
  submitError?: string | null;
  onSubmit: (input: CreateLegalCaseInput) => void;
  onCancel?: () => void;
}

const JURISDICTIONS: readonly LegalJurisdiction[] = ['national', 'caba', 'pba', 'cordoba', 'tucuman'];
const MATTERS: readonly LegalMatter[] = ['civil', 'commercial', 'civil-commercial'];
const CLIENT_ROLES: readonly LegalPartyRole[] = ['plaintiff', 'defendant', 'third-party'];

/** Formulario controlado de alta de expediente con validación mínima y errores visibles. */
export function CaseForm({ pending = false, submitError = null, onSubmit, onCancel }: CaseFormProps) {
  const t = useT();
  const [title, setTitle] = useState('');
  const [court, setCourt] = useState('');
  const [jurisdiction, setJurisdiction] = useState<LegalJurisdiction>('national');
  const [matter, setMatter] = useState<LegalMatter>('civil');
  const [clientRole, setClientRole] = useState<LegalPartyRole>('plaintiff');
  const [touched, setTouched] = useState(false);

  const titleError = title.trim() === '' ? t('legalCases.titleRequired') : null;
  const courtError = court.trim() === '' ? t('legalCases.courtRequired') : null;
  const showTitleError = touched && titleError !== null;
  const showCourtError = touched && courtError !== null;

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setTouched(true);
    if (title.trim() === '' || court.trim() === '') return;
    onSubmit({ title: title.trim(), jurisdiction, court: court.trim(), matter, clientRole });
  };

  return (
    <form data-testid="case-form" noValidate onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="space-y-1.5">
        <label htmlFor="case-form-title" className="text-sm font-medium text-text">
          {t('legalCases.titleLabel')}
        </label>
        <Input
          id="case-form-title"
          data-testid="case-form-title"
          value={title}
          invalid={showTitleError}
          aria-describedby={showTitleError ? 'case-form-title-error' : undefined}
          placeholder={t('legalCases.titlePlaceholder')}
          disabled={pending}
          onChange={(event) => setTitle(event.target.value)}
        />
        {showTitleError ? (
          <p id="case-form-title-error" data-testid="case-form-title-error" role="alert" className="text-xs text-danger">
            {titleError}
          </p>
        ) : null}
      </div>

      <div className="space-y-1.5">
        <label htmlFor="case-form-court" className="text-sm font-medium text-text">
          {t('legalCases.courtLabel')}
        </label>
        <Input
          id="case-form-court"
          data-testid="case-form-court"
          value={court}
          invalid={showCourtError}
          aria-describedby={showCourtError ? 'case-form-court-error' : undefined}
          placeholder={t('legalCases.courtPlaceholder')}
          disabled={pending}
          onChange={(event) => setCourt(event.target.value)}
        />
        {showCourtError ? (
          <p id="case-form-court-error" data-testid="case-form-court-error" role="alert" className="text-xs text-danger">
            {courtError}
          </p>
        ) : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1.5">
          <label htmlFor="case-form-jurisdiction" className="text-sm font-medium text-text">
            {t('legalCases.jurisdictionLabel')}
          </label>
          <Select
            id="case-form-jurisdiction"
            data-testid="case-form-jurisdiction"
            value={jurisdiction}
            options={jurisdictionOptions(t)}
            disabled={pending}
            onChange={(event) => setJurisdiction(event.target.value as LegalJurisdiction)}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="case-form-matter" className="text-sm font-medium text-text">
            {t('legalCases.matterLabel')}
          </label>
          <Select
            id="case-form-matter"
            data-testid="case-form-matter"
            value={matter}
            options={matterOptions(t)}
            disabled={pending}
            onChange={(event) => setMatter(event.target.value as LegalMatter)}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="case-form-role" className="text-sm font-medium text-text">
            {t('legalCases.clientRoleLabel')}
          </label>
          <Select
            id="case-form-role"
            data-testid="case-form-role"
            value={clientRole}
            options={roleOptions(t)}
            disabled={pending}
            onChange={(event) => setClientRole(event.target.value as LegalPartyRole)}
          />
        </div>
      </div>

      {submitError !== null && submitError !== '' ? (
        <p data-testid="case-form-submit-error" role="alert" className="text-xs text-danger">
          {submitError}
        </p>
      ) : null}

      <div className="flex items-center justify-end gap-2">
        {onCancel === undefined ? null : (
          <Button type="button" variant="secondary" disabled={pending} onClick={onCancel}>
            {t('legalCases.cancel')}
          </Button>
        )}
        <Button type="submit" data-testid="case-form-submit" loading={pending}>
          {t('legalCases.create')}
        </Button>
      </div>
    </form>
  );
}

// Las opciones derivan del vocabulario canónico en inglés; las etiquetas van por i18n.
function jurisdictionOptions(t: Translate): readonly SelectOption[] {
  const labels: Record<LegalJurisdiction, string> = {
    national: t('legalCases.jurisdictionNational'),
    caba: t('legalCases.jurisdictionCaba'),
    pba: t('legalCases.jurisdictionPba'),
    cordoba: t('legalCases.jurisdictionCordoba'),
    tucuman: t('legalCases.jurisdictionTucuman'),
  };
  return JURISDICTIONS.map((value) => ({ value, label: labels[value] }));
}

function matterOptions(t: Translate): readonly SelectOption[] {
  const labels: Record<LegalMatter, string> = {
    civil: t('legalCases.matterCivil'),
    commercial: t('legalCases.matterCommercial'),
    'civil-commercial': t('legalCases.matterCivilCommercial'),
  };
  return MATTERS.map((value) => ({ value, label: labels[value] }));
}

function roleOptions(t: Translate): readonly SelectOption[] {
  const labels: Record<LegalPartyRole, string> = {
    plaintiff: t('legalCases.rolePlaintiff'),
    defendant: t('legalCases.roleDefendant'),
    'third-party': t('legalCases.roleThirdParty'),
  };
  return CLIENT_ROLES.map((value) => ({ value, label: labels[value] }));
}
