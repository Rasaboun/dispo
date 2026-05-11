import type { Availability } from './types.ts';

type StatusMapper = (httpStatus: number) => Availability;

// Default mapper: 200 = registered, 404 = available, else unknown.
// Matches IANA RDAP server requirements and is what most registries
// (including .com, .io, .dev, .fr, .ai, .is, .ch) implement today.
export const defaultMapper: StatusMapper = (status) => {
  if (status === 200) return 'registered';
  if (status === 404) return 'available';
  return 'unknown';
};

// Per-TLD overrides. Add entries here when a registry documents
// non-default semantics. Key is the lowercase TLD without leading dot.
export const TLD_OVERRIDES: Record<string, StatusMapper> = {
  // Example slot: 'tld': (status) => status === 200 ? 'available' : 'registered',
};

export function getMapper(domain: string): StatusMapper {
  const tld = domain.split('.').pop()?.toLowerCase() ?? '';
  return TLD_OVERRIDES[tld] ?? defaultMapper;
}
