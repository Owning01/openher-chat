import { useId } from 'react';

import { useT } from '@/i18n/useT';
import { Select } from '@/shared/ui';
import type { SelectOption } from '@/shared/ui';

import { useSettingsStore } from '../state/settingsStore';
import { HISTORY_BUDGET_LIMITS } from '../state/validation';
import { NumberField } from './NumberField';

export function HistoryBudgetSection() {
  const t = useT();
  const history = useSettingsStore((state) => state.settings.history);
  const patch = useSettingsStore((state) => state.patch);
  const modeId = useId();

  const modeOptions: SelectOption[] = [
    { value: 'auto', label: t('settings.historyModeAuto') },
    { value: 'fixed', label: t('settings.historyModeFixed') },
  ];

  return (
    <div className="space-y-4 rounded-lg border border-border-subtle p-3">
      <h3 className="text-sm font-medium text-text">{t('settings.historyTitle')}</h3>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor={modeId} className="block text-sm font-medium text-text">
            {t('settings.historyMode')}
          </label>
          <Select
            id={modeId}
            value={history.mode}
            options={modeOptions}
            onChange={(event) => {
              const mode = event.target.value === 'fixed' ? 'fixed' : 'auto';
              void patch({ history: { mode } });
            }}
          />
        </div>
        <NumberField
          label={t('settings.historyMaxPromptTokens')}
          value={history.maxPromptTokens}
          min={HISTORY_BUDGET_LIMITS.maxPromptTokens.min}
          max={HISTORY_BUDGET_LIMITS.maxPromptTokens.max}
          allowNull
          onCommit={(value) => void patch({ history: { maxPromptTokens: value } })}
        />
        <NumberField
          label={t('settings.historyReservedOutputTokens')}
          value={history.reservedOutputTokens}
          min={HISTORY_BUDGET_LIMITS.reservedOutputTokens.min}
          max={HISTORY_BUDGET_LIMITS.reservedOutputTokens.max}
          onCommit={(value) => void patch({ history: { reservedOutputTokens: value ?? history.reservedOutputTokens } })}
        />
        <NumberField
          label={t('settings.historyKeepLastTurns')}
          value={history.keepLastTurns}
          min={HISTORY_BUDGET_LIMITS.keepLastTurns.min}
          max={HISTORY_BUDGET_LIMITS.keepLastTurns.max}
          onCommit={(value) => void patch({ history: { keepLastTurns: value ?? history.keepLastTurns } })}
        />
        <NumberField
          label={t('settings.historyTruncatePercent')}
          value={Math.round(history.truncateMessageAtPercent * 100)}
          min={Math.round(HISTORY_BUDGET_LIMITS.truncateMessageAtPercent.min * 100)}
          max={Math.round(HISTORY_BUDGET_LIMITS.truncateMessageAtPercent.max * 100)}
          hint={t('settings.historyTruncateHint')}
          onCommit={(value) =>
            void patch({ history: { truncateMessageAtPercent: (value ?? history.truncateMessageAtPercent * 100) / 100 } })
          }
        />
      </div>
    </div>
  );
}
