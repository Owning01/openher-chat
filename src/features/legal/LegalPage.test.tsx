import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { LegalCorpus } from '@/adapters/legal/LegalCorpus';
import type { AppServices } from '@/app/services';
import { ServicesProvider } from '@/app/services';
import { buildLegalIndex } from '@/domain/legal/retrieval';
import type { ChatCompletionRequest, ProviderAdapter } from '@/domain/ports/ProviderAdapter';
import type { ModelInfo, ProviderCapabilities } from '@/domain/types/provider';
import type { LegalIndex, LegalPack } from '@/domain/types/legal';
import type { StreamEvent } from '@/domain/types/stream';
import { PROVIDERS_STORAGE_KEY } from '@/features/settings/state/providerStorage';
import { setLocale } from '@/i18n';
import {
  MemoryConversationRepository,
  MemoryKeyVault,
  MemoryLegalCaseRepository,
  MemorySettingsRepository,
} from '@/test/fakes/MemoryRepos';

import { LegalPage } from './LegalPage';

beforeEach(() => {
  window.location.hash = '';
  localStorage.clear();
  setLocale('es');
});

afterEach(() => {
  cleanup();
  window.location.hash = '';
  localStorage.clear();
  setLocale('es');
});

/** Pack mínimo para el índice del corpus fake (misma forma que `legalStores.test.ts`). */
const PACK: LegalPack = {
  schema: 'openher.legal.pack/1',
  id: 'ar-ccyc-core',
  title: 'CCyC núcleo',
  version: '1.0.0',
  publishedAt: '2026-01-05',
  jurisdiction: 'national',
  matter: 'civil-commercial',
  license: {
    name: 'InfoLEG',
    url: 'https://servicios.infoleg.gob.ar/',
    attribution: 'InfoLEG',
  },
  sources: [{ url: 'https://servicios.infoleg.gob.ar/', retrievedAt: '2026-01-05' }],
  norms: [
    {
      id: 'CCyC',
      short: 'CCyC',
      long: 'Código Civil y Comercial de la Nación',
      jurisdiction: 'national',
    },
  ],
  provisions: [
    {
      id: 'CCyC-2560',
      normId: 'CCyC',
      article: '2560',
      title: 'Prescripción liberatoria',
      text: 'ARTÍCULO 2560.- El plazo de la prescripción liberatoria se cuenta desde que la obligación es exigible.',
      jurisdiction: 'national',
      sourceUrl: 'https://servicios.infoleg.gob.ar/',
      sourceDate: '2026-01-05',
      textHash: 'hash-2560',
      verificationMethod: 'manual',
      tags: ['prescripcion', 'obligaciones'],
      verified: true,
    },
  ],
  hash: 'hash-pack',
};

const INDEX: LegalIndex = buildLegalIndex([PACK]);

const DEFENSE_RAW = JSON.stringify([
  {
    statement: 'La obligación se extinguió por pago íntegro antes de la demanda.',
    basis: ['art. 2560 CCyC'],
    kind: 'defense',
    strength: 'high',
    confidence: 0.8,
  },
]);
const ATTACK_RAW = JSON.stringify([
  {
    statement: 'La prescripción invocada no resulta aplicable a este reclamo.',
    basis: ['art. 9999 CCyC'],
    kind: 'attack',
    strength: 'medium',
    confidence: 0.6,
  },
]);
const JUDGE_RAW = JSON.stringify([
  {
    thesis: 'La prescripción aparece favorable a la defensa.',
    leaning: 'favorable',
    confidence: 0.7,
    basis: ['art. 2560 CCyC'],
  },
]);
const RISK_RAW = JSON.stringify([
  {
    statement: 'Existe riesgo de costas si la defensa de prescripción fracasa.',
    kind: 'risk',
    strength: 'low',
    confidence: 0.4,
  },
]);
const SYNTHESIS_RAW = 'Síntesis de prueba consolidada.';

function textScript(text: string): StreamEvent[] {
  return [
    { type: 'text-delta', delta: text },
    { type: 'stop', reason: 'end_turn' },
  ];
}

/** Adapter guionizado: cada `streamChat` consume el siguiente script y graba el request. */
class FakeLegalAdapter implements ProviderAdapter {
  readonly providerId = 'provider-1';
  readonly kind = 'openai-compatible' as const;
  readonly requests: ChatCompletionRequest[] = [];
  readonly scripts: StreamEvent[][] = [];

  capabilities(): ProviderCapabilities {
    return { streaming: true, toolCalling: false, systemPrompt: true, listModels: false, images: false };
  }

  async listModels(): Promise<ModelInfo[]> {
    return [];
  }

  async *streamChat(request: ChatCompletionRequest): AsyncGenerator<StreamEvent, void, void> {
    this.requests.push(request);
    const events = this.scripts.shift() ?? [];
    for (const event of events) yield event;
  }
}

interface CorpusSpy {
  syncCalls: number;
  ensureCalls: number;
}

/** Corpus fake en memoria con conteo de `syncFromManifest`/`ensureIndex`. */
function createCorpusFake(index: LegalIndex, spy: CorpusSpy): LegalCorpus {
  return {
    syncFromManifest: async () => {
      spy.syncCalls += 1;
      return { installed: [], skipped: [], failed: [] };
    },
    ensureIndex: async () => {
      spy.ensureCalls += 1;
      return index;
    },
    getIndex: () => index,
    listInstalled: async () => [],
  };
}

/** Proveedor válido para `LocalProviderConfigRepository` (el análisis lo resuelve de acá). */
function seedProviders(): void {
  localStorage.setItem(
    PROVIDERS_STORAGE_KEY,
    JSON.stringify([
      {
        id: 'provider-1',
        label: 'Test Provider',
        kind: 'openai-compatible',
        baseUrl: 'https://api.example.com',
        requiresKey: false,
        keyRef: null,
        models: [{ id: 'model-1', label: 'Model 1', source: 'manual' }],
        defaultModelId: 'model-1',
        createdAt: 1,
        updatedAt: 1,
      },
    ]),
  );
}

interface LegalHarness {
  services: AppServices;
  legalCases: MemoryLegalCaseRepository;
  adapter: FakeLegalAdapter;
}

function createLegalHarness(options: { corpus?: LegalCorpus } = {}): LegalHarness {
  const adapter = new FakeLegalAdapter();
  const legalCases = new MemoryLegalCaseRepository();
  const services: AppServices = {
    conversations: new MemoryConversationRepository(),
    settings: new MemorySettingsRepository(),
    keys: new MemoryKeyVault(),
    http: { request: async () => ({ status: 200, headers: {}, text: '' }) },
    transport: {
      post: async () => {
        throw new Error('Transporte no usado en LegalPage.');
      },
    },
    legalCases,
    ...(options.corpus === undefined ? {} : { legalCorpus: options.corpus }),
    async createAdapter(config) {
      void config;
      return adapter;
    },
  };
  return { services, legalCases, adapter };
}

function renderLegalPage(services: AppServices): void {
  render(
    <ServicesProvider services={services}>
      <LegalPage />
    </ServicesProvider>,
  );
}

describe('LegalPage (G1)', () => {
  it('monta panel y estudio, dispara sync + índice y saca los placeholders', async () => {
    seedProviders();
    const spy: CorpusSpy = { syncCalls: 0, ensureCalls: 0 };
    const { services, legalCases } = createLegalHarness({ corpus: createCorpusFake(INDEX, spy) });
    const created = await legalCases.create({
      title: 'Caso G1',
      jurisdiction: 'national',
      court: 'Juzgado Civil 1',
      matter: 'civil',
      clientRole: 'plaintiff',
    });
    window.location.hash = `#/legal/${created.id}`;
    renderLegalPage(services);

    // Panel y estudio montados (componentes T24 sin modificar).
    expect(await screen.findByTestId('adversarial-panel')).toBeInTheDocument();
    expect(screen.getByTestId('document-studio')).toBeInTheDocument();
    // Placeholders fuera (textos legacy de T24).
    expect(screen.queryByText('El análisis del caso se monta acá (T24).')).not.toBeInTheDocument();
    expect(screen.queryByText('El estudio de documentos se monta acá (T24).')).not.toBeInTheDocument();
    // Sync disparado en el mount (fake de corpus) y sin aviso de carga persistente.
    expect(spy.syncCalls).toBeGreaterThanOrEqual(1);
    expect(spy.ensureCalls).toBeGreaterThanOrEqual(1);
    expect(screen.queryByTestId('legal-corpus-loading')).not.toBeInTheDocument();
    expect(screen.queryByTestId('legal-corpus-error')).not.toBeInTheDocument();
  });

  it('ejecuta el análisis con el adapter de servicios (executeCall recolecta el texto)', async () => {
    seedProviders();
    const spy: CorpusSpy = { syncCalls: 0, ensureCalls: 0 };
    const { services, legalCases, adapter } = createLegalHarness({ corpus: createCorpusFake(INDEX, spy) });
    adapter.scripts.push(
      textScript(DEFENSE_RAW),
      textScript(ATTACK_RAW),
      textScript(JUDGE_RAW),
      textScript(RISK_RAW),
      textScript(SYNTHESIS_RAW),
    );
    const created = await legalCases.create({
      title: 'Caso G1',
      jurisdiction: 'national',
      court: 'Juzgado Civil 1',
      matter: 'civil',
      clientRole: 'plaintiff',
    });
    window.location.hash = `#/legal/${created.id}`;
    renderLegalPage(services);

    fireEvent.click(await screen.findByTestId('adversarial-analyze'));

    // La síntesis del modelo queda visible: las 5 llamadas (4 personas + síntesis) corrieron.
    // Timeout amplio: el pipeline con streaming supera el `findBy` por defecto
    // (1s) cuando la suite corre en paralelo en máquinas lentas.
    expect(await screen.findByText(SYNTHESIS_RAW, undefined, { timeout: 10_000 })).toBeInTheDocument();
    expect(adapter.requests).toHaveLength(5);
    // Mismo scaffold en todas (byte-idéntico) y brief del expediente en el wire.
    const systems = new Set(adapter.requests.map((request) => request.system ?? ''));
    expect(systems.size).toBe(1);
    expect(adapter.requests[0]?.system).toContain('CITATION DISCIPLINE');
    expect(
      adapter.requests.some((request) => request.messages.some((message) => message.content.includes('<expediente>'))),
    ).toBe(true);
    // El análisis quedó persistido en el repositorio del caso.
    expect(await legalCases.listAnalyses(created.id)).toHaveLength(1);
  });

  it('degrada sin corpus ni proveedores: estudio montado, panel con aviso, sin placeholders', async () => {
    const { services, legalCases } = createLegalHarness();
    const created = await legalCases.create({
      title: 'Caso G1',
      jurisdiction: 'national',
      court: 'Juzgado Civil 1',
      matter: 'civil',
      clientRole: 'plaintiff',
    });
    window.location.hash = `#/legal/${created.id}`;
    renderLegalPage(services);

    // El estudio no exige índice: se monta igual.
    expect(await screen.findByTestId('document-studio')).toBeInTheDocument();
    // Sin índice no hay panel (aviso visible, sin bloquear) y los placeholders quedaron fuera.
    expect(screen.queryByTestId('adversarial-panel')).not.toBeInTheDocument();
    expect(screen.queryByText('El análisis del caso se monta acá (T24).')).not.toBeInTheDocument();
    expect(screen.queryByText('El estudio de documentos se monta acá (T24).')).not.toBeInTheDocument();
    expect(screen.getByTestId('legal-corpus-error')).toBeInTheDocument();
  });

  it('sin servicios legales muestra el estado no disponible', async () => {
    const { services } = createLegalHarness();
    const withoutLegal: AppServices = {
      conversations: services.conversations,
      settings: services.settings,
      keys: services.keys,
      http: services.http,
      transport: services.transport,
      createAdapter: services.createAdapter,
    };
    renderLegalPage(withoutLegal);

    expect(await screen.findByText('El almacenamiento de expedientes no está disponible.')).toBeInTheDocument();
  });
});
