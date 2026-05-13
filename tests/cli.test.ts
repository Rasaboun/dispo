import { describe, expect, test } from 'bun:test';
import { CliError, collectDomains, expandKeywords, normalizeDomain, parseArgs } from '../src/cli.ts';

describe('parseArgs', () => {
  test('domains as positional args', () => {
    const a = parseArgs(['foo.com', 'bar.io']);
    expect(a.domains).toEqual(['foo.com', 'bar.io']);
  });

  test('--json flag', () => {
    const a = parseArgs(['--json', 'foo.com']);
    expect(a.json).toBe(true);
  });

  test('--concurrency and -c parse positive int', () => {
    expect(parseArgs(['--concurrency', '16']).concurrency).toBe(16);
    expect(parseArgs(['-c', '4']).concurrency).toBe(4);
  });

  test('--timeout and -t', () => {
    expect(parseArgs(['--timeout', '5000']).timeoutMs).toBe(5000);
    expect(parseArgs(['-t', '2000']).timeoutMs).toBe(2000);
  });

  test('--file and -f', () => {
    expect(parseArgs(['--file', 'list.txt']).file).toBe('list.txt');
    expect(parseArgs(['-f', 'list.txt']).file).toBe('list.txt');
  });

  test('rejects unknown flag', () => {
    expect(() => parseArgs(['--bogus'])).toThrow(CliError);
  });

  test('rejects non-positive concurrency', () => {
    expect(() => parseArgs(['-c', '0'])).toThrow(CliError);
    expect(() => parseArgs(['-c', 'abc'])).toThrow(CliError);
  });

  test('missing flag value', () => {
    expect(() => parseArgs(['-c'])).toThrow(CliError);
  });

  test('--tlds and -T parse comma-separated list', () => {
    expect(parseArgs(['--tlds', 'com,io,net']).tlds).toEqual(['com', 'io', 'net']);
    expect(parseArgs(['-T', 'org,dev']).tlds).toEqual(['org', 'dev']);
  });

  test('--tlds trims spaces and lowercases', () => {
    expect(parseArgs(['--tlds', ' COM , IO ']).tlds).toEqual(['com', 'io']);
  });

  test('--version and -v', () => {
    expect(parseArgs(['--version']).version).toBe(true);
    expect(parseArgs(['-v']).version).toBe(true);
  });
});

describe('normalizeDomain', () => {
  test('lowercases', () => {
    expect(normalizeDomain('FOO.COM')).toBe('foo.com');
  });

  test('strips protocol and path', () => {
    expect(normalizeDomain('https://foo.com/path?x=1')).toBe('foo.com');
  });

  test('rejects non-domain input', () => {
    expect(normalizeDomain('not a domain')).toBeNull();
    expect(normalizeDomain('')).toBeNull();
    expect(normalizeDomain('foo')).toBeNull();
  });

  test('accepts hyphens but not leading hyphen', () => {
    expect(normalizeDomain('foo-bar.com')).toBe('foo-bar.com');
    expect(normalizeDomain('-foo.com')).toBeNull();
  });
});

describe('collectDomains', () => {
  test('merges args + file + stdin and dedupes', () => {
    const r = collectDomains(
      { domains: ['a.com', 'b.io'], json: false, concurrency: 8, timeoutMs: 1000, help: false, version: false },
      'b.io\nc.dev\n',
      'd.fr\na.com\n',
    );
    expect(r.valid).toEqual(['a.com', 'b.io', 'c.dev', 'd.fr']);
  });

  test('reports invalid inputs', () => {
    const r = collectDomains(
      { domains: ['ok.com', 'bad'], json: false, concurrency: 8, timeoutMs: 1000, help: false, version: false },
      undefined,
      undefined,
    );
    expect(r.valid).toEqual(['ok.com']);
    expect(r.invalid).toEqual(['bad']);
  });
});

describe('expandKeywords', () => {
  test('expands keyword × tlds', () => {
    expect(expandKeywords(['myproject'], ['com', 'io'])).toEqual(['myproject.com', 'myproject.io']);
  });

  test('expands multiple keywords', () => {
    expect(expandKeywords(['foo', 'bar'], ['com', 'dev'])).toEqual([
      'foo.com', 'foo.dev', 'bar.com', 'bar.dev',
    ]);
  });

  test('dedupes combinations', () => {
    expect(expandKeywords(['foo', 'foo'], ['com', 'com'])).toEqual(['foo.com']);
  });

  test('lowercases and trims', () => {
    expect(expandKeywords(['FOO '], ['COM'])).toEqual(['foo.com']);
  });

  test('skips empty keywords', () => {
    expect(expandKeywords(['foo', '', 'bar'], ['com'])).toEqual(['foo.com', 'bar.com']);
  });
});
