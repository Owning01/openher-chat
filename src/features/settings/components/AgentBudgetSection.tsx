import type { AgentBudget } from '@/domain/types/agent';
import { useT } from '@/i18n/useT';
import type { MessageKey } from '@/i18n/types';

import { useSettingsStore } from '../state/settingsStore';
import { AGENT_BUDGET_LIMITS } from '../state/validation';
import { NumberField } from './NumberField';

const FIELDS: readonly { key: keyof AgentBudget; label: MessageKey }[] = [
  { key: 'maxSteps', label: 'settings.agentMaxSteps' },
  { key: 'maxToolCalls', label: 'settings.agentMaxToolCalls' },
  { key: 'maxToolResultChars', label: 'settings.agentMaxToolResultChars' },
  { key: 'maxTotalTokens', label: 'settings.agentMaxTotalTokens' },
  { key: 'maxWallClockMs', label: 'settings.agentMaxWallClockMs' },
  { key: 'maxRetriesPerStep', label: 'settings.agentMaxRetriesPerStep' },
  { key: 'toolTimeoutMs', label: 'settings.agentToolTimeoutMs' },
];

export function AgentBudgetSection() {
  const t = useT();
  const agent = useSettingsStore((state) => state.settings.agent);
  const patch = useSettingsStore((state) => state.patch);

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">{t('settings.agentHint')}</p>
      <div className="grid gap-4 sm:grid-cols-2">
        {FIELDS.map(({ key, label }) => {
          const limits = AGENT_BUDGET_LIMITS[key];
          return (
            <NumberField
              key={key}
              label={t(label)}
              value={agent[key]}
              min={limits.min}
              max={limits.max}
              onCommit={(value) => {
                if (value !== null) void patch({ agent: { [key]: value } });
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
