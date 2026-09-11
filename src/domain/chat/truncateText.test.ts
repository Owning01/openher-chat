import { describe, expect, it } from 'vitest';
import { truncateText } from './truncateText';

const marker = (removed: number): string => `\n\n[... truncated ${removed} chars ...]\n\n`;

describe('truncateText', () => {
  it('devuelve el texto intacto si cabe (incluido el borde exacto)', () => {
    expect(truncateText('abc', 10)).toBe('abc');
    expect(truncateText('abc', 3)).toBe('abc');
    expect(truncateText('', 0)).toBe('');
  });

  it('mide el límite en code points, no en code units UTF-16', () => {
    const emoji = '😀';
    expect(truncateText(emoji.repeat(10), 10)).toBe(emoji.repeat(10));
  });

  it('recorta head 60% + marcador en inglés + tail 40%', () => {
    const text = 'abcdefghijklmnopqrstuvwxyz0123456789'.repeat(3);
    const result = truncateText(text, 50);
    expect(result).toBe(`${text.slice(0, 30)}${marker(58)}${text.slice(-20)}`);
  });

  it('en el borde del límite conserva head y tail proporcionales', () => {
    expect(truncateText('x'.repeat(100), 60)).toBe(`${'x'.repeat(36)}${marker(40)}${'x'.repeat(24)}`);
  });

  it('con límite 0 devuelve solo el marcador con el total removido', () => {
    expect(truncateText('abc', 0)).toBe(marker(3));
  });

  it('sin espacio para head+tail devuelve solo el marcador', () => {
    expect(truncateText('abcdefghij', 4)).toBe(marker(6));
    expect(truncateText('你好世界你好世界', 4)).toBe(marker(4));
    expect(truncateText('x'.repeat(100), 34)).toBe(marker(66));
  });

  it('con límite igual al marcador + 4 ya conserva head y tail', () => {
    expect(truncateText('x'.repeat(100), 36)).toBe(`${'x'.repeat(21)}${marker(64)}${'x'.repeat(15)}`);
  });

  it('es determinista', () => {
    const first = truncateText('x'.repeat(100), 40);
    const second = truncateText('x'.repeat(100), 40);
    expect(first).toBe(second);
    expect(first).toContain('[... truncated 60 chars ...]');
  });

  it('corta por code points y no parte pares surrogados', () => {
    const emoji = '😀';
    const text = emoji.repeat(60);
    const result = truncateText(text, 40);
    const removedMarker = marker(20);
    expect(result).toBe(`${emoji.repeat(24)}${removedMarker}${emoji.repeat(16)}`);
    expect(Array.from(result).length).toBe(40 + Array.from(removedMarker).length);
  });

  it('un límite no finito desactiva el truncado', () => {
    expect(truncateText('abc', Number.NaN)).toBe('abc');
    expect(truncateText('abc', Number.POSITIVE_INFINITY)).toBe('abc');
  });
});
