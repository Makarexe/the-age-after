#!/usr/bin/env node
// Builds manifest.json + config.zip from the CurseForge instance and (with --upload) publishes them
// to the `pack-latest` GitHub Release. Runs only on the owner's PC: the instance lives there.
//
//   node build-pack.mjs --instance "C:\Users\<you>\curseforge\minecraft\Instances\The Age After"
//   node build-pack.mjs --instance "..." --upload
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { buildPack, diffManifests, nextPackVersion } from './lib/pack.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

const { values: args } = parseArgs({
  options: {
    instance: { type: 'string', short: 'i' },
    out: { type: 'string', default: path.join(here, 'out') },
    version: { type: 'string' },
    upload: { type: 'boolean', default: false },
    'mods-only': { type: 'boolean', default: false },
    'check-urls': { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

if (args.help || !(args.instance ?? process.env.PACK_INSTANCE)) {
  console.log(`Использование:
  node build-pack.mjs --instance <папка инстанса CurseForge> [--upload] [--mods-only] [--check-urls] [--version 2026.01.31-1]

  --instance    папка с minecraftinstance.json (или переменная PACK_INSTANCE)
  --upload      загрузить в GitHub Release через gh (нужен gh auth login)
  --mods-only   обновить только моды: конфиги (config.zip) остаются как в опубликованной сборке
  --check-urls  проверить, что все ссылки CurseForge отвечают
  --out         куда сложить файлы (по умолчанию tools/pack/out)`);
  process.exit(args.help ? 0 : 1);
}

const instanceDir = path.resolve(args.instance ?? process.env.PACK_INSTANCE);
const config = JSON.parse(await readFile(path.join(here, 'pack.json'), 'utf8'));
const sides = JSON.parse(await readFile(path.join(here, 'sides.json'), 'utf8'));
const releaseBaseUrl = `https://github.com/${config.repo}/releases/download/${config.tag}`;

let previous = null;
try {
  const res = await fetch(`${releaseBaseUrl}/manifest.json`);
  if (res.ok) previous = await res.json();
} catch {
  // offline or no release yet
}

if (args['mods-only'] && !previous) {
  console.error('--mods-only: не удалось получить опубликованную сборку. Опубликуйте сборку целиком (без --mods-only).');
  process.exit(1);
}

const packVersion = args.version ?? nextPackVersion(previous?.packVersion);
const { manifest, uploads, serverMods, warnings } = await buildPack({
  instanceDir,
  config,
  sides,
  releaseBaseUrl,
  packVersion,
  keepOverrides: args['mods-only'] ? (previous.overrides ?? null) : undefined,
});

if (args['check-urls']) {
  const external = manifest.files.filter((f) => !f.url.startsWith(releaseBaseUrl));
  console.log(`Проверяю ${external.length} ссылок…`);
  let bad = 0;
  for (let i = 0; i < external.length; i += 16) {
    await Promise.all(
      external.slice(i, i + 16).map(async (f) => {
        try {
          const res = await fetch(f.url, { method: 'HEAD', redirect: 'follow' });
          const len = Number(res.headers.get('content-length'));
          if (!res.ok || (len && len !== f.size)) throw new Error(`HTTP ${res.status}, size ${len}`);
        } catch (err) {
          bad++;
          warnings.push(`Ссылка не работает: ${f.path} → ${f.url} (${err.message})`);
        }
      }),
    );
  }
  if (bad) console.log(`Нерабочих ссылок: ${bad}`);
}

await rm(args.out, { recursive: true, force: true });
await mkdir(path.join(args.out, 'assets'), { recursive: true });
for (const u of uploads) await writeFile(path.join(args.out, 'assets', u.name), u.data);
const manifestPath = path.join(args.out, 'manifest.json');
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
await writeFile(path.join(args.out, 'server-mods.txt'), serverMods.join('\n') + '\n');

const mb = (n) => (n / 1024 / 1024).toFixed(1);
const total = manifest.files.reduce((n, f) => n + f.size, 0) + (manifest.overrides?.size ?? 0);
console.log(`\nСборка ${packVersion}: ${manifest.files.length} файлов, ${mb(total)} МБ всего.`);
console.log(`В Release: ${uploads.length} файлов (${mb(uploads.reduce((n, u) => n + u.data.length, 0))} МБ).`);
if (args['mods-only']) console.log('Конфиги не трогаем: остаётся опубликованный config.zip.');
else if (manifest.overrides) console.log(`config.zip: ${manifest.overrides.files} файлов.`);

const diff = diffManifests(previous, manifest);
if (previous) {
  console.log(`\nОтносительно ${previous.packVersion}:`);
  for (const p of diff.added) console.log(`  + ${p}`);
  for (const p of diff.removed) console.log(`  - ${p}`);
  for (const p of diff.changed) console.log(`  ~ ${p}`);
  if (diff.configChanged) console.log('  ~ конфиги');
  if (!diff.added.length && !diff.removed.length && !diff.changed.length && !diff.configChanged) {
    console.log('  изменений нет');
  }
}
if (warnings.length) {
  console.log('\nПредупреждения:');
  for (const w of warnings) console.log(`  ! ${w}`);
}
console.log(`\nФайлы: ${args.out}`);
console.log('server-mods.txt — что должно лежать в mods/ сервера (сверьте с хостингом).');

if (!args.upload) {
  console.log('\nЧтобы опубликовать: добавьте --upload.');
  process.exit(0);
}

function gh(ghArgs, { check = true } = {}) {
  const res = spawnSync('gh', ghArgs, { stdio: check ? 'inherit' : 'ignore' });
  if (res.error) throw new Error(`gh не найден: установите GitHub CLI и выполните gh auth login (${res.error.message})`);
  if (check && res.status !== 0) throw new Error(`gh ${ghArgs.slice(0, 2).join(' ')} завершился с кодом ${res.status}`);
  return res.status === 0;
}

const repo = ['--repo', config.repo];
if (!gh(['release', 'view', config.tag, ...repo], { check: false })) {
  // Pre-release, so it never becomes "latest": electron-updater takes launcher updates from the latest release.
  gh([
    'release', 'create', config.tag, ...repo, '--prerelease',
    '--title', 'Сборка модов (для лаунчера)',
    '--notes', 'Служебный релиз: манифест сборки и файлы, которых нет на CurseForge. Обновляется скриптом tools/pack.',
  ]);
}
const assetPaths = uploads.map((u) => path.join(args.out, 'assets', u.name));
// Files first, manifest last: the launcher never sees a manifest pointing at files that aren't there yet.
for (let i = 0; i < assetPaths.length; i += 20) {
  gh(['release', 'upload', config.tag, ...assetPaths.slice(i, i + 20), '--clobber', ...repo]);
}
gh(['release', 'upload', config.tag, manifestPath, '--clobber', ...repo]);
console.log(`\nОпубликовано: ${releaseBaseUrl}/manifest.json`);
