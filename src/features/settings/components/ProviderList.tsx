import { Server } from 'lucide-react';
import { useState } from 'react';

import type { ProviderConfig } from '@/domain/types/provider';
import { useT } from '@/i18n/useT';
import { ChevronDown, ChevronRight, Pencil, Plus, Trash } from '@/shared/icons';
import { Badge, Button, Dialog, EmptyState, IconButton, useToast } from '@/shared/ui';

import { useSettingsStore } from '../state/settingsStore';
import { ImportOpenCodeServer } from './ImportOpenCodeServer';
import { ModelsSection } from './ModelsSection';
import { providerKindLabel } from './providerKindLabel';
import { ProviderForm } from './ProviderForm';
import type { ProviderFormValue } from './ProviderForm';
import { SectionCard } from './SectionCard';

type EditorState = { mode: 'add' } | { mode: 'edit'; providerId: string };

export function ProviderList() {
  const t = useT();
  const providers = useSettingsStore((state) => state.providers);
  const activeProviderId = useSettingsStore((state) => state.settings.activeProviderId);
  const keyPresence = useSettingsStore((state) => state.keyPresence);
  const addProvider = useSettingsStore((state) => state.addProvider);
  const updateProvider = useSettingsStore((state) => state.updateProvider);
  const removeProvider = useSettingsStore((state) => state.removeProvider);
  const saveApiKey = useSettingsStore((state) => state.saveApiKey);
  const refreshModels = useSettingsStore((state) => state.refreshModels);
  const setActiveProvider = useSettingsStore((state) => state.setActiveProvider);
  const { push } = useToast();

  const [editor, setEditor] = useState<EditorState | null>(null);
  const [deleting, setDeleting] = useState<ProviderConfig | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const editingProvider =
    editor?.mode === 'edit' ? (providers.find((provider) => provider.id === editor.providerId) ?? null) : null;
  const editingKeyRef = editingProvider?.keyRef ?? null;

  const handleSubmit = async (value: ProviderFormValue): Promise<void> => {
    if (editor === null) return;
    setSaving(true);
    if (editor.mode === 'add') {
      const created = await addProvider({
        type: 'manual',
        label: value.label,
        kind: value.kind,
        baseUrl: value.baseUrl,
        requiresKey: value.requiresKey,
      });
      if (created !== null) {
        const typedKey = value.apiKey.trim() !== '';
        if (typedKey && created.keyRef !== null) {
          await saveApiKey(created.keyRef, value.apiKey);
        }
        push({ title: t('settings.providerCreated'), variant: 'success' });
        setEditor(null);
        await discoverModels(created, typedKey);
      }
    } else {
      const target = providers.find((provider) => provider.id === editor.providerId);
      if (target !== undefined) {
        const typedKey = value.apiKey.trim() !== '';
        await updateProvider(target.id, {
          label: value.label,
          kind: value.kind,
          baseUrl: value.baseUrl,
          requiresKey: value.requiresKey,
        });
        if (typedKey && target.keyRef !== null) {
          await saveApiKey(target.keyRef, value.apiKey);
        }
        if (target.models.length === 0) {
          await discoverModels(target, typedKey);
        }
      }
      setEditor(null);
    }
    setSaving(false);
  };

  /**
   * Descubre modelos al conectar, para que el usuario nunca tenga que tipearlos:
   * solo si el proveedor no requiere key o ya hay una guardada o recién escrita.
   */
  const discoverModels = async (provider: ProviderConfig, typedKey: boolean): Promise<void> => {
    const canDiscover =
      !provider.requiresKey ||
      typedKey ||
      (provider.keyRef !== null && keyPresence[provider.keyRef] === true);
    if (!canDiscover) return;
    const models = await refreshModels(provider.id);
    if (models === null) {
      push({ title: t('settings.providerAutoDiscoverError'), variant: 'warning' });
      return;
    }
    push({ title: t('settings.providerAutoDiscoverSuccess', { count: models.length }), variant: 'success' });
  };

  const handleClearKey = async (provider: ProviderConfig): Promise<void> => {
    if (provider.keyRef === null) return;
    const cleared = await saveApiKey(provider.keyRef, '');
    if (cleared) {
      push({ title: t('settings.apiKeyRemoved'), variant: 'success' });
      return;
    }
    push({ title: t('settings.apiKeyClearError'), variant: 'danger' });
  };

  const handleDelete = async (): Promise<void> => {
    if (deleting === null) return;
    const removed = await removeProvider(deleting.id);
    if (removed) {
      if (expandedId === deleting.id) setExpandedId(null);
      push({ title: t('settings.providerRemoved'), variant: 'success' });
    }
    setDeleting(null);
  };

  return (
    <SectionCard
      title={t('settings.sectionProviders')}
      description={t('settings.sectionProvidersDescription')}
      icon={<Server aria-hidden="true" className="size-4" />}
      actions={
        <div className="flex items-center gap-2">
          <Button size="sm" variant="secondary" onClick={() => setImportOpen(true)}>
            {t('settings.importOpencodeAction')}
          </Button>
          <Button size="sm" icon={<Plus aria-hidden="true" />} onClick={() => setEditor({ mode: 'add' })}>
            {t('settings.providerAdd')}
          </Button>
        </div>
      }
    >
      {providers.length === 0 ? (
        <EmptyState
          title={t('settings.providerEmptyTitle')}
          description={t('settings.providerEmptyDescription')}
          action={
            <Button size="sm" icon={<Plus aria-hidden="true" />} onClick={() => setEditor({ mode: 'add' })}>
              {t('settings.providerAdd')}
            </Button>
          }
        />
      ) : (
        <ul className="space-y-2">
          {providers.map((provider) => {
            const isActive = provider.id === activeProviderId;
            const expanded = expandedId === provider.id;
            return (
              <li key={provider.id} className="rounded-lg border border-border-subtle bg-background/40">
                <div className="flex flex-wrap items-center gap-2 p-3">
                  {isActive ? (
                    <Badge variant="primary">{t('settings.providerActive')}</Badge>
                  ) : (
                    <Button size="sm" variant="ghost" onClick={() => void setActiveProvider(provider.id)}>
                      {t('settings.providerSetActive')}
                    </Button>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-text">{provider.label}</p>
                    <p className="truncate text-xs text-muted">
                      {providerKindLabel(provider.kind, t)}
                      {' · '}
                      {provider.baseUrl}
                      {' · '}
                      {t('settings.providerModelCount', { count: provider.models.length })}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={expanded ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
                    aria-expanded={expanded}
                    onClick={() => setExpandedId(expanded ? null : provider.id)}
                  >
                    {t('settings.providerModels')}
                  </Button>
                  <IconButton
                    label={t('settings.providerEdit')}
                    icon={<Pencil aria-hidden="true" />}
                    size="sm"
                    onClick={() => setEditor({ mode: 'edit', providerId: provider.id })}
                  />
                  <IconButton
                    label={t('common.delete')}
                    icon={<Trash aria-hidden="true" />}
                    size="sm"
                    onClick={() => setDeleting(provider)}
                  />
                </div>
                {expanded ? (
                  <div className="border-t border-border-subtle p-3">
                    <ModelsSection provider={provider} />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <Dialog
        open={editor !== null}
        title={editor?.mode === 'edit' ? t('settings.providerEditTitle') : t('settings.providerAddTitle')}
        onClose={() => setEditor(null)}
        className="max-h-[85dvh] overflow-y-auto"
      >
        {editor !== null ? (
          <ProviderForm
            key={editor.mode === 'edit' ? editor.providerId : 'new'}
            provider={editingProvider}
            hasStoredKey={editingKeyRef !== null && keyPresence[editingKeyRef] === true}
            saving={saving}
            onSubmit={(value) => void handleSubmit(value)}
            onCancel={() => setEditor(null)}
            onClearKey={
              editingProvider !== null && editingKeyRef !== null
                ? () => void handleClearKey(editingProvider)
                : undefined
            }
          />
        ) : null}
      </Dialog>

      <Dialog
        open={deleting !== null}
        title={t('settings.providerDeleteTitle')}
        onClose={() => setDeleting(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleting(null)}>
              {t('common.cancel')}
            </Button>
            <Button variant="danger" onClick={() => void handleDelete()}>
              {t('common.delete')}
            </Button>
          </>
        }
      >
        <p>{deleting === null ? '' : t('settings.providerDeleteDescription', { name: deleting.label })}</p>
      </Dialog>

      <ImportOpenCodeServer open={importOpen} onClose={() => setImportOpen(false)} />
    </SectionCard>
  );
}
