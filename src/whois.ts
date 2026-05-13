import { Socket } from 'node:net';
import type { Availability } from './types.ts';

const WHOIS_PORT = 43;
const IANA_HOST = 'whois.iana.org';
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_RETRY_DELAY_MS = 250;
const MAX_WHOIS_ATTEMPTS = 2;

type WhoisQuery = (host: string, query: string, timeoutMs: number) => Promise<string>;
type Delay = (ms: number) => Promise<void>;

// In-memory cache for TLD → WHOIS server. Values are promises so concurrent
// lookups for the same TLD share the same IANA referral request.
let tldServerCache = new Map<string, Promise<string | null>>();
let serverQueues = new Map<string, Promise<void>>();

export interface WhoisResult {
  status: Availability;
  raw: string;
  server: string | null;
  error?: string;
}

export interface WhoisCheckOptions {
  queryImpl?: WhoisQuery;
  delayImpl?: Delay;
  retryDelayMs?: number;
}

export async function whoisCheck(
  domain: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
  opts: WhoisCheckOptions = {},
): Promise<WhoisResult> {
  const {
    queryImpl = whoisQuery,
    delayImpl = delay,
    retryDelayMs = DEFAULT_RETRY_DELAY_MS,
  } = opts;
  const tld = domain.split('.').pop()?.toLowerCase() ?? '';
  if (!tld) return { status: 'unknown', raw: '', server: null, error: 'no TLD' };

  let server: string | null;
  try {
    server = await getWhoisServer(tld, timeoutMs, queryImpl);
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

  try {
    for (let attempt = 1; attempt <= MAX_WHOIS_ATTEMPTS; attempt++) {
      const raw = await withWhoisServerQueue(server, () => queryImpl(server, domain, timeoutMs));
      const status = classify(raw);

      if (status !== 'unknown' || attempt === MAX_WHOIS_ATTEMPTS) {
        return { status, raw, server };
      }

      await delayImpl(retryDelayMs);
    }
  } catch (e) {
    return { status: 'unknown', raw: '', server, error: `WHOIS query failed: ${msgOf(e)}` };
  }

  return { status: 'unknown', raw: '', server };
}

function msgOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function clearWhoisCaches(): void {
  tldServerCache = new Map<string, Promise<string | null>>();
  serverQueues = new Map<string, Promise<void>>();
}

export async function getWhoisServer(
  tld: string,
  timeoutMs: number,
  queryImpl: WhoisQuery = whoisQuery,
): Promise<string | null> {
  const cached = tldServerCache.get(tld);
  if (cached) return cached;

  const lookup = queryImpl(IANA_HOST, tld, timeoutMs).then((raw) => {
    const match = raw.match(/^\s*refer:[ \t]*(\S+)/im) || raw.match(/^\s*whois:[ \t]*(\S+)/im);
    return match?.[1]?.toLowerCase() ?? null;
  });
  tldServerCache.set(tld, lookup);
  lookup.catch(() => {
    if (tldServerCache.get(tld) === lookup) tldServerCache.delete(tld);
  });
  return lookup;
}

async function withWhoisServerQueue<T>(server: string, task: () => Promise<T>): Promise<T> {
  const previous = serverQueues.get(server) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(task);
  const release = current
    .then(() => undefined, () => undefined)
    .finally(() => {
      if (serverQueues.get(server) === release) serverQueues.delete(server);
    });
  serverQueues.set(server, release);
  return current;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  /\bcurrently available for application\b/i,
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
