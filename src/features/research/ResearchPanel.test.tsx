import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createDefaultSettings } from '@/domain/settings/defaults';
import type { AgentStep } from '@/domain/types/agent';
import { assistantMessage } from '@/features/chat/components/__fixtures__/messages';
import { setLocale } from '@/i18n';

import { ResearchPanel } from './ResearchPanel';

const SETTINGS = createDefaultSettings(0);
const SOURCE_URL = 'https://example.com/doc';

const STEPS: AgentStep[] = [
  {
    index: 0,
    status: 'complete',
    startedAt: 0,
    endedAt: 1500,
    text: '',
    toolCalls: [{ id: 'call-1', name: 'web_search', argumentsText: '{"query":"clima"}' }],
    toolResults: [
      {
        ok: true,
        content: 'resultados',
        sources: [{ url: SOURCE_URL, title: 'Doc', accessedAt: 1 }],
        durationMs: 1200,
      },
    ],
    usage: { totalTokens: 100 },
  },
  { index: 1, status: 'running', startedAt: 1500, text: '', toolCalls: [], toolResults: [] },
];

beforeEach(() => setLocale('es'));

afterEach(() => {
  cleanup();
  setLocale('es');
});

describe('ResearchPanel', () => {
  it('compone timeline, fuentes y presupuesto con estado por defecto', () => {
    const messages = [
      assistantMessage('a1', [
        {
          type: 'tool-result',
          toolCallId: 't1',
          toolName: 'web_search',
          result: {
            ok: true,
            content: 'resultados',
            sources: [
              { url: SOURCE_URL, title: 'Doc', accessedAt: 1 },
              { url: `${SOURCE_URL}#frag`, title: 'Doc duplicada', accessedAt: 2 },
              { url: 'https://other.example/b', title: 'Otra', accessedAt: 3 },
            ],
            durationMs: 1200,
          },
        },
      ]),
    ];

    render(
      <ResearchPanel
        steps={STEPS}
        messages={messages}
        settings={SETTINGS}
        keyPresence={{ brave: false, tavily: false }}
        browser={false}
      />,
    );

    expect(screen.getByTestId('research-panel')).toBeInTheDocument();
    expect(screen.getByText('Paso 1')).toBeInTheDocument();
    expect(screen.getByText('Paso 2')).toBeInTheDocument();
    expect(screen.getByText('web_search')).toBeInTheDocument();
    expect(screen.getByText('Completado')).toBeInTheDocument();
    expect(screen.getByText('En curso')).toBeInTheDocument();

    const sourceLinks = screen.getAllByTestId('research-source-chip');
    expect(sourceLinks).toHaveLength(2);
    const first = screen.getByRole('link', { name: 'Doc (se abre en una pestaña nueva)' });
    expect(first).toHaveAttribute('href', SOURCE_URL);
    expect(first).toHaveAttribute('target', '_blank');
    expect(first).toHaveAttribute('rel', 'noopener noreferrer');

    const budget = screen.getByTestId('research-budget');
    expect(budget).toHaveTextContent('Presupuesto');
    expect(budget).toHaveTextContent('2 / 6');
  });

  it('muestra aviso accionable con enlace a ajustes cuando falta la key de búsqueda', () => {
    render(
      <ResearchPanel
        steps={[]}
        messages={[]}
        settings={{ ...SETTINGS, search: { ...SETTINGS.search, mode: 'brave' } }}
        keyPresence={{ brave: false, tavily: false }}
        browser={false}
      />,
    );

    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Brave');
    expect(screen.getByRole('link', { name: 'Abrir ajustes' })).toHaveAttribute('href', '#/settings');
  });

  it('sin settings solo muestra timeline y fuentes sin presupuesto', () => {
    render(
      <ResearchPanel
        steps={[]}
        messages={[]}
        settings={null}
        keyPresence={{ brave: false, tavily: false }}
        browser={false}
      />,
    );

    expect(screen.getByTestId('research-steps')).toBeInTheDocument();
    expect(screen.getByTestId('research-sources')).toHaveTextContent('Aún no hay fuentes.');
    expect(screen.queryByTestId('research-budget')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('colapsa el timeline desde su cabecera', () => {
    render(
      <ResearchPanel
        steps={STEPS}
        messages={[]}
        settings={SETTINGS}
        keyPresence={{ brave: false, tavily: false }}
        browser={false}
      />,
    );

    const header = screen.getByRole('button', { name: /Pasos/ });
    expect(header).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Paso 1')).toBeInTheDocument();

    fireEvent.click(header);
    expect(header).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Paso 1')).not.toBeInTheDocument();
  });
});
