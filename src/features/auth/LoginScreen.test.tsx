import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { setLocale, t } from '@/i18n';
import { MemoryAuth } from '@/test/fakes/MemoryAuth';

import { LoginScreen } from './LoginScreen';

beforeEach(() => {
  localStorage.clear();
  setLocale('es');
});

afterEach(() => {
  cleanup();
  setLocale('es');
});

function fill(email: string, password: string): void {
  fireEvent.change(screen.getByLabelText(t('auth.emailLabel')), { target: { value: email } });
  fireEvent.change(screen.getByLabelText(t('auth.passwordLabel')), { target: { value: password } });
}

describe('LoginScreen', () => {
  it('ingresa con correo y contraseña', async () => {
    const auth = new MemoryAuth();
    render(<LoginScreen auth={auth} />);

    fill('abogado@estudio.com', 'secreta1');
    fireEvent.click(screen.getByRole('button', { name: t('auth.signIn') }));

    await waitFor(() => expect(auth.calls).toContain('signInWithEmail'));
  });

  it('exige los dos campos antes de llamar al backend', () => {
    const auth = new MemoryAuth();
    render(<LoginScreen auth={auth} />);

    fireEvent.click(screen.getByRole('button', { name: t('auth.signIn') }));

    expect(screen.getByText(t('auth.missingFields'))).toBeInTheDocument();
    expect(auth.calls).toHaveLength(0);
  });

  it('muestra el error traducido y no el código crudo de Firebase', async () => {
    const auth = new MemoryAuth({ failWith: 'invalid-credential' });
    render(<LoginScreen auth={auth} />);

    fill('abogado@estudio.com', 'mala');
    fireEvent.click(screen.getByRole('button', { name: t('auth.signIn') }));

    expect(await screen.findByText(t('auth.errorInvalidCredential'))).toBeInTheDocument();
  });

  it('permite crear cuenta', async () => {
    const auth = new MemoryAuth();
    render(<LoginScreen auth={auth} />);

    fireEvent.click(screen.getByRole('button', { name: t('auth.switchToSignUp') }));
    fill('nuevo@estudio.com', 'secreta1');
    fireEvent.click(screen.getByRole('button', { name: t('auth.signUp') }));

    await waitFor(() => expect(auth.calls).toContain('signUpWithEmail'));
  });

  it('envía el correo de restablecimiento', async () => {
    const auth = new MemoryAuth();
    render(<LoginScreen auth={auth} />);

    fireEvent.change(screen.getByLabelText(t('auth.emailLabel')), { target: { value: 'abogado@estudio.com' } });
    fireEvent.click(screen.getByRole('button', { name: t('auth.forgot') }));

    await waitFor(() => expect(auth.calls).toContain('sendPasswordReset'));
    expect(await screen.findByText(t('auth.resetSent'))).toBeInTheDocument();
  });

  it('ofrece Google', async () => {
    const auth = new MemoryAuth();
    render(<LoginScreen auth={auth} />);

    fireEvent.click(screen.getByRole('button', { name: t('auth.google') }));

    await waitFor(() => expect(auth.calls).toContain('signInWithGoogle'));
  });

  it('explica que Google nativo no está disponible', async () => {
    const auth = new MemoryAuth({ failWith: 'operation-not-allowed' });
    render(<LoginScreen auth={auth} />);

    fireEvent.click(screen.getByRole('button', { name: t('auth.google') }));

    expect(await screen.findByText(t('auth.errorOperationNotAllowed'))).toBeInTheDocument();
  });
});
