import { describe, expect, it } from 'vitest';

import { compressImageFile, ImageTooLargeError } from './images';

function pngFile(name = 'foto.png'): File {
  // PNG mínimo de 1x1 (bytes reales, sin canvas).
  const bytes = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
    0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8, 0xff, 0xff, 0x3f,
    0x00, 0x05, 0xfe, 0x02, 0xfe, 0xdc, 0xcc, 0x59, 0xe7, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,
    0x44, 0xae, 0x42, 0x60, 0x82,
  ]);
  return new File([bytes], name, { type: 'image/png' });
}

describe('compressImageFile', () => {
  it('sin canvas cae al dataUrl crudo con su mime', async () => {
    const result = await compressImageFile(pngFile(), { createImageBitmap: undefined, createCanvas: undefined });
    expect(result.mime).toBe('image/png');
    expect(result.dataUrl.startsWith('data:image/png;base64,')).toBe(true);
  });

  it('rechaza imágenes que superan la cota cruda', async () => {
    const big = new File([new Uint8Array(8_000_001)], 'grande.jpg', { type: 'image/jpeg' });
    await expect(compressImageFile(big, { createImageBitmap: undefined, createCanvas: undefined })).rejects.toBeInstanceOf(
      ImageTooLargeError,
    );
  });

  it('comprime por canvas cuando hay decodificador disponible', async () => {
    const bitmap = { width: 3000, height: 2000, close: () => undefined } as unknown as ImageBitmap;
    const drawn: string[] = [];
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({
        drawImage: () => {
          drawn.push('draw');
        },
      }),
      toBlob: (callback: (blob: Blob | null) => void) => {
        callback(new File(['jpeg'], 'x.jpg', { type: 'image/jpeg' }));
      },
    } as unknown as HTMLCanvasElement;
    const result = await compressImageFile(pngFile('scan.png'), {
      createImageBitmap: (async () => bitmap) as unknown as typeof createImageBitmap,
      createCanvas: () => canvas,
    });
    expect(result.mime).toBe('image/jpeg');
    expect(result.dataUrl.startsWith('data:image/jpeg;base64,')).toBe(true);
    expect(drawn).toEqual(['draw']);
    expect(canvas.width).toBeLessThanOrEqual(1568);
  });
});
