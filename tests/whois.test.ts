import { describe, expect, test } from 'bun:test';
import { classify, getWhoisServer } from '../src/whois.ts';

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
});
