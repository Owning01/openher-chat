/**
 * Tool `load_skill`: el modelo pide una skill guardada por su nombre y recibe
 * el Markdown completo para seguir esas instrucciones. El listado (nombre +
 * descripción) viaja en el system prompt; el cuerpo se carga sólo cuando hace
 * falta, así los prompts no se inflan con skills que el turno no usa.
 */
import { findSkillByName } from '@/domain/skills/skillName';
import type { Skill } from '@/domain/types/skill';
import type { ToolResult } from '@/domain/types/chat';
import type { ToolDefinition } from '@/domain/types/tools';

export const LOAD_SKILL_TOOL_NAME = 'load_skill';
const LOAD_SKILL_TIMEOUT_MS = 5_000;
const LOAD_SKILL_MAX_RESULT_CHARS = 16_000;

export interface LoadSkillDeps {
  skills: readonly Skill[];
  now?: () => number;
}

function readString(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed === '' ? null : trimmed;
}

/** Recorta el cuerpo al cap del tool sin romper el Markdown por la mitad de un carácter. */
function truncate(text: string): string {
  if (text.length <= LOAD_SKILL_MAX_RESULT_CHARS) return text;
  return `${text.slice(0, LOAD_SKILL_MAX_RESULT_CHARS)}\n[…recortado]`;
}

export function createLoadSkillTool(deps: LoadSkillDeps): ToolDefinition {
  const now = deps.now ?? Date.now;

  return {
    name: LOAD_SKILL_TOOL_NAME,
    description:
      'Load the full instructions of a saved skill by name. The available skills are listed in the system prompt; when the user request matches one of them, call this tool BEFORE starting the task and then follow the returned instructions.',
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Skill name exactly as listed in the system prompt (case and dashes are forgiving).',
        },
      },
      required: ['name'],
    },
    timeoutMs: LOAD_SKILL_TIMEOUT_MS,
    maxResultChars: LOAD_SKILL_MAX_RESULT_CHARS,
    async execute(args): Promise<ToolResult> {
      const startedAt = now();
      const fail = (message: string): ToolResult => ({
        ok: false,
        content: message,
        error: { code: 'invalid_args', message },
        durationMs: Math.max(0, now() - startedAt),
      });

      const requested = readString(args.name);
      if (requested === null) {
        return fail('The "name" argument is required and must be a non-empty string.');
      }

      const skill = findSkillByName(deps.skills, requested);
      if (skill === null) {
        const available = deps.skills.map((entry) => entry.name).join(', ');
        return fail(`Unknown skill "${requested}". Available skills: ${available}.`);
      }

      const body = skill.body.trim();
      return {
        ok: true,
        content: body === '' ? `The skill "${skill.name}" has no content yet.` : truncate(skill.body),
        provider: 'skills',
        durationMs: Math.max(0, now() - startedAt),
      };
    },
  };
}
