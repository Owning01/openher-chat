import { describe, expect, it } from 'vitest';
import { ProviderError, mapHttpStatus } from './errors';

describe('ProviderError', () => {
  it('expone code, retryable y metadatos opcionales', () => {
    const error = new ProviderError('boom', 'rate_limit', { retryable: true, status: 429, retryAfterMs: 500 });
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('ProviderError');
    expect(error.message).toBe('boom');
    expect(error.code).toBe('rate_limit');
    expect(error.retryable).toBe(true);
    expect(error.status).toBe(429);
    expect(error.retryAfterMs).toBe(500);
  });

  it('omite los metadatos no informados', () => {
    const error = new ProviderError('boom', 'unknown', { retryable: false });
    expect(error.status).toBeUndefined();
    expect(error.retryAfterMs).toBeUndefined();
  });
});

describe('mapHttpStatus', () => {
  it('401 → auth sin retry y extrae el mensaje del body', () => {
    const error = mapHttpStatus(401, '{"error":{"message":"bad key"}}');
    expect(error.code).toBe('auth');
    expect(error.retryable).toBe(false);
    expect(error.status).toBe(401);
    expect(error.message).toBe('bad key');
  });

  it('403 → auth sin retry', () => {
    const error = mapHttpStatus(403, 'forbidden');
    expect(error.code).toBe('auth');
    expect(error.retryable).toBe(false);
    expect(error.message).toBe('forbidden');
  });

  it('408 → timeout con retry', () => {
    const error = mapHttpStatus(408, '');
    expect(error.code).toBe('timeout');
    expect(error.retryable).toBe(true);
    expect(error.message).toBe('HTTP 408');
  });

  it('429 sin Retry-After → rate_limit con retry y sin retryAfterMs', () => {
    const error = mapHttpStatus(429, '{"error":{"message":"slow down"}}');
    expect(error.code).toBe('rate_limit');
    expect(error.retryable).toBe(true);
    expect(error.retryAfterMs).toBeUndefined();
  });

  it('429 con Retry-After en segundos → retryAfterMs exacto', () => {
    const error = mapHttpStatus(429, '', '2.5');
    expect(error.code).toBe('rate_limit');
    expect(error.retryAfterMs).toBe(2500);
  });

  it('429 con Retry-After en fecha HTTP → retryAfterMs relativo a now', () => {
    const now = Date.UTC(2026, 0, 1, 12, 0, 0);
    const header = new Date(now + 45_000).toUTCString();
    const error = mapHttpStatus(429, '', header, now);
    expect(error.retryAfterMs).toBe(45_000);
  });

  it('429 con Retry-After inválido o vencido → sin explotar', () => {
    expect(mapHttpStatus(429, '', 'not-a-date').retryAfterMs).toBeUndefined();
    const now = Date.UTC(2026, 0, 1, 12, 0, 0);
    expect(mapHttpStatus(429, '', new Date(now - 10_000).toUTCString(), now).retryAfterMs).toBe(0);
  });

  it('400 normal → invalid_request sin retry', () => {
    const error = mapHttpStatus(400, '{"error":{"message":"bad model"}}');
    expect(error.code).toBe('invalid_request');
    expect(error.retryable).toBe(false);
    expect(error.message).toBe('bad model');
  });

  it('400 con context_length_exceeded → context_length', () => {
    const error = mapHttpStatus(400, '{"error":{"code":"context_length_exceeded","message":"too long"}}');
    expect(error.code).toBe('context_length');
    expect(error.retryable).toBe(false);
    expect(error.message).toBe('too long');
  });

  it('400 con la frase context length → context_length', () => {
    const error = mapHttpStatus(400, 'This model maximum context length is 8192 tokens');
    expect(error.code).toBe('context_length');
  });

  it('404 → invalid_request sin retry', () => {
    const error = mapHttpStatus(404, '{"error":"model not found"}');
    expect(error.code).toBe('invalid_request');
    expect(error.retryable).toBe(false);
    expect(error.message).toBe('model not found');
  });

  it('500 y 503 → server con retry', () => {
    for (const status of [500, 503]) {
      const error = mapHttpStatus(status, '');
      expect(error.code).toBe('server');
      expect(error.retryable).toBe(true);
      expect(error.status).toBe(status);
    }
  });

  it('4xx restantes (402/405/409/413/422/418) → invalid_request sin retry', () => {
    for (const status of [402, 405, 409, 413, 418, 422]) {
      const error = mapHttpStatus(status, '');
      expect(error.code).toBe('invalid_request');
      expect(error.retryable).toBe(false);
      expect(error.status).toBe(status);
    }
  });

  it('418 conserva el mensaje del body como invalid_request', () => {
    const error = mapHttpStatus(418, 'teapot');
    expect(error.code).toBe('invalid_request');
    expect(error.status).toBe(418);
    expect(error.message).toBe('teapot');
  });

  it('status fuera del rango HTTP (0/999) → unknown sin retry', () => {
    for (const status of [0, 999]) {
      const error = mapHttpStatus(status, '');
      expect(error.code).toBe('unknown');
      expect(error.retryable).toBe(false);
      expect(error.status).toBe(status);
      expect(error.message).toBe(`HTTP ${status}`);
    }
  });

  it('body JSON sin mensaje reconocible cae al texto crudo', () => {
    const error = mapHttpStatus(500, '{"detail":"upstream"}');
    expect(error.message).toBe('{"detail":"upstream"}');
  });

  it('body vacío usa el fallback HTTP <status>', () => {
    expect(mapHttpStatus(500, '   ').message).toBe('HTTP 500');
  });
});
