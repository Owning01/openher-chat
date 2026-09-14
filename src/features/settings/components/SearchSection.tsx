import { useId, useState } from 'react';

import { useT } from '@/i18n/useT';
import { Select, Switch, useToast } from '@/shared/ui';
import type { SelectOption } from '@/shared/ui';

import { SEARCH_KEY_REFS, useSettingsStore } from '../state/settingsStore';
import { SEARCH_LIMITS } from '../state/validation';
import { ApiKeyField } from './ApiKeyField';
import { NumberField } from './NumberField';

export function SearchSection() {
  const t = useT();
  const search = useSettingsStore((state) => state.settings.search);
  const tools = useSettingsStore((state) => state.settings.tools);
  const keyPresence = useSettingsStore((state) => state.keyPresence);
  const patch = useSettingsStore((state) => state.patch);
  const saveApiKey = useSettingsStore((state) => state.saveApiKey);
  const { push } = useToast();
  const modeId = useId();
  const freshnessId = useId();
  const toolsTitleId = useId();
  const [braveKey, setBraveKey] = useState('');
  const [tavilyKey, setTavilyKey] = useState('');
  const [savingRef, setSavingRef] = useState<string | null>(null);

  const modeOptions: SelectOption[] = [
    { value: 'auto', label: t('settings.searchModeAuto') },
    { value: 'brave', label: t('settings.searchModeBrave') },
    { value: 'tavily', label: t('settings.searchModeTavily') },
    { value: 'duckduckgo', label: t('settings.searchModeDuckduckgo') },
    { value: 'exa', label: t('settings.searchModeExa') },
  ];

  const freshnessOptions: SelectOption[] = [
    { value: 'any', label: t('settings.searchFreshnessAny') },
    { value: 'day', label: t('settings.searchFreshnessDay') },
    { value: 'week', label: t('settings.searchFreshnessWeek') },
    { value: 'month', label: t('settings.searchFreshnessMonth') },
    { value: 'year', label: t('settings.searchFreshnessYear') },
  ];

  const persistKey = async (ref: string, secret: string, reset: () => void): Promise<void> => {
    setSavingRef(ref);
    const saved = await saveApiKey(ref, secret);
    setSavingRef(null);
    if (!saved) return;
    reset();
    push({
      title: secret.trim() === '' ? t('settings.apiKeyRemoved') : t('settings.apiKeySaved'),
      variant: 'success',
    });
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor={modeId} className="block text-sm font-medium text-text">
            {t('settings.searchMode')}
          </label>
          <Select
            id={modeId}
            value={search.mode}
            options={modeOptions}
            onChange={(event) => {
              const value = event.target.value;
              const mode =
                value === 'brave' || value === 'tavily' || value === 'duckduckgo' || value === 'exa' ? value : 'auto';
              void patch({ search: { mode } });
            }}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor={freshnessId} className="block text-sm font-medium text-text">
            {t('settings.searchFreshness')}
          </label>
          <Select
            id={freshnessId}
            value={search.defaultFreshness}
            options={freshnessOptions}
            onChange={(event) => {
              const value = event.target.value;
              const defaultFreshness =
                value === 'day' || value === 'week' || value === 'month' || value === 'year' ? value : 'any';
              void patch({ search: { defaultFreshness } });
            }}
          />
        </div>
        <NumberField
          label={t('settings.searchMaxResults')}
          value={search.maxResults}
          min={SEARCH_LIMITS.maxResults.min}
          max={SEARCH_LIMITS.maxResults.max}
          onCommit={(value) => void patch({ search: { maxResults: value ?? search.maxResults } })}
        />
        <div className="flex items-center justify-between gap-3 sm:pt-7">
          <span className="text-sm font-medium text-text">{t('settings.searchSafeSearch')}</span>
          <Switch
            checked={search.safeSearch}
            label={t('settings.searchSafeSearch')}
            onCheckedChange={(checked) => void patch({ search: { safeSearch: checked } })}
          />
        </div>
      </div>

      <p className="text-sm text-muted">{t('settings.searchHint')}</p>

      <ApiKeyField
        label={`Brave · ${t('settings.apiKeyLabel')}`}
        value={braveKey}
        hint={t('settings.apiKeyHint')}
        hasStoredKey={keyPresence[SEARCH_KEY_REFS.brave] === true}
        saving={savingRef === SEARCH_KEY_REFS.brave}
        onChange={setBraveKey}
        onSave={() => void persistKey(SEARCH_KEY_REFS.brave, braveKey, () => setBraveKey(''))}
        onClear={() => void persistKey(SEARCH_KEY_REFS.brave, '', () => setBraveKey(''))}
      />
      <ApiKeyField
        label={`Tavily · ${t('settings.apiKeyLabel')}`}
        value={tavilyKey}
        hint={t('settings.apiKeyHint')}
        hasStoredKey={keyPresence[SEARCH_KEY_REFS.tavily] === true}
        saving={savingRef === SEARCH_KEY_REFS.tavily}
        onChange={setTavilyKey}
        onSave={() => void persistKey(SEARCH_KEY_REFS.tavily, tavilyKey, () => setTavilyKey(''))}
        onClear={() => void persistKey(SEARCH_KEY_REFS.tavily, '', () => setTavilyKey(''))}
      />

      <div role="group" aria-labelledby={toolsTitleId} className="space-y-3 rounded-lg border border-border-subtle p-3">
        <h3 id={toolsTitleId} className="text-sm font-medium text-text">
          {t('settings.searchToolsTitle')}
        </h3>
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-text">{t('settings.searchWebSearch')}</span>
          <Switch
            checked={tools.webSearchEnabled}
            label={t('settings.searchWebSearch')}
            onCheckedChange={(checked) => void patch({ tools: { webSearchEnabled: checked } })}
          />
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-text">{t('settings.searchOpenUrl')}</span>
          <Switch
            checked={tools.openUrlEnabled}
            label={t('settings.searchOpenUrl')}
            onCheckedChange={(checked) => void patch({ tools: { openUrlEnabled: checked } })}
          />
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-text">{t('settings.searchRequireApproval')}</span>
          <Switch
            checked={tools.requireApproval}
            label={t('settings.searchRequireApproval')}
            onCheckedChange={(checked) => void patch({ tools: { requireApproval: checked } })}
          />
        </div>
      </div>
    </div>
  );
}
