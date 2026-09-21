import { useState } from 'react';
import type { FormEvent } from 'react';

import type { LegalKeyDate } from '@/domain/types/legal';
import { useT } from '@/i18n/useT';
import { Button, Dialog, Input } from '@/shared/ui';
import { newId } from '@/shared/utils/ids';

export interface KeyDateFormDialogProps {
  open: boolean;
  onClose: () => void;
  onSave: (date: LegalKeyDate) => void;
}

export function KeyDateFormDialog({ open, onClose, onSave }: KeyDateFormDialogProps) {
  const t = useT();
  const [label, setLabel] = useState('');
  const [date, setDate] = useState('');
  const [touched, setTouched] = useState(false);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setTouched(true);
    if (label.trim() === '' || date.trim() === '') return;

    onSave({
      id: newId('date'),
      label: label.trim(),
      date: date.trim(),
    });
    onClose();
  };

  const labelError = touched && label.trim() === '';
  const dateError = touched && date.trim() === '';

  return (
    <Dialog open={open} title={t('legalCases.addKeyDate')} onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <div className="space-y-1">
          <label htmlFor="key-date-label" className="text-xs font-medium text-text">
            {t('legalCases.keyDateLabelTitle')} *
          </label>
          <Input
            id="key-date-label"
            value={label}
            invalid={labelError}
            placeholder="Ej.: Notificación de demanda, Vencimiento intimación"
            onChange={(e) => setLabel(e.target.value)}
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="key-date-val" className="text-xs font-medium text-text">
            {t('legalCases.factDateLabel')} *
          </label>
          <Input
            id="key-date-val"
            value={date}
            invalid={dateError}
            placeholder="AAAA-MM-DD"
            onChange={(e) => setDate(e.target.value)}
          />
        </div>

        <div className="mt-2 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('legalCases.cancel')}
          </Button>
          <Button type="submit">
            {t('legalCases.addKeyDate')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
