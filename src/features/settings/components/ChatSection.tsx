import { useEffect, useId, useState } from 'react';

import { useT } from '@/i18n/useT';
import type { MessageKey } from '@/i18n/types';
import { THINKING_LEVELS } from '@/domain/types/provider';
import type { ThinkingLevel } from '@/domain/types/provider';
import { Select, TextArea } from '@/shared/ui';
import type { SelectOption } from '@/shared/ui';

import { useSettingsStore } from '../state/settingsStore';
import { MAX_OUTPUT_TOKENS_LIMITS, TEMPERATURE_LIMITS } from '../state/validation';
import { HistoryBudgetSection } from './HistoryBudgetSection';
import { NumberField } from './NumberField';

function isThinkingLevel(value: string): value is ThinkingLevel {
  return (THINKING_LEVELS as readonly string[]).includes(value);
}

const THINKING_LABEL_KEYS: Record<ThinkingLevel, MessageKey> = {
  off: 'settings.chatThinking_off',
  low: 'settings.chatThinking_low',
  medium: 'settings.chatThinking_medium',
  high: 'settings.chatThinking_high',
  max: 'settings.chatThinking_max',
};

export function ChatSection() {
  const t = useT();
  const chat = useSettingsStore((state) => state.settings.chat);
  const patch = useSettingsStore((state) => state.patch);
  const promptId = useId();
  const thinkingId = useId();
  const [prompt, setPrompt] = useState(chat.systemPrompt);

  useEffect(() => {
    setPrompt(chat.systemPrompt);
  }, [chat.systemPrompt]);

  const commitPrompt = (): void => {
    if (prompt.trim() === '' || prompt === chat.systemPrompt) return;
    void patch({ chat: { systemPrompt: prompt } });
  };

  const thinkingOptions: SelectOption[] = THINKING_LEVELS.map((level) => ({
    value: level,
    label: t(THINKING_LABEL_KEYS[level]),
  }));

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <label htmlFor={promptId} className="block text-sm font-medium text-text">
          {t('settings.chatSystemPrompt')}
        </label>
        <TextArea
          id={promptId}
          rows={4}
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          onBlur={commitPrompt}
        />
        <p className="text-xs text-muted">{t('settings.chatSystemPromptHint')}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <NumberField
          label={t('settings.chatTemperature')}
          value={chat.temperature}
          min={TEMPERATURE_LIMITS.min}
          max={TEMPERATURE_LIMITS.max}
          step={0.1}
          hint={t('settings.chatTemperatureHint')}
          onCommit={(value) => {
            if (value !== null) void patch({ chat: { temperature: value } });
          }}
        />
        <NumberField
          label={t('settings.chatMaxOutputTokens')}
          value={chat.maxOutputTokens}
          min={MAX_OUTPUT_TOKENS_LIMITS.min}
          max={MAX_OUTPUT_TOKENS_LIMITS.max}
          allowNull
          hint={t('settings.chatMaxOutputTokensHint')}
          onCommit={(value) => void patch({ chat: { maxOutputTokens: value } })}
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor={thinkingId} className="block text-sm font-medium text-text">
          {t('settings.chatThinking')}
        </label>
        <Select
          id={thinkingId}
          value={chat.thinking}
          options={thinkingOptions}
          onChange={(event) => {
            const value = event.target.value;
            if (isThinkingLevel(value)) void patch({ chat: { thinking: value } });
          }}
        />
        <p className="text-xs text-muted">{t('settings.chatThinkingHint')}</p>
      </div>

      <HistoryBudgetSection />
    </div>
  );
}
