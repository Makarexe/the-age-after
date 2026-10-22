import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';

const { mods } = JSON.parse(await readFile(new URL('../optional-mods.json', import.meta.url), 'utf8'));

describe('optional-mods.json', () => {
  it('has unique ids and known requires', () => {
    const ids = mods.map((m) => m.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const m of mods) for (const r of m.requires ?? []) assert.ok(ids.includes(r), `${m.id} requires ${r}`);
  });

  it('every file is a pinned https download into mods/', () => {
    for (const m of mods) {
      assert.ok(m.files.length > 0, m.id);
      for (const f of m.files) {
        assert.match(f.path, /^mods\/[^/\\]+\.jar$/);
        assert.match(f.sha1, /^[0-9a-f]{40}$/);
        assert.ok(f.size > 0);
        assert.match(f.url, /^https:\/\/cdn\.modrinth\.com\//);
      }
    }
  });
});
