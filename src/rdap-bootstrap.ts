const RDAP_DNS_BOOTSTRAP = 'https://data.iana.org/rdap/dns.json';

type BootstrapMap = Map<string, string>;

let bootstrapCache = new WeakMap<typeof fetch, Promise<BootstrapMap>>();

export async function getRdapBaseUrl(
  tld: string,
  fetchImpl: typeof fetch,
  signal?: AbortSignal,
): Promise<string | null> {
  const bootstrap = await getBootstrap(fetchImpl, signal);
  return bootstrap.get(tld.toLowerCase()) ?? null;
}

export function clearRdapBootstrapCache(): void {
  bootstrapCache = new WeakMap<typeof fetch, Promise<BootstrapMap>>();
}

async function getBootstrap(fetchImpl: typeof fetch, signal?: AbortSignal): Promise<BootstrapMap> {
  const cached = bootstrapCache.get(fetchImpl);
  if (cached) return cached;

  const promise = fetchImpl(RDAP_DNS_BOOTSTRAP, {
    method: 'GET',
    headers: { accept: 'application/json' },
    signal,
  })
    .then(async (res) => {
      if (!res.ok) throw new Error(`IANA RDAP bootstrap HTTP ${res.status}`);
      return parseBootstrap(await res.json());
    });

  bootstrapCache.set(fetchImpl, promise);
  promise.catch(() => bootstrapCache.delete(fetchImpl));
  return promise;
}

function parseBootstrap(raw: unknown): BootstrapMap {
  const services = (raw as { services?: unknown }).services;
  if (!Array.isArray(services)) throw new Error('invalid IANA RDAP bootstrap data');

  const out: BootstrapMap = new Map();
  for (const service of services) {
    if (!Array.isArray(service) || service.length < 2) continue;

    const tlds = service[0];
    const urls = service[1];
    if (!Array.isArray(tlds) || !Array.isArray(urls)) continue;

    const baseUrl = selectBaseUrl(urls);
    if (!baseUrl) continue;

    for (const tld of tlds) {
      if (typeof tld !== 'string' || tld.trim() === '') continue;
      out.set(tld.trim().toLowerCase(), baseUrl);
    }
  }

  return out;
}

function selectBaseUrl(urls: unknown[]): string | null {
  const candidates = urls
    .filter((url): url is string => typeof url === 'string' && url.trim() !== '')
    .map((url) => url.trim());
  return candidates.find((url) => url.startsWith('https://')) ?? candidates[0] ?? null;
}
