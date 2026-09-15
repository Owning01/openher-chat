import { useState } from 'react';
import type { FormEvent } from 'react';

import { AlertBanner } from '@/app/layout/AlertBanner';
import { navigate } from '@/app/routing';
import { AuthError } from '@/domain/ports/AuthPort';
import type { AuthErrorCode, AuthPort } from '@/domain/ports/AuthPort';
import type { MessageKey } from '@/i18n/types';
import { useT } from '@/i18n/useT';
import { ArrowLeft } from '@/shared/icons';
import { Logo } from '@/shared/brand/Logo';
import { Button, Input } from '@/shared/ui';

const ERROR_KEYS: Record<AuthErrorCode, MessageKey> = {
  'invalid-credential': 'auth.errorInvalidCredential',
  'invalid-email': 'auth.errorInvalidEmail',
  'user-disabled': 'auth.errorUserDisabled',
  'user-not-found': 'auth.errorUserNotFound',
  'wrong-password': 'auth.errorWrongPassword',
  'email-already-in-use': 'auth.errorEmailInUse',
  'weak-password': 'auth.errorWeakPassword',
  'too-many-requests': 'auth.errorTooManyRequests',
  'operation-not-allowed': 'auth.errorOperationNotAllowed',
  'unauthorized-domain': 'auth.errorUnauthorizedDomain',
  'popup-closed': 'auth.errorPopupClosed',
  'popup-blocked': 'auth.errorPopupBlocked',
  network: 'auth.errorNetwork',
  unknown: 'auth.errorUnknown',
};

type Mode = 'sign-in' | 'sign-up';
type Pending = 'email' | 'google' | 'reset' | null;
type ShownError = AuthErrorCode | 'missing';

export interface LoginScreenProps {
  auth: AuthPort;
}

/** Pantalla de acceso: correo/contraseña, alta de cuenta y Google. */
export function LoginScreen({ auth }: LoginScreenProps) {
  const t = useT();
  const [mode, setMode] = useState<Mode>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState<Pending>(null);
  const [error, setError] = useState<ShownError | null>(null);
  const [resetSent, setResetSent] = useState(false);

  const run = async (kind: Exclude<Pending, null>, operation: () => Promise<unknown>): Promise<void> => {
    setError(null);
    setResetSent(false);
    setPending(kind);
    try {
      await operation();
    } catch (cause) {
      setError(cause instanceof AuthError ? cause.code : 'unknown');
    } finally {
      setPending(null);
    }
  };

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const value = email.trim();
    if (value === '' || password === '') {
      setError('missing');
      return;
    }
    void run('email', () =>
      mode === 'sign-in' ? auth.signInWithEmail(value, password) : auth.signUpWithEmail(value, password),
    );
  };

  const onGoogle = (): void => {
    void run('google', () => auth.signInWithGoogle());
  };

  const onForgot = (): void => {
    const value = email.trim();
    if (value === '') {
      setError('missing');
      return;
    }
    void run('reset', async () => {
      await auth.sendPasswordReset(value);
      setResetSent(true);
    });
  };

  const busy = pending !== null;
  const errorMessage = error === null ? null : error === 'missing' ? t('auth.missingFields') : t(ERROR_KEYS[error]);

  return (
    <main className="grid min-h-dvh place-items-center bg-background px-4 py-10 text-text">
      <div className="w-full max-w-sm space-y-6">
        <div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="min-h-11 -ml-2"
            onClick={() => navigate('#/chat')}
          >
            <ArrowLeft aria-hidden="true" className="size-4" />
            {t('auth.backToHome')}
          </Button>
        </div>
        <div className="flex flex-col items-center gap-2 text-center">
          <Logo size={40} />
          <h1 className="text-lg font-semibold tracking-tight">{t('auth.title')}</h1>
          <p className="text-sm text-muted">{t('auth.subtitle')}</p>
        </div>

        {errorMessage !== null ? <AlertBanner variant="danger" title={errorMessage} /> : null}
        {resetSent ? <AlertBanner variant="info" title={t('auth.resetSent')} /> : null}

        <form className="space-y-4" onSubmit={submit} noValidate>
          <div className="space-y-1.5">
            <label htmlFor="auth-email" className="block text-sm font-medium text-text">
              {t('auth.emailLabel')}
            </label>
            <Input
              id="auth-email"
              type="email"
              autoComplete="email"
              inputMode="email"
              placeholder={t('auth.emailPlaceholder')}
              value={email}
              disabled={busy}
              invalid={error === 'missing' || error === 'invalid-email'}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="auth-password" className="block text-sm font-medium text-text">
              {t('auth.passwordLabel')}
            </label>
            <Input
              id="auth-password"
              type="password"
              autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
              placeholder={t('auth.passwordPlaceholder')}
              value={password}
              disabled={busy}
              invalid={error === 'missing'}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>

          <Button type="submit" className="w-full" loading={pending === 'email'}>
            {mode === 'sign-in' ? t('auth.signIn') : t('auth.signUp')}
          </Button>
        </form>

        <div className="space-y-3">
          <Button
            type="button"
            variant="secondary"
            className="w-full"
            loading={pending === 'google'}
            disabled={busy && pending !== 'google'}
            onClick={onGoogle}
          >
            {t('auth.google')}
          </Button>

          <div className="flex items-center justify-between gap-2 text-sm">
            <button
              type="button"
              className="rounded-md px-1 py-0.5 text-muted transition-colors hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
              disabled={busy}
              onClick={() => {
                setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in');
                setError(null);
                setResetSent(false);
              }}
            >
              {mode === 'sign-in' ? t('auth.switchToSignUp') : t('auth.switchToSignIn')}
            </button>
            <button
              type="button"
              className="rounded-md px-1 py-0.5 text-muted transition-colors hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
              disabled={busy}
              onClick={onForgot}
            >
              {pending === 'reset' ? t('auth.loading') : t('auth.forgot')}
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
