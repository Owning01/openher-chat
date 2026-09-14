import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LegalIndex, LegalPassage, LegalProvision } from '@/domain/types/legal';
import { MessageActions } from '@/features/chat/components/MessageActions';
import { Composer } from '@/features/chat/components/Composer';
import type { ComposerLegal } from '@/features/chat/components/Composer';
import { MessageList } from '@/features/chat/components/MessageList';
import { assistantMessage } from '@/features/chat/components/__fixtures__/messages';
import { setLocale } from '@/i18n';

import {
  CitationGuardProvider,
  countLegalCitations,
  markLegalText,
  markTextWithoutIndex,
  useCitationGuard,
} from './CitationGuardContext';

beforeEach(() => setLocale('es'));

afterEach(() => {
  cleanup();
  setLocale('es');
});

const PROVISION_2560: LegalProvision = {
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
  tags: ['prescripcion'],
  verified: true,
};

/** Índice falso mínimo que respeta el contrato `LegalIndex`. */
function makeIndex(provisions: readonly LegalProvision[]): LegalIndex {
  const byKey = new Map<string, LegalProvision>();
  for (const provision of provisions) {
    byKey.set(`${provision.normId}|${provision.article}`, provision);
  }
  return {
    versions: { 'ar-ccyc-core': '1.0.0' },
    size: provisions.length,
    has(normId, article) {
      return byKey.has(`${normId}|${article}`);
    },
    get(normId, article) {
      return byKey.get(`${normId}|${article}`) ?? null;
    },
    search(query, limit) {
      const needle = query.toLowerCase();
      const results: LegalPassage[] = [];
      for (const provision of provisions) {
        if (results.length >= limit) break;
        const haystack = `${provision.normId} ${provision.article} ${provision.text}`.toLowerCase();
        if (haystack.includes(needle)) {
          results.push({ provision, score: 1, packId: 'ar-ccyc-core', packVersion: '1.0.0' });
        }
      }
      return results;
    },
  };
}

const INDEX = makeIndex([PROVISION_2560]);

const VERIFIED_TEXT = 'Según el art. 2560 CCyC, el plazo se cuenta desde la exigibilidad.';
const MIXED_TEXT = 'El art. 2560 CCyC rige. El art. 9999 CCyC no existe.';

/** Sonda para observar el guard dentro y fuera del provider. */
function Probe({ text }: { text: string }) {
  const guard = useCitationGuard();
  const counts = guard.counters(text);
  return (
    <div
      data-testid="guard-probe"
      data-index-available={guard.indexAvailable ? 'yes' : 'no'}
      data-counters={`${counts.verified}/${counts.unverified}`}
    >
      {guard.mark(text)}
    </div>
  );
}

function probeState() {
  const probe = screen.getByTestId('guard-probe');
  return {
    text: probe.textContent ?? '',
    indexAvailable: probe.getAttribute('data-index-available'),
    counters: probe.getAttribute('data-counters'),
  };
}

describe('CitationGuardContext con índice', () => {
  it('marca sólo las citas no verificadas y cuenta verificadas/sin verificar', () => {
    render(
      <CitationGuardProvider index={INDEX}>
        <Probe text={MIXED_TEXT} />
      </CitationGuardProvider>,
    );

    const state = probeState();
    expect(state.indexAvailable).toBe('yes');
    expect(state.counters).toBe('1/1');
    expect(state.text).toContain('art. 9999 CCyC [VERIFICAR]');
    expect(state.text).not.toContain('2560 CCyC [VERIFICAR]');
  });

  it('deja intacto el texto verificado', () => {
    expect(markLegalText(VERIFIED_TEXT, INDEX)).toBe(VERIFIED_TEXT);
    expect(countLegalCitations(MIXED_TEXT, INDEX)).toEqual({ verified: 1, unverified: 1 });
  });
});

describe('CitationGuardContext sin índice (provider con null)', () => {
  it('aplica marcado conservador [VERIFICAR] a toda cita (fail-closed, nunca verified)', () => {
    render(
      <CitationGuardProvider index={null}>
        <Probe text={VERIFIED_TEXT} />
      </CitationGuardProvider>,
    );

    const state = probeState();
    expect(state.indexAvailable).toBe('no');
    expect(state.counters).toBe('0/1');
    expect(state.text).toContain('[VERIFICAR]');
  });

  it('no marca el texto sin citas', () => {
    expect(markTextWithoutIndex('Hola, ¿cómo va la tarde?')).toBe('Hola, ¿cómo va la tarde?');
    expect(countLegalCitations(MIXED_TEXT, null)).toEqual({ verified: 0, unverified: 2 });
  });
});

describe('CitationGuardContext fuera del provider', () => {
  it('devuelve el guard neutro (identidad) para no romper renders existentes', () => {
    render(<Probe text={MIXED_TEXT} />);

    const state = probeState();
    expect(state.indexAvailable).toBe('no');
    expect(state.counters).toBe('0/0');
    expect(state.text).toBe(MIXED_TEXT);
  });
});

describe('MessageActions en contexto legal', () => {
  function mockClipboard() {
    const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    return writeText;
  }

  function messageActions(text: string) {
    return (
      <MessageActions
        messageId="a1"
        role="assistant"
        text={text}
        canRegenerate={false}
        disabled={false}
        onRegenerate={vi.fn()}
        onEditStart={vi.fn()}
        onDelete={vi.fn()}
      />
    );
  }

  it('copia el texto post-guard con los [VERIFICAR] visibles (índice ausente)', async () => {
    const writeText = mockClipboard();
    render(<CitationGuardProvider index={null}>{messageActions(VERIFIED_TEXT)}</CitationGuardProvider>);

    fireEvent.click(screen.getByRole('button', { name: 'Copiar' }));
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const copied = writeText.mock.calls[0]?.[0] ?? '';
    expect(copied).toContain('[VERIFICAR]');
  });

  it('copia el texto intacto cuando la cita está verificada', async () => {
    const writeText = mockClipboard();
    render(<CitationGuardProvider index={INDEX}>{messageActions(VERIFIED_TEXT)}</CitationGuardProvider>);

    fireEvent.click(screen.getByRole('button', { name: 'Copiar' }));
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith(VERIFIED_TEXT));
  });
});

describe('MessageList en contexto legal', () => {
  const handlers = () => ({
    onRegenerate: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
  });

  it('renderiza el texto marcado y muestra los contadores de citas', () => {
    render(
      <CitationGuardProvider index={null}>
        <MessageList
          messages={[assistantMessage('a1', [{ type: 'text', text: VERIFIED_TEXT }])]}
          runStatus="idle"
          {...handlers()}
        />
      </CitationGuardProvider>,
    );

    expect(screen.getByText(/\[VERIFICAR\]/)).toBeInTheDocument();
    const counters = screen.getByTestId('citation-counters');
    expect(counters).toHaveTextContent('sin verificar');
  });
});

describe('Composer legal (preview de privacidad + consentimiento)', () => {
  function setupComposer(legal?: ComposerLegal) {
    const onSend = vi.fn();
    const onStop = vi.fn();
    render(<Composer status="idle" onSend={onSend} onStop={onStop} legal={legal} />);
    return {
      onSend,
      textarea: screen.getByRole('textbox', { name: 'Escribe un mensaje…' }),
    };
  }

  const legalCounts: ComposerLegal = {
    redactionActive: true,
    redactedCounts: { person: 2, doc: 1 },
  };

  it('muestra el preview compacto con conteos por categoría (sin mapping)', () => {
    setupComposer(legalCounts);

    const preview = screen.getByTestId('legal-privacy-preview');
    expect(preview).toHaveTextContent('Qué sale del dispositivo');
    expect(preview.textContent).toContain('Personas');
    expect(preview.textContent).toContain('2');
    expect(preview.textContent).toContain('Documentos');
    expect(preview.textContent).not.toContain('Correos');
  });

  it('bloquea el envío hasta el consentimiento y notifica el cambio', () => {
    const onConsentChange = vi.fn<(accepted: boolean) => void>();
    const { onSend, textarea } = setupComposer({ ...legalCounts, onConsentChange });

    fireEvent.change(textarea, { target: { value: 'hola' } });
    expect(screen.getByRole('button', { name: 'Enviar' })).toBeDisabled();
    fireEvent.keyDown(textarea, { key: 'Enter' });
    expect(onSend).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('checkbox'));
    expect(onConsentChange).toHaveBeenCalledWith(true);
    expect(screen.getByText('Consentimiento aceptado para esta sesión.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }));
    expect(onSend).toHaveBeenCalledWith('hola');
  });

  it('con consentimiento persistido no bloquea ni pide checkbox', () => {
    const { onSend, textarea } = setupComposer({
      redactionActive: true,
      redactedCounts: {},
      consentAccepted: true,
    });

    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    fireEvent.change(textarea, { target: { value: 'hola' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }));
    expect(onSend).toHaveBeenCalledWith('hola');
  });

  it('sin prop legal no muestra preview ni bloquea (modo general intacto)', () => {
    const { onSend, textarea } = setupComposer(undefined);

    expect(screen.queryByTestId('legal-privacy-preview')).not.toBeInTheDocument();
    fireEvent.change(textarea, { target: { value: 'hola' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }));
    expect(onSend).toHaveBeenCalledWith('hola');
  });

  it('con redacción inactiva no muestra preview (gate apagado)', () => {
    setupComposer({ redactionActive: false, redactedCounts: { person: 2 } });

    expect(screen.queryByTestId('legal-privacy-preview')).not.toBeInTheDocument();
  });
});
