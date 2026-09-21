import { useState } from 'react';
import type { FormEvent } from 'react';

import type { LegalFact, LegalFactCertainty } from '@/domain/types/legal';
import { useT } from '@/i18n/useT';
import { Button, Dialog, Input, Select, TextArea } from '@/shared/ui';
import { newId } from '@/shared/utils/ids';

export interface FactFormDialogProps {
  open: boolean;
  fact?: LegalFact | null;
  onClose: () => void;
  onSave: (fact: LegalFact) => void;
}

export function FactFormDialog({ open, fact, onClose, onSave }: FactFormDialogProps) {
  const t = useT();
  const [statement, setStatement] = useState(fact?.statement ?? '');
  const [date, setDate] = useState(fact?.date ?? '');
  const [certainty, setCertainty] = useState<LegalFactCertainty>(fact?.certainty ?? 'certain');
  const [source, setSource] = useState(fact?.source ?? '');
  const [touched, setTouched] = useState(false);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setTouched(true);
    if (statement.trim() === '') return;

    onSave({
      id: fact?.id ?? newId('fact'),
      statement: statement.trim(),
      certainty,
      ...(date.trim() !== '' ? { date: date.trim() } : {}),
      ...(source.trim() !== '' ? { source: source.trim() } : {}),
    });
    onClose();
  };

  const statementError = touched && statement.trim() === '';

  const certaintyOptions = [
    { value: 'certain', label: t('legalCases.certaintyCertain') },
    { value: 'probable', label: t('legalCases.certaintyProbable') },
    { value: 'doubtful', label: t('legalCases.certaintyDoubtful') },
    { value: 'unknown', label: t('legalCases.certaintyUnknown') },
  ];

  return (
    <Dialog open={open} title={fact ? t('legalCases.editFact') : t('legalCases.addFact')} onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <div className="space-y-1">
          <label htmlFor="fact-statement" className="text-xs font-medium text-text">
            {t('legalCases.factStatementLabel')} *
          </label>
          <TextArea
            id="fact-statement"
            rows={3}
            value={statement}
            invalid={statementError}
            placeholder="Relato claro del hecho ocurrido..."
            onChange={(e) => setStatement(e.target.value)}
          />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label htmlFor="fact-date" className="text-xs font-medium text-text">
              {t('legalCases.factDateLabel')}
            </label>
            <Input
              id="fact-date"
              value={date}
              placeholder="AAAA-MM-DD"
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="fact-certainty" className="text-xs font-medium text-text">
              {t('legalCases.factCertaintyLabel')}
            </label>
            <Select
              id="fact-certainty"
              value={certainty}
              options={certaintyOptions}
              onChange={(e) => setCertainty(e.target.value as LegalFactCertainty)}
            />
          </div>
        </div>

        <div className="space-y-1">
          <label htmlFor="fact-source" className="text-xs font-medium text-text">
            {t('legalCases.factSourceLabel')}
          </label>
          <Input
            id="fact-source"
            value={source}
            placeholder="Ej.: Carta documento remitida, Acta notarial, Contrato cláusula 3"
            onChange={(e) => setSource(e.target.value)}
          />
        </div>

        <div className="mt-2 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('legalCases.cancel')}
          </Button>
          <Button type="submit">
            {fact ? t('legalCases.editFact') : t('legalCases.addFact')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
