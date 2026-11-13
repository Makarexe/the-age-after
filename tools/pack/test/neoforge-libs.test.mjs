import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import { buildNeoForgeLibrariesZip, neoForgeLibraries } from '../lib/neoforge-libs.mjs';
import { createZip, readZipEntry } from '../lib/zip.mjs';

const sha = (b) => createHash('sha1').update(b).digest('hex');
const bus = Buffer.from('bus');
const lib = (path, data, host) => ({ downloads: { artifact: { path, sha1: sha(data), size: data.length, url: `https://${host}/${path}` } } });
const installer = createZip([
  { name: 'install_profile.json', data: Buffer.from(JSON.stringify({ libraries: [lib('net/neoforged/bus/1/bus-1.jar', bus, 'maven.neoforged.net'), lib('com/mojang/x/1/x-1.jar', Buffer.from('x'), 'libraries.minecraft.net')] })) },
  { name: 'version.json', data: Buffer.from(JSON.stringify({ libraries: [lib('net/neoforged/bus/1/bus-1.jar', bus, 'maven.neoforged.net')] })) },
]);

describe('neoforge libraries zip', () => {
  it('lists only non-Mojang libraries, each once', () => {
    assert.deepEqual(neoForgeLibraries(installer).map((a) => a.path), ['net/neoforged/bus/1/bus-1.jar']);
  });

  it('downloads, verifies and zips them under libraries/', async () => {
    const { zip, files } = await buildNeoForgeLibrariesZip(installer, async () => new Response(bus));
    assert.equal(files, 1);
    assert.equal(readZipEntry(zip, 'libraries/net/neoforged/bus/1/bus-1.jar').toString(), 'bus');
  });

  it('refuses a download whose sha1 differs (an empty file from a blocked host, say)', async () => {
    await assert.rejects(buildNeoForgeLibrariesZip(installer, async () => new Response('')), /sha1/);
  });
});
