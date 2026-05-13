---
name: dispo
description: Check domain availability using the dispo CLI. Use when the user asks to check if a domain is available, search for app/product names, or verify domain status for one or more domains.
metadata:
  author: Rasaboun
  version: "1.0.0"
---

# dispo — domain availability checker

Use `dispo` to check whether domains are registered or available. RDAP first, WHOIS fallback.

## Prerequisite

Verify dispo is installed:

```sh
which dispo
```

If missing, install globally:

```sh
bun install -g github:Rasaboun/dispo
```

## Usage

Batch everything into a single call — always check multiple TLDs at once:

```sh
dispo wishspot.app wishspot.com wishspot.co
dispo google.com openai.io anthropic.fr
```

### Flags

| Flag | Description |
|------|-------------|
| `--json` | Machine-readable JSON output |
| `--file <path>` | Read domains from a newline-separated file |
| `--tlds, -T <list>` | Comma-separated TLDs; positional args become keywords |
| `--concurrency <n>` | Parallel lookups (default 8) |
| `--version, -v` | Show version |
| `--timeout <ms>` | Per-request timeout (default 10000) |

## Output

```
DOMAIN        STATUS      SOURCE  TIME
------------  ----------  ------  ----
wishspot.app  available   rdap    257ms
google.com    registered  rdap    83ms
```

### Status values

- `available` — domain is free to register
- `registered` — domain is taken
- `unknown` — could not determine (re-check individually)

### Source reliability

- **RDAP `available`** — fully authoritative, trust it
- **WHOIS `available`** — reliable for `.co`, `.io`; may fail for obscure TLDs
- **`unknown`** — re-run as a standalone call to confirm

## Keyword expansion

Use `--tlds` when checking many TLD variants of a keyword:

```sh
dispo --tlds com,app,co,io,net spots
dispo -T dev,xyz,me foo bar
```

Positional args become keywords. Each keyword × each TLD = one domain check.

## Strategy for name searches

1. **Batch aggressively** — 10–20 domains per call
2. **Use `--tlds` for TLD sweeps** — faster than typing each full domain
3. **Check `.com`, `.app`, `.co`** for each candidate
4. **Prefer `.app` for mobile apps**, `.com` for global brands
5. **Only surface RDAP `available` results** as confirmed to the user
6. **Flag WHOIS `available`** as "likely available — verify before purchasing"

## Example

User asks: "find an available domain for my food app"

```sh
dispo --tlds com,app,co spots wishspot placepin gemspot
dispo --tlds app,co viree mapcarte placeboard
```
