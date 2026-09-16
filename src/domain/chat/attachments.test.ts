import { describe, expect, it } from 'vitest';

import {
  composeMessageWithAttachments,
  formatAttachmentBlock,
  isSupportedAttachment,
  MAX_ATTACHMENT_CHARS,
  splitAttachmentBlocks,
  toAttachmentDraft,
} from './attachments';

describe('isSupportedAttachment', () => {
  it('acepta texto por mime o extensión', () => {
    expect(isSupportedAttachment('nota.txt', 'text/plain')).toBe(true);
    expect(isSupportedAttachment('datos.json', 'application/json')).toBe(true);
    expect(isSupportedAttachment('doc.md', '')).toBe(true);
    expect(isSupportedAttachment('NOTA.TXT', '')).toBe(true);
  });

  it('rechaza binarios que requieren parser externo', () => {
    expect(isSupportedAttachment('doc.pdf', 'application/pdf')).toBe(false);
    expect(isSupportedAttachment('foto.png', 'image/png')).toBe(false);
    expect(isSupportedAttachment('informe.docx', '')).toBe(false);
    expect(isSupportedAttachment('sin-extension', '')).toBe(false);
  });
});

describe('toAttachmentDraft', () => {
  it('trunca al presupuesto y lo marca', () => {
    const draft = toAttachmentDraft('a1', 'largo.txt', 'x'.repeat(MAX_ATTACHMENT_CHARS + 10));
    expect(draft.text).toHaveLength(MAX_ATTACHMENT_CHARS);
    expect(draft.truncated).toBe(true);
  });

  it('no trunca dentro del presupuesto', () => {
    const draft = toAttachmentDraft('a1', 'corto.txt', 'hola');
    expect(draft.text).toBe('hola');
    expect(draft.truncated).toBe(false);
  });
});

describe('composeMessageWithAttachments', () => {
  it('une borrador y adjuntos delimitados', () => {
    const composed = composeMessageWithAttachments('miren esto', [
      { id: 'a1', name: 'a.txt', text: 'contenido', truncated: false },
    ]);
    expect(composed).toContain('miren esto');
    expect(composed).toContain('## Archivo adjunto: a.txt');
    expect(composed).toContain('contenido');
  });

  it('permite enviar solo adjuntos sin borrador', () => {
    const composed = composeMessageWithAttachments('   ', [
      { id: 'a1', name: 'a.txt', text: 'contenido', truncated: false },
    ]);
    expect(composed).toContain('## Archivo adjunto: a.txt');
  });

  it('marca el truncado en el bloque', () => {
    const block = formatAttachmentBlock({ id: 'a1', name: 'a.txt', text: 'parte', truncated: true });
    expect(block).toContain('[…truncado]');
  });
});

describe('splitAttachmentBlocks', () => {
  it('separa texto y adjuntos del mensaje compuesto (ida y vuelta)', () => {
    const composed = composeMessageWithAttachments('miren esto', [
      { id: 'a1', name: 'a.txt', text: 'contenido uno', truncated: false },
      { id: 'a2', name: 'b.pdf', text: 'contenido dos', truncated: true, sourceLabel: 'Documento PDF' },
    ]);
    const split = splitAttachmentBlocks(composed);
    expect(split.text).toBe('miren esto');
    expect(split.attachments).toHaveLength(2);
    expect(split.attachments[0]).toEqual({ name: 'a.txt', body: 'contenido uno' });
    expect(split.attachments[1]?.name).toBe('b.pdf');
    expect(split.attachments[1]?.body).toContain('contenido dos');
  });

  it('sin bloques devuelve el texto intacto', () => {
    expect(splitAttachmentBlocks('hola mundo')).toEqual({ text: 'hola mundo', attachments: [] });
    expect(splitAttachmentBlocks('   ')).toEqual({ text: '', attachments: [] });
  });
});
