import type { Locale } from '../types/settings';

/**
 * Puerto de los comandos de OpenCode (`command/index.ts`) al caso chat:
 * `$ARGUMENTS` se sustituye por el texto tras el comando. Las plantillas van en
 * inglés porque son texto dirigido al modelo.
 */
export interface SlashCommand {
  name: string;
  description: Record<Locale, string>;
  template: string;
}

/** Comandos integrados (no requieren configuración). */
export const BUILTIN_COMMANDS: readonly SlashCommand[] = [
  {
    name: 'explain',
    description: {
      es: 'Explicar con una analogía',
      en: 'Explain with an analogy',
    },
    template: 'Explain the following in simple terms and include one concrete analogy:\n\n$ARGUMENTS',
  },
  {
    name: 'summarize',
    description: {
      es: 'Resumir en 3 puntos clave',
      en: 'Summarize in 3 key points',
    },
    template: 'Summarize the following in three key bullet points, preserving the essentials:\n\n$ARGUMENTS',
  },
  {
    name: 'translate',
    description: {
      es: 'Traducir es↔en conservando el tono',
      en: 'Translate es↔en keeping the tone',
    },
    template:
      'Translate the following text. If it is in Spanish, translate it to English; otherwise translate it to Spanish. Keep the tone and formatting:\n\n$ARGUMENTS',
  },
  {
    name: 'improve',
    description: {
      es: 'Reescribir más claro y breve',
      en: 'Rewrite clearer and shorter',
    },
    template: 'Rewrite the following to be clearer and more concise. Keep the original meaning and language:\n\n$ARGUMENTS',
  },
  {
    name: 'review',
    description: {
      es: 'Revisar en busca de errores',
      en: 'Review for bugs and edge cases',
    },
    template:
      'Review the following for bugs, edge cases and clarity. Be specific, concise and propose concrete fixes:\n\n$ARGUMENTS',
  },
  {
    name: 'outline',
    description: {
      es: 'Crear un esquema estructurado',
      en: 'Create a structured outline',
    },
    template: 'Create a structured outline for the following. Use nested bullet points:\n\n$ARGUMENTS',
  },
];

/** Placeholders de una plantilla (`$1`, `$2`… y `$ARGUMENTS`), como en OpenCode. */
export function hints(template: string): string[] {
  const result: string[] = [];
  const numbered = template.match(/\$\d+/g);
  if (numbered !== null) {
    for (const match of [...new Set(numbered)].sort()) result.push(match);
  }
  if (template.includes('$ARGUMENTS')) result.push('$ARGUMENTS');
  return result;
}

export function findCommand(name: string, commands: readonly SlashCommand[] = BUILTIN_COMMANDS): SlashCommand | undefined {
  const normalized = name.toLowerCase();
  return commands.find((command) => command.name === normalized);
}

/** Comandos cuyo nombre encaja con lo que se está tecleando tras `/`. */
export function matchCommands(query: string, commands: readonly SlashCommand[] = BUILTIN_COMMANDS): SlashCommand[] {
  const normalized = query.trim().toLowerCase();
  if (normalized === '') return [...commands];
  return commands.filter((command) => command.name.includes(normalized));
}

export interface ParsedSlashInput {
  name: string;
  args: string;
}

/** Detecta `/nombre args…`; `null` si el borrador no es un comando. */
export function parseSlashInput(input: string): ParsedSlashInput | null {
  const trimmed = input.trimStart();
  if (!trimmed.startsWith('/')) return null;
  const match = /^\/([a-z0-9-]+)\s*([\s\S]*)$/i.exec(trimmed);
  if (match === null) return null;
  return { name: (match[1] ?? '').toLowerCase(), args: (match[2] ?? '').trim() };
}

/** Sustituye `$ARGUMENTS`; si la plantilla no lo usa, adjunta los args al final. */
export function expandCommand(command: SlashCommand, args: string): string {
  if (command.template.includes('$ARGUMENTS')) return command.template.split('$ARGUMENTS').join(args.trim());
  return args.trim() === '' ? command.template : `${command.template}\n\n${args.trim()}`;
}

/** Expande un borrador `/nombre args` si corresponde a un comando conocido. */
export function expandSlashInput(input: string, commands: readonly SlashCommand[] = BUILTIN_COMMANDS): string {
  const parsed = parseSlashInput(input);
  if (parsed === null) return input.trim();
  const command = findCommand(parsed.name, commands);
  return command === undefined ? input.trim() : expandCommand(command, parsed.args);
}
