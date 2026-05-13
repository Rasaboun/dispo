import { beforeEach, describe, expect, test } from 'bun:test';
import { clearRdapBootstrapCache } from '../src/rdap-bootstrap.ts';
import { checkDomain, clearRdapRuntimeState } from '../src/rdap.ts';
import type { WhoisResult } from '../src/whois.ts';

const BOOTSTRAP_URL = 'https://data.iana.org/rdap/dns.json';
const RDAP_BASE = 'https://rdap.example.test/';

function rejectingFetch(err: Error): typeof fetch {
  return (async () => {
    throw err;
  }) as unknown as typeof fetch;
}

function timeoutFetch(): typeof fetch {
  return (async (_url: unknown, init?: RequestInit) => {
    await new Promise((_, reject) => {
      if (init?.signal?.aborted) {
        reject(new DOMException('aborted', 'AbortError'));
        return;
      }
      init?.signal?.addEventListener('abort', () =>
        reject(new DOMException('aborted', 'AbortError')),
      );
    });
    return new Response();
  }) as unknown as typeof fetch;
}

function directRdapFetch(statuses: Record<string, number>, tlds = ['com']): typeof fetch {
  return (async (url: unknown) => {
    const rawUrl = String(url);
    if (rawUrl === BOOTSTRAP_URL) {
      return jsonResponse(200, rawUrl, { services: [[tlds, [RDAP_BASE]]] });
    }

    const domain = rawUrl.split('/domain/')[1];
    if (domain) {
      return response(statuses[decodeURIComponent(domain)] ?? 500, rawUrl);
    }

    throw new Error(`unexpected URL: ${rawUrl}`);
  }) as unknown as typeof fetch;
}

function directRdapSequenceFetch(statuses: number[], tlds = ['com']): typeof fetch {
  let registryCalls = 0;
  return (async (url: unknown) => {
    const rawUrl = String(url);
    if (rawUrl === BOOTSTRAP_URL) {
      return jsonResponse(200, rawUrl, { services: [[tlds, [RDAP_BASE]]] });
    }

    const domain = rawUrl.split('/domain/')[1];
    if (domain) {
      const status = statuses[Math.min(registryCalls, statuses.length - 1)]!;
      registryCalls++;
      return response(status, rawUrl);
    }

    throw new Error(`unexpected URL: ${rawUrl}`);
  }) as unknown as typeof fetch;
}

function noRdapServiceFetch(tlds = ['com']): typeof fetch {
  return (async (url: unknown) => {
    const rawUrl = String(url);
    if (rawUrl === BOOTSTRAP_URL) {
      return jsonResponse(200, rawUrl, { services: [[tlds, [RDAP_BASE]]] });
    }
    throw new Error(`unexpected URL: ${rawUrl}`);
  }) as unknown as typeof fetch;
}

function bootstrapFailureThenRdapOrg(
  status: number,
  finalUrl = 'https://rdap.verisign.com/com/v1/domain/example.com',
): typeof fetch {
  return (async (url: unknown) => {
    const rawUrl = String(url);
    if (rawUrl === BOOTSTRAP_URL) throw new Error('bootstrap unavailable');
    if (rawUrl.startsWith('https://rdap.org/domain/')) return response(status, finalUrl);
    throw new Error(`unexpected URL: ${rawUrl}`);
  }) as unknown as typeof fetch;
}

function response(status: number, url: string): Response {
  const r = new Response(null, { status });
  Object.defineProperty(r, 'url', { value: url });
  return r;
}

function jsonResponse(status: number, url: string, body: unknown): Response {
  const r = new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
  Object.defineProperty(r, 'url', { value: url });
  return r;
}

const noFallback = { whoisFallback: false } as const;
const fakeWhois = (result: WhoisResult) => async () => result;

beforeEach(() => {
  clearRdapBootstrapCache();
  clearRdapRuntimeState();
});

describe('checkDomain (RDAP only)', () => {
  test('200 → registered via RDAP', async () => {
    const r = await checkDomain('example.com', {
      fetchImpl: directRdapFetch({ 'example.com': 200 }),
      ...noFallback,
    });
    expect(r.status).toBe('registered');
    expect(r.source).toBe('rdap');
  });

  test('404 from registry → available via RDAP', async () => {
    const r = await checkDomain('zzz-nope.com', {
      fetchImpl: directRdapFetch({ 'zzz-nope.com': 404 }),
      ...noFallback,
    });
    expect(r.status).toBe('available');
    expect(r.source).toBe('rdap');
  });

  test('500 from registry → unknown (no fallback)', async () => {
    const r = await checkDomain('example.com', {
      fetchImpl: directRdapFetch({ 'example.com': 500 }),
      ...noFallback,
    });
    expect(r.status).toBe('unknown');
  });

  test('does not fall back to WHOIS after transient registry RDAP failure', async () => {
    let whoisCalls = 0;
    const r = await checkDomain('example.com', {
      fetchImpl: directRdapSequenceFetch([429, 429, 429]),
      whoisImpl: async () => {
        whoisCalls++;
        return { status: 'registered', raw: '', server: null };
      },
    });
    expect(r.status).toBe('unknown');
    expect(r.source).toBe('rdap');
    expect(r.httpStatus).toBe(429);
    expect(r.error).toBe('RDAP HTTP 429');
    expect(whoisCalls).toBe(0);
  });

  test('retries transient registry RDAP status', async () => {
    const r = await checkDomain('example.com', {
      fetchImpl: directRdapSequenceFetch([429, 200]),
      ...noFallback,
    });
    expect(r.status).toBe('registered');
    expect(r.source).toBe('rdap');
  });

  test('TLD without bootstrap RDAP endpoint → unknown', async () => {
    const r = await checkDomain('foo.io', {
      fetchImpl: noRdapServiceFetch(['com']),
      ...noFallback,
    });
    expect(r.status).toBe('unknown');
    expect(r.error).toContain('no RDAP service');
  });

  test('bootstrap data is cached for the process', async () => {
    let bootstrapCalls = 0;
    const fetchImpl = (async (url: unknown) => {
      const rawUrl = String(url);
      if (rawUrl === BOOTSTRAP_URL) {
        bootstrapCalls++;
        return jsonResponse(200, rawUrl, { services: [[['com'], [RDAP_BASE]]] });
      }
      return response(200, rawUrl);
    }) as unknown as typeof fetch;

    await checkDomain('foo.com', { fetchImpl, ...noFallback });
    await checkDomain('bar.com', { fetchImpl, ...noFallback });

    expect(bootstrapCalls).toBe(1);
  });

  test('falls back to rdap.org when IANA bootstrap fetch fails', async () => {
    const r = await checkDomain('example.com', {
      fetchImpl: bootstrapFailureThenRdapOrg(200),
      ...noFallback,
    });
    expect(r.status).toBe('registered');
    expect(r.source).toBe('rdap');
  });

  test('timeout → unknown', async () => {
    const r = await checkDomain('example.com', {
      fetchImpl: timeoutFetch(),
      timeoutMs: 20,
      ...noFallback,
    });
    expect(r.status).toBe('unknown');
  });
});

describe('checkDomain (WHOIS fallback)', () => {
  test('falls back to WHOIS when RDAP TLD unsupported', async () => {
    const r = await checkDomain('foo.io', {
      fetchImpl: noRdapServiceFetch(['com']),
      whoisImpl: fakeWhois({ status: 'registered', raw: 'Registrar: x', server: 'whois.nic.io' }),
    });
    expect(r.status).toBe('registered');
    expect(r.source).toBe('whois');
    expect(r.whoisServer).toBe('whois.nic.io');
  });

  test('WHOIS reports available', async () => {
    const r = await checkDomain('zzz-not-real.io', {
      fetchImpl: noRdapServiceFetch(['com']),
      whoisImpl: fakeWhois({ status: 'available', raw: 'No match', server: 'whois.nic.io' }),
    });
    expect(r.status).toBe('available');
    expect(r.source).toBe('whois');
  });

  test('falls back when RDAP fetch throws', async () => {
    const r = await checkDomain('foo.io', {
      fetchImpl: rejectingFetch(new Error('ENOTFOUND')),
      whoisImpl: fakeWhois({ status: 'registered', raw: 'x', server: 'whois.nic.io' }),
    });
    expect(r.status).toBe('registered');
    expect(r.source).toBe('whois');
  });

  test('does not fall back when RDAP authoritatively answers', async () => {
    let whoisCalls = 0;
    const r = await checkDomain('foo.com', {
      fetchImpl: directRdapFetch({ 'foo.com': 404 }),
      whoisImpl: async () => {
        whoisCalls++;
        return { status: 'registered', raw: '', server: null };
      },
    });
    expect(r.status).toBe('available');
    expect(r.source).toBe('rdap');
    expect(whoisCalls).toBe(0);
  });
});
