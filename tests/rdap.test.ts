import { describe, expect, test } from 'bun:test';
import { checkDomain } from '../src/rdap.ts';
import type { WhoisResult } from '../src/whois.ts';

function fakeFetch(status: number, finalUrl = 'https://rdap.verisign.com/com/v1/domain/example.com'): typeof fetch {
  return (async () => {
    const r = new Response(null, { status });
    Object.defineProperty(r, 'url', { value: finalUrl });
    return r;
  }) as unknown as typeof fetch;
}

function rejectingFetch(err: Error): typeof fetch {
  return (async () => {
    throw err;
  }) as unknown as typeof fetch;
}

function timeoutFetch(): typeof fetch {
  return (async (_url: unknown, init?: RequestInit) => {
    await new Promise((_, reject) => {
      init?.signal?.addEventListener('abort', () =>
        reject(new DOMException('aborted', 'AbortError')),
      );
    });
    return new Response();
  }) as unknown as typeof fetch;
}

const noFallback = { whoisFallback: false } as const;
const fakeWhois = (result: WhoisResult) => async () => result;

describe('checkDomain (RDAP only)', () => {
  test('200 → registered via RDAP', async () => {
    const r = await checkDomain('example.com', { fetchImpl: fakeFetch(200), ...noFallback });
    expect(r.status).toBe('registered');
    expect(r.source).toBe('rdap');
  });

  test('404 from registry → available via RDAP', async () => {
    const r = await checkDomain('zzz-nope.com', { fetchImpl: fakeFetch(404), ...noFallback });
    expect(r.status).toBe('available');
    expect(r.source).toBe('rdap');
  });

  test('500 from registry → unknown (no fallback)', async () => {
    const r = await checkDomain('example.com', { fetchImpl: fakeFetch(500), ...noFallback });
    expect(r.status).toBe('unknown');
  });

  test('404 from bootstrap (TLD lacks RDAP) → unknown', async () => {
    const r = await checkDomain('foo.io', {
      fetchImpl: fakeFetch(404, 'https://rdap.org/domain/foo.io'),
      ...noFallback,
    });
    expect(r.status).toBe('unknown');
    expect(r.error).toContain('no RDAP service');
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
      fetchImpl: fakeFetch(404, 'https://rdap.org/domain/foo.io'),
      whoisImpl: fakeWhois({ status: 'registered', raw: 'Registrar: x', server: 'whois.nic.io' }),
    });
    expect(r.status).toBe('registered');
    expect(r.source).toBe('whois');
    expect(r.whoisServer).toBe('whois.nic.io');
  });

  test('WHOIS reports available', async () => {
    const r = await checkDomain('zzz-not-real.io', {
      fetchImpl: fakeFetch(404, 'https://rdap.org/domain/zzz-not-real.io'),
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
      fetchImpl: fakeFetch(404),
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
