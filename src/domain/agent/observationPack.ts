/**
 * SoL-Pi ObservationPack Engine (arXiv:2609.20519):
 * Empaquetado y compresión de observaciones extensas (páginas web, volcados de
 * documentos o peritajes). Reemplaza volcados masivos (>2.000 caracteres) por un
 * `ObservationHandle` con extracto ejecutivo denso e índice de secciones lógicas.
 * Permite al agente inspeccionar fragmentos bajo demanda con `read_observation`,
 * reduciendo el tráfico de tokens entre un 44% y 49%.
 */

export interface ObservationSection {
  id: string;
  heading: string;
  charCount: number;
  content: string;
}

export interface ObservationPack {
  id: string;
  title: string;
  sourceUrl?: string;
  totalChars: number;
  estimatedWords: number;
  sections: ObservationSection[];
  executiveExcerpt: string;
  createdAt: number;
}

export interface CreateObservationInput {
  id?: string;
  title: string;
  fullContent: string;
  sourceUrl?: string;
  maxExcerptChars?: number;
  now?: () => number;
}

const DEFAULT_MAX_EXCERPT_CHARS = 1_500;
const MAX_PACKS_IN_STORE = 50;

/** Divide texto Markdown o plano en secciones según encabezados (#, ##, ###) o párrafos dobles. */
export function segmentIntoSections(text: string): ObservationSection[] {
  const normalized = text.trim();
  if (!normalized) return [];

  const lines = normalized.split(/\r?\n/);
  const sections: ObservationSection[] = [];
  let currentHeading = 'Introducción / Resumen inicial';
  let currentLines: string[] = [];

  const flush = () => {
    if (currentLines.length > 0) {
      const content = currentLines.join('\n').trim();
      if (content) {
        sections.push({
          id: `sec-${sections.length + 1}`,
          heading: currentHeading,
          charCount: content.length,
          content,
        });
      }
      currentLines = [];
    }
  };

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,4})\s+(.+)$/);
    if (headingMatch && headingMatch[2]) {
      flush();
      currentHeading = headingMatch[2].trim();
    } else {
      currentLines.push(line);
    }
  }
  flush();

  // Si no hubo encabezados Markdown, segmentar por bloques de párrafos si es muy largo
  if (sections.length <= 1 && normalized.length > 2_500) {
    const paragraphs = normalized.split(/\n\s*\n/);
    if (paragraphs.length > 2) {
      const paragraphSections: ObservationSection[] = [];
      let pIdx = 1;
      let chunkLines: string[] = [];
      let currentChunkChars = 0;

      for (const p of paragraphs) {
        chunkLines.push(p);
        currentChunkChars += p.length;
        if (currentChunkChars >= 1_200) {
          const content = chunkLines.join('\n\n').trim();
          paragraphSections.push({
            id: `part-${pIdx}`,
            heading: `Parte ${pIdx}: ${p.slice(0, 45).replace(/[#*_]/g, '').trim()}...`,
            charCount: content.length,
            content,
          });
          pIdx++;
          chunkLines = [];
          currentChunkChars = 0;
        }
      }
      if (chunkLines.length > 0) {
        const content = chunkLines.join('\n\n').trim();
        paragraphSections.push({
          id: `part-${pIdx}`,
          heading: `Parte ${pIdx} final`,
          charCount: content.length,
          content,
        });
      }
      return paragraphSections;
    }
  }

  return sections.length > 0
    ? sections
    : [
        {
          id: 'full',
          heading: 'Contenido completo',
          charCount: normalized.length,
          content: normalized,
        },
      ];
}

/** Genera un extracto denso de alta información extrayendo oraciones clave y encabezados. */
export function generateExecutiveExcerpt(
  sections: ObservationSection[],
  maxChars = DEFAULT_MAX_EXCERPT_CHARS,
): string {
  if (sections.length === 0) return '';
  if (sections.length === 1 && (sections[0]?.content.length ?? 0) <= maxChars) {
    return sections[0]?.content ?? '';
  }

  const chunks: string[] = [];
  let accumulated = 0;

  for (const sec of sections) {
    if (accumulated >= maxChars) break;
    const lines = sec.content
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith('![')) // omitir imágenes
      .slice(0, 3); // tomar hasta 3 primeras oraciones/párrafos de cada sección

    const sample = lines.join(' ');
    if (sample) {
      const entry = `• [${sec.heading}]: ${sample}`;
      const toAdd = entry.slice(0, maxChars - accumulated);
      chunks.push(toAdd);
      accumulated += toAdd.length;
    }
  }

  return chunks.join('\n\n');
}

/** Crea un ObservationPack a partir de texto extenso. */
export function createObservationPack(input: CreateObservationInput): ObservationPack {
  const id =
    input.id ??
    `obs_${Math.random().toString(36).substring(2, 9)}_${Date.now().toString(36).slice(-4)}`;
  const now = input.now ?? Date.now;
  const sections = segmentIntoSections(input.fullContent);
  const totalChars = input.fullContent.length;
  const estimatedWords = Math.round(totalChars / 6);
  const maxExcerptChars = input.maxExcerptChars ?? DEFAULT_MAX_EXCERPT_CHARS;
  const executiveExcerpt = generateExecutiveExcerpt(sections, maxExcerptChars);

  const pack: ObservationPack = {
    id,
    title: input.title,
    sourceUrl: input.sourceUrl,
    totalChars,
    estimatedWords,
    sections,
    executiveExcerpt,
    createdAt: now(),
  };

  globalObservationRegistry.set(pack);
  return pack;
}

/** Formatea el resumen estructurado que se devuelve al agente en el `tool_result`. */
export function formatObservationSummary(pack: ObservationPack): string {
  const lines: string[] = [
    `[OBSERVATION_PACK id="${pack.id}"]`,
    `Título: ${pack.title}`,
  ];
  if (pack.sourceUrl) {
    lines.push(`Fuente URL: ${pack.sourceUrl}`);
  }
  lines.push(
    `Volumen: ${pack.totalChars.toLocaleString()} caracteres (~${pack.estimatedWords.toLocaleString()} palabras).`,
  );
  lines.push('');
  lines.push('Índice de secciones disponibles:');
  for (const sec of pack.sections) {
    lines.push(`- [sección: "${sec.id}"] ${sec.heading} (${sec.charCount} caracteres)`);
  }
  lines.push('');
  lines.push('Resumen Ejecutivo Denso:');
  lines.push(pack.executiveExcerpt);
  lines.push('');
  lines.push(
    `[Instrucción: Para examinar cualquier sección completa, invoque: read_observation(handleId="${pack.id}", sectionId="<id_de_sección>")]`,
  );

  return lines.join('\n');
}

/** Almacén en memoria de observaciones para recuperación bajo demanda. */
export class ObservationRegistry {
  private readonly store = new Map<string, ObservationPack>();

  public set(pack: ObservationPack): void {
    if (this.store.size >= MAX_PACKS_IN_STORE) {
      // Purgar la entrada más antigua
      const oldestKey = this.store.keys().next().value;
      if (oldestKey) this.store.delete(oldestKey);
    }
    this.store.set(pack.id, pack);
  }

  public get(id: string): ObservationPack | null {
    return this.store.get(id) ?? null;
  }

  public clear(): void {
    this.store.clear();
  }

  public size(): number {
    return this.store.size;
  }
}

export const globalObservationRegistry = new ObservationRegistry();

/**
 * Lee una sección o rango de caracteres de una observación empaquetada.
 */
export function readObservationSection(
  handleId: string,
  sectionId?: string,
  offset = 0,
  limit = 4_000,
  registry: ObservationRegistry = globalObservationRegistry,
): { found: boolean; text: string; sectionHeading?: string; error?: string } {
  const pack = registry.get(handleId);
  if (!pack) {
    return {
      found: false,
      text: '',
      error: `No se encontró la observación con id "${handleId}". Pudo expirar de la memoria local.`,
    };
  }

  if (sectionId && sectionId.trim() !== '') {
    const target = pack.sections.find(
      (s) => s.id.toLowerCase() === sectionId.toLowerCase().trim(),
    );
    if (!target) {
      const available = pack.sections.map((s) => s.id).join(', ');
      return {
        found: false,
        text: '',
        error: `Sección "${sectionId}" no existe en ${handleId}. Secciones disponibles: [${available}].`,
      };
    }

    const sliced = target.content.slice(offset, offset + limit);
    return {
      found: true,
      sectionHeading: target.heading,
      text: sliced,
    };
  }

  // Sin sectionId, devolver el contenido completo recortado por offset y limit
  const full = pack.sections.map((s) => `## ${s.heading}\n\n${s.content}`).join('\n\n');
  const sliced = full.slice(offset, offset + limit);
  return {
    found: true,
    sectionHeading: 'Contenido completo',
    text: sliced,
  };
}
