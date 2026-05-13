export interface CliArgs {
  domains: string[];
  json: boolean;
  concurrency: number;
  delayMs: number;
  timeoutMs: number;
  file?: string;
  tlds?: string[];
  help: boolean;
  version: boolean;
}

export const HELP_TEXT = `dispo - check domain availability (RDAP first, WHOIS fallback)

Usage:
  dispo [options] <domain>...
  echo "foo.com\\nbar.io" | dispo [options]
  dispo --file domains.txt [options]
  dispo --tlds com,io,net <keyword>...

Options:
  --file, -f <path>          Read newline-separated domains from a file
  --tlds, -T <list>          Comma-separated TLDs; positional args become keywords
  --json                     Output JSON instead of a table
  --concurrency, -c <n>      Max parallel lookups (default 8)
  --delay <ms>               Delay between starting lookups in ms (default 500)
  --timeout, -t <ms>         Per-request timeout in ms (default 10000)
  --version, -v              Show version
  --help, -h                 Show this help

Exit codes:
  0 - all domains resolved (registered or available)
  2 - at least one result was "unknown"
  1 - argument or file error
`;

export class CliError extends Error {}

export function parseArgs(argv: readonly string[]): CliArgs {
  const args: CliArgs = {
    domains: [],
    json: false,
    concurrency: 8,
    delayMs: 500,
    timeoutMs: 10_000,
    help: false,
    version: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    switch (a) {
      case '--help':
      case '-h':
        args.help = true;
        break;
      case '--version':
      case '-v':
        args.version = true;
        break;
      case '--json':
        args.json = true;
        break;
      case '--file':
      case '-f':
        args.file = required(argv, ++i, a);
        break;
      case '--tlds':
      case '-T':
        args.tlds = required(argv, ++i, a).split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
        break;
      case '--concurrency':
      case '-c':
        args.concurrency = parsePositiveInt(required(argv, ++i, a), a);
        break;
      case '--delay':
      case '--delay-ms':
        args.delayMs = parseNonNegativeInt(required(argv, ++i, a), a);
        break;
      case '--timeout':
      case '-t':
        args.timeoutMs = parsePositiveInt(required(argv, ++i, a), a);
        break;
      default:
        if (a.startsWith('-')) throw new CliError(`Unknown flag: ${a}`);
        args.domains.push(a);
    }
  }

  return args;
}

function required(argv: readonly string[], i: number, flag: string): string {
  const v = argv[i];
  if (v === undefined) throw new CliError(`Missing value for ${flag}`);
  return v;
}

function parseNonNegativeInt(raw: string, flag: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) {
    throw new CliError(`Expected non-negative integer for ${flag}, got: ${raw}`);
  }
  return n;
}

function parsePositiveInt(raw: string, flag: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new CliError(`Expected positive integer for ${flag}, got: ${raw}`);
  }
  return n;
}

const DOMAIN_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;

export function normalizeDomain(raw: string): string | null {
  let d = raw.trim().toLowerCase();
  if (!d) return null;
  d = d.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!DOMAIN_RE.test(d)) return null;
  return d;
}

export function collectDomains(
  args: CliArgs,
  fileContents: string | undefined,
  stdin: string | undefined,
): { valid: string[]; invalid: string[] } {
  const raw: string[] = [...args.domains];
  if (fileContents) raw.push(...fileContents.split(/\r?\n/));
  if (stdin) raw.push(...stdin.split(/\r?\n/));

  const seen = new Set<string>();
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const r of raw) {
    if (!r.trim()) continue;
    const n = normalizeDomain(r);
    if (!n) {
      invalid.push(r.trim());
      continue;
    }
    if (seen.has(n)) continue;
    seen.add(n);
    valid.push(n);
  }
  return { valid, invalid };
}

export function expandKeywords(keywords: readonly string[], tlds: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const k of keywords) {
    const base = k.trim().toLowerCase();
    if (!base) continue;
    for (const t of tlds) {
      const tld = t.trim().toLowerCase();
      if (!tld) continue;
      const d = `${base}.${tld}`;
      if (seen.has(d)) continue;
      seen.add(d);
      out.push(d);
    }
  }
  return out;
}
