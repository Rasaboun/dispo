export type Availability = 'registered' | 'available' | 'unknown';
export type Source = 'rdap' | 'whois';

export interface DomainResult {
  domain: string;
  status: Availability;
  source: Source;
  httpStatus?: number;
  whoisServer?: string;
  error?: string;
  durationMs: number;
}

export interface CheckOptions {
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  whoisFallback?: boolean;
  whoisImpl?: (domain: string, timeoutMs: number) => Promise<import('./whois.ts').WhoisResult>;
}
