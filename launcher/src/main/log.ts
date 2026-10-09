import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import path from 'node:path';

const MAX_BYTES = 5 * 1024 * 1024;
let file: string | undefined;

export function initLog(dir: string): string {
  mkdirSync(dir, { recursive: true });
  file = path.join(dir, 'launcher.log');
  try {
    if (statSync(file).size > MAX_BYTES) renameSync(file, path.join(dir, 'launcher.old.log'));
  } catch {
    // no log yet
  }
  return file;
}

function formatArg(a: unknown): string {
  if (a instanceof AggregateError) {
    // Download failures: the inner errors say which file and why.
    const inner = a.errors.slice(0, 5).map((e) => {
      const url = (e as { url?: unknown })?.url;
      return `  - ${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}${url ? ` (${String(url)})` : ''}`;
    });
    return [`AggregateError: ${a.errors.length} errors`, ...inner, a.errors.length > 5 ? `  ... and ${a.errors.length - 5} more` : '']
      .filter(Boolean)
      .join('\n');
  }
  if (a instanceof Error) return a.stack ?? a.message;
  return typeof a === 'string' ? a : JSON.stringify(a);
}

function write(level: string, args: unknown[]) {
  const text = args.map(formatArg).join(' ');
  const line = `${new Date().toISOString()} ${level} ${text}\n`;
  if (level === 'ERROR') console.error(line.trimEnd());
  else console.log(line.trimEnd());
  if (file) {
    try {
      appendFileSync(file, line);
    } catch {
      // logging must never break the launcher
    }
  }
}

export const log = {
  info: (...args: unknown[]) => write('INFO', args),
  warn: (...args: unknown[]) => write('WARN', args),
  error: (...args: unknown[]) => write('ERROR', args),
};
