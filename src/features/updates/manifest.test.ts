import { describe, expect, it } from 'vitest';

import { compareVersions, isNewerVersion, parseUpdateManifest } from './manifest';

const VALID = {
  version: '1.2.0',
  versionCode: 3,
  apkUrl: 'https://github.com/Owning01/openher-chat/releases/latest/download/OpenHer-Chat.apk',
  sha256: 'abc123',
  notes: 'Mejoras',
  publishedAt: '2026-09-14T00:00:00.000Z',
};

describe('parseUpdateManifest', () => {
  it('acepta un manifiesto completo', () => {
    expect(parseUpdateManifest(VALID)).toEqual(VALID);
  });

  it('acepta el mínimo (version + apkUrl http)', () => {
    expect(parseUpdateManifest({ version: '1.0.0', apkUrl: 'http://192.168.1.15:8123/a.apk' })).toEqual({
      version: '1.0.0',
      apkUrl: 'http://192.168.1.15:8123/a.apk',
    });
  });

  it('rechaza formas inválidas', () => {
    expect(parseUpdateManifest(null)).toBeNull();
    expect(parseUpdateManifest([])).toBeNull();
    expect(parseUpdateManifest('nope')).toBeNull();
    expect(parseUpdateManifest({})).toBeNull();
    expect(parseUpdateManifest({ version: '1.0.0' })).toBeNull();
    expect(parseUpdateManifest({ version: '  ', apkUrl: 'https://x/y.apk' })).toBeNull();
    expect(parseUpdateManifest({ version: '1.0.0', apkUrl: 'ftp://x/y.apk' })).toBeNull();
    expect(parseUpdateManifest({ version: '1.0.0', apkUrl: 'no-es-url' })).toBeNull();
  });

  it('ignora opcionales mal tipados sin romper', () => {
    expect(
      parseUpdateManifest({ version: '1.0.0', apkUrl: 'https://x/y.apk', versionCode: -2, notes: 7, sha256: '' }),
    ).toEqual({ version: '1.0.0', apkUrl: 'https://x/y.apk' });
  });
});

describe('compareVersions / isNewerVersion', () => {
  it('compara por segmentos numéricos', () => {
    expect(compareVersions('1.1.0', '1.0.9')).toBe(1);
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
    expect(compareVersions('1.0', '1.0.0')).toBe(0);
    expect(compareVersions('1.10.0', '1.9.0')).toBe(1);
    expect(compareVersions('2.0.0', '10.0.0')).toBe(-1);
  });

  it('ignora sufijos no numéricos y compara segmentos extra', () => {
    expect(compareVersions('1.1.0', '1.1.0-beta')).toBe(0);
    expect(isNewerVersion('1.1.0', '1.1.0-beta')).toBe(false);
    expect(isNewerVersion('1.1.0.1', '1.1.0')).toBe(true);
  });

  it('isNewerVersion es estricto', () => {
    expect(isNewerVersion('1.0.1', '1.0.0')).toBe(true);
    expect(isNewerVersion('1.0.0', '1.0.0')).toBe(false);
    expect(isNewerVersion('0.9.9', '1.0.0')).toBe(false);
  });
});
