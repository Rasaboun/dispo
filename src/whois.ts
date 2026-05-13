import { Socket } from 'node:net';
import type { Availability } from './types.ts';

const WHOIS_PORT = 43;
const IANA_HOST = 'whois.iana.org';
const DEFAULT_TIMEOUT_MS = 10_000;

// In-memory cache for TLD → whois server (IANA referrals are stable per session)
const tldServerCache = new Map<string, string | null>();

export interface WhoisResult {
  status: Availability;
  raw: string;
  server: string | null;
  error?: string;
}

export async function whoisCheck(
  domain: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<WhoisResult> {
  const tld = domain.split('.').pop()?.toLowerCase() ?? '';
  if (!tld) return { status: 'unknown', raw: '', server: null, error: 'no TLD' };

  let server: string | null;
  try {
    server = await getWhoisServer(tld, timeoutMs);
  } catch (e) {
    return {
      status: 'unknown',
      raw: '',
      server: null,
      error: `IANA lookup failed: ${msgOf(e)}`,
    };
  }

  if (!server) {
    return { status: 'unknown', raw: '', server: null, error: 'no WHOIS server for TLD' };
  }

  let raw: string;
  try {
    raw = await whoisQuery(server, domain, timeoutMs);
  } catch (e) {
    return { status: 'unknown', raw: '', server, error: `WHOIS query failed: ${msgOf(e)}` };
  }

  return { status: classify(raw), raw, server };
}

function msgOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export async function getWhoisServer(tld: string, timeoutMs: number): Promise<string | null> {
  const cached = tldServerCache.get(tld);
  if (cached !== undefined) return cached;

  const raw = await whoisQuery(IANA_HOST, tld, timeoutMs);
  const match = raw.match(/^\s*refer:[ \t]*(\S+)/im) || raw.match(/^\s*whois:[ \t]*(\S+)/im);
  const server = match?.[1]?.toLowerCase() ?? null;
  tldServerCache.set(tld, server);
  return server;
}

function whoisQuery(host: string, query: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = new Socket();
    const chunks: Buffer[] = [];
    let settled = false;

    const finish = (err: Error | null) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (err) reject(err);
      else resolve(Buffer.concat(chunks).toString('utf8'));
    };

    const timer = setTimeout(() => finish(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs);
    socket.setTimeout(timeoutMs);

    socket.on('data', (c: Buffer) => chunks.push(c));
    socket.on('end', () => {
      clearTimeout(timer);
      finish(null);
    });
    socket.on('error', (err) => {
      clearTimeout(timer);
      finish(err);
    });
    socket.on('timeout', () => {
      clearTimeout(timer);
      finish(new Error(`socket timeout after ${timeoutMs}ms`));
    });

    socket.connect(WHOIS_PORT, host, () => {
      socket.write(`${query}\r\n`);
    });
  });
}

// Patterns that indicate the domain is NOT registered. Combined from common
// registry response shapes (Verisign, IANA, ccTLD registries).
const AVAILABLE_PATTERNS: readonly RegExp[] = [
  /\bno match\b/i,
  /\bnot found\b/i,
  /\bno entries found\b/i,
  /\bno data found\b/i,
  /\bdomain (status:?\s*)?(is\s+)?available\b/i,
  /\bstatus:\s*(free|available|no object found)\b/i,
  /\bdomain not registered\b/i,
  /\bobject does not exist\b/i,
  /\bis free\b/i,
  /^\s*no\s+match\s+for/im,
];

// Patterns that indicate registration even when no obvious record sections appear.
const REGISTERED_PATTERNS: readonly RegExp[] = [
  /^\s*(domain name|domain):\s*\S+/im,
  /^\s*registrar:/im,
  /^\s*registry domain id:/im,
  /^\s*creation date:/im,
  /^\s*created\s*(on|date)?:/im,
  /^\s*name server:/im,
];

export function classify(raw: string): Availability {
  if (!raw.trim()) return 'unknown';
  for (const re of AVAILABLE_PATTERNS) if (re.test(raw)) return 'available';
  for (const re of REGISTERED_PATTERNS) if (re.test(raw)) return 'registered';
  return 'unknown';
}
