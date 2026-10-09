import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ensureServerListed, readNbt, writeNbt, type Compound } from '../src/main/servers-dat';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'servers-'));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const servers = (root: Compound) => {
  const list = root.find(([k]) => k === 'servers')![1];
  if (list.type !== 9) throw new Error('no list');
  return list.value.items.map((i) => (i.type === 10 ? Object.fromEntries(i.value.map(([k, v]) => [k, v.value])) : null));
};

describe('servers.dat', () => {
  it('creates the file with our server', async () => {
    expect(await ensureServerListed(dir, 'The Age After', '185.9.145.108:32796')).toBe(true);
    const { root } = readNbt(await readFile(path.join(dir, 'servers.dat')));
    expect(servers(root)).toEqual([{ name: 'The Age After', ip: '185.9.145.108:32796' }]);
  });

  it("keeps the player's servers and their extra fields, adds ours once at the top", async () => {
    const icon = 'iVBORw0KGgo=';
    const original: Compound = [
      [
        'servers',
        {
          type: 9,
          value: {
            elementType: 10,
            items: [
              {
                type: 10,
                value: [
                  ['icon', { type: 8, value: icon }],
                  ['ip', { type: 8, value: 'mc.hypixel.net' }],
                  ['name', { type: 8, value: 'Хайпиксель ✓' }],
                  ['acceptTextures', { type: 1, value: 1 }],
                  ['hidden', { type: 1, value: 0 }],
                ],
              },
            ],
          },
        },
      ],
    ];
    const file = path.join(dir, 'servers.dat');
    const bytes = writeNbt(original);
    await writeFile(file, bytes);
    expect(writeNbt(readNbt(bytes).root)).toEqual(bytes); // lossless round trip

    expect(await ensureServerListed(dir, 'The Age After', '185.9.145.108:32796')).toBe(true);
    expect(await ensureServerListed(dir, 'The Age After', '185.9.145.108:32796')).toBe(false);
    expect(servers(readNbt(await readFile(file)).root)).toEqual([
      { name: 'The Age After', ip: '185.9.145.108:32796' },
      { icon, ip: 'mc.hypixel.net', name: 'Хайпиксель ✓', acceptTextures: 1, hidden: 0 },
    ]);
  });

  it('updates the address of our entry instead of adding a second one', async () => {
    await ensureServerListed(dir, 'The Age After', 'play.example.ru:25565');
    expect(await ensureServerListed(dir, 'The Age After', '185.9.145.108:32796')).toBe(true);
    const { root } = readNbt(await readFile(path.join(dir, 'servers.dat')));
    expect(servers(root)).toEqual([{ name: 'The Age After', ip: '185.9.145.108:32796' }]);
  });

  it('leaves an unreadable file alone', async () => {
    const file = path.join(dir, 'servers.dat');
    await writeFile(file, Buffer.from([1, 2, 3]));
    expect(await ensureServerListed(dir, 'X', 'a:1')).toBe(false);
    expect(await readFile(file)).toEqual(Buffer.from([1, 2, 3]));
  });
});
