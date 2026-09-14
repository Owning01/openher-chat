import { createContext, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';

import { applyCitationMarkers, extractCitations, verifyCitations } from '@/domain/legal/citation';
import type { CitationGuardResult, CitationVerdict, LegalIndex } from '@/domain/types/legal';

/** Conteo de citas para la UI (contadores del guard, sin malformadas). */
export interface CitationCounters {
  verified: number;
  unverified: number;
}

/**
 * Guard de circulación del texto en contexto legal (render/copiar).
 * El texto crudo nunca se muta: `mark` devuelve una copia con los
 * `[VERIFICAR]` insertados (idempotente).
 */
export interface CitationGuard {
  mark(text: string): string;
  counters(text: string): CitationCounters;
  /** `false` = sin índice (guard conservador) o fuera del provider (neutro). */
  indexAvailable: boolean;
}

export interface CitationGuardProviderProps {
  /** Índice legal o `null` si no hay corpus (y nada más: la presencia del provider marca el contexto legal). */
  index: LegalIndex | null;
  children: ReactNode;
}

/**
 * Marca conservadora sin índice (fail-closed): toda cita detectada queda
 * `[VERIFICAR]` con motivo `no-index` y ninguna puede quedar `verified`.
 * Decisión documentada: sin corpus no hay existencia que comprobar, así que
 * el guard degrada a marcar todo lo detectable en vez de dejarlo pasar.
 * Réplica la política de `conversationToMarkdown` (T20) para el render/copiar.
 */
export function markTextWithoutIndex(text: string): string {
  try {
    const refs = extractCitations(text);
    if (refs.length === 0) return text;
    const verdicts: CitationVerdict[] = refs.map(
      (citation): CitationVerdict => ({ status: 'unverified', citation, reason: 'no-index' }),
    );
    const result: CitationGuardResult = {
      verdicts,
      verified: 0,
      unverified: verdicts.length,
      malformed: 0,
    };
    return applyCitationMarkers(text, result);
  } catch {
    return text;
  }
}

/** Marca un texto contra el índice (o de forma conservadora si es `null`). Nunca lanza. */
export function markLegalText(text: string, index: LegalIndex | null): string {
  if (typeof text !== 'string' || text === '') return text;
  try {
    if (index === null) return markTextWithoutIndex(text);
    return applyCitationMarkers(text, verifyCitations(text, index));
  } catch {
    return text;
  }
}

/** Cuenta citas verificadas/sin verificar (sin índice: todo lo detectado es unverified). Nunca lanza. */
export function countLegalCitations(text: string, index: LegalIndex | null): CitationCounters {
  try {
    if (typeof text !== 'string' || text === '') return { verified: 0, unverified: 0 };
    if (index === null) return { verified: 0, unverified: extractCitations(text).length };
    const result = verifyCitations(text, index);
    return { verified: result.verified, unverified: result.unverified };
  } catch {
    return { verified: 0, unverified: 0 };
  }
}

const CitationGuardContext = createContext<CitationGuard | null>(null);

/** Guard neutro fuera del provider: identidad, para no alterar el modo general. */
const NEUTRAL_GUARD: CitationGuard = {
  mark: (text) => text,
  counters: () => ({ verified: 0, unverified: 0 }),
  indexAvailable: false,
};

export function CitationGuardProvider({ index, children }: CitationGuardProviderProps) {
  const guard = useMemo<CitationGuard>(
    () => ({
      mark: (text) => markLegalText(text, index),
      counters: (text) => countLegalCitations(text, index),
      indexAvailable: index !== null,
    }),
    [index],
  );
  return <CitationGuardContext.Provider value={guard}>{children}</CitationGuardContext.Provider>;
}

/**
 * Guard de circulación. Fuera del provider devuelve el guard neutro (identidad)
 * para no romper renders existentes; por eso `ChatPage` no necesita montar provider.
 */
export function useCitationGuard(): CitationGuard {
  const guard = useContext(CitationGuardContext);
  return guard ?? NEUTRAL_GUARD;
}
