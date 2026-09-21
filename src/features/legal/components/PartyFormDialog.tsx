import { useState } from 'react';
import type { FormEvent } from 'react';

import type { LegalParty, LegalPartyRole } from '@/domain/types/legal';
import { useT } from '@/i18n/useT';
import { Button, Dialog, Input, Select } from '@/shared/ui';
import { newId } from '@/shared/utils/ids';

export interface PartyFormDialogProps {
  open: boolean;
  party?: LegalParty | null;
  onClose: () => void;
  onSave: (party: LegalParty) => void;
}

export function PartyFormDialog({ open, party, onClose, onSave }: PartyFormDialogProps) {
  const t = useT();
  const [name, setName] = useState(party?.name ?? '');
  const [role, setRole] = useState<LegalPartyRole>(party?.role ?? 'plaintiff');
  const [taxId, setTaxId] = useState(party?.taxId ?? '');
  const [address, setAddress] = useState(party?.address ?? '');
  const [representative, setRepresentative] = useState(party?.representative ?? '');
  const [touched, setTouched] = useState(false);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setTouched(true);
    if (name.trim() === '') return;

    onSave({
      id: party?.id ?? newId('party'),
      name: name.trim(),
      role,
      ...(taxId.trim() !== '' ? { taxId: taxId.trim() } : {}),
      ...(address.trim() !== '' ? { address: address.trim() } : {}),
      ...(representative.trim() !== '' ? { representative: representative.trim() } : {}),
    });
    onClose();
  };

  const nameError = touched && name.trim() === '';

  const roleOptions = [
    { value: 'plaintiff', label: t('legalCases.rolePlaintiff') },
    { value: 'defendant', label: t('legalCases.roleDefendant') },
    { value: 'third-party', label: t('legalCases.roleThirdParty') },
  ];

  return (
    <Dialog open={open} title={party ? t('legalCases.editParty') : t('legalCases.addParty')} onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <div className="space-y-1">
          <label htmlFor="party-name" className="text-xs font-medium text-text">
            {t('legalCases.partyNameLabel')} *
          </label>
          <Input
            id="party-name"
            value={name}
            invalid={nameError}
            placeholder="Ej.: Juan Pérez o Empresa S.A."
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label htmlFor="party-role" className="text-xs font-medium text-text">
              {t('legalCases.clientRoleLabel')}
            </label>
            <Select
              id="party-role"
              value={role}
              options={roleOptions}
              onChange={(e) => setRole(e.target.value as LegalPartyRole)}
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="party-tax-id" className="text-xs font-medium text-text">
              {t('legalCases.partyTaxIdLabel')}
            </label>
            <Input
              id="party-tax-id"
              value={taxId}
              placeholder="20-12345678-9"
              onChange={(e) => setTaxId(e.target.value)}
            />
          </div>
        </div>

        <div className="space-y-1">
          <label htmlFor="party-address" className="text-xs font-medium text-text">
            {t('legalCases.partyAddressLabel')}
          </label>
          <Input
            id="party-address"
            value={address}
            placeholder="Av. Corrientes 1234, CABA"
            onChange={(e) => setAddress(e.target.value)}
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="party-rep" className="text-xs font-medium text-text">
            {t('legalCases.partyRepLabel')}
          </label>
          <Input
            id="party-rep"
            value={representative}
            placeholder="Dr. Matías Gómez (T° 45 F° 678)"
            onChange={(e) => setRepresentative(e.target.value)}
          />
        </div>

        <div className="mt-2 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('legalCases.cancel')}
          </Button>
          <Button type="submit">
            {party ? t('legalCases.editParty') : t('legalCases.addParty')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
