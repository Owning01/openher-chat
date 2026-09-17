/**
 * Lee un `SKILL.md` (formato OpenCode/Claude: frontmatter YAML opcional con
 * `name` y `description`) y devuelve los campos del formulario de skills.
 * Tolerante: sin frontmatter usa el primer título `# …` como nombre, y si no
 * hay ninguna pista deja el nombre vacío para que el usuario lo complete.
 */
export interface ParsedSkillMarkdown {
  name: string;
  description: string;
  body: string;
}

export function parseSkillMarkdown(source: string): ParsedSkillMarkdown {
  const normalized = source.replace(/^\uFEFF/, '');
  const frontmatter = readFrontmatter(normalized);
  const body = frontmatter.body.trim();

  const name = (frontmatter.fields.name ?? readHeading(body) ?? '').trim();
  const description = (frontmatter.fields.description ?? '').trim();
  return { name, description, body };
}

/** Separa el bloque `---` inicial; fuera de él no se interpreta nada. */
function readFrontmatter(source: string): { fields: Record<string, string>; body: string } {
  if (!source.startsWith('---')) return { fields: {}, body: source };
  const end = source.indexOf('\n---', 3);
  if (end === -1) return { fields: {}, body: source };
  const raw = source.slice(3, end);
  const body = source.slice(source.indexOf('\n', end + 1) + 1);
  return { fields: parseFields(raw), body };
}

/** Pares `clave: valor` de una línea; ignora comentarios y líneas sin `:`. */
function parseFields(raw: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const line of raw.split('\n')) {
    if (line.trim().startsWith('#')) continue;
    const separator = line.indexOf(':');
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line
      .slice(separator + 1)
      .trim()
      .replace(/^["']|["']$/g, '');
    if (key !== '' && value !== '') fields[key] = value;
  }
  return fields;
}

/** Primer `# título` del cuerpo, sin el `#`. */
function readHeading(body: string): string | null {
  const match = /^#\s+(.+)$/m.exec(body);
  return match === null ? null : (match[1] ?? '').trim();
}
