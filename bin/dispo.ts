#!/usr/bin/env bun
import { readFile } from 'node:fs/promises';
import pkg from '../package.json' with { type: 'json' };
import { CliError, HELP_TEXT, collectDomains, expandKeywords, parseArgs } from '../src/cli.ts';
import { runPool } from '../src/pool.ts';
import { checkDomain } from '../src/rdap.ts';
import { exitCodeFor, renderJson, renderTable } from '../src/render.ts';

async function readStdin(): Promise<string | undefined> {
  if (process.stdin.isTTY) return undefined;
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function main(): Promise<number> {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    if (e instanceof CliError) {
      process.stderr.write(`${e.message}\n\n${HELP_TEXT}`);
      return 1;
    }
    throw e;
  }

  if (args.help) {
    process.stdout.write(HELP_TEXT);
    return 0;
  }

  if (args.version) {
    process.stdout.write(`${pkg.version}\n`);
    return 0;
  }

  if (args.tlds && args.tlds.length > 0) {
    if (args.domains.length === 0) {
      process.stderr.write(`--tlds requires at least one keyword domain.\n\n${HELP_TEXT}`);
      return 1;
    }
    args.domains = expandKeywords(args.domains, args.tlds);
    delete args.tlds;
  }

  let fileContents: string | undefined;
  if (args.file) {
    try {
      fileContents = await readFile(args.file, 'utf8');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      process.stderr.write(`Cannot read --file ${args.file}: ${msg}\n`);
      return 1;
    }
  }

  const stdin = await readStdin();
  const { valid, invalid } = collectDomains(args, fileContents, stdin);

  if (invalid.length > 0) {
    process.stderr.write(`Skipping ${invalid.length} invalid input(s): ${invalid.join(', ')}\n`);
  }

  if (valid.length === 0) {
    process.stderr.write(`No valid domains supplied.\n\n${HELP_TEXT}`);
    return 1;
  }

  const results = await runPool(
    valid,
    (d) => checkDomain(d, { timeoutMs: args.timeoutMs }),
    args.concurrency,
  );

  const useColor = !args.json && process.stdout.isTTY === true;
  const output = args.json ? renderJson(results) : renderTable(results, useColor);
  process.stdout.write(`${output}\n`);

  return exitCodeFor(results);
}

main().then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(`Fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
    process.exit(1);
  },
);
