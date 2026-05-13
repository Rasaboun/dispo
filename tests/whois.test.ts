import { beforeEach, describe, expect, test } from 'bun:test';
import { classify, clearWhoisCaches, getWhoisServer, whoisCheck } from '../src/whois.ts';

const IANA_HOST = 'whois.iana.org';

beforeEach(() => clearWhoisCaches());

describe('classify', () => {
  test('available: "No match"', () => {
    expect(classify('No match for "FOO.IO".\n\n>>> Last update of WHOIS')).toBe('available');
  });

  test('available: "Not Found"', () => {
    expect(classify('Domain not found.\n')).toBe('available');
  });

  test('available: "No entries found"', () => {
    expect(classify('%% No entries found in the AFNIC database.')).toBe('available');
  });

  test('available: "Status: free"', () => {
    expect(classify('Status: free')).toBe('available');
  });

  test('available: Identity Digital Dropzone response', () => {
    const raw = `This domain is currently available for application via the Identity Digital Dropzone service.
>>> Last update of WHOIS database: 2026-05-13T16:08:47Z <<<`;
    expect(classify(raw)).toBe('available');
  });

  test('registered: Domain Name line', () => {
    const raw = `Domain Name: GOOGLE.COM
Registrar: MarkMonitor Inc.
Creation Date: 1997-09-15`;
    expect(classify(raw)).toBe('registered');
  });

  test('registered: Registrar line alone', () => {
    expect(classify('Registrar: GoDaddy.com, LLC')).toBe('registered');
  });

  test('registered: Name server line', () => {
    expect(classify('Name Server: NS1.EXAMPLE.COM')).toBe('registered');
  });

  test('unknown: empty', () => {
    expect(classify('')).toBe('unknown');
    expect(classify('   \n\n  ')).toBe('unknown');
  });

  test('unknown: response without known markers', () => {
    expect(classify('Whois lookup error: try later')).toBe('unknown');
  });

  test('available pattern beats registered pattern', () => {
    // Some registries include "no match" + a generic header
    const raw = `% This is the WHOIS server
% No match for ZZZ.IO`;
    expect(classify(raw)).toBe('available');
  });
});

describe('getWhoisServer', () => {
  test('does not match across lines when whois: is empty', () => {
    const raw = `whois:        \n\nstatus:       ACTIVE`;
    const match = raw.match(/^\s*refer:[ \t]*(\S+)/im) || raw.match(/^\s*whois:[ \t]*(\S+)/im);
    expect(match).toBeNull();
  });

  test('captures whois server value on same line', () => {
    const raw = `whois:        whois.nic.io\nstatus:       ACTIVE`;
    const match = raw.match(/^\s*refer:[ \t]*(\S+)/im) || raw.match(/^\s*whois:[ \t]*(\S+)/im);
    expect(match?.[1]).toBe('whois.nic.io');
  });

  test('shares in-flight IANA referral lookups for the same TLD', async () => {
    let ianaCalls = 0;
    const queryImpl = async (host: string, query: string) => {
      expect(host).toBe(IANA_HOST);
      expect(query).toBe('io');
      ianaCalls++;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return 'whois:        whois.nic.io\nstatus:       ACTIVE';
    };

    const [a, b] = await Promise.all([
      getWhoisServer('io', 1000, queryImpl),
      getWhoisServer('io', 1000, queryImpl),
    ]);

    expect(a).toBe('whois.nic.io');
    expect(b).toBe('whois.nic.io');
    expect(ianaCalls).toBe(1);
  });
});

describe('whoisCheck', () => {
  test('serializes concurrent queries to the same WHOIS server', async () => {
    let activeServerQueries = 0;
    let maxActiveServerQueries = 0;

    const queryImpl = async (host: string, query: string) => {
      if (host === IANA_HOST) return 'whois:        whois.nic.io';

      activeServerQueries++;
      maxActiveServerQueries = Math.max(maxActiveServerQueries, activeServerQueries);
      await new Promise((resolve) => setTimeout(resolve, 5));
      activeServerQueries--;

      return `Domain Name: ${query.toUpperCase()}`;
    };

    const [a, b, c] = await Promise.all([
      whoisCheck('one.io', 1000, { queryImpl }),
      whoisCheck('two.io', 1000, { queryImpl }),
      whoisCheck('three.io', 1000, { queryImpl }),
    ]);

    expect(a.status).toBe('registered');
    expect(b.status).toBe('registered');
    expect(c.status).toBe('registered');
    expect(maxActiveServerQueries).toBe(1);
  });

  test('retries an unclassifiable WHOIS response once', async () => {
    let serverCalls = 0;
    const queryImpl = async (host: string, query: string) => {
      if (host === IANA_HOST) return 'whois:        whois.nic.io';
      serverCalls++;
      return serverCalls === 1 ? '' : `Domain Name: ${query.toUpperCase()}`;
    };

    const r = await whoisCheck('mintory.io', 1000, {
      queryImpl,
      delayImpl: async () => {},
      retryDelayMs: 0,
    });

    expect(r.status).toBe('registered');
    expect(r.server).toBe('whois.nic.io');
    expect(serverCalls).toBe(2);
  });
});
