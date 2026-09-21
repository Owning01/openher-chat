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
    expect(withResearch).toContain('Multi-query exploration');
    expect(withResearch).toContain('Fact-checking & gotchas');
    expect(withResearch).toContain('Visual Reports');

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

  it('agrega el bloque de skills sólo cuando hay y no toca el prompt sin ellas', () => {
    const base = buildSystemPrompt({ researchMode: false, now: NOW, locale: 'es' });
    const skills = [
      { name: 'informe-laboral', description: 'Redacta informes laborales' },
      { name: 'resumen-prensa', description: 'Resume noticias del día' },
    ];
    const withSkills = buildSystemPrompt({ researchMode: false, now: NOW, locale: 'es', skills });

    expect(withSkills).toContain('load_skill');
    expect(withSkills).toContain('- informe-laboral: Redacta informes laborales');
    expect(withSkills).toContain('- resumen-prensa: Resume noticias del día');
    expect(withSkills).toContain('Never invent a skill');
    expect(base).not.toContain('load_skill');
    expect(buildSystemPrompt({ researchMode: false, now: NOW, locale: 'es', skills: [] })).toBe(base);
  });

  it('incluye el manifiesto de entorno y arquitectura local-first', () => {
    const prompt = buildSystemPrompt({ researchMode: false, now: NOW, locale: 'es' });
    expect(prompt).toContain('Environment & Execution Context:');
    expect(prompt).toContain('Single-user local-first application');
    expect(prompt).toContain('IndexedDB/KeyVault');
    expect(prompt).toContain('Web browser / desktop PWA');
  });

  it('refleja plataforma Android cuando se ejecuta en entorno nativo', () => {
    const prompt = buildSystemPrompt({ researchMode: false, now: NOW, locale: 'es', platform: 'android' });
    expect(prompt).toContain('Android mobile device (Capacitor native shell)');
  });

  it('declara las capacidades activas del turno (búsqueda, documentos, skills, visión)', () => {
    const prompt = buildSystemPrompt({
      researchMode: true,
      now: NOW,
      locale: 'es',
      capabilities: {
        webResearch: true,
        legalDocuments: true,
        skills: true,
        vision: true,
      },
    });
    expect(prompt).toContain('Active capabilities in this session:');
    expect(prompt).toContain('Web search & page retrieval');
    expect(prompt).toContain('Legal document studio');
    expect(prompt).toContain('User skills (load_skill)');
    expect(prompt).toContain('Multimodal image perception');
  });
});
