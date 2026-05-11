# domain-check

CLI to check domain availability without a paid API. RDAP first, WHOIS fallback when RDAP is unavailable for the TLD.

## Install

```sh
bun install
chmod +x bin/domain-check.ts
```

Optional global symlink:

```sh
bun link
```

## Usage

```sh
bun run bin/domain-check.ts google.com openai.io anthropic.fr
echo "foo.com\nbar.io" | bun run bin/domain-check.ts
bun run bin/domain-check.ts --file domains.txt
bun run bin/domain-check.ts --json google.com openai.io
bun run bin/domain-check.ts --concurrency 16 --timeout 8000 google.com
```

### Output

Table by default:

```
DOMAIN                STATUS      SOURCE  TIME
--------------------  ----------  ------  ----
google.com            registered  rdap    83ms
openai.io             registered  whois   893ms
zzz-nope-xyz.io       available   whois   890ms
```

`--json` returns an array of `{ domain, status, source, httpStatus?, whoisServer?, error?, durationMs }`.

### Status values

- `registered` — domain exists
- `available` — domain not registered
- `unknown` — neither RDAP nor WHOIS could classify confidently

### Exit codes

- `0` — every domain resolved (registered or available)
- `1` — argument / file error
- `2` — at least one `unknown`

## How it works

1. **RDAP**: GET `https://rdap.org/domain/{domain}` with `accept: application/rdap+json`. If the bootstrap redirects to a registry endpoint, the HTTP code is authoritative (`200`=registered, `404`=available).
2. **WHOIS fallback**: When the TLD has no RDAP service (rdap.org returns 4xx without redirecting) or RDAP errors out, the CLI opens a TCP socket to `whois.iana.org:43`, follows the `refer:` referral to the TLD's WHOIS server, and classifies the response by matching common "no match" / "Domain Name:" patterns.

Per-TLD overrides for non-default RDAP semantics live in `src/tld-overrides.ts` (empty today — current major registries follow the default rule).

## Tests

```sh
bun test
bunx tsc --noEmit
```

Network calls are mocked; tests run offline.
