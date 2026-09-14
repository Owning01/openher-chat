import { describe, expect, it } from 'vitest';

import type { TokenUsage } from '../types/chat';
import { estimateCost, findModelPrice, totalCost, totalTokens } from './pricing';

describe('findModelPrice', () => {
  it('resuelve por coincidencia parcial, priorizando la regla más específica', () => {
    expect(findModelPrice('gpt-4o-mini')?.input).toBe(0.15);
    expect(findModelPrice('openai/gpt-4o')?.output).toBe(10);
    expect(findModelPrice('gpt-4.1-mini')?.input).toBe(0.4);
    expect(findModelPrice('claude-sonnet-4-5')?.input).toBe(3);
  });

  it('devuelve null para modelos sin precio conocido (p. ej. locales)', () => {
    expect(findModelPrice('llama-3.2-3b-instruct')).toBeNull();
    expect(findModelPrice('mi-modelo-casero')).toBeNull();
  });
});

describe('estimateCost', () => {
  it('cobra entrada, salida y caché con los precios de cada tramo', () => {
    const usage: TokenUsage = {
      promptTokens: 1_000_000,
      completionTokens: 1_000_000,
      cachedPromptTokens: 400_000,
      cacheWritePromptTokens: 100_000,
    };

    const cost = estimateCost('claude-sonnet-4', usage);
    expect(cost).not.toBeNull();
    expect(cost?.currency).toBe('USD');
    // 500k fresh*3 + 400k cached*0.3 + 100k write*3.75 + 1M out*15 = 1.5 + 0.12 + 0.375 + 15
    expect(cost?.input).toBeCloseTo(1.995, 5);
    expect(cost?.output).toBeCloseTo(15, 5);
    expect(cost?.total).toBeCloseTo(16.995, 5);
  });

  it('usa el precio de entrada cuando no hay tarifa de caché declarada', () => {
    const cost = estimateCost('llama-3.3-70b', {
      promptTokens: 1_000_000,
      completionTokens: 0,
      cachedPromptTokens: 500_000,
    });
    expect(cost?.total).toBeCloseTo(0.59, 5);
  });

  it('devuelve null sin modelo o sin precio', () => {
    expect(estimateCost(undefined, { promptTokens: 10 })).toBeNull();
    expect(estimateCost('modelo-desconocido', { promptTokens: 10 })).toBeNull();
  });
});

describe('totalCost / totalTokens', () => {
  const messages = [
    { modelId: 'gpt-4o-mini', usage: { promptTokens: 1_000_000, completionTokens: 0 } as TokenUsage },
    { modelId: 'modelo-desconocido', usage: { promptTokens: 500, completionTokens: 500 } as TokenUsage },
  ];

  it('suma solo los mensajes con precio conocido', () => {
    const total = totalCost(messages);
    expect(total?.total).toBeCloseTo(0.15, 5);

    expect(totalCost([{ modelId: 'modelo-desconocido', usage: { promptTokens: 1 } }])).toBeNull();
    expect(totalCost([{ modelId: 'gpt-4o-mini' }])).toBeNull();
  });

  it('agrega tokens y expone caché solo si existe', () => {
    const tokens = totalTokens([
      { usage: { promptTokens: 100, completionTokens: 20, cachedPromptTokens: 40 } },
      { usage: { promptTokens: 50, completionTokens: 10 } },
    ]);
    expect(tokens).toEqual({
      promptTokens: 150,
      completionTokens: 30,
      totalTokens: 180,
      cachedPromptTokens: 40,
    });
  });
});
