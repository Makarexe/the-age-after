# tools/pack — манифест сборки

Запускается **только на ПК владельца**: читает инстанс CurseForge и публикует то, что скачивает лаунчер.

## Что делает

- Моды, ресурспаки и шейдеры из CurseForge попадают в `manifest.json` ссылками на их CDN (`edge.forgecdn.net`): мы их не перераздаём. sha1 проверяется по файлу на диске.
- Свои jar (которых нет в `minecraftinstance.json`) и jar, изменённые локально, загружаются в GitHub Release `pack-latest`.
- `config/`, `defaultconfigs/`, `kubejs/` и `options.txt` упаковываются в `config.zip` (список — `pack.json`). `options.txt` лаунчер ставит только при первой установке.
- `*.disabled` пропускаются.
- `sides.json`: `serverOnly` — моды только для сервера (игрокам не уходят), `clientOnly` — только для клиента (не попадают в `server-mods.txt`). Шаблоны имён: `*` — что угодно.
- Версия сборки — `YYYY.MM.DD-N`, N растёт, если в этот день уже публиковали.

## Как запустить

Нужны Node 22+ и [GitHub CLI](https://cli.github.com/) (`gh auth login` один раз).

```powershell
cd tools\pack
node build-pack.mjs --instance "C:\Users\<вы>\curseforge\minecraft\Instances\<инстанс>"            # собрать и посмотреть
node build-pack.mjs --instance "C:\Users\<вы>\curseforge\minecraft\Instances\<инстанс>" --upload   # опубликовать
```

Скрипт покажет, что изменилось относительно опубликованной сборки, и предупреждения. Результат — в `tools/pack/out/` (в git не попадает):

- `manifest.json` — для лаунчера;
- `assets/` — что уходит в Release;
- `server-mods.txt` — какие jar должны лежать в `mods/` сервера.

`--check-urls` дополнительно проверит, что все ссылки CurseForge отвечают.

Release `pack-latest` создаётся как pre-release, чтобы не стать «последним релизом»: из последнего релиза лаунчер берёт свои обновления.

## Формат manifest.json

```json
{
  "formatVersion": 1,
  "packVersion": "2026.10.09-1",
  "minecraft": "1.21.1",
  "neoforge": "21.1.256",
  "files": [{ "path": "mods/x.jar", "sha1": "…", "size": 123, "url": "https://edge.forgecdn.net/…" }],
  "overrides": { "url": "…/config.zip", "sha1": "…", "size": 456, "files": 789 },
  "managedDirs": ["mods"],
  "firstInstallOnly": ["options.txt"]
}
```

Лаунчер скачивает `files` и проверяет sha1, удаляет из `managedDirs` всё, чего нет в `files`, и при смене `packVersion` распаковывает `overrides` поверх папки игры (файлы из `firstInstallOnly` — только если их ещё нет).

Тесты: `npm test`.
