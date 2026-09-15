import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createServices, ServicesProvider } from '@/app/services';
import type { HttpClient } from '@/domain/ports/HttpClient';
import type { CloudSyncPort } from '@/domain/ports/SyncPort';
import { buildSharePayload } from '@/domain/settings/share';
import type { SharePayload } from '@/domain/settings/share';
import { setLocale, t } from '@/i18n';
import { ToastViewport } from '@/shared/ui';
import { MemoryConversationRepository, MemoryKeyVault, MemorySettingsRepository } from '@/test/fakes/MemoryRepos';

import { SettingsPage } from '../SettingsPage';

beforeEach(() => {
  localStorage.clear();
  setLocale('es');
});

afterEach(() => {
  cleanup();
  setLocale('es');
});

function renderPage(sync?: CloudSyncPort) {
  const services = createServices({
    conversations: new MemoryConversationRepository(),
    settings: new MemorySettingsRepository(),
    keys: new MemoryKeyVault(),
    http: { request: async () => ({ status: 200, headers: {}, text: '' }) } as HttpClient,
  });
  // Hermético: sin fake explícito no hay nube (el `.env.local` del dev trae
  // config real y `createServices` la detectaría).
  if (sync === undefined) delete services.sync;
  else services.sync = sync;
  render(
    <ServicesProvider services={services}>
      <SettingsPage />
      <ToastViewport />
    </ServicesProvider>,
  );
}

function createFakeSync(initial: SharePayload | null = null) {
  let stored = initial === null ? null : (JSON.parse(JSON.stringify(initial)) as SharePayload);
  const pushes: SharePayload[] = [];
  const sync: CloudSyncPort = {
    async pull() {
      return stored === null ? null : (JSON.parse(JSON.stringify(stored)) as SharePayload);
    },
    async push(payload: SharePayload) {
      const clone = JSON.parse(JSON.stringify(payload)) as SharePayload;
      pushes.push(clone);
      stored = clone;
    },
  };
  return { sync, pushes };
}

function shareFileInput(): HTMLInputElement {
  const buttons = screen.getAllByRole('button', { name: t('settings.shareImport') });
  const container = buttons[0]?.closest('div');
  const input = container?.parentElement?.querySelector('input[type="file"]');
  if (!(input instanceof HTMLInputElement)) throw new Error('Falta el input de importar configuración.');
  return input;
}

function validPayloadFile(): File {
  const payload = buildSharePayload({
    providers: [
      {
        id: 'opencode-go',
        label: 'OpenCode Go',
        kind: 'opencode',
        baseUrl: 'https://opencode.ai/zen/go/v1',
        requiresKey: true,
        keyRef: 'provider:opencode-go',
        models: [{ id: 'muse-spark-1.3-contributor', label: 'Muse Spark', source: 'api' }],
        defaultModelId: 'muse-spark-1.3-contributor',
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    secrets: { 'provider:opencode-go': 'sk-papa' },
    settings: {
      activeProviderId: 'opencode-go',
      lastModelByProvider: { 'opencode-go': 'muse-spark-1.3-contributor' },
      chat: { systemPrompt: '', temperature: 0.5, maxOutputTokens: null, thinking: 'low' },
      locale: 'es',
    },
    now: 1,
  });
  return new File([JSON.stringify(payload)], 'openher-chat-config.json', { type: 'application/json' });
}

describe('ShareSection', () => {
  it('muestra exportar e importar con aviso de texto plano', async () => {
    renderPage();

    expect(await screen.findByRole('button', { name: t('settings.shareExport') })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t('settings.shareImport') })).toBeInTheDocument();
    expect(screen.getByText(t('settings.sharePlaintextWarning'))).toBeInTheDocument();
  });

  it('rechaza un archivo que no es configuración válida', async () => {
    renderPage();
    await screen.findByRole('button', { name: t('settings.shareImport') });

    fireEvent.change(shareFileInput(), { target: { files: [new File(['{"app":"otra"}'], 'x.json', { type: 'application/json' })] } });

    expect(await screen.findByText(t('settings.shareInvalid'))).toBeInTheDocument();
  });

  it('importa un paquete válido con confirmación y deja todo activo', async () => {
    renderPage();
    await screen.findByRole('button', { name: t('settings.shareImport') });

    fireEvent.change(shareFileInput(), { target: { files: [validPayloadFile()] } });

    const dialog = await screen.findByRole('dialog', { name: t('settings.shareConfirmTitle') });
    expect(dialog).toHaveTextContent('OpenCode Go');
    fireEvent.click(screen.getByRole('button', { name: t('settings.shareApply') }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: t('settings.shareConfirmTitle') })).not.toBeInTheDocument();
    });
    // El proveedor importado aparece en la lista y queda activo
    // (el detalle fino —modelo, keys— está cubierto en settingsStore.test).
    // La página arranca sin proveedores: este badge solo puede ser el importado.
    expect(await screen.findByText('OpenCode Go')).toBeInTheDocument();
    expect(await screen.findByText(t('settings.providerActive'))).toBeInTheDocument();
  });
});

describe('ShareSection - nube', () => {
  it('sin servicio sync no muestra el bloque de nube (sigue local)', async () => {
    renderPage();
    await screen.findByRole('button', { name: t('settings.shareImport') });

    expect(screen.queryByText(t('settings.cloudTitle'))).not.toBeInTheDocument();
  });

  it('con sync muestra toggle, aviso de texto plano y subir', async () => {
    const { sync } = createFakeSync();
    renderPage(sync);
    await screen.findByRole('button', { name: t('settings.shareImport') });

    expect(await screen.findByText(t('settings.cloudTitle'))).toBeInTheDocument();
    expect(screen.getByText(t('settings.cloudWarning'))).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: t('settings.cloudToggle') })).toBeChecked();
    expect(screen.getByRole('button', { name: t('settings.cloudPushNow') })).toBeInTheDocument();
  });

  it('aplica sola la configuración de la nube al abrir Ajustes', async () => {
    const { sync } = createFakeSync(
      buildSharePayload({
        providers: [
          {
            id: 'opencode-go',
            label: 'OpenCode Go',
            kind: 'opencode',
            baseUrl: 'https://opencode.ai/zen/go/v1',
            requiresKey: true,
            keyRef: 'provider:opencode-go',
            models: [{ id: 'muse-spark-1.3-contributor', label: 'Muse Spark', source: 'api' }],
            defaultModelId: 'muse-spark-1.3-contributor',
            createdAt: 1,
            updatedAt: 1,
          },
        ],
        secrets: { 'provider:opencode-go': 'sk-nube' },
        settings: {
          activeProviderId: 'opencode-go',
          lastModelByProvider: { 'opencode-go': 'muse-spark-1.3-contributor' },
          chat: { systemPrompt: '', temperature: 0.5, maxOutputTokens: null, thinking: 'low' },
          locale: 'es',
        },
        now: 50_000,
      }),
    );
    renderPage(sync);

    expect(await screen.findByText('OpenCode Go')).toBeInTheDocument();
    expect(await screen.findByText(t('settings.cloudPulled'))).toBeInTheDocument();
  });

  it('subir ahora manda proveedores y secreto a la nube', async () => {
    const { sync, pushes } = createFakeSync();
    renderPage(sync);
    await screen.findByRole('button', { name: t('settings.shareImport') });

    fireEvent.change(shareFileInput(), { target: { files: [validPayloadFile()] } });
    await screen.findByRole('dialog', { name: t('settings.shareConfirmTitle') });
    fireEvent.click(screen.getByRole('button', { name: t('settings.shareApply') }));
    await screen.findByText('OpenCode Go');

    fireEvent.click(screen.getByRole('button', { name: t('settings.cloudPushNow') }));
    await screen.findByText(t('settings.cloudPushed'));

    expect(pushes.length).toBeGreaterThanOrEqual(1);
    const last = pushes[pushes.length - 1];
    expect(last?.providers[0]?.config.label).toBe('OpenCode Go');
    expect(last?.providers[0]?.secret).toBe('sk-papa');
  });
});
