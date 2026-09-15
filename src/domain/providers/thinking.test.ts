import { describe, expect, it } from 'vitest';

import { inferThinkingSupport, thinkingBudgetTokens } from './thinking';

describe('inferThinkingSupport', () => {
  it('reconoce familias razonadoras conocidas', () => {
    expect(inferThinkingSupport('deepseek-reasoner')).toBe(true);
    expect(inferThinkingSupport('qwq-32b')).toBe(true);
    expect(inferThinkingSupport('openai/gpt-oss-120b')).toBe(true);
    expect(inferThinkingSupport('kimi-k2-thinking')).toBe(true);
    expect(inferThinkingSupport('qwen3-thinking-2507')).toBe(true);
  });

  it('es conservador ante la duda', () => {
    expect(inferThinkingSupport('')).toBe(false);
    expect(inferThinkingSupport('   ')).toBe(false);
    expect(inferThinkingSupport('gpt-4o')).toBe(false);
    expect(inferThinkingSupport('claude-sonnet-4-5')).toBe(false);
    expect(inferThinkingSupport('llama-3.3-70b')).toBe(false);
    expect(inferThinkingSupport('kimi-k2')).toBe(false);
  });
});

describe('thinkingBudgetTokens', () => {
  it('off siempre da null', () => {
    expect(thinkingBudgetTokens('off', 64000)).toBeNull();
  });

  it('aplica la fracción del nivel con mínimo de 1024', () => {
    expect(thinkingBudgetTokens('low', 64000)).toBe(6400);
    expect(thinkingBudgetTokens('medium', 64000)).toBe(16000);
    expect(thinkingBudgetTokens('high', 64000)).toBe(32000);
    expect(thinkingBudgetTokens('max', 64000)).toBe(51200);
    // Ventana chica: el mínimo manda mientras quepa.
    expect(thinkingBudgetTokens('low', 2048)).toBe(1024);
  });

  it('da null cuando el presupuesto no cabe en la ventana', () => {
    expect(thinkingBudgetTokens('low', 1024)).toBeNull();
    expect(thinkingBudgetTokens('high', 500)).toBeNull();
    expect(thinkingBudgetTokens('medium', Number.NaN)).toBeNull();
  });
});
