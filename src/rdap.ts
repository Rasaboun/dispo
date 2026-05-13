import type { CheckOptions, DomainResult } from './types.ts';
import { getRdapBaseUrl } from './rdap-bootstrap.ts';
import { getMapper } from './tld-overrides.ts';
import { whoisCheck } from './whois.ts';

const RDAP_ORG_BOOTSTRAP = 'https://rdap.org/domain/';
const BOOTSTRAP_HOST = 'rdap.org';
const RDAP_MAX_ATTEMPTS = 3;
const RDAP_RETRY_DELAY_MS = 300;

let rdapHostQueues = new Map<string, Promise<void>>();

export function clearRdapRuntimeState(): void {
  rdapHostQueues = new Map<string, Promise<void>>();
}

export async function checkDomain(
  domain: string,
  opts: CheckOptions = {},
): Promise<DomainResult> {
  const {
    timeoutMs = 10_000,
    fetchImpl = fetch,
    whoisFallback = true,
    whoisImpl = whoisCheck,
  } = opts;
  const started = performance.now();
  const finish = (extra: Omit<DomainResult, 'domain' | 'durationMs'>): DomainResult => ({
    domain,
    durationMs: Math.round(performance.now() - started),
    ...extra,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let rdapStatus: number | undefined;
  let rdapReachedRegistry = false;
  let rdapError: string | undefined;
  let shouldTryWhois = true;

  try {
    const tld = domain.split('.').pop()?.toLowerCase() ?? '';
    const rdapBaseUrl = tld ? await getRdapBaseUrl(tld, fetchImpl, controller.signal) : null;

    if (rdapBaseUrl) {
      rdapReachedRegistry = true;
      const res = await rdapFetchWithRetry(
        fetchImpl,
        rdapUrl(rdapBaseUrl, domain),
        controller.signal,
      );
      rdapStatus = res.status;
      const status = getMapper(domain)(res.status);
      if (status !== 'unknown') {
        return finish({ status, source: 'rdap', httpStatus: res.status });
      }
      rdapError = `RDAP HTTP ${res.status}`;
      if (isTransientRdapStatus(res.status)) shouldTryWhois = false;
    } else {
      rdapError = 'no RDAP service for this TLD';
    }
  } catch (err) {
    rdapError = err instanceof Error ? err.message : String(err);
    const fallback = await tryRdapOrg(domain, fetchImpl, controller.signal);
    if (fallback) {
      rdapStatus = fallback.status;
      rdapReachedRegistry = fallback.reachedRegistry;
      rdapError = fallback.error ?? rdapError;

      if (fallback.reachedRegistry || fallback.status === 200) {
        const status = getMapper(domain)(fallback.status);
        if (status !== 'unknown') {
          return finish({ status, source: 'rdap', httpStatus: fallback.status });
        }
      }
    }
  } finally {
    clearTimeout(timer);
  }

  if (!whoisFallback || !shouldTryWhois) {
    return finish({
      status: 'unknown',
      source: 'rdap',
      httpStatus: rdapStatus,
      error: rdapError ?? (rdapReachedRegistry ? undefined : 'no RDAP service for this TLD'),
    });
  }

  const whois = await whoisImpl(domain, timeoutMs);
  return finish({
    status: whois.status,
    source: 'whois',
    httpStatus: rdapStatus,
    whoisServer: whois.server ?? undefined,
    error: whois.error,
  });
}

async function rdapFetch(
  fetchImpl: typeof fetch,
  url: string,
  signal: AbortSignal,
): Promise<Response> {
  return fetchImpl(url, {
    method: 'GET',
    redirect: 'follow',
    headers: { accept: 'application/rdap+json, application/json' },
    signal,
  });
}

async function rdapFetchWithRetry(
  fetchImpl: typeof fetch,
  url: string,
  signal: AbortSignal,
): Promise<Response> {
  let last: Response | undefined;
  for (let attempt = 1; attempt <= RDAP_MAX_ATTEMPTS; attempt++) {
    last = await withRdapHostQueue(url, () => rdapFetch(fetchImpl, url, signal));
    if (!isTransientRdapStatus(last.status) || attempt === RDAP_MAX_ATTEMPTS) return last;
    await delay(RDAP_RETRY_DELAY_MS * attempt, signal);
  }
  return last!;
}

async function withRdapHostQueue<T>(url: string, task: () => Promise<T>): Promise<T> {
  const key = rdapQueueKey(url);
  const previous = rdapHostQueues.get(key) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(task);
  const release = current
    .then(() => undefined, () => undefined)
    .finally(() => {
      if (rdapHostQueues.get(key) === release) rdapHostQueues.delete(key);
    });
  rdapHostQueues.set(key, release);
  return current;
}

function isTransientRdapStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new DOMException('aborted', 'AbortError'));
    }, { once: true });
  });
}

function rdapQueueKey(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function rdapUrl(baseUrl: string, domain: string): string {
  const sep = baseUrl.endsWith('/') ? '' : '/';
  return `${baseUrl}${sep}domain/${encodeURIComponent(domain)}`;
}

async function tryRdapOrg(
  domain: string,
  fetchImpl: typeof fetch,
  signal: AbortSignal,
): Promise<{ status: number; reachedRegistry: boolean; error?: string } | null> {
  try {
    const res = await rdapFetch(fetchImpl, RDAP_ORG_BOOTSTRAP + encodeURIComponent(domain), signal);
    const finalHost = safeHost(res.url);
    return {
      status: res.status,
      reachedRegistry: finalHost !== null && finalHost !== BOOTSTRAP_HOST,
    };
  } catch (err) {
    return null;
  }
}

function safeHost(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}
