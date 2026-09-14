import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';

import { useMediaQuery } from '@/shared/hooks/useMediaQuery';
import { ToastViewport } from '@/shared/ui';
import { cn } from '@/shared/utils/cn';

import { MobileDrawer } from './MobileDrawer';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';

export interface AppShellProps {
  children: ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const isDesktop = useMediaQuery('(min-width: 1024px)');
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);
  const openDrawer = useCallback(() => setDrawerOpen(true), []);

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background pt-[var(--safe-area-inset-top)] pb-[var(--safe-area-inset-bottom)] text-text">
      {isDesktop ? <Sidebar className="fixed inset-y-0 left-0 z-30" /> : null}
      <div className={cn('flex min-h-0 flex-1 flex-col', isDesktop && 'lg:pl-72')}>
        <TopBar onOpenMenu={openDrawer} />
        <main className="flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</main>
      </div>
      {isDesktop ? null : <MobileDrawer open={drawerOpen} onClose={closeDrawer} />}
      <ToastViewport />
    </div>
  );
}
