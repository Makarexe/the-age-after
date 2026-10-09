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

function write(level: string, args: unknown[]) {
  const text = args
    .map((a) => (a instanceof Error ? (a.stack ?? a.message) : typeof a === 'string' ? a : JSON.stringify(a)))
    .join(' ');
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
