import { describe, expect, it } from 'vitest';

import { readFirebaseConfig } from './firebaseConfig';

const FULL = {
  VITE_FIREBASE_API_KEY: 'api-key-123',
  VITE_FIREBASE_AUTH_DOMAIN: 'demo.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'demo',
  VITE_FIREBASE_APP_ID: '1:2:web:3',
  VITE_FIREBASE_STORAGE_BUCKET: 'demo.appspot.com',
  VITE_FIREBASE_MESSAGING_SENDER_ID: '123',
};

describe('readFirebaseConfig', () => {
  it('devuelve null si falta cualquier campo imprescindible', () => {
    expect(readFirebaseConfig({})).toBeNull();
    expect(readFirebaseConfig({ ...FULL, VITE_FIREBASE_APP_ID: undefined })).toBeNull();
    expect(readFirebaseConfig({ ...FULL, VITE_FIREBASE_PROJECT_ID: '   ' })).toBeNull();
    expect(readFirebaseConfig({ ...FULL, VITE_FIREBASE_AUTH_DOMAIN: 42 })).toBeNull();
  });

  it('arma la config con los imprescindibles y agrega los opcionales', () => {
    expect(
      readFirebaseConfig({
        VITE_FIREBASE_API_KEY: ' api-key-123 ',
        VITE_FIREBASE_AUTH_DOMAIN: 'demo.firebaseapp.com',
        VITE_FIREBASE_PROJECT_ID: 'demo',
        VITE_FIREBASE_APP_ID: '1:2:web:3',
      }),
    ).toEqual({
      apiKey: 'api-key-123',
      authDomain: 'demo.firebaseapp.com',
      projectId: 'demo',
      appId: '1:2:web:3',
    });

    expect(readFirebaseConfig(FULL)).toEqual({
      apiKey: 'api-key-123',
      authDomain: 'demo.firebaseapp.com',
      projectId: 'demo',
      appId: '1:2:web:3',
      storageBucket: 'demo.appspot.com',
      messagingSenderId: '123',
    });
  });

  it('omite opcionales vacíos (no los deja como cadena vacía)', () => {
    const config = readFirebaseConfig({ ...FULL, VITE_FIREBASE_STORAGE_BUCKET: '', VITE_FIREBASE_MESSAGING_SENDER_ID: ' ' });
    expect(config).not.toBeNull();
    expect(config).not.toHaveProperty('storageBucket');
    expect(config).not.toHaveProperty('messagingSenderId');
  });
});
