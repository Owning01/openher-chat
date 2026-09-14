import { describe, expect, it } from 'vitest';

import {
  BUILTIN_COMMANDS,
  expandCommand,
  expandSlashInput,
  findCommand,
  hints,
  matchCommands,
  parseSlashInput,
} from './commands';

describe('parseSlashInput', () => {
  it('detecta nombre y argumentos', () => {
    expect(parseSlashInput('/summarize texto libre')).toEqual({ name: 'summarize', args: 'texto libre' });
    expect(parseSlashInput('  /Explain  ')).toEqual({ name: 'explain', args: '' });
  });

  it('ignora lo que no es un comando', () => {
    expect(parseSlashInput('hola')).toBeNull();
    expect(parseSlashInput('/')).toBeNull();
    expect(parseSlashInput('/nombre con espacio\nsalto')).toEqual({ name: 'nombre', args: 'con espacio\nsalto' });
  });
});

describe('matchCommands', () => {
  it('filtra por subcadena y devuelve todos con query vacía', () => {
    expect(matchCommands('').length).toBe(BUILTIN_COMMANDS.length);
    expect(matchCommands('sum').map((command) => command.name)).toEqual(['summarize']);
  });
});

describe('expandCommand', () => {
  it('sustituye $ARGUMENTS', () => {
    const command = findCommand('summarize');
    if (command === undefined) throw new Error('missing command');
    expect(expandCommand(command, 'hola mundo')).toContain('hola mundo');
    expect(expandCommand(command, 'hola mundo')).not.toContain('$ARGUMENTS');
  });

  it('adjunta los args cuando no hay placeholder', () => {
    const expanded = expandCommand({ name: 'x', description: { es: 'x', en: 'x' }, template: 'Haz algo.' }, 'extra');
    expect(expanded).toBe('Haz algo.\n\nextra');
    expect(expandCommand({ name: 'x', description: { es: 'x', en: 'x' }, template: 'Haz algo.' }, '')).toBe('Haz algo.');
  });
});

describe('expandSlashInput', () => {
  it('expande comandos conocidos y deja pasar el resto', () => {
    expect(expandSlashInput('/summarize dato')).toContain('dato');
    expect(expandSlashInput('/desconocido algo')).toBe('/desconocido algo');
    expect(expandSlashInput('  texto normal  ')).toBe('texto normal');
  });
});

describe('hints', () => {
  it('lista placeholders numerados y $ARGUMENTS', () => {
    expect(hints('$2 $1 $2 $ARGUMENTS')).toEqual(['$1', '$2', '$ARGUMENTS']);
    expect(hints('sin placeholders')).toEqual([]);
  });
});
