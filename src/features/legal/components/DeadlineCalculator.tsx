import { useMemo, useState } from 'react';

import { computeDeadline, computePrescriptionTable } from '@/domain/legal/deadlines';
import { resolveDeadlineRules } from '@/domain/legal/rules';
import type { DeadlineRule, LegalCase } from '@/domain/types/legal';
import { useT } from '@/i18n/useT';
import { Badge, Button, Input } from '@/shared/ui';

export interface DeadlineCalculatorProps {
  caseData: LegalCase;
}

export function DeadlineCalculator({ caseData }: DeadlineCalculatorProps) {
  const t = useT();

  const todayStr = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [anchorDate, setAnchorDate] = useState<string>(todayStr);
  const [daysAmount, setDaysAmount] = useState<number>(5);
  const [customCalculated, setCustomCalculated] = useState<ReturnType<typeof computeDeadline> | null>(null);

  const rules: DeadlineRule[] = useMemo(() => {
    const list = resolveDeadlineRules(caseData.jurisdiction);
    return list.length > 0 ? list : resolveDeadlineRules('national');
  }, [caseData.jurisdiction]);

  const anchors = useMemo(() => {
    const list: { id: string; label: string; date: string }[] = [];
    for (const keyDate of caseData.keyDates) {
      list.push({ id: keyDate.id, label: keyDate.label, date: keyDate.date });
    }
    for (const fact of caseData.facts) {
      if (fact.date) {
        list.push({ id: fact.id, label: fact.statement.slice(0, 40), date: fact.date });
      }
    }
    return list;
  }, [caseData.keyDates, caseData.facts]);

  const prescriptionTable = useMemo(() => {
    if (anchors.length === 0 || rules.length === 0) return [];
    return computePrescriptionTable({
      anchors,
      rules: rules.filter((r) => r.scope === 'prescription'),
      caseId: caseData.id,
      today: todayStr,
    });
  }, [anchors, rules, caseData.id, todayStr]);

  const handleCalculate = () => {
    const rule: DeadlineRule = {
      id: 'custom-procedural',
      jurisdiction: caseData.jurisdiction,
      scope: 'procedural',
      normRef: 'CPCCN / CPCCT',
      days: daysAmount,
      unit: 'business-days',
      from: 'notification',
      verified: true,
      sourceUrl: '',
      label: `Plazo de ${daysAmount} días hábiles`,
    };

    const result = computeDeadline({
      rule,
      anchor: anchorDate,
      caseId: caseData.id,
      today: todayStr,
    });
    setCustomCalculated(result);
  };

  return (
    <div data-testid="deadline-calculator" className="flex flex-col gap-5 p-1">
      {/* Calculadora de plazo procesal puntual */}
      <section className="rounded-lg border border-border bg-surface p-4 shadow-xs">
        <h4 className="text-sm font-semibold text-text">{t('legalCases.deadlinesTitle')}</h4>
        <p className="mt-0.5 text-xs text-muted">{t('legalCases.deadlinesIntro')}</p>

        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <label htmlFor="calc-anchor" className="text-xs font-medium text-text">
              {t('legalCases.deadlinesAnchorLabel')}
            </label>
            <Input
              id="calc-anchor"
              type="date"
              value={anchorDate}
              onChange={(e) => setAnchorDate(e.target.value)}
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="calc-days" className="text-xs font-medium text-text">
              {t('legalCases.deadlinesDaysLabel')}
            </label>
            <Input
              id="calc-days"
              type="number"
              min={1}
              max={180}
              value={daysAmount}
              onChange={(e) => setDaysAmount(Math.max(1, Number(e.target.value)))}
            />
          </div>

          <div className="flex items-end">
            <Button type="button" onClick={handleCalculate} className="w-full">
              {t('legalCases.deadlinesCalculate')}
            </Button>
          </div>
        </div>

        {customCalculated && (
          <div data-testid="deadline-custom-result" className="mt-4 rounded-md border border-border bg-surface-subtle/50 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <span className="text-xs text-muted">{t('legalCases.deadlinesDueDate')}:</span>
                <span className="ml-2 font-mono text-base font-bold text-text">
                  {customCalculated.dueDate}
                </span>
              </div>
              <Badge variant={customCalculated.expired ? 'danger' : 'success'}>
                {customCalculated.expired ? t('legalCases.deadlinesExpired') : t('legalCases.deadlinesActive')}
              </Badge>
            </div>
            <p className="mt-1 text-xs text-muted">
              {t('legalCases.deadlinesCountedDays')}: {customCalculated.countedDays} ({customCalculated.label})
            </p>
          </div>
        )}
      </section>

      {/* Tabla de prescripción derivada de los hechos y fechas */}
      <section className="rounded-lg border border-border bg-surface p-4 shadow-xs">
        <h4 className="text-sm font-semibold text-text">{t('legalCases.prescriptionTitle')}</h4>
        {anchors.length === 0 ? (
          <p className="mt-2 text-xs text-muted">
            {t('legalCases.emptyFacts')} {t('legalCases.emptyKeyDates')}
          </p>
        ) : prescriptionTable.length === 0 ? (
          <p className="mt-2 text-xs text-muted">Sin reglas de prescripción aplicables a las fechas del caso.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-border text-muted">
                <tr>
                  <th className="pb-2 font-medium">Hito / Hecho</th>
                  <th className="pb-2 font-medium">Plazo</th>
                  <th className="pb-2 font-medium">Vencimiento</th>
                  <th className="pb-2 font-medium">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {prescriptionTable.slice(0, 10).map((item) => (
                  <tr key={item.id} className="hover:bg-surface-subtle/30">
                    <td className="py-2 pr-2 font-medium text-text max-w-xs truncate">{item.label}</td>
                    <td className="py-2 pr-2 text-muted">{item.ruleId} ({item.amount} {item.unit})</td>
                    <td className="py-2 pr-2 font-mono text-text">{item.dueDate}</td>
                    <td className="py-2">
                      <Badge variant={item.expired ? 'danger' : 'success'}>
                        {item.expired ? t('legalCases.deadlinesExpired') : t('legalCases.deadlinesActive')}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
