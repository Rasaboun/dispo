import type { DomainResult } from './types.ts';

const RESET = '\x1b[0m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const DIM = '\x1b[2m';

function color(useColor: boolean, code: string, text: string): string {
  return useColor ? `${code}${text}${RESET}` : text;
}

function statusLabel(useColor: boolean, r: DomainResult): string {
  switch (r.status) {
    case 'registered':
      return color(useColor, RED, 'registered');
    case 'available':
      return color(useColor, GREEN, 'available');
    case 'unknown':
      return color(useColor, YELLOW, 'unknown');
  }
}

export function renderTable(results: readonly DomainResult[], useColor: boolean): string {
  if (results.length === 0) return '';

  const domainCol = Math.max(6, ...results.map((r) => r.domain.length));
  const statusCol = 'registered'.length;
  const sourceCol = 'source'.length;

  const lines: string[] = [];
  lines.push(
    `${'DOMAIN'.padEnd(domainCol)}  ${'STATUS'.padEnd(statusCol)}  ${'SOURCE'.padEnd(sourceCol)}  TIME`,
  );
  lines.push(
    `${'-'.repeat(domainCol)}  ${'-'.repeat(statusCol)}  ${'-'.repeat(sourceCol)}  ----`,
  );

  for (const r of results) {
    const time = `${r.durationMs}ms`;
    const status = statusLabel(useColor, r);
    const statusPadding = ' '.repeat(Math.max(0, statusCol - r.status.length));
    const tail = r.error ? `  ${color(useColor, DIM, r.error)}` : '';
    lines.push(
      `${r.domain.padEnd(domainCol)}  ${status}${statusPadding}  ${r.source.padEnd(sourceCol)}  ${time}${tail}`,
    );
  }

  return lines.join('\n');
}

export function renderJson(results: readonly DomainResult[]): string {
  return JSON.stringify(results, null, 2);
}

export function exitCodeFor(results: readonly DomainResult[]): 0 | 2 {
  return results.some((r) => r.status === 'unknown') ? 2 : 0;
}
