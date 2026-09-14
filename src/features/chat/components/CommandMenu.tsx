import type { SlashCommand } from '@/domain/prompts/commands';
import { useLocale } from '@/i18n/useT';
import { cn } from '@/shared/utils/cn';

export interface CommandMenuProps {
  commands: readonly SlashCommand[];
  highlighted: number;
  onSelect: (command: SlashCommand) => void;
  onHighlight: (index: number) => void;
}

/** Paleta de comandos `/` mostrada sobre el composer. */
export function CommandMenu({ commands, highlighted, onSelect, onHighlight }: CommandMenuProps) {
  const locale = useLocale();
  if (commands.length === 0) return null;

  return (
    <ul
      data-testid="command-menu"
      role="listbox"
      aria-label="Comandos"
      className="absolute bottom-full left-0 z-10 mb-2 max-h-64 w-full max-w-md overflow-y-auto rounded-xl border border-border bg-surface p-1 shadow-lg"
    >
      {commands.map((command, index) => (
        <li key={command.name}>
          <button
            type="button"
            role="option"
            aria-selected={index === highlighted}
            onMouseEnter={() => onHighlight(index)}
            onMouseDown={(event) => {
              event.preventDefault();
              onSelect(command);
            }}
            className={cn(
              'flex w-full items-baseline gap-2 rounded-lg px-3 py-2 text-left',
              index === highlighted ? 'bg-surface-subtle' : 'hover:bg-surface-subtle',
            )}
          >
            <span className="font-mono text-xs font-medium text-primary">/{command.name}</span>
            <span className="min-w-0 truncate text-xs text-muted">{command.description[locale]}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
