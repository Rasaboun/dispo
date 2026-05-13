# dispo

[![skills.sh](https://skills.sh/b/Rasaboun/dispo)](https://skills.sh/Rasaboun/dispo)

CLI to check domain availability without a paid API. RDAP first, WHOIS fallback when RDAP is unavailable for the TLD.

## Install

### One-shot (no install)

```sh
npx @rasaboun/dispo google.com openai.io
bunx @rasaboun/dispo google.com openai.io
```

### Global CLI

```sh
npm install -g @rasaboun/dispo
bun install -g @rasaboun/dispo
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
dispo --concurrency 3 --timeout 8000 google.com openai.io anthropic.fr
dispo --delay 1000 --tlds com,io,dev,app wishspot placepin
dispo --tlds com,app,co,io wishspot placepin
dispo -T dev,xyz,app foo bar
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

- `registered` - domain exists
- `available` - domain not registered
- `unknown` - neither RDAP nor WHOIS could classify confidently

### Exit codes

- `0` - every domain resolved (registered or available)
- `1` - argument / file error
- `2` - at least one `unknown`

## How it works

1. **RDAP bootstrap**: Fetch the IANA RDAP DNS bootstrap file (`https://data.iana.org/rdap/dns.json`) once per process and map each TLD to its registry RDAP endpoint. If the IANA bootstrap fetch fails, `rdap.org` is used as a last-resort fallback.
2. **Registry RDAP**: Query the registry endpoint directly. The HTTP code is authoritative (`200`=registered, `404`=available).
3. **WHOIS fallback**: When the TLD has no RDAP service or RDAP errors out, the CLI opens a TCP socket to `whois.iana.org:43`, follows the `refer:` referral to the TLD's WHOIS server, and classifies the response by matching common "no match" / "Domain Name:" patterns. WHOIS queries are serialized per server and retried once when a response is unclassifiable, which helps with registries that return empty responses under concurrent load.

Lookups are paced by default with a 500ms delay between starts to avoid registry bursts. Use `--delay 0` for maximum speed, or a higher value such as `--delay 1000` for conservative bulk checks.

Per-TLD overrides for non-default RDAP semantics live in `src/tld-overrides.ts` (empty today - current major registries follow the default rule).

## AI agent skill

Install via [skills.sh](https://skills.sh/Rasaboun/dispo) so any compatible AI agent automatically uses `dispo` when checking domain availability:

```sh
bunx skills add Rasaboun/dispo
```

## Tests

```sh
bun test
bunx tsc --noEmit
```

Network calls are mocked; tests run offline.
