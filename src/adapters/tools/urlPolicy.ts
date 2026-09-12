/**
 * SSRF guard for web tools. Only `http`/`https` URLs, no embedded credentials and
 * no literal loopback/private/link-local hosts. DNS is intentionally NOT resolved:
 * a domain that maps to a private IP still passes this filter (documented
 * limitation), which is why every redirect hop must be revalidated.
 */

export type UrlPolicyVerdict = { ok: true } | { ok: false; reason: string };

/** Maximum number of redirects a tool fetch may follow, revalidating each hop. */
export const MAX_REDIRECTS = 5;

type Ipv4 = [number, number, number, number];

export function isUrlAllowed(rawUrl: string): UrlPolicyVerdict {
  if (typeof rawUrl !== 'string' || rawUrl.trim() === '') return deny('invalid URL');

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return deny('invalid URL');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return deny(`unsupported scheme "${parsed.protocol.replace(/:$/, '')}" (only http and https are allowed)`);
  }
  if (parsed.username !== '' || parsed.password !== '') return deny('URL credentials are not allowed');

  const host = normalizeHostname(parsed.hostname);
  if (host === '') return deny('missing host');
  if (isLocalhost(host)) return deny(`blocked host "${host}" (localhost)`);

  const ipv4 = parseIpv4(host);
  if (ipv4 !== null) {
    const category = ipv4Category(ipv4);
    return category === null ? { ok: true } : deny(`blocked host "${host}" (${category})`);
  }
  if (host.includes(':')) {
    const ipv6 = parseIpv6Value(host);
    if (ipv6 === null) return deny(`invalid host "${host}"`);
    const category = ipv6Category(ipv6);
    return category === null ? { ok: true } : deny(`blocked host "${host}" (${category})`);
  }
  return { ok: true };
}

/**
 * Revalidates a single redirect hop. Returns a failed verdict including the
 * origin when the destination is blocked by the same policy.
 */
export function assertRedirectAllowed(from: string, to: string): UrlPolicyVerdict {
  const verdict = isUrlAllowed(to);
  if (verdict.ok) return verdict;
  return { ok: false, reason: `redirect from "${from}" to "${to}" rejected: ${verdict.reason}` };
}

function deny(reason: string): UrlPolicyVerdict {
  return { ok: false, reason };
}

function normalizeHostname(hostname: string): string {
  let host = hostname.toLowerCase();
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  while (host.endsWith('.')) host = host.slice(0, -1);
  return host;
}

function isLocalhost(host: string): boolean {
  return host === 'localhost' || host.endsWith('.localhost');
}

function parseIpv4(host: string): Ipv4 | null {
  const parts = host.split('.');
  if (parts.length !== 4) return null;
  const values: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const value = Number.parseInt(part, 10);
    if (value > 255) return null;
    values.push(value);
  }
  const [a, b, c, d] = values;
  if (a === undefined || b === undefined || c === undefined || d === undefined) return null;
  return [a, b, c, d];
}

function ipv4Category([a, b, c]: Ipv4): string | null {
  if (a === 0) return 'unspecified address';
  if (a === 10) return 'private network';
  if (a === 100 && b >= 64 && b <= 127) return 'carrier-grade NAT';
  if (a === 127) return 'loopback';
  if (a === 169 && b === 254) return 'link-local';
  if (a === 172 && b >= 16 && b <= 31) return 'private network';
  if (a === 192 && b === 168) return 'private network';
  if (a === 192 && b === 0 && c === 0) return 'IETF reserved';
  if (a === 192 && b === 0 && c === 2) return 'documentation';
  if (a === 198 && (b === 18 || b === 19)) return 'benchmarking';
  if (a === 198 && b === 51 && c === 100) return 'documentation';
  if (a === 203 && b === 0 && c === 113) return 'documentation';
  if (a >= 224) return 'multicast/reserved';
  return null;
}

function parseIpv6Value(host: string): bigint | null {
  const halves = host.split('::');
  if (halves.length > 2) return null;
  const head = splitIpv6Groups(halves[0] ?? '');
  const tail = halves.length === 2 ? splitIpv6Groups(halves[1] ?? '') : [];
  if (head === null || tail === null) return null;
  if (halves.length === 1 && head.length !== 8) return null;
  if (halves.length === 2 && head.length + tail.length > 7) return null;
  const groups = [...head, ...new Array<number>(8 - head.length - tail.length).fill(0), ...tail];
  let value = 0n;
  for (const group of groups) value = (value << 16n) | BigInt(group);
  return value;
}

function splitIpv6Groups(side: string): number[] | null {
  if (side === '') return [];
  const groups: number[] = [];
  for (const part of side.split(':')) {
    if (!/^[0-9a-f]{1,4}$/.test(part)) return null;
    groups.push(Number.parseInt(part, 16));
  }
  return groups;
}

function ipv6Category(value: bigint): string | null {
  if (value === 0n) return 'unspecified address';
  if (value === 1n) return 'loopback';
  if (value >> 118n === 0x3fan) return 'link-local';
  if (value >> 121n === 0x7en) return 'unique local';
  if (value >> 120n === 0xffn) return 'multicast';
  if (value >> 96n === 0x0064ff9bn) return 'IPv4-embedded (NAT64)';
  const high = value >> 32n;
  if (high === 0n || high === 0xffffn) {
    const embedded = value & 0xffffffffn;
    const octets: Ipv4 = [
      Number((embedded >> 24n) & 0xffn),
      Number((embedded >> 16n) & 0xffn),
      Number((embedded >> 8n) & 0xffn),
      Number(embedded & 0xffn),
    ];
    return ipv4Category(octets);
  }
  return null;
}
