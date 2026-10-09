import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Settings } from '../shared/types';

export const totalMemoryMb = () => Math.floor(os.totalmem() / 1024 / 1024);

/** ~380 mods want 6–8 GB; leave the rest of the RAM to the system. */
export function defaultMemoryMb(totalMb = totalMemoryMb()): number {
  const half = Math.floor(totalMb / 2 / 512) * 512;
  return Math.min(8192, Math.max(4096, half));
}

export function clampMemory(mb: number, totalMb = totalMemoryMb()): number {
  const max = Math.max(2048, totalMb - 1536);
  return Math.min(max, Math.max(2048, Math.round(mb / 256) * 256));
}

export class SettingsStore {
  private value: Settings;

  constructor(
    private readonly file: string,
    defaultGameDir: string,
  ) {
    const defaults: Settings = { memoryMb: defaultMemoryMb(), gameDir: defaultGameDir, hideWhilePlaying: false, apiRoot: '' };
    let stored: Partial<Settings> = {};
    try {
      stored = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      // first start
    }
    this.value = { ...defaults, ...stored };
  }

  get(): Settings {
    return { ...this.value };
  }

  update(patch: Partial<Settings>): Settings {
    const next = { ...this.value, ...patch };
    next.memoryMb = clampMemory(next.memoryMb);
    next.apiRoot = next.apiRoot.trim().replace(/\/+$/, '');
    if (next.apiRoot && !/^https?:\/\/[^/\s]+/.test(next.apiRoot)) throw new Error('Адрес сервера должен начинаться с https://');
    this.value = next;
    mkdirSync(path.dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(next, null, 2));
    return this.get();
  }
}
