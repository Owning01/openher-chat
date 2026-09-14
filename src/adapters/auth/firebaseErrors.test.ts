import { describe, expect, it } from 'vitest';

import { toAuthErrorCode, toAuthErrorMessage } from './firebaseErrors';

describe('toAuthErrorCode', () => {
  it('mapea los códigos conocidos del SDK', () => {
    expect(toAuthErrorCode({ code: 'auth/invalid-credential' })).toBe('invalid-credential');
    expect(toAuthErrorCode({ code: 'auth/wrong-password' })).toBe('wrong-password');
    expect(toAuthErrorCode({ code: 'auth/email-already-in-use' })).toBe('email-already-in-use');
    expect(toAuthErrorCode({ code: 'auth/weak-password' })).toBe('weak-password');
    expect(toAuthErrorCode({ code: 'auth/too-many-requests' })).toBe('too-many-requests');
    expect(toAuthErrorCode({ code: 'auth/operation-not-allowed' })).toBe('operation-not-allowed');
    expect(toAuthErrorCode({ code: 'auth/unauthorized-domain' })).toBe('unauthorized-domain');
    expect(toAuthErrorCode({ code: 'auth/popup-closed-by-user' })).toBe('popup-closed');
    expect(toAuthErrorCode({ code: 'auth/popup-blocked' })).toBe('popup-blocked');
    expect(toAuthErrorCode({ code: 'auth/network-request-failed' })).toBe('network');
  });

  it('no filtra códigos desconocidos ni entradas raras', () => {
    expect(toAuthErrorCode({ code: 'auth/something-new' })).toBe('unknown');
    expect(toAuthErrorCode(null)).toBe('unknown');
    expect(toAuthErrorCode('auth/wrong-password')).toBe('unknown');
    expect(toAuthErrorCode({ code: 7 })).toBe('unknown');
  });
});

describe('toAuthErrorMessage', () => {
  it('usa el mensaje del Error cuando existe', () => {
    expect(toAuthErrorMessage(new Error('boom'))).toBe('boom');
  });

  it('cae al código crudo o a un texto genérico', () => {
    expect(toAuthErrorMessage({ code: 'auth/popup-blocked' })).toBe('auth/popup-blocked');
    expect(toAuthErrorMessage(undefined)).toBe('unknown auth error');
  });
});
