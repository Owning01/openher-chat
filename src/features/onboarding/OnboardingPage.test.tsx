import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ServicesProvider, createServices } from '@/app/services';
import type { AppServices } from '@/app/services';
import type { ProviderAdapter } from '@/domain/ports/ProviderAdapter';
import type { ModelInfo, ProviderConfig } from '@/domain/types/provider';
import { setLocale, t } from '@/i18n';
import {
  MemoryConversationRepository,
  MemoryKeyVault,
  MemorySettingsRepository,
} from '@/test/fakes/MemoryRepos';

import { OnboardingPage } from './OnboardingPage';
import { isOnboardingResolvedThisSession, resetOnboardingSession } from './session';

const MODELS: ModelInfo[] = [
  { id: 'model-a', label: 'Model A', source: 'api' },
  { id: 'model-b', label: 'Model B', source: 'api' },
];

function createFakeAdapter(listModels: () => Promise<ModelInfo[]>): ProviderAdapter {
  return {
    providerId: 'fake',
    kind: 'openai-compatible',
    capabilities: () => ({
      streaming: false,
      toolCalling: false,
      systemPrompt: true,
      listModels: true,
      images: false,
    }),
    listModels,
    async *streamChat() {},
  };
}

interface RenderOptions {
  createAdapter?: AppServices['createAdapter'];
}

function renderPage(options: RenderOptions = {}) {
  const settingsRepo = new MemorySettingsRepository();
  const keys = new MemoryKeyVault();
  const adapterConfigs: ProviderConfig[] = [];
  const base = createServices({
    conversations: new MemoryConversationRepository(),
    settings: settingsRepo,
    keys,
  });
  const services: AppServices = {
    ...base,
    createAdapter:
      options.createAdapter ??
      (async (config) => {
        adapterConfigs.push(config);
        return createFakeAdapter(async () => MODELS.map((model) => ({ ...model })));
      }),
  };

  render(
    <ServicesProvider services={services}>
      <OnboardingPage />
    </ServicesProvider>,
  );

  return { settingsRepo, keys, adapterConfigs };
}

async function selectTemplate(name: RegExp): Promise<void> {
  await screen.findByTestId('onboarding-wizard');
  fireEvent.click(screen.getByRole('button', { name }));
  fireEvent.click(screen.getByRole('button', { name: t('onboarding.continue') }));
}

beforeEach(() => {
  localStorage.clear();
  resetOnboardingSession();
});

afterEach(() => {
  cleanup();
  setLocale('es');
  localStorage.clear();
  resetOnboardingSession();
});

describe('OnboardingPage', () => {
  it('renderiza el paso 1 con el catálogo y la opción personalizada', async () => {
    renderPage();

    expect(await screen.findByTestId('onboarding-wizard')).toBeInTheDocument();
    expect(screen.getByText(t('onboarding.stepLabel', { current: 1, total: 3 }))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Groq/ })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: /Ollama/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Personalizado/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('onboarding.continue') })).not.toBeInTheDocument();
  });

  it('prueba la conexión con el adapter, elige modelo y persiste el onboarding', async () => {
    const { settingsRepo, keys, adapterConfigs } = renderPage();

    await selectTemplate(/Groq/);

    const keyInput = await screen.findByLabelText(t('settings.apiKeyLabel'));
    fireEvent.change(keyInput, { target: { value: 'sk-test' } });
    fireEvent.click(screen.getByRole('button', { name: t('onboarding.testConnection') }));

    expect(await screen.findByText(t('onboarding.testSuccess', { count: MODELS.length }))).toBeInTheDocument();
    expect(adapterConfigs[0]?.id).toBe('groq');
    expect(await keys.get('provider:groq')).toBe('sk-test');

    fireEvent.click(screen.getByRole('button', { name: t('common.next') }));
    expect(await screen.findByText(t('onboarding.stepLabel', { current: 3, total: 3 }))).toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: /Model B/ }));
    fireEvent.click(screen.getByRole('button', { name: t('onboarding.finish') }));

    await waitFor(async () => {
      const settings = await settingsRepo.load();
      expect(settings.onboardingCompleted).toBe(true);
      expect(settings.activeProviderId).toBe('groq');
      expect(settings.lastModelByProvider['groq']).toBe('model-b');
    });
    expect(isOnboardingResolvedThisSession()).toBe(true);
    await waitFor(() => expect(window.location.hash).toBe('#/chat'));
  });

  it('muestra el error legible cuando el adapter falla', async () => {
    renderPage({
      createAdapter: async () =>
        createFakeAdapter(async () => {
          throw new Error('401 Unauthorized');
        }),
    });

    await selectTemplate(/Groq/);

    const keyInput = await screen.findByLabelText(t('settings.apiKeyLabel'));
    fireEvent.change(keyInput, { target: { value: 'sk-bad' } });
    fireEvent.click(screen.getByRole('button', { name: t('onboarding.testConnection') }));

    expect(await screen.findByText(t('onboarding.testErrorTitle'))).toBeInTheDocument();
    expect(screen.getByText('401 Unauthorized')).toBeInTheDocument();
  });

  it('salta la API key en proveedores locales y respeta "Saltar por ahora"', async () => {
    const { settingsRepo } = renderPage();

    await selectTemplate(/Ollama/);

    expect(await screen.findByText(t('onboarding.stepLabel', { current: 2, total: 3 }))).toBeInTheDocument();
    expect(screen.queryByLabelText(t('settings.apiKeyLabel'))).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: t('onboarding.skipKey') }));
    expect(await screen.findByText(t('onboarding.stepLabel', { current: 3, total: 3 }))).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: t('onboarding.skipForNow') }));

    await waitFor(() => expect(window.location.hash).toBe('#/settings'));
    expect((await settingsRepo.load()).onboardingCompleted).toBe(false);
    expect(isOnboardingResolvedThisSession()).toBe(true);
  });

  it('crea un proveedor personalizado reutilizando ProviderForm', async () => {
    const { settingsRepo } = renderPage();

    await screen.findByTestId('onboarding-wizard');
    fireEvent.click(screen.getByRole('button', { name: /Personalizado/ }));

    fireEvent.change(await screen.findByLabelText(t('settings.providerLabel')), {
      target: { value: 'Local' },
    });
    fireEvent.change(screen.getByLabelText(t('settings.providerBaseUrl')), {
      target: { value: 'https://api.local/v1' },
    });
    fireEvent.click(screen.getByRole('button', { name: t('common.save') }));

    expect(await screen.findByText(t('onboarding.stepLabel', { current: 2, total: 3 }))).toBeInTheDocument();
    const settings = await settingsRepo.load();
    expect(settings.activeProviderId).not.toBeNull();
    expect(localStorage.getItem('openher.providers.v1') ?? '').toContain('https://api.local/v1');
  });
});
