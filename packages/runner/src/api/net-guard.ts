import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { isIP } from 'node:net';
import { Agent } from 'undici';

/**
 * SSRF guard (OWASP A10): API tests run on our servers, so by default they may only reach public
 * addresses. The check runs inside the connection's DNS lookup, so it also covers redirects and
 * DNS rebinding (a name that resolves to a public IP first and a private one later).
 */
export class BlockedAddressError extends Error {
  constructor(host: string, address: string) {
    super(
      `Blocked request to ${host} (${address}): private, loopback and cloud-metadata addresses are not allowed for API tests`,
    );
  }
}

const V4_BLOCKED: [number, number][] = [
  [0x00000000, 8], // 0.0.0.0/8
  [0x0a000000, 8], // 10/8
  [0x64400000, 10], // 100.64/10 carrier-grade NAT
  [0x7f000000, 8], // loopback
  [0xa9fe0000, 16], // 169.254/16 link-local + cloud metadata
  [0xac100000, 12], // 172.16/12
  [0xc0000000, 24], // 192.0.0/24
  [0xc0a80000, 16], // 192.168/16
  [0xc6120000, 15], // 198.18/15 benchmarking
  [0xe0000000, 3], // multicast + reserved (224/3)
];

function v4ToInt(ip: string) {
  return ip.split('.').reduce((a, o) => (a << 8) + Number(o), 0) >>> 0;
}

export function isPrivateAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const n = v4ToInt(address);
    return V4_BLOCKED.some(([base, bits]) => n >>> (32 - bits) === base >>> (32 - bits));
  }
  if (family === 6) {
    const a = address.toLowerCase();
    if (a === '::' || a === '::1') return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(a);
    if (mapped) return isPrivateAddress(mapped[1]!);
    return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(a.replace(/^0+/, ''));
  }
  return true; // not an IP: refuse rather than guess
}

type LookupCb = (
  err: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void;

export function guardedLookup(
  hostname: string,
  options: { all?: boolean; family?: number },
  cb: LookupCb,
) {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return cb(err, []);
    const list = addresses as LookupAddress[];
    const bad = list.find((a) => isPrivateAddress(a.address));
    if (bad) return cb(new BlockedAddressError(hostname, bad.address) as NodeJS.ErrnoException, []);
    if (options.all) return cb(null, list);
    cb(null, list[0]!.address, list[0]!.family);
  });
}

/** Dispatcher for outbound test requests. `allowPrivate` is for local development only. */
export function createDispatcher(opts: { allowPrivate: boolean; timeoutMs: number }) {
  return new Agent({
    connect: {
      timeout: opts.timeoutMs,
      ...(opts.allowPrivate ? {} : { lookup: guardedLookup as never }),
    },
    headersTimeout: opts.timeoutMs,
    bodyTimeout: opts.timeoutMs,
  } as ConstructorParameters<typeof Agent>[0]);
}

/** Literal-IP URLs never hit DNS, so check them up front too. */
export function assertAllowedUrl(url: URL, allowPrivate: boolean) {
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    throw new Error(`Only http and https URLs can be tested (got ${url.protocol})`);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!allowPrivate && isIP(host) && isPrivateAddress(host))
    throw new BlockedAddressError(host, host);
}
