import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createServices, ServicesProvider } from '@/app/services';
import type { HttpClient } from '@/domain/ports/HttpClient';
import { setLocale, t } from '@/i18n';
import { ToastViewport } from '@/shared/ui';
import { MemoryConversationRepository, MemoryKeyVault, MemorySettingsRepository } from '@/test/fakes/MemoryRepos';

import { SettingsPage } from './SettingsPage';

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  setLocale('es');
});

function renderPage(keys: MemoryKeyVault = new MemoryKeyVault(), options: { manifest?: string } = {}) {
  const settingsRepo = new MemorySettingsRepository();
  const requests: string[] = [];
  const http: HttpClient = {
    async request(request) {
      requests.push(request.url);
      if (options.manifest !== undefined && request.url.includes('version.json')) {
        return { status: 200, headers: {}, text: options.manifest };
      }
      return { status: 200, headers: {}, text: '{"data":[{"id":"model-a","name":"Model A"}]}' };
    },
  };
  const services = createServices({
    conversations: new MemoryConversationRepository(),
    settings: settingsRepo,
    keys,
    http,
  });

  render(
    <ServicesProvider services={services}>
      <SettingsPage />
      <ToastViewport />
    </ServicesProvider>,
  );

  return { settingsRepo, keys, requests };
}

async function addProvider(): Promise<void> {
  const addButtons = await screen.findAllByRole('button', { name: t('settings.providerAdd') });
  const addButton = addButtons[0];
  if (addButton === undefined) throw new Error('missing add provider button');
  fireEvent.click(addButton);

  const dialog = await screen.findByRole('dialog', { name: t('settings.providerAddTitle') });
  fireEvent.change(within(dialog).getByLabelText(t('settings.providerLabel')), { target: { value: 'Local' } });
  fireEvent.change(within(dialog).getByLabelText(t('settings.providerBaseUrl')), {
    target: { value: 'https://api.local/v1' },
  });
  fireEvent.click(within(dialog).getByRole('button', { name: t('common.save') }));

  await screen.findByText('Local');
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
}

class FailingRemoveVault extends MemoryKeyVault {
  override async remove(): Promise<void> {
    throw new Error('vault caído');
  }
}

describe('SettingsPage', () => {
  it('muestra las siete secciones de ajustes', async () => {
    renderPage();

    expect(await screen.findByText(t('settings.sectionProviders'))).toBeInTheDocument();
    expect(screen.getByText(t('settings.sectionChat'))).toBeInTheDocument();
    expect(screen.getByText(t('settings.sectionAgent'))).toBeInTheDocument();
    expect(screen.getByText(t('settings.sectionSearch'))).toBeInTheDocument();
    expect(screen.getByText(t('settings.sectionWorkMode'))).toBeInTheDocument();
    expect(screen.getByText(t('settings.sectionAppearance'))).toBeInTheDocument();
    expect(screen.getByText(t('updates.title'))).toBeInTheDocument();
  });

  it('el switch del workspace legal persiste y marca el setup como ofrecido', async () => {
    const { settingsRepo } = renderPage();
    const toggle = await screen.findByRole('switch', { name: t('settings.workModeLegalLabel') });
    expect(toggle).not.toBeChecked();

    fireEvent.click(toggle);

    await waitFor(async () => {
      const settings = await settingsRepo.load();
      expect(settings.legal.enabled).toBe(true);
      expect(settings.legal.setupCompleted).toBe(true);
    });
    expect(screen.getByRole('switch', { name: t('settings.workModeLegalLabel') })).toBeChecked();
  });

  it('detecta y ofrece descargar una versión nueva', async () => {
    renderPage(new MemoryKeyVault(), {
      manifest: JSON.stringify({ version: '9.0.0', apkUrl: 'https://example.com/app.apk', sha256: 'abc' }),
    });

    fireEvent.click(await screen.findByRole('button', { name: t('updates.check') }));

    expect(await screen.findByText(t('updates.availableTitle', { version: '9.0.0' }))).toBeInTheDocument();
    expect(screen.getByRole('link', { name: t('updates.download') })).toHaveAttribute(
      'href',
      'https://example.com/app.apk',
    );
  });

  it('persiste el auto-chequeo de actualizaciones', async () => {
    const { settingsRepo } = renderPage();
    const toggle = await screen.findByRole('switch', { name: t('updates.autoCheck') });
    expect(toggle).toBeChecked();

    fireEvent.click(toggle);

    await waitFor(async () => {
      expect((await settingsRepo.load()).ui.autoCheckUpdates).toBe(false);
    });
  });

  it('agrega un proveedor manual, lo muestra y lo persiste como activo', async () => {
    const { settingsRepo } = renderPage();

    await addProvider();

    expect(localStorage.getItem('openher.providers.v1')).toContain('https://api.local/v1');
    await waitFor(async () => {
      expect((await settingsRepo.load()).activeProviderId).not.toBeNull();
    });
  });

  it('acota la temperatura al confirmar el campo', async () => {
    const { settingsRepo } = renderPage();
    const input = await screen.findByLabelText(t('settings.chatTemperature'));

    fireEvent.change(input, { target: { value: '9' } });
    fireEvent.blur(input);

    await waitFor(async () => {
      expect((await settingsRepo.load()).chat.temperature).toBe(2);
    });
  });

  it('persiste el nivel de pensamiento elegido', async () => {
    const { settingsRepo } = renderPage();
    const select = await screen.findByLabelText(t('settings.chatThinking'));

    fireEvent.change(select, { target: { value: 'high' } });

    await waitFor(async () => {
      expect((await settingsRepo.load()).chat.thinking).toBe('high');
    });
  });

  it('descubre modelos desde la API del proveedor', async () => {
    const { requests } = renderPage();

    await addProvider();
    fireEvent.click(screen.getByRole('button', { name: t('settings.providerModels') }));
    fireEvent.click(await screen.findByRole('button', { name: t('settings.modelsRefresh') }));

    expect((await screen.findAllByText('Model A')).length).toBeGreaterThan(0);
    expect(requests.some((url) => url.endsWith('/models'))).toBe(true);
  });

  it('guarda la API key en el KeyVault y nunca en la config', async () => {
    const { settingsRepo, keys } = renderPage();

    await addProvider();
    fireEvent.click(screen.getByRole('button', { name: t('settings.providerEdit') }));
    const dialog = await screen.findByRole('dialog', { name: t('settings.providerEditTitle') });
    fireEvent.change(within(dialog).getByLabelText(t('settings.apiKeyLabel')), {
      target: { value: 'sk-live-1' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: t('settings.apiKeySave') }));

    const stored = JSON.parse(localStorage.getItem('openher.providers.v1') ?? '[]') as {
      keyRef: string | null;
    }[];
    const keyRef = stored[0]?.keyRef ?? null;
    expect(keyRef).not.toBeNull();

    await waitFor(async () => {
      expect(await keys.get(keyRef ?? '')).toBe('sk-live-1');
    });
    expect(localStorage.getItem('openher.providers.v1') ?? '').not.toContain('sk-live-1');
    expect(JSON.stringify(await settingsRepo.load())).not.toContain('sk-live-1');
  });

  it('no muestra éxito al borrar la key si el vault falla', async () => {
    renderPage(new FailingRemoveVault());

    await addProvider();
    fireEvent.click(screen.getByRole('button', { name: t('settings.providerEdit') }));
    const dialog = await screen.findByRole('dialog', { name: t('settings.providerEditTitle') });
    fireEvent.change(within(dialog).getByLabelText(t('settings.apiKeyLabel')), { target: { value: 'sk-live-1' } });
    fireEvent.click(within(dialog).getByRole('button', { name: t('settings.apiKeySave') }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: t('settings.providerEdit') }));
    const reopened = await screen.findByRole('dialog', { name: t('settings.providerEditTitle') });
    fireEvent.click(within(reopened).getByRole('button', { name: t('settings.apiKeyClear') }));

    expect(await screen.findByText(t('settings.apiKeyClearError'))).toBeInTheDocument();
    expect(screen.queryByText(t('settings.apiKeyRemoved'))).not.toBeInTheDocument();
  });
});
