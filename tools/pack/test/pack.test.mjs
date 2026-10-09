import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { inflateRawSync } from 'node:zlib';
import { assetName, buildPack, diffManifests, globToRegExp, nextPackVersion, sha1 } from '../lib/pack.mjs';

/** Reads back our zip via the central directory. */
function readZip(buf) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = {};
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const dataStart = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(dataStart, dataStart + csize);
    out[name] = (method === 8 ? inflateRawSync(raw) : raw).toString('utf8');
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

const RELEASE = 'https://github.com/o/r/releases/download/pack-latest';
const config = {
  minecraft: '1.21.1',
  neoforge: '21.1.256',
  overrideDirs: ['config', 'kubejs'],
  overrideFiles: ['options.txt'],
  firstInstallOnly: ['options.txt'],
  managedDirs: ['mods'],
  exclude: ['**/*.bak'],
};

let dir;
const jei = Buffer.from('jei jar');
const own = Buffer.from('own mod jar');

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'pack-'));
  await mkdir(path.join(dir, 'mods'));
  await mkdir(path.join(dir, 'config', 'jei'), { recursive: true });
  await mkdir(path.join(dir, 'resourcepacks'));
  const addon = (name, fileName, data, extra = {}) => ({
    name,
    installedFile: {
      id: 5846880,
      fileNameOnDisk: fileName,
      fileLength: data.length,
      downloadUrl: `https://edge.forgecdn.net/files/5846/880/${fileName}`,
      hashes: [{ type: 2, value: 'md5' }, { type: 1, value: sha1(data) }],
      ...extra,
    },
    categorySection: { path: fileName.endsWith('.zip') ? 'resourcepacks' : 'mods' },
  });
  await writeFile(
    path.join(dir, 'minecraftinstance.json'),
    JSON.stringify({
      baseModLoader: { name: 'neoforge-21.1.256', forgeVersion: '21.1.256', minecraftVersion: '1.21.1' },
      installedAddons: [
        addon('JEI', 'jei-1.21.1.jar', jei),
        addon('Disabled Mod', 'old.jar.disabled', Buffer.from('x')),
        addon('Changed Locally', 'patched.jar', Buffer.from('original')),
        addon('No Url', 'nourl.jar', Buffer.from('nourl'), { downloadUrl: null, id: 1234567 }),
        addon('Faithful', 'faithful.zip', Buffer.from('pack')),
      ],
    }),
  );
  await writeFile(path.join(dir, 'mods', 'jei-1.21.1.jar'), jei);
  await writeFile(path.join(dir, 'mods', 'old.jar.disabled'), 'x');
  await writeFile(path.join(dir, 'mods', 'patched.jar'), 'patched!');
  await writeFile(path.join(dir, 'mods', 'nourl.jar'), 'nourl');
  await writeFile(path.join(dir, 'mods', 'My Own Mod 1.0.jar'), own);
  await writeFile(path.join(dir, 'mods', 'ageafterauth-0.1.0.jar'), 'server only');
  await writeFile(path.join(dir, 'resourcepacks', 'faithful.zip'), 'pack');
  await writeFile(path.join(dir, 'config', 'jei', 'jei-client.toml'), 'a = 1\n');
  await writeFile(path.join(dir, 'config', 'mod.toml.bak'), 'old');
  await writeFile(path.join(dir, 'config', 'русский.json'), '{}');
  await writeFile(path.join(dir, 'options.txt'), 'key_key.jump:key.keyboard.space\n');
});
after(() => rm(dir, { recursive: true, force: true }));

describe('buildPack', () => {
  let result;
  before(async () => {
    result = await buildPack({
      instanceDir: dir,
      config,
      sides: { serverOnly: ['ageafterauth-*.jar'], clientOnly: [] },
      releaseBaseUrl: RELEASE,
      packVersion: '2026.10.09-1',
    });
  });

  it('lists CurseForge files by their CDN url and checks sha1 against the disk', () => {
    const files = Object.fromEntries(result.manifest.files.map((f) => [f.path, f]));
    assert.deepEqual(files['mods/jei-1.21.1.jar'], {
      path: 'mods/jei-1.21.1.jar',
      sha1: sha1(jei),
      size: jei.length,
      url: 'https://edge.forgecdn.net/files/5846/880/jei-1.21.1.jar',
    });
    assert.equal(files['resourcepacks/faithful.zip'].url, 'https://edge.forgecdn.net/files/5846/880/faithful.zip');
    assert.equal(files['mods/nourl.jar'].url, 'https://edge.forgecdn.net/files/1234/567/nourl.jar');
  });

  it('uploads own and locally changed jars, skips disabled and server-only', () => {
    const paths = result.manifest.files.map((f) => f.path);
    assert.ok(!paths.some((p) => p.includes('old.jar')));
    assert.ok(!paths.some((p) => p.includes('ageafterauth')));
    const ownEntry = result.manifest.files.find((f) => f.path === 'mods/My Own Mod 1.0.jar');
    assert.equal(ownEntry.url, `${RELEASE}/My.Own.Mod.1.0.jar`);
    assert.equal(result.manifest.files.find((f) => f.path === 'mods/patched.jar').url, `${RELEASE}/patched.jar`);
    assert.deepEqual(result.uploads.map((u) => u.name).sort(), ['My.Own.Mod.1.0.jar', 'config.zip', 'patched.jar']);
    assert.ok(result.warnings.some((w) => w.includes('patched.jar')));
    assert.ok(result.warnings.some((w) => w.includes('No Url')));
  });

  it('packs configs and options.txt into config.zip, minus excluded files', () => {
    const zip = result.uploads.find((u) => u.name === 'config.zip').data;
    const entries = readZip(zip);
    assert.deepEqual(Object.keys(entries).sort(), ['config/jei/jei-client.toml', 'config/русский.json', 'options.txt']);
    assert.equal(entries['config/jei/jei-client.toml'], 'a = 1\n');
    assert.deepEqual(result.manifest.overrides, { url: `${RELEASE}/config.zip`, sha1: sha1(zip), size: zip.length, files: 3 });
  });

  it('server-mods.txt includes server-only mods', () => {
    assert.ok(result.serverMods.includes('ageafterauth-0.1.0.jar'));
    assert.ok(result.serverMods.includes('jei-1.21.1.jar'));
  });

  it('manifest header', () => {
    const { files, overrides, ...head } = result.manifest;
    assert.deepEqual(head, {
      formatVersion: 1,
      packVersion: '2026.10.09-1',
      minecraft: '1.21.1',
      neoforge: '21.1.256',
      managedDirs: ['mods'],
      firstInstallOnly: ['options.txt'],
    });
  });

  it('is deterministic', async () => {
    const again = await buildPack({ instanceDir: dir, config, sides: { serverOnly: ['ageafterauth-*.jar'] }, releaseBaseUrl: RELEASE, packVersion: 'x' });
    assert.equal(again.manifest.overrides.sha1, result.manifest.overrides.sha1);
  });
});

describe('helpers', () => {
  it('nextPackVersion', () => {
    const now = new Date(2026, 9, 9);
    assert.equal(nextPackVersion(undefined, now), '2026.10.09-1');
    assert.equal(nextPackVersion('2026.10.09-3', now), '2026.10.09-4');
    assert.equal(nextPackVersion('2026.10.08-3', now), '2026.10.09-1');
  });

  it('globs', () => {
    assert.ok(globToRegExp('**/*.bak').test('config/a/b.bak'));
    assert.ok(globToRegExp('**/*.bak').test('b.bak'));
    assert.ok(!globToRegExp('config/*.toml').test('config/a/b.toml'));
    assert.ok(globToRegExp('ageafterauth-*.jar').test('ageafterauth-0.1.0.jar'));
  });

  it('assetName', () => {
    assert.equal(assetName('My Mod [1.0] + extra.jar'), 'My.Mod.1.0.extra.jar');
  });

  it('diffManifests', () => {
    const a = { files: [{ path: 'mods/a.jar', sha1: '1' }, { path: 'mods/b.jar', sha1: '2' }], overrides: { sha1: 'c' } };
    const b = { files: [{ path: 'mods/b.jar', sha1: '3' }, { path: 'mods/c.jar', sha1: '4' }], overrides: { sha1: 'c' } };
    assert.deepEqual(diffManifests(a, b), { added: ['mods/c.jar'], removed: ['mods/a.jar'], changed: ['mods/b.jar'], configChanged: false });
  });
});
