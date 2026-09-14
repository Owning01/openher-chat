import { AuthError } from '@/domain/ports/AuthPort';
import type { AuthErrorCode, AuthPort, AuthUser } from '@/domain/ports/AuthPort';

export interface MemoryAuthOptions {
  user?: AuthUser | null;
  /** Si se define, toda operación falla con ese código. */
  failWith?: AuthErrorCode;
}

/** Doble en memoria del puerto de auth para tests de UI y de gate. */
export class MemoryAuth implements AuthPort {
  readonly calls: string[] = [];
  private user: AuthUser | null;
  private failWith: AuthErrorCode | null;
  private readonly listeners = new Set<(user: AuthUser | null) => void>();

  constructor(options: MemoryAuthOptions = {}) {
    this.user = options.user ?? null;
    this.failWith = options.failWith ?? null;
  }

  setFailWith(code: AuthErrorCode | null): void {
    this.failWith = code;
  }

  setUser(user: AuthUser | null): void {
    this.user = user;
    for (const listener of this.listeners) listener(user);
  }

  currentUser(): AuthUser | null {
    return this.user;
  }

  subscribe(listener: (user: AuthUser | null) => void): () => void {
    this.listeners.add(listener);
    listener(this.user);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async signInWithEmail(email: string, _password: string): Promise<AuthUser> {
    this.guard('signInWithEmail');
    return this.complete({ uid: 'memory-user', email, displayName: null, photoUrl: null });
  }

  async signUpWithEmail(email: string, _password: string): Promise<AuthUser> {
    this.guard('signUpWithEmail');
    return this.complete({ uid: 'memory-user', email, displayName: null, photoUrl: null });
  }

  async signInWithGoogle(): Promise<AuthUser> {
    this.guard('signInWithGoogle');
    return this.complete({ uid: 'memory-google', email: 'google@example.com', displayName: 'Google User', photoUrl: null });
  }

  async sendPasswordReset(_email: string): Promise<void> {
    this.guard('sendPasswordReset');
  }

  async signOut(): Promise<void> {
    this.guard('signOut');
    this.setUser(null);
  }

  private guard(operation: string): void {
    this.calls.push(operation);
    if (this.failWith !== null) throw new AuthError(this.failWith);
  }

  private complete(user: AuthUser): AuthUser {
    this.setUser(user);
    return user;
  }
}
