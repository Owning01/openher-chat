import type { SkillDraft } from '../types/skill';

export const DEEP_INVESTIGATOR_SKILL_NAME = 'deep-investigator';

export const DEEP_INVESTIGATOR_SKILL: SkillDraft = {
  name: DEEP_INVESTIGATOR_SKILL_NAME,
  description:
    'Metodología de investigación profunda: fan-out multi-query, auditoría crítica de fuentes (fact-checking y gotchas), síntesis estructurada e informes visuales interactivos.',
  body: `# Deep Investigator — Protocolo de Investigación Exhaustiva

## 1. Fase de Exploración en Abanico (Multi-Query Fan-Out)
- Nunca te limites a una única búsqueda. Descompón el problema en múltiples consultas independientes:
  - Búsqueda fáctica directa de las fuentes primarias.
  - Búsqueda de alternativas, antecedentes y estado del arte.
  - Búsqueda de debates, problemas recurrentes o controversias.
- Inspecciona las páginas completas mediante \`open_url\` para extraer contexto real, nunca te conformes con los fragmentos de vista previa.

## 2. Auditoría Crítica y Fact-Checking (Gotchas & Riesgos)
- Busca activamente contra-evidencias y limitaciones técnicas:
  - ¿Cuáles son los puntos de falla, costos ocultos o restricciones?
  - ¿Existen sesgos comerciales o afirmaciones publicitarias no verificables?
  - Si dos fuentes discrepan, expón la contradicción claramente indicando las fechas de cada una.

## 3. Síntesis y Arquitectura de Soluciones
- Presenta las conclusiones con un enfoque orientado a la acción:
  - Resumen ejecutivo con las 3-5 conclusiones determinantes.
  - Tablas comparativas con criterios uniformes (rendimiento, compatibilidad, madurez).
  - Datos concretos: números, métricas, normativas, versiones exactas.

## 4. Generación de Informes Visuales HTML
- Cuando el usuario solicite un informe visual o una presentación de resultados, genera un documento HTML autocontenido de diseño moderno con métricas, tarjetas interactivas, tablas comparativas y una paleta de colores coherente y profesional.
`,
};

export const DEFAULT_PRELOADED_SKILLS: readonly SkillDraft[] = [DEEP_INVESTIGATOR_SKILL];

export async function seedDefaultSkills(repo: {
  list: () => Promise<readonly { name: string }[]>;
  save: (draft: SkillDraft) => Promise<unknown>;
}): Promise<void> {
  try {
    const existing = await repo.list();
    const existingNames = new Set(existing.map((s) => s.name.toLowerCase()));
    for (const draft of DEFAULT_PRELOADED_SKILLS) {
      if (!existingNames.has(draft.name.toLowerCase())) {
        await repo.save(draft);
      }
    }
  } catch {
    // Si la base local aún no está lista, degrada sin lanzar.
  }
}
