---
name: dispo
description: Check domain availability using the dispo CLI. Use when the user asks to check if a domain is available, search for app/product names, or verify domain status.
---

# dispo — domain availability checker

Use `dispo` to check whether domains are registered or available. RDAP first, WHOIS fallback.

## Prerequisite

Verify dispo is installed before running:

```sh
which dispo
```

If missing, install:

```sh
bun install -g github:Rasaboun/dispo
```

## Usage

```sh
dispo <domain>...
```

Check one or many domains in a single call — batch everything:

```sh
dispo wishspot.app wishspot.com wishspot.co
dispo google.com openai.io anthropic.fr
```

### Flags

| Flag | Description |
|------|-------------|
| `--json` | Machine-readable JSON output |
| `--file <path>` | Read domains from a newline-separated file |
| `--concurrency <n>` | Parallel lookups (default 8) |
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
- `unknown` — could not determine (treat as uncertain, re-check or flag to user)

### Reliability

RDAP results are authoritative. WHOIS results are reliable for `.co` and `.io` but may fail for some TLDs (returns `unknown`). When a result is `unknown` via WHOIS, re-run as a standalone call to confirm.

## Strategy for name searches

When searching for a good domain across many candidates:

1. **Batch aggressively** — pass 10–20 domains per call
2. **Check `.com`, `.app`, `.co`** for each candidate
3. **Trust RDAP `available`** — fully reliable
4. **Distrust `unknown`** — re-check individually
5. **Prefer `.app` for mobile apps**, `.com` for global brands

## Example

User asks: "find an available domain for my food discovery app"

```sh
dispo spots.app spots.com wishspot.app placepin.app gemspot.app
dispo viree.app viree.co mapcarte.app placeboard.app
```

Present only `available` results with RDAP source as confirmed. Flag WHOIS `available` as "likely available, verify before purchasing."
