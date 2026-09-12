import { describe, expect, it } from 'vitest';
import { MAX_REDIRECTS, assertRedirectAllowed, isUrlAllowed } from './urlPolicy';

interface UrlCase {
  url: string;
  allowed: boolean;
  reason?: RegExp;
}

const CASES: UrlCase[] = [
  { url: 'https://example.com', allowed: true },
  { url: 'http://example.com/path?q=1#frag', allowed: true },
  { url: 'https://example.com:8443/deep/link', allowed: true },
  { url: 'https://sub.example.co.uk/', allowed: true },
  { url: 'https://8.8.8.8/', allowed: true },
  { url: 'https://[2606:4700:4700::1111]/', allowed: true },
  { url: 'http://localhost/', allowed: false, reason: /localhost/ },
  { url: 'http://localhost:8080/x', allowed: false, reason: /localhost/ },
  { url: 'http://api.localhost/', allowed: false, reason: /localhost/ },
  { url: 'http://localhost./', allowed: false, reason: /localhost/ },
  { url: 'HTTP://LOCALHOST/', allowed: false, reason: /localhost/ },
  { url: 'http://127.0.0.1/', allowed: false, reason: /loopback/ },
  { url: 'http://127.1.2.3:9000/', allowed: false, reason: /loopback/ },
  { url: 'http://2130706433/', allowed: false, reason: /loopback/ },
  { url: 'http://0x7f.0.0.1/', allowed: false, reason: /loopback/ },
  { url: 'http://0177.0.0.1/', allowed: false, reason: /loopback/ },
  { url: 'http://10.0.0.5/', allowed: false, reason: /private network/ },
  { url: 'http://172.16.0.1/', allowed: false, reason: /private network/ },
  { url: 'http://172.31.255.255/', allowed: false, reason: /private network/ },
  { url: 'http://192.168.1.10/', allowed: false, reason: /private network/ },
  { url: 'http://169.254.169.254/latest/meta-data', allowed: false, reason: /link-local/ },
  { url: 'http://0/', allowed: false, reason: /unspecified/ },
  { url: 'http://[::1]/', allowed: false, reason: /loopback/ },
  { url: 'http://[0:0:0:0:0:0:0:1]/', allowed: false, reason: /loopback/ },
  { url: 'http://[::]/', allowed: false, reason: /unspecified/ },
  { url: 'http://[fe80::1]/', allowed: false, reason: /link-local/ },
  { url: 'http://[fe80::abcd:1234]/', allowed: false, reason: /link-local/ },
  { url: 'http://[febf::1]/', allowed: false, reason: /link-local/ },
  { url: 'http://[::ffff:127.0.0.1]/', allowed: false, reason: /loopback/ },
  { url: 'http://[::ffff:7f00:1]/', allowed: false, reason: /loopback/ },
  { url: 'http://[::ffff:10.0.0.1]/', allowed: false, reason: /private network/ },
  { url: 'http://[fc00::1]/', allowed: false, reason: /unique local/ },
  { url: 'http://[ff02::1]/', allowed: false, reason: /multicast/ },
  { url: 'http://[64:ff9b::7f00:1]/', allowed: false, reason: /NAT64/ },
  { url: 'http://[64:ff9b::a00:1]/', allowed: false, reason: /NAT64/ },
  { url: 'http://[64:ff9b::c0a8:0101]/', allowed: false, reason: /NAT64/ },
  { url: 'ftp://example.com/file', allowed: false, reason: /unsupported scheme "ftp"/ },
  { url: 'file:///etc/passwd', allowed: false, reason: /unsupported scheme "file"/ },
  { url: 'javascript:alert(1)', allowed: false, reason: /unsupported scheme "javascript"/ },
  { url: 'data:text/html,hello', allowed: false, reason: /unsupported scheme "data"/ },
  { url: 'https://user:pass@example.com/', allowed: false, reason: /credentials/ },
  { url: 'https://user@example.com/', allowed: false, reason: /credentials/ },
  { url: 'not a url', allowed: false, reason: /invalid URL/ },
  { url: '', allowed: false, reason: /invalid URL/ },
];

describe('isUrlAllowed', () => {
  it.each(CASES)('$url → allowed: $allowed', ({ url, allowed, reason }) => {
    const verdict = isUrlAllowed(url);
    expect(verdict.ok).toBe(allowed);
    if (!verdict.ok && reason !== undefined) {
      expect(verdict.reason).toMatch(reason);
    }
  });

  it('permite el borde justo fuera de 172.16/12', () => {
    expect(isUrlAllowed('http://172.32.0.1/').ok).toBe(true);
    expect(isUrlAllowed('http://172.15.255.255/').ok).toBe(true);
  });

  it('normaliza puertos por defecto y fragmentos en URLs públicas', () => {
    expect(isUrlAllowed('https://example.com:443/a#b').ok).toBe(true);
    expect(isUrlAllowed('http://example.com:80/a').ok).toBe(true);
  });
});

describe('assertRedirectAllowed', () => {
  it('expone el tope de redirects', () => {
    expect(MAX_REDIRECTS).toBe(5);
  });

  it('acepta un salto público', () => {
    expect(assertRedirectAllowed('https://example.com/', 'https://cdn.example.com/asset')).toEqual({ ok: true });
  });

  it('rechaza un redirect a loopback con contexto del origen', () => {
    const verdict = assertRedirectAllowed('https://example.com/', 'http://127.0.0.1:8080/admin');
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.reason).toContain('redirect from "https://example.com/"');
      expect(verdict.reason).toMatch(/loopback/);
    }
  });

  it('rechaza un redirect a un esquema no permitido', () => {
    const verdict = assertRedirectAllowed('https://example.com/', 'file:///etc/passwd');
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toMatch(/unsupported scheme "file"/);
  });
});
