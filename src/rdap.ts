import type { CheckOptions, DomainResult } from './types.ts';
import { getMapper } from './tld-overrides.ts';
import { whoisCheck } from './whois.ts';

const RDAP_BOOTSTRAP = 'https://rdap.org/domain/';
const BOOTSTRAP_HOST = 'rdap.org';

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

  try {
    const res = await fetchImpl(RDAP_BOOTSTRAP + encodeURIComponent(domain), {
      method: 'GET',
      redirect: 'follow',
      headers: { accept: 'application/rdap+json, application/json' },
      signal: controller.signal,
    });
    rdapStatus = res.status;
    const finalHost = safeHost(res.url);
    rdapReachedRegistry = finalHost !== null && finalHost !== BOOTSTRAP_HOST;

    if (rdapReachedRegistry || res.status === 200) {
      const status = getMapper(domain)(res.status);
      if (status !== 'unknown') {
        return finish({ status, source: 'rdap', httpStatus: res.status });
      }
    }
  } catch (err) {
    rdapError = err instanceof Error ? err.message : String(err);
  } finally {
    clearTimeout(timer);
  }

  if (!whoisFallback) {
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

function safeHost(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}
