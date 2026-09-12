import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { SourceRef } from '@/domain/types/chat';
import { setLocale } from '@/i18n';

import { SourceChip } from './SourceChip';

function source(url: string): SourceRef {
  return { url, title: 'Doc', accessedAt: 1 };
}

beforeEach(() => setLocale('es'));

afterEach(() => {
  cleanup();
  setLocale('es');
});

describe('SourceChip', () => {
  it('renderiza texto plano sin anchor para esquemas no http(s)', () => {
    render(
      <>
        <SourceChip source={source('javascript:alert(1)')} />
        <SourceChip source={source('data:text/html,<h1>x</h1>')} />
        <SourceChip source={source('intent://scan/#Intent;scheme=zxing;end')} />
      </>,
    );

    expect(screen.queryAllByRole('link')).toHaveLength(0);
    expect(screen.getAllByTestId('research-source-chip')).toHaveLength(3);
    expect(screen.getByTitle('javascript:alert(1)')).toBeInTheDocument();
  });

  it('enlaza http(s) con target y rel seguros', () => {
    render(<SourceChip source={source('https://example.com/doc')} />);

    const link = screen.getByRole('link', { name: 'Doc (se abre en una pestaña nueva)' });
    expect(link).toHaveAttribute('href', 'https://example.com/doc');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('rechaza URLs relativas y basura sin romper el render', () => {
    render(
      <>
        <SourceChip source={source('/docs/guia')} />
        <SourceChip source={source('no-es-una-url')} />
      </>,
    );

    expect(screen.queryAllByRole('link')).toHaveLength(0);
    expect(screen.getAllByTestId('research-source-chip')).toHaveLength(2);
  });
});
