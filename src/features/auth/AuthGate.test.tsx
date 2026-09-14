import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { AuthUser } from '@/domain/ports/AuthPort';
import { setLocale, t } from '@/i18n';
import { MemoryAuth } from '@/test/fakes/MemoryAuth';

import { AuthGate, useAuthUser } from './AuthGate';

const USER: AuthUser = { uid: 'u1', email: 'abogado@estudio.com', displayName: null, photoUrl: null };

beforeEach(() => {
  localStorage.clear();
  setLocale('es');
  window.location.hash = '';
});

afterEach(() => {
  cleanup();
  setLocale('es');
});

function Child(): React.ReactElement {
  const user = useAuthUser();
  return <div data-testid="child">{user?.email ?? 'sin-sesion'}</div>;
}

describe('AuthGate', () => {
  it('muestra la portada cuando no hay sesión y la ruta no es login', async () => {
    render(
      <AuthGate auth={new MemoryAuth()}>
        <div>APP</div>
      </AuthGate>,
    );

    expect(await screen.findByText(t('auth.landingTitle'))).toBeInTheDocument();
    expect(screen.queryByText(t('auth.title'))).not.toBeInTheDocument();
    expect(screen.queryByText('APP')).not.toBeInTheDocument();
  });

  it('muestra el login cuando no hay sesión en #/login', async () => {
    window.location.hash = '#/login';
    render(
      <AuthGate auth={new MemoryAuth()}>
        <div>APP</div>
      </AuthGate>,
    );

    expect(await screen.findByText(t('auth.title'))).toBeInTheDocument();
    expect(screen.queryByText(t('auth.landingTitle'))).not.toBeInTheDocument();
    expect(screen.queryByText('APP')).not.toBeInTheDocument();
  });

  it('monta la app y expone el usuario cuando hay sesión', async () => {
    render(
      <AuthGate auth={new MemoryAuth({ user: USER })}>
        <Child />
      </AuthGate>,
    );

    expect(await screen.findByTestId('child')).toHaveTextContent('abogado@estudio.com');
  });

  it('reacciona al cerrar sesión y al volver a entrar', async () => {
    const auth = new MemoryAuth({ user: USER });
    render(
      <AuthGate auth={auth}>
        <div>APP</div>
      </AuthGate>,
    );

    expect(await screen.findByText('APP')).toBeInTheDocument();

    auth.setUser(null);
    expect(await screen.findByText(t('auth.landingTitle'))).toBeInTheDocument();
    expect(screen.queryByText('APP')).not.toBeInTheDocument();
  });
});
