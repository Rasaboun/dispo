# dispo

[![skills.sh](https://skills.sh/b/Rasaboun/dispo)](https://skills.sh/Rasaboun/dispo)

CLI to check domain availability without a paid API. RDAP first, WHOIS fallback when RDAP is unavailable for the TLD.

## Install

### Global CLI (recommended)

```sh
bun install -g github:Rasaboun/dispo
```

Then run from anywhere:

```sh
dispo wishspot.app google.com
```

### Standalone binary (no Bun required at runtime)

```sh
bun run build          # dist/dispo for current platform
bun run build:all      # all platforms → dist/
```

Cross-compile targets: `build:mac-arm64`, `build:mac-x64`, `build:linux-arm64`, `build:linux-x64`.

Move the binary anywhere in your `$PATH`:

```sh
mv dist/dispo /usr/local/bin/dispo
```

### Run from source

```sh
bun install
bun run bin/dispo.ts google.com
```

Optional global symlink (requires Bun):

```sh
bun link
```

## Usage

```sh
dispo google.com openai.io anthropic.fr
echo "foo.com\nbar.io" | dispo
dispo --file domains.txt
dispo --json google.com openai.io
dispo --concurrency 16 --timeout 8000 google.com
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

## Claude Code skill

Install via [skills.sh](https://skills.sh/Rasaboun/dispo) so Claude automatically uses `dispo` when checking domain availability:

```sh
bunx skills add Rasaboun/dispo/skills/dispo
```

## Tests

```sh
bun test
bunx tsc --noEmit
```

Network calls are mocked; tests run offline.
