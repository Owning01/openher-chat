/**
 * Sistema de Artefactos HTML Versionados y Edición Quirúrgica por Parches.
 * Permite actualizar documentos e informes HTML existentes sin reescribir todo desde cero.
 */

export interface HtmlPatch {
  search: string;
  replace: string;
}

export type ArtifactSource = 'initial' | 'user-edit' | 'agent-patch' | 'agent-rewrite';

export interface ArtifactVersion {
  version: number;
  html: string;
  timestamp: number;
  source: ArtifactSource;
  summary?: string;
}

export interface HtmlArtifact {
  id: string;
  messageId: string;
  currentVersion: number;
  activeHtml: string;
  title?: string;
  versions: ArtifactVersion[];
}

export interface ApplyPatchResult {
  success: boolean;
  html: string;
  appliedCount: number;
  errors: string[];
}

/**
 * Normaliza saltos de línea y espacios en blanco al final de cada línea
 * para permitir comparación tolerante entre el LLM y el código original.
 */
function normalizeLineBreaks(str: string): string {
  return str.replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '');
}

/**
 * Aplica uno o más parches de búsqueda y reemplazo sobre un HTML existente.
 * Soporta coincidencia exacta y coincidencia con normalización de saltos de línea.
 */
export function applyHtmlPatch(originalHtml: string, patches: HtmlPatch[]): ApplyPatchResult {
  if (patches.length === 0) {
    return { success: false, html: originalHtml, appliedCount: 0, errors: ['No se encontraron parches para aplicar'] };
  }

  let current = originalHtml;
  let appliedCount = 0;
  const errors: string[] = [];

  for (let i = 0; i < patches.length; i++) {
    const { search, replace } = patches[i]!;
    const cleanSearch = search.trim();

    if (!cleanSearch) {
      errors.push(`Parche #${i + 1}: el bloque SEARCH está vacío.`);
      continue;
    }

    // 1. Intento de coincidencia exacta
    if (current.includes(search)) {
      current = current.replace(search, replace);
      appliedCount++;
      continue;
    }

    // 2. Intento de coincidencia con trimmed search
    if (current.includes(cleanSearch)) {
      current = current.replace(cleanSearch, replace.trim());
      appliedCount++;
      continue;
    }

    // 3. Intento de coincidencia con saltos de línea normalizados
    const normCurrent = normalizeLineBreaks(current);
    const normSearch = normalizeLineBreaks(cleanSearch);

    const normIndex = normCurrent.indexOf(normSearch);
    if (normIndex !== -1) {
      // Reemplaza utilizando los límites encontrados en la versión normalizada
      const before = normCurrent.slice(0, normIndex);
      const after = normCurrent.slice(normIndex + normSearch.length);
      current = before + normalizeLineBreaks(replace) + after;
      appliedCount++;
      continue;
    }

    // 4. Intento de coincidencia línea por línea colapsando indentación
    const currentLines = current.split(/\r?\n/);
    const searchLines = cleanSearch.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

    if (searchLines.length > 0) {
      let matchStart = -1;
      for (let lineIdx = 0; lineIdx <= currentLines.length - searchLines.length; lineIdx++) {
        let allMatch = true;
        for (let sIdx = 0; sIdx < searchLines.length; sIdx++) {
          if (currentLines[lineIdx + sIdx]!.trim() !== searchLines[sIdx]) {
            allMatch = false;
            break;
          }
        }
        if (allMatch) {
          matchStart = lineIdx;
          break;
        }
      }

      if (matchStart !== -1) {
        currentLines.splice(matchStart, searchLines.length, replace);
        current = currentLines.join('\n');
        appliedCount++;
        continue;
      }
    }

    errors.push(`Parche #${i + 1}: no se encontró el fragmento original especificado en SEARCH.`);
  }

  return {
    success: appliedCount > 0,
    html: current,
    appliedCount,
    errors,
  };
}

/**
 * Extrae bloques de parche tipo:
 * <<<<<<< SEARCH
 * ...
 * =======
 * ...
 * >>>>>>>
 * O estilo simplificado:
 * <<<< SEARCH
 * ...
 * ====
 * ...
 * >>>>
 */
export function extractHtmlPatches(text: string): HtmlPatch[] {
  if (typeof text !== 'string' || text.trim() === '') return [];

  const patches: HtmlPatch[] = [];

  // Expresión regular que tolera 4 a 7 caracteres de marca (<<<<, <<<<<<<)
  // con o sin identificador REPLACE
  const patchRegex = /<{4,7}\s*SEARCH[\r\n]+([\s\S]*?)[\r\n]+={4,7}[\r\n]+([\s\S]*?)[\r\n]+>{4,7}(?:\s*REPLACE)?/gi;

  let match: RegExpExecArray | null;
  while ((match = patchRegex.exec(text)) !== null) {
    const search = match[1] ?? '';
    const replace = match[2] ?? '';
    if (search.trim() !== '') {
      patches.push({ search, replace });
    }
  }

  return patches;
}

/**
 * Crea un nuevo artefacto HTML con su versión inicial (v1).
 */
export function createHtmlArtifact(id: string, messageId: string, html: string, title?: string): HtmlArtifact {
  const initialVersion: ArtifactVersion = {
    version: 1,
    html,
    timestamp: Date.now(),
    source: 'initial',
    summary: 'Versión inicial generada por el agente',
  };

  return {
    id,
    messageId,
    currentVersion: 1,
    activeHtml: html,
    title,
    versions: [initialVersion],
  };
}

/**
 * Agrega una nueva versión al artefacto incrementando su número de versión.
 */
export function addArtifactVersion(
  artifact: HtmlArtifact,
  newHtml: string,
  source: ArtifactSource,
  summary?: string,
): HtmlArtifact {
  if (newHtml.trim() === artifact.activeHtml.trim()) {
    return artifact;
  }

  const nextVersionNum = artifact.versions.length + 1;
  const newVersion: ArtifactVersion = {
    version: nextVersionNum,
    html: newHtml,
    timestamp: Date.now(),
    source,
    summary:
      summary ??
      (source === 'user-edit'
        ? 'Edición manual de código'
        : source === 'agent-patch'
          ? 'Parche quirúrgico del agente'
          : 'Actualización completa del informe'),
  };

  return {
    ...artifact,
    currentVersion: nextVersionNum,
    activeHtml: newHtml,
    versions: [...artifact.versions, newVersion],
  };
}

import { extractHtmlReport } from './reportThemes';

/**
 * Restaura una versión previa del artefacto por su número de versión.
 */
export function restoreArtifactVersion(artifact: HtmlArtifact, targetVersion: number): HtmlArtifact {
  const target = artifact.versions.find((v) => v.version === targetVersion);
  if (!target) return artifact;

  return {
    ...artifact,
    currentVersion: target.version,
    activeHtml: target.html,
  };
}

/**
 * Resuelve el HTML a partir del contenido de un mensaje, detectando si contiene
 * un HTML completo o un parche quirúrgico aplicado sobre un HTML anterior.
 */
export function resolveMessageHtml(
  text: string,
  previousHtml?: string,
): { html: string | null; isPatch: boolean; patchCount: number; errors: string[] } {
  const patches = extractHtmlPatches(text);
  if (patches.length > 0 && previousHtml) {
    const patchResult = applyHtmlPatch(previousHtml, patches);
    if (patchResult.success) {
      return {
        html: patchResult.html,
        isPatch: true,
        patchCount: patchResult.appliedCount,
        errors: patchResult.errors,
      };
    }
  }

  const fullHtml = extractHtmlReport(text);
  if (fullHtml) {
    return {
      html: fullHtml,
      isPatch: false,
      patchCount: 0,
      errors: [],
    };
  }

  return {
    html: null,
    isPatch: false,
    patchCount: 0,
    errors: patches.length > 0 && !previousHtml ? ['No hay HTML previo sobre el que aplicar el parche'] : [],
  };
}
