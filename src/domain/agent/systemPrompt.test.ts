import { describe, expect, it } from 'vitest';
import { buildSystemPrompt } from './systemPrompt';

const NOW = Date.UTC(2026, 0, 2, 3, 4, 5);

describe('buildSystemPrompt', () => {
  it('incluye la fecha UTC sin hora para no romper la caché de prompt', () => {
    const prompt = buildSystemPrompt({ researchMode: false, now: NOW, locale: 'es' });
    expect(prompt).toContain('Current date (UTC): 2026-01-02.');
    expect(prompt).not.toContain('2026-01-02T03:04:05');
  });

  it('fija el idioma de respuesta según el locale', () => {
    expect(buildSystemPrompt({ researchMode: false, now: NOW, locale: 'es' })).toContain('Spanish');
    expect(buildSystemPrompt({ researchMode: false, now: NOW, locale: 'en' })).toContain('English');
  });

  it('añade instrucciones de investigación solo en researchMode', () => {
    const withResearch = buildSystemPrompt({ researchMode: true, now: NOW, locale: 'en' });
    expect(withResearch).toContain('Research mode is enabled');
    expect(withResearch).toContain('[1], [2]');
    expect(withResearch).toContain('Never invent URLs');
    expect(withResearch).toContain('most recent results');

    const withoutResearch = buildSystemPrompt({ researchMode: false, now: NOW, locale: 'en' });
    expect(withoutResearch).not.toContain('Research mode');
  });

  it('incluye la nota de presupuesto siempre', () => {
    expect(buildSystemPrompt({ researchMode: false, now: NOW, locale: 'en' })).toContain('Budget:');
    expect(buildSystemPrompt({ researchMode: true, now: NOW, locale: 'es' })).toContain('Budget:');
  });

  it('presenta al asistente en inglés para el modelo', () => {
    expect(buildSystemPrompt({ researchMode: false, now: NOW, locale: 'es' })).toContain('You are OpenHer');
  });

  it('es byte-estable dentro del mismo día UTC (no rompe la caché de prefijo)', () => {
    const startOfDay = Date.UTC(2026, 0, 2, 0, 0, 1);
    const endOfDay = Date.UTC(2026, 0, 2, 23, 59, 59);
    expect(buildSystemPrompt({ researchMode: false, now: startOfDay, locale: 'en' })).toBe(
      buildSystemPrompt({ researchMode: false, now: endOfDay, locale: 'en' }),
    );
  });
});
