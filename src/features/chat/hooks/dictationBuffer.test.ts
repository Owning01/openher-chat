import { describe, expect, it } from 'vitest';

import { appendWebFinal, combineDisplay, mergeNativePartial } from './dictationBuffer';

describe('appendWebFinal', () => {
  it('acumula segmentos con un espacio y nunca recorta', () => {
    let buffer = 'hola';
    buffer = appendWebFinal(buffer, 'mundo');
    expect(buffer).toBe('hola mundo');
    buffer = appendWebFinal(buffer, '  ');
    expect(buffer).toBe('hola mundo');
  });

  it('no duplica un final ya contenido al final', () => {
    expect(appendWebFinal('hola mundo', 'mundo')).toBe('hola mundo');
  });
});

describe('combineDisplay', () => {
  it('concatena finales + interim', () => {
    expect(combineDisplay('hola', 'mundo')).toBe('hola mundo');
    expect(combineDisplay('', 'mundo')).toBe('mundo');
    expect(combineDisplay('hola', '  ')).toBe('hola');
  });
});

describe('mergeNativePartial', () => {
  it('nunca borra el encabezado ya consolidado', () => {
    expect(mergeNativePartial('Frase uno.', 10, 'frase dos')).toBe('Frase uno. frase dos');
  });

  it('reescribe solo la cola de la utterance (no duplica)', () => {
    expect(mergeNativePartial('hola mun', 0, 'hola mundo')).toBe('hola mundo');
  });

  it('tolera el final sobre el parcial ("Hola mundo." sobre "hola mundo")', () => {
    expect(mergeNativePartial('Hola mundo', 0, 'Hola mundo.')).toBe('Hola mundo.');
  });

  it('ignora un parcial vacío y jamás encoge el buffer', () => {
    const prev = 'texto escrito por el usuario, dictado acumulado';
    expect(mergeNativePartial(prev, 20, '   ')).toBe(prev);
    expect(mergeNativePartial(prev, 0, 'texto').length).toBeGreaterThanOrEqual(prev.length - 1);
  });

  it('extiende el encabezado con la base de la utterance', () => {
    // base=11 ("Frase uno. ") + nueva frase
    expect(mergeNativePartial('Frase uno. nuev', 11, 'nueva frase')).toBe('Frase uno. nueva frase');
  });
});
