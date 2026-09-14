import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  AnalysisCitation,
  AnalysisItem,
  CaseAnalysis,
  JudgePostureItem,
} from '@/domain/types/legal';
import { setLocale } from '@/i18n';

import { AnalysisView } from './AnalysisView';

beforeEach(() => setLocale('es'));

afterEach(() => {
  cleanup();
  setLocale('es');
});

function verifiedCitation(raw: string): AnalysisCitation {
  return {
    raw,
    normId: 'CCyC',
    article: '2560',
    packId: 'ar-ccyc-core',
    packVersion: '1.0.0',
    status: 'verified',
    fidelity: 'verbatim',
  };
}

function unverifiedCitation(raw: string): AnalysisCitation {
  return {
    raw,
    normId: 'CCyC',
    article: '9999',
    packId: null,
    packVersion: null,
    status: 'unverified',
    fidelity: 'not-applicable',
  };
}

function makeItem(item: Partial<AnalysisItem> & { id: string; statement: string }): AnalysisItem {
  return {
    perspective: 'defense',
    kind: 'defense',
    basis: [],
    evidenceRefs: [],
    strength: 'medium',
    confidence: 0.5,
    ...item,
  };
}

function makeJudge(item: Partial<JudgePostureItem> & { id: string; thesis: string }): JudgePostureItem {
  return { leaning: 'unclear', basis: [], confidence: 0.5, ...item };
}

const ANALYSIS: CaseAnalysis = {
  id: 'analysis-1',
  caseId: 'case-1',
  createdAt: 1,
  providerId: 'test-provider',
  modelId: 'test-model',
  packs: [],
  defenses: [
    makeItem({
      id: 'defense-1',
      perspective: 'defense',
      kind: 'defense',
      statement: 'La prescripción no operó sobre el crédito reclamado.',
      basis: [verifiedCitation('art. 2560 CCyC')],
      strength: 'high',
      confidence: 0.8,
    }),
  ],
  attacks: [
    makeItem({
      id: 'attack-1',
      perspective: 'attack',
      kind: 'attack',
      statement: 'La contraparte opondrá la prescripción del crédito.',
      basis: [unverifiedCitation('art. 9999 CCyC')],
      strength: 'medium',
      confidence: 0.6,
    }),
  ],
  judgePosture: [
    makeJudge({
      id: 'judge-1',
      thesis: 'El juzgado exigirá prueba documental del crédito.',
      leaning: 'unclear',
      confidence: 0.5,
    }),
  ],
  risks: [
    makeItem({
      id: 'risk-1',
      perspective: 'risk',
      kind: 'risk',
      statement: 'Riesgo de caducidad de la prueba testimonial.',
      strength: 'medium',
      confidence: 0.6,
    }),
  ],
  openQuestions: [
    makeItem({
      id: 'question-1',
      perspective: 'risk',
      kind: 'question',
      statement: '¿Existe intimación fehaciente previa al incumplimiento?',
      strength: 'low',
      confidence: 0.4,
    }),
  ],
  synthesis: 'Síntesis del caso testigo.',
  citations: { verified: 1, unverified: 1 },
  incomplete: false,
  raw: { defense: 'defensa', attack: 'ataque', judge: 'juez', risk: 'riesgo' },
};

const INCOMPLETE: CaseAnalysis = {
  ...ANALYSIS,
  incomplete: true,
  raw: { defense: 'defensa', attack: '', judge: 'juez', risk: '' },
};

describe('AnalysisView', () => {
  it('muestra las cuatro personas separadas más preguntas abiertas y síntesis', () => {
    render(<AnalysisView analysis={ANALYSIS} />);

    expect(screen.getByTestId('analysis-section-defense')).toHaveTextContent('Defensa');
    expect(screen.getByTestId('analysis-section-attack')).toHaveTextContent(
      'Ataque de la contraparte',
    );
    expect(screen.getByTestId('analysis-section-judge')).toHaveTextContent('Postura del juez');
    expect(screen.getByTestId('analysis-section-risk')).toHaveTextContent('Riesgos');
    expect(screen.getByTestId('analysis-section-questions')).toHaveTextContent(
      '¿Existe intimación fehaciente previa al incumplimiento?',
    );
    expect(screen.getByTestId('analysis-section-synthesis')).toHaveTextContent(
      'Síntesis del caso testigo.',
    );
    expect(screen.getByTestId('analysis-item-defense-1')).toHaveTextContent(
      'La prescripción no operó sobre el crédito reclamado.',
    );
    expect(screen.getByTestId('analysis-item-attack-1')).toHaveTextContent(
      'La contraparte opondrá la prescripción del crédito.',
    );
  });

  it('marca el ataque como simulación interna no presentable', () => {
    render(<AnalysisView analysis={ANALYSIS} />);

    const mark = screen.getByTestId('analysis-attack-simulation');
    expect(mark).toHaveTextContent('Simulación interna');
    // La marca vive dentro de la sección de ataque, no en la defensa.
    expect(screen.getByTestId('analysis-section-attack')).toContainElement(mark);
    expect(screen.getByTestId('analysis-section-defense')).not.toContainElement(mark);
  });

  it('muestra el contador global verified/unverified', () => {
    render(<AnalysisView analysis={ANALYSIS} />);

    const counters = screen.getByTestId('analysis-counters');
    expect(counters).toHaveTextContent('1 verificadas');
    expect(counters).toHaveTextContent('1 sin verificar');
  });

  it('muestra el fundamento citado y la confianza de cada ítem', () => {
    render(<AnalysisView analysis={ANALYSIS} />);

    const item = screen.getByTestId('analysis-item-defense-1');
    expect(item).toHaveTextContent('art. 2560 CCyC');
    expect(item).toHaveTextContent('verificada');
    expect(item).toHaveTextContent('Confianza: 80 %');
    const attack = screen.getByTestId('analysis-item-attack-1');
    expect(attack).toHaveTextContent('sin verificar');
  });

  it('avisa la degradación con el conteo N de 4 personas', () => {
    render(<AnalysisView analysis={INCOMPLETE} />);

    expect(screen.getByTestId('analysis-incomplete')).toHaveTextContent(
      'Análisis incompleto: 2 de 4 personas',
    );
  });

  it('no muestra el aviso de degradación en un análisis completo', () => {
    render(<AnalysisView analysis={ANALYSIS} />);

    expect(screen.queryByTestId('analysis-incomplete')).toBeNull();
  });

  it('muestra el estado vacío sin análisis', () => {
    render(<AnalysisView analysis={null} />);

    expect(screen.getByTestId('analysis-empty')).toHaveTextContent('Sin análisis todavía');
  });

  it('muestra el estado de carga', () => {
    render(<AnalysisView analysis={null} status="loading" />);

    expect(screen.getByTestId('analysis-loading')).toHaveTextContent('Analizando…');
  });

  it('muestra el error con reintento', () => {
    const onRetry = vi.fn();
    render(<AnalysisView analysis={null} status="error" error="falló el modelo" onRetry={onRetry} />);

    expect(screen.getByTestId('analysis-error')).toHaveTextContent('falló el modelo');
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
