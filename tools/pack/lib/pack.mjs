import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { createZip } from './zip.mjs';

export const MANIFEST_FORMAT = 1;
const SHA1_HASH_TYPE = 1; // CurseForge HashAlgo: 1 = SHA1, 2 = MD5
const CONTENT_DIRS = new Set(['mods', 'resourcepacks', 'shaderpacks']);
const ZIP_MTIME = new Date(2000, 0, 1); // fixed: same configs → same config.zip sha1

export const sha1 = (data) => createHash('sha1').update(data).digest('hex');

/** `**` matches across folders, `*` inside one name. Paths use "/". */
export function globToRegExp(pattern) {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*' && pattern[i + 1] === '*') {
      re += pattern[i + 2] === '/' ? '(?:.*/)?' : '.*';
      i += pattern[i + 2] === '/' ? 2 : 1;
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`, 'i');
}

export const matchesAny = (p, patterns) => patterns.some((g) => globToRegExp(g).test(p));

/** GitHub turns odd characters in asset names into dots; do it ourselves so the URL is predictable. */
export function assetName(fileName) {
  return fileName.replace(/[^A-Za-z0-9._-]+/g, '.');
}

export function nextPackVersion(previous, now = new Date()) {
  const date = `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, '0')}.${String(now.getDate()).padStart(2, '0')}`;
  const m = typeof previous === 'string' ? previous.match(/^(\d{4}\.\d{2}\.\d{2})-(\d+)$/) : null;
  return m && m[1] === date ? `${date}-${Number(m[2]) + 1}` : `${date}-1`;
}

function curseforgeUrl(fileId, fileName) {
  return `https://edge.forgecdn.net/files/${Math.floor(fileId / 1000)}/${fileId % 1000}/${encodeURIComponent(fileName)}`;
}

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function walk(dir, base = dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full, base)));
    else if (entry.isFile()) out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out;
}

/** CurseForge addons from minecraftinstance.json. Field names differ a bit between app versions. */
export async function readInstance(instanceDir) {
  const raw = JSON.parse(await readFile(path.join(instanceDir, 'minecraftinstance.json'), 'utf8'));
  const addons = [];
  for (const addon of raw.installedAddons ?? []) {
    const file = addon.installedFile ?? {};
    const fileName = file.fileNameOnDisk ?? file.FileNameOnDisk ?? addon.fileNameOnDisk ?? file.fileName;
    if (!fileName) continue;
    const dir = addon.categorySection?.path ?? file.categorySectionPath ?? 'mods';
    const hash = (file.hashes ?? []).find((h) => h.type === SHA1_HASH_TYPE || h.algo === SHA1_HASH_TYPE);
    addons.push({
      name: addon.name ?? fileName,
      dir,
      fileName,
      sha1: hash?.value?.toLowerCase(),
      size: file.fileLength,
      url: file.downloadUrl || (file.id ? curseforgeUrl(file.id, fileName) : undefined),
      urlGuessed: !file.downloadUrl,
    });
  }
  const loader = raw.baseModLoader ?? {};
  return {
    addons,
    minecraft: loader.minecraftVersion ?? raw.gameVersion,
    neoforge: loader.forgeVersion ?? loader.name?.match(/^neoforge-(.+)$/)?.[1],
  };
}

/**
 * Builds the manifest and the list of files to upload to the release.
 * @returns {{ manifest: object, uploads: {name: string, data: Buffer}[], serverMods: string[], warnings: string[] }}
 */
export async function buildPack({ instanceDir, config, sides, releaseBaseUrl, packVersion }) {
  const warnings = [];
  const instance = await readInstance(instanceDir);
  const minecraft = config.minecraft;
  const neoforge = config.neoforge;
  if (instance.minecraft && instance.minecraft !== minecraft) {
    warnings.push(`Инстанс на Minecraft ${instance.minecraft}, а в pack.json ${minecraft}.`);
  }
  if (instance.neoforge && instance.neoforge !== neoforge) {
    warnings.push(`Инстанс на NeoForge ${instance.neoforge}, а в pack.json ${neoforge}.`);
  }

  const files = [];
  const uploads = [];
  const serverMods = [];
  const known = new Set();

  for (const addon of instance.addons) {
    if (!CONTENT_DIRS.has(addon.dir)) continue;
    const relPath = `${addon.dir}/${addon.fileName}`;
    known.add(relPath.toLowerCase());
    if (addon.fileName.endsWith('.disabled')) continue;
    const local = path.join(instanceDir, addon.dir, addon.fileName);
    if (!(await exists(local))) {
      if (!(await exists(`${local}.disabled`))) warnings.push(`Нет файла ${relPath} (${addon.name}), пропущен.`);
      known.add(`${relPath}.disabled`.toLowerCase());
      continue;
    }
    const data = await readFile(local);
    const hash = sha1(data);
    const entry = { path: relPath, sha1: hash, size: data.length };
    if (addon.dir === 'mods' && matchesAny(addon.fileName, sides.serverOnly ?? [])) {
      serverMods.push(addon.fileName);
      continue;
    }
    if (hash === addon.sha1 && addon.url) {
      if (addon.urlGuessed) warnings.push(`${addon.name}: нет downloadUrl, ссылка собрана по id файла.`);
      files.push({ ...entry, url: addon.url });
    } else {
      warnings.push(`${relPath}: файл отличается от CurseForge, будет загружен в Release.`);
      const name = assetName(addon.fileName);
      uploads.push({ name, data });
      files.push({ ...entry, url: `${releaseBaseUrl}/${name}` });
    }
    if (addon.dir === 'mods' && !matchesAny(addon.fileName, sides.clientOnly ?? [])) serverMods.push(addon.fileName);
  }

  // Jars in mods/ that CurseForge doesn't know about: the owner's own mods.
  const modsDir = path.join(instanceDir, 'mods');
  if (await exists(modsDir)) {
    for (const entry of await readdir(modsDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.jar')) continue;
      if (known.has(`mods/${entry.name}`.toLowerCase())) continue;
      const data = await readFile(path.join(modsDir, entry.name));
      const serverOnly = matchesAny(entry.name, sides.serverOnly ?? []);
      if (!matchesAny(entry.name, sides.clientOnly ?? [])) serverMods.push(entry.name);
      if (serverOnly) continue;
      const name = assetName(entry.name);
      uploads.push({ name, data });
      files.push({ path: `mods/${entry.name}`, sha1: sha1(data), size: data.length, url: `${releaseBaseUrl}/${name}` });
    }
  }

  const assetNames = new Set();
  for (const u of uploads) {
    if (assetNames.has(u.name.toLowerCase())) throw new Error(`Два файла дают одно имя в Release: ${u.name}`);
    assetNames.add(u.name.toLowerCase());
  }

  // Configs and other overrides go into one zip.
  const zipEntries = [];
  for (const dir of config.overrideDirs ?? []) {
    const full = path.join(instanceDir, dir);
    if (!(await exists(full))) continue;
    for (const rel of await walk(full)) {
      const name = `${dir}/${rel}`;
      if (matchesAny(name, config.exclude ?? [])) continue;
      zipEntries.push({ name, data: await readFile(path.join(full, ...rel.split('/'))), mtime: ZIP_MTIME });
    }
  }
  for (const file of config.overrideFiles ?? []) {
    const full = path.join(instanceDir, file);
    if (await exists(full)) zipEntries.push({ name: file, data: await readFile(full), mtime: ZIP_MTIME });
  }
  zipEntries.sort((a, b) => a.name.localeCompare(b.name));
  let overrides = null;
  if (zipEntries.length > 0) {
    const zip = createZip(zipEntries);
    uploads.push({ name: 'config.zip', data: zip });
    overrides = { url: `${releaseBaseUrl}/config.zip`, sha1: sha1(zip), size: zip.length, files: zipEntries.length };
  }

  files.sort((a, b) => a.path.localeCompare(b.path));
  serverMods.sort((a, b) => a.localeCompare(b));
  const manifest = {
    formatVersion: MANIFEST_FORMAT,
    packVersion,
    minecraft,
    neoforge,
    files,
    overrides,
    managedDirs: config.managedDirs ?? ['mods'],
    firstInstallOnly: config.firstInstallOnly ?? [],
  };
  return { manifest, uploads, serverMods, warnings };
}

/** Human-readable changes between two manifests (by path). */
export function diffManifests(previous, next) {
  const before = new Map((previous?.files ?? []).map((f) => [f.path, f.sha1]));
  const after = new Map(next.files.map((f) => [f.path, f.sha1]));
  const added = [...after.keys()].filter((p) => !before.has(p));
  const removed = [...before.keys()].filter((p) => !after.has(p));
  const changed = [...after.keys()].filter((p) => before.has(p) && before.get(p) !== after.get(p));
  const configChanged = previous?.overrides?.sha1 !== next.overrides?.sha1;
  return { added, removed, changed, configChanged };
}
