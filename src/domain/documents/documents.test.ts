import { describe, expect, it } from 'vitest';

import {
  classifyDocument,
  formatDocumentBlock,
  isLegacyDoc,
  MAX_DOCUMENT_CHARS,
  toDocumentDraftText,
} from './documents';

describe('classifyDocument', () => {
  it('clasifica por mime o extensión', () => {
    expect(classifyDocument('escrito.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe('docx');
    expect(classifyDocument('ESCAN.DOCX', '')).toBe('docx');
    expect(classifyDocument('prueba.pdf', 'application/pdf')).toBe('pdf');
    expect(classifyDocument('nota.PDF', '')).toBe('pdf');
    expect(classifyDocument('foto.jpg', 'image/jpeg')).toBe('image');
    expect(classifyDocument('captura.png', '')).toBe('image');
    expect(classifyDocument('foto.webp', 'image/webp')).toBe('image');
  });

  it('devuelve null para lo no soportado', () => {
    expect(classifyDocument('planilla.xlsx', '')).toBeNull();
    expect(classifyDocument('audio.mp3', 'audio/mpeg')).toBeNull();
    expect(classifyDocument('viejo.doc', 'application/msword')).toBeNull();
  });
});

describe('isLegacyDoc', () => {
  it('detecta el .doc binario viejo pero no el .docx', () => {
    expect(isLegacyDoc('informe.doc', 'application/msword')).toBe(true);
    expect(isLegacyDoc('informe.doc', '')).toBe(true);
    expect(isLegacyDoc('informe.docx', '')).toBe(false);
    expect(isLegacyDoc('informe.pdf', '')).toBe(false);
  });
});

describe('toDocumentDraftText', () => {
  it('trunca al presupuesto y lo marca', () => {
    const draft = toDocumentDraftText('x'.repeat(MAX_DOCUMENT_CHARS + 5));
    expect(draft.text).toHaveLength(MAX_DOCUMENT_CHARS);
    expect(draft.truncated).toBe(true);
  });

  it('no trunca dentro del presupuesto', () => {
    const draft = toDocumentDraftText('demanda');
    expect(draft.text).toBe('demanda');
    expect(draft.truncated).toBe(false);
  });
});

describe('formatDocumentBlock', () => {
  it('delimita con la etiqueta de origen y marca el truncado', () => {
    const block = formatDocumentBlock('Documento PDF', 'prueba.pdf', 'texto', false);
    expect(block).toContain('## Documento PDF: prueba.pdf');
    expect(block).toContain('texto');
    expect(formatDocumentBlock('Documento Word', 'a.docx', 't', true)).toContain('[…truncado]');
  });
});
