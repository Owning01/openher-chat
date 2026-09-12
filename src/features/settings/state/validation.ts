import type { AgentBudget } from '@/domain/types/agent';
import type { HistoryBudget, SearchSettings } from '@/domain/types/settings';
import type { ProviderKind } from '@/domain/types/provider';

export type ProviderDraftField = 'label' | 'baseUrl';
export type ProviderDraftError = 'required' | 'invalid_url';

export interface ProviderDraft {
  label: string;
  kind: ProviderKind;
  baseUrl: string;
  requiresKey: boolean;
}

export const PROVIDER_KINDS: readonly ProviderKind[] = ['openai-compatible', 'anthropic'];

export function isProviderKind(value: string): value is ProviderKind {
  return (PROVIDER_KINDS as readonly string[]).includes(value);
}

/** Acepta solo URLs absolutas http/https con host. */
export function isHttpUrl(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed === '') return false;
  try {
    const url = new URL(trimmed);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname !== '';
  } catch {
    return false;
  }
}

export function validateProviderDraft(draft: ProviderDraft): Partial<Record<ProviderDraftField, ProviderDraftError>> {
  const errors: Partial<Record<ProviderDraftField, ProviderDraftError>> = {};
  if (draft.label.trim() === '') errors.label = 'required';
  if (!isHttpUrl(draft.baseUrl)) errors.baseUrl = 'invalid_url';
  return errors;
}

export function hasProviderDraftErrors(errors: Partial<Record<ProviderDraftField, ProviderDraftError>>): boolean {
  return errors.label !== undefined || errors.baseUrl !== undefined;
}

export function isWithinRange(value: number, min: number, max: number): boolean {
  return Number.isFinite(value) && value >= min && value <= max;
}

export function clampToRange(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/** Rangos espejo de `migrateSettings`; los tests verifican la paridad con los clamps reales. */
export const AGENT_BUDGET_LIMITS: Record<keyof AgentBudget, { min: number; max: number }> = {
  maxSteps: { min: 1, max: 20 },
  maxToolCalls: { min: 0, max: 50 },
  maxToolResultChars: { min: 500, max: 200_000 },
  maxTotalTokens: { min: 1000, max: 2_000_000 },
  maxWallClockMs: { min: 5000, max: 1_800_000 },
  maxRetriesPerStep: { min: 0, max: 10 },
  toolTimeoutMs: { min: 1000, max: 120_000 },
};

export const HISTORY_BUDGET_LIMITS = {
  maxPromptTokens: { min: 512, max: 2_000_000 },
  reservedOutputTokens: { min: 0, max: 32_768 },
  keepLastTurns: { min: 0, max: 50 },
  truncateMessageAtPercent: { min: 0.05, max: 1 },
} satisfies Partial<Record<keyof HistoryBudget, { min: number; max: number }>>;

export const SEARCH_LIMITS = {
  maxResults: { min: 3, max: 10 },
} satisfies Partial<Record<keyof SearchSettings, { min: number; max: number }>>;

export const TEMPERATURE_LIMITS = { min: 0, max: 2 };
export const MAX_OUTPUT_TOKENS_LIMITS = { min: 1, max: 200_000 };

export function validateTemperature(value: number): boolean {
  return isWithinRange(value, TEMPERATURE_LIMITS.min, TEMPERATURE_LIMITS.max);
}

export function validateMaxResults(value: number): boolean {
  return isWithinRange(value, SEARCH_LIMITS.maxResults.min, SEARCH_LIMITS.maxResults.max);
}
