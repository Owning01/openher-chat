import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  MAX_INTAKE_CHARS,
  imageDataUrlToFile,
  installOpenHerIntake,
  normalizeIntakePayload,
} from './openherIntake';

const PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
const JPEG_DATA_URL = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';

afterEach(() => {
  delete window.__openherIntake;
});

describe('imageDataUrlToFile', () => {
  it('convierte un data URL de PNG en File', () => {
    const file = imageDataUrlToFile(PNG_DATA_URL, 'captura.png');
    expect(file).toBeInstanceOf(File);
    expect(file?.name).toBe('captura.png');
    expect(file?.type).toBe('image/png');
    expect(file?.size).toBeGreaterThan(0);
  });

  it('deduce la extensión cuando no le pasan nombre', () => {
    expect(imageDataUrlToFile(JPEG_DATA_URL, '  ')?.name).toBe('captura.jpg');
  });

  it('rechaza lo que no es una imagen en base64', () => {
    expect(imageDataUrlToFile('https://example.com/a.png', 'x')).toBeNull();
    expect(imageDataUrlToFile('data:text/plain;base64,aGk=', 'x')).toBeNull();
    expect(imageDataUrlToFile('data:image/png;base64,%%%', 'x')).toBeNull();
    expect(imageDataUrlToFile('', 'x')).toBeNull();
  });
});

describe('normalizeIntakePayload', () => {
  it('devuelve null cuando no hay texto ni imagen', () => {
    expect(normalizeIntakePayload({})).toBeNull();
    expect(normalizeIntakePayload({ text: '   ' })).toBeNull();
    expect(normalizeIntakePayload('hola')).toBeNull();
    expect(normalizeIntakePayload(null)).toBeNull();
  });

  it('limpia el texto y conserva la imagen', () => {
    const payload = normalizeIntakePayload({ text: '  hola  ', imageDataUrl: PNG_DATA_URL, imageName: 'x.png', source: 'ext' });
    expect(payload).toEqual({ text: 'hola', imageDataUrl: PNG_DATA_URL, imageName: 'x.png', source: 'ext' });
  });

  it('acota el texto enormous', () => {
    const payload = normalizeIntakePayload({ text: 'a'.repeat(MAX_INTAKE_CHARS + 50) });
    expect(payload?.text).toHaveLength(MAX_INTAKE_CHARS);
  });
});

describe('installOpenHerIntake', () => {
  it('publica el gancho, agrega texto y adjunta la imagen, y lo saca al limpiar', async () => {
    const appendText = vi.fn<(next: string) => void>();
    const addFiles = vi.fn(async (_files: readonly File[]) => undefined);
    const cleanup = installOpenHerIntake({ appendText, addFiles });

    expect(typeof window.__openherIntake).toBe('function');
    await window.__openherIntake?.({ text: 'texto de contexto', imageDataUrl: PNG_DATA_URL });

    expect(appendText).toHaveBeenCalledWith('texto de contexto');
    expect(addFiles).toHaveBeenCalledTimes(1);
    const files = addFiles.mock.calls[0]?.[0] ?? [];
    expect(files[0]?.name).toBe('captura.png');

    cleanup();
    expect(window.__openherIntake).toBeUndefined();
  });

  it('no toca nada con un payload vacío o inválido', async () => {
    const appendText = vi.fn<(next: string) => void>();
    const addFiles = vi.fn(async (_files: readonly File[]) => undefined);
    const cleanup = installOpenHerIntake({ appendText, addFiles });

    await window.__openherIntake?.({ text: '   ' });
    await window.__openherIntake?.({ imageDataUrl: 'no-es-una-imagen' });
    await window.__openherIntake?.({} as { text?: string });

    expect(appendText).not.toHaveBeenCalled();
    expect(addFiles).not.toHaveBeenCalled();
    cleanup();
  });

  it('solo borra el gancho si sigue siendo el suyo', () => {
    const cleanup = installOpenHerIntake({
      appendText: vi.fn<(next: string) => void>(),
      addFiles: vi.fn(async (_files: readonly File[]) => undefined),
    });
    const other = (): Promise<void> => Promise.resolve();
    window.__openherIntake = other;
    cleanup();
    expect(window.__openherIntake).toBe(other);
  });
});
