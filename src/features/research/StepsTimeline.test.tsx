import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentStep } from '@/domain/types/agent';
import { setLocale } from '@/i18n';

import { StepsTimeline } from './StepsTimeline';

const REPEATED_IDS_STEP: AgentStep = {
  index: 0,
  status: 'complete',
  startedAt: 0,
  endedAt: 10,
  text: '',
  toolCalls: [
    { id: 'dup', name: 'web_search', argumentsText: '{"query":"a"}' },
    { id: 'dup', name: 'open_url', argumentsText: '{"url":"https://x.test"}' },
  ],
  toolResults: [],
};

beforeEach(() => setLocale('es'));

afterEach(() => {
  cleanup();
  setLocale('es');
  vi.restoreAllMocks();
});

describe('StepsTimeline', () => {
  it('renderiza tool-ids repetidos con keys estables y sin warning de React', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    render(<StepsTimeline steps={[REPEATED_IDS_STEP]} />);

    expect(screen.getByText('web_search')).toBeInTheDocument();
    expect(screen.getByText('open_url')).toBeInTheDocument();
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
