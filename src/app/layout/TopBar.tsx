import { Monitor, Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';

import { navigate, SETTINGS_HREF, useRoute } from '@/app/routing';
import type { Route } from '@/app/routing';
import { useServices } from '@/app/services';
import type { Conversation } from '@/domain/types/conversation';
import type { ThemeMode } from '@/domain/types/settings';
import { useCreateConversation } from '@/features/conversations/hooks/useCreateConversation';
import { useConversationsStore } from '@/features/conversations/state/conversationsStore';
import { useT } from '@/i18n/useT';
import type { Translate } from '@/i18n/useT';
import { useTheme } from '@/shared/hooks/useTheme';
import { Menu, Plus, Settings } from '@/shared/icons';
import type { LucideIcon } from '@/shared/icons';
import { IconButton, useToast } from '@/shared/ui';

export interface TopBarProps {
  onOpenMenu: () => void;
}

const THEME_CYCLE: Record<ThemeMode, ThemeMode> = { light: 'dark', dark: 'system', system: 'light' };
const THEME_ICONS: Record<ThemeMode, LucideIcon> = { light: Sun, dark: Moon, system: Monitor };

export function TopBar({ onOpenMenu }: TopBarProps) {
  const t = useT();
  const route = useRoute();
  const settingsRepo = useServices().settings;
  const items = useConversationsStore((state) => state.items);
  const createConversation = useCreateConversation();
  const { push } = useToast();
  const [theme, setTheme] = useState<ThemeMode>('system');

  useTheme(theme);

  useEffect(() => {
    let active = true;
    void settingsRepo
      .load()
      .then((settings) => {
        if (active) setTheme(settings.theme);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [settingsRepo]);

  const cycleTheme = async (): Promise<void> => {
    const next = THEME_CYCLE[theme];
    setTheme(next);
    try {
      const settings = await settingsRepo.load();
      await settingsRepo.save({ ...settings, theme: next, updatedAt: Date.now() });
    } catch {
      setTheme(theme);
      push({ title: t('app.themeError'), variant: 'danger' });
    }
  };

  const routeConversation =
    route.name === 'chat' && route.conversationId !== null
      ? items.find((conversation) => conversation.id === route.conversationId)
      : undefined;
  const ThemeIcon = THEME_ICONS[theme];

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-1 border-b border-border bg-background/90 px-3 backdrop-blur">
      <IconButton
        className="lg:hidden"
        label={t('app.menu')}
        icon={<Menu aria-hidden="true" />}
        onClick={onOpenMenu}
      />
      <h1 className="min-w-0 flex-1 truncate px-1 text-sm font-semibold text-text">
        {resolveTitle(route, routeConversation, t)}
      </h1>
      <IconButton
        label={t('conversations.new')}
        icon={<Plus aria-hidden="true" />}
        onClick={() => void createConversation()}
      />
      <IconButton
        label={t('app.themeCurrent', { mode: t(`common.theme.${theme}`) })}
        icon={<ThemeIcon aria-hidden="true" />}
        onClick={() => void cycleTheme()}
      />
      <IconButton
        label={t('app.settings')}
        icon={<Settings aria-hidden="true" />}
        onClick={() => navigate(SETTINGS_HREF)}
      />
    </header>
  );
}

function resolveTitle(route: Route, conversation: Conversation | undefined, t: Translate): string {
  if (route.name === 'settings') return t('app.settingsTitle');
  if (route.conversationId === null) return t('app.title');
  if (conversation === undefined || conversation.title.trim() === '') return t('conversations.untitled');
  return conversation.title;
}
