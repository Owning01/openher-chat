import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';

import { useRoute } from '@/app/routing';
import type { AuthPort, AuthUser } from '@/domain/ports/AuthPort';
import { useT } from '@/i18n/useT';
import { Logo } from '@/shared/brand/Logo';
import { Spinner } from '@/shared/ui';

import { LandingPage } from './LandingPage';
import { LoginScreen } from './LoginScreen';

const AuthUserContext = createContext<AuthUser | null>(null);

/** Usuario autenticado (null si no hay sesión o si la app no usa auth). */
export function useAuthUser(): AuthUser | null {
  return useContext(AuthUserContext);
}

export interface AuthGateProps {
  auth: AuthPort;
  children: ReactNode;
}

/**
 * Puerta de sesión: espera el estado de auth; sin usuario muestra la portada
 * pública (y el login en `#/login`); sólo con sesión monta la app. Si el
 * servicio `auth` no existe, este componente no se usa (la app queda
 * local-first, como hoy).
 */
export function AuthGate({ auth, children }: AuthGateProps) {
  const t = useT();
  const route = useRoute();
  const [user, setUser] = useState<AuthUser | null | undefined>(undefined);

  useEffect(() => auth.subscribe((next) => setUser(next)), [auth]);

  if (user === undefined) {
    return (
      <main className="grid min-h-dvh place-items-center bg-background text-text">
        <div className="flex flex-col items-center gap-4">
          <Logo size={32} />
          <Spinner label={t('auth.loading')} />
        </div>
      </main>
    );
  }

  if (user === null) return route.name === 'login' ? <LoginScreen auth={auth} /> : <LandingPage />;

  return <AuthUserContext.Provider value={user}>{children}</AuthUserContext.Provider>;
}
