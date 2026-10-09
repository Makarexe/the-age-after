# The Age After — лаунчер, аккаунты, серверный мод

> Самодостаточный план для любой сессии, которая продолжит работу (в том числе облачной).
> Язык общения с владельцем — русский. Все тексты UI и писем — на русском.

## Зачем

Приватный модовый сервер Minecraft (NeoForge 1.21.1, ~380 модов) для друзей. Ставить сборку руками умеют не все, версии у игроков разъезжаются (разный NeoForge → кик, мод только у части игроков → сломанный крафт). Нужен свой лаунчер, который:

- регистрирует и логинит игрока **своим аккаунтом** (ник, почта, пароль; почту подтверждают; **регистрацию одобряет админ**);
- сам ставит Java 21, Minecraft 1.21.1, NeoForge **21.1.256** и ровно нужную сборку модов и конфигов;
- запускает игру с **настоящей проверкой сессии**: сервер работает в `online-mode=true`, но проверяет игроков через наш сервер аккаунтов, а не через Mojang. Тогда ник нельзя подделать.

Решения владельца: только **Windows**; название **The Age After** (папка игры `%APPDATA%\.theageafter`); репозиторий **публичный**; письма через **SMTP Яндекса или Gmail**; бэкенд на **Railway**.

## Проверенные технические факты (не перепроверять)

- **Порядок запуска сервера NeoForge 21.1** (`net/minecraft/server/Main`): `Bootstrap.bootStrap()` → `ServerModLoader.load()` → `new YggdrasilAuthenticationService(Proxy)` → `Services.create(...)`. Конструкторы модов выполняются **до** создания сервиса авторизации.
- **authlib 6.0.54** (MC 1.21.1), `EnvironmentParser` читает системные свойства `minecraft.api.session.host` и `minecraft.api.services.host`. Задавать нужно **оба**, иначе authlib их игнорирует. Ключи проверки подписей он тянет из `<services host>/publickeys`.
  → Серверный мод в конструкторе делает `System.setProperty(...)` на оба хоста. Флаги JVM не нужны: хостинг сервера не даёт их менять (команда запуска игнорируется, `unix_args.txt` тоже).
- **`TextureUrlChecker`** пропускает скины только с `.minecraft.net` и `.mojang.com`, поэтому **на клиенте нужен authlib-injector** (`-javaagent:authlib-injector.jar=<API root>`). Его подставляет лаунчер. Серверу authlib-injector не нужен.
- **Offline UUID.** Аккаунтам выдаётся `UUID.nameUUIDFromBytes(("OfflinePlayer:" + name).getBytes(UTF_8))`, то есть MD5, version 3 и variant IETF. Так сохраняются уже существующие данные игроков на сервере: он сейчас в offline-режиме, `playerdata` и `ops.json` лежат на offline-UUID. Тестовые векторы, сверенные с реальным сервером:
  - `Notch` → `b50ad385-829d-3141-a216-7e7d7539ba7f`
  - `Steve` → `5627dd98-e6be-3c21-b8a8-e92344183641`
  - `Alex` → `36532b5e-c442-3dbb-a24c-c7e55d0f979a`

  UUID считается от ника **с учётом регистра** в том виде, в каком его зарегистрировали. Уникальность ника проверяется **без учёта регистра**.
- **Сборка-эталон** — инстанс CurseForge на ПК владельца: 383 мода из CurseForge, у каждого в `minecraftinstance.json` есть `downloadUrl` (edge.forgecdn.net) и sha1 в `installedFile.hashes`. Ещё ~8 jar не из CurseForge (~11 МБ, моды владельца). Всего ~1.6 ГБ. **Манифест генерируется только локально** на ПК владельца.

## Структура репозитория

```
backend/      Node 24 + TypeScript (ESM) + Fastify 5 + Drizzle ORM + PostgreSQL. Деплой на Railway.
              Тесты: vitest + PGlite (@electric-sql/pglite) — Postgres в процессе, Docker не нужен.
launcher/     Electron + TypeScript + React (Vite), @xmcl/core + @xmcl/installer, electron-builder (NSIS x64).
server-mod/   NeoForge 1.21.1 мод `ageafterauth` (только сервер).
tools/pack/   Node-скрипт сборки манифеста из инстанса CurseForge (запускается локально).
docs/         Этот план.
```

**Секретов в репозитории нет.** SMTP, приватный ключ подписи и `DATABASE_URL` хранятся в переменных Railway. Пароли и ключи владелец вводит сам.

## 1. backend — сервер аккаунтов

API по спецификации authlib-injector (Yggdrasil): https://github.com/yushijinhun/authlib-injector/wiki/Yggdrasil-服务端技术规范
Корень API — `PUBLIC_URL` (например, `https://<app>.up.railway.app`).

**Yggdrasil:**

- `GET /` — метаданные:
  - `meta.serverName = "The Age After"`, `implementationName`;
  - `meta.links.homepage` / `register`;
  - `meta["feature.non_email_login"] = true`;
  - `skinDomains: [host из PUBLIC_URL]`;
  - `signaturePublickey` (PEM).
- `POST /authserver/authenticate` — `username` (ник **или** почта) + `password` → `accessToken`, `clientToken`, `availableProfiles`, `selectedProfile`, опционально `user`. Только для статуса `active`. Ошибки в формате Yggdrasil: `{error:"ForbiddenOperationException", errorMessage:"..."}`, HTTP 403.
- `POST /authserver/refresh | validate | invalidate | signout`.
- `POST /sessionserver/session/minecraft/join` — `{accessToken, selectedProfile, serverId}`. Записывается в память на 30 с, 204.
- `GET /sessionserver/session/minecraft/hasJoined?username&serverId[&ip]` → 200 с профилем и **подписанными** textures, иначе 204.
- `GET /sessionserver/session/minecraft/profile/{uuid}?unsigned=` → 200 или 204.
- `POST /api/profiles/minecraft` (массово ник → `{id,name}`), `GET /api/users/profiles/minecraft/{name}`.
- `GET /minecraftservices/publickeys` → `{profilePropertyKeys:[{publicKey:<base64 DER SPKI>}], playerCertificateKeys:[...]}`.
- `GET /minecraftservices/player/attributes`, `/privacy/blocklist`, `/minecraft/profile`. Подпись чата не поддерживаем: на сервере `enforce-secure-profile=false`, `/player/certificates` отвечает 404.
- `GET /textures/{sha256}` — PNG скина.

Профиль: `{id (uuid без дефисов), name, properties:[{name:"textures", value:base64(json), signature?}, {name:"uploadableTextures", value:"skin"}]}`. JSON textures: `{timestamp, profileId, profileName, textures:{SKIN:{url, metadata?:{model:"slim"}}}}`. Подпись: **SHA1withRSA**, ключ RSA-4096 из env `SIGNING_PRIVATE_KEY` (PEM), а если его нет — созданный при первом запуске и сохранённый в базе (`app_secrets`).

**API лаунчера** (`/launcher/*`, JSON, Bearer = accessToken):

- `GET config` → `{serverName, serverAddress (env SERVER_ADDRESS), packManifestUrl (env), apiRoot}`;
- `POST register` → `{username 3–16 [A-Za-z0-9_], email, password ≥ 8}`;
- `GET /verify?token` — HTML-страница «почта подтверждена»;
- `POST resend-verification`;
- `POST forgot-password` → письмо со ссылкой на `GET /reset?token` (HTML-форма) → `POST reset-password`;
- `GET me`, `POST change-password`;
- `POST skin` → `{png base64, model: classic|slim}`, проверка PNG 64×64 или 64×32;
- `GET news`.

Жизненный цикл аккаунта: `pending_email` → (ссылка из письма) → `pending_approval` → (админ) → `active`. Из любого состояния возможны `rejected` и `banned`. Если SMTP не настроен, письма пишутся в лог, а шаг подтверждения почты пропускается (сразу `pending_approval`).

**Админка** `GET /admin`: одна HTML-страница с JS.
- Вход админ-аккаунтом.
- Список заявок и пользователей, кнопки «Одобрить», «Отклонить», «Бан», «Разбан».
- Простая лента новостей для лаунчера.
- Админу (`ADMIN_NOTIFY_EMAIL`) уходит письмо о каждой новой заявке.
- Первый админ создаётся командой `node dist/scripts/make-admin.js <ник>` (Railway shell).

**Безопасность:**
- пароли хешируются argon2id (`@node-rs/argon2`);
- `@fastify/rate-limit` на authserver, register, forgot-password и `/admin` login;
- токены — 32 случайных байта, в базе только sha256;
- одноразовые токены почты и сброса: TTL 24 ч и 1 ч;
- каждое действие админа пишется в `audit_log`.

**Таблицы:** `users`, `access_tokens`, `email_tokens`, `skins` (png bytea, sha256), `news`, `audit_log`.

**Env:** `PORT`, `DATABASE_URL`, `PUBLIC_URL`, `SIGNING_PRIVATE_KEY`, `SERVER_ADDRESS`, `PACK_MANIFEST_URL`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`, `ADMIN_NOTIFY_EMAIL`.

Ключ можно сгенерировать `npm run gen-key` и задать в Railway; без него сервер создаёт ключ сам и хранит в базе.

**Деплой (делает владелец):** Railway → New Project → Deploy from GitHub → root `backend/` (Dockerfile) → Add PostgreSQL → переменные. Миграции Drizzle применяются при старте.

**Тесты (vitest + PGlite)** проходят весь цикл:
register → verify → approve → authenticate → join → hasJoined (подпись textures проверяется публичным ключом из `GET /`) → refresh/validate/invalidate → неверный пароль 403 → rate limit.

## 2. server-mod — `ageafterauth`

- NeoForge 1.21.1, `neo_version=21.1.256`, Java 21, `net.neoforged.moddev` 2.0.78, parchment `2024.11.17`. Шаблон — любой мод владельца (например, langsystem-mod).
- Только dedicated-сервер: в `@Mod`-конструкторе проверяется `FMLEnvironment.dist.isDedicatedServer()`, `displayTest = IGNORE_SERVER_VERSION`.
- Конструктор читает `config/ageafterauth.properties` обычным `Properties.load`, потому что ModConfigSpec грузится позже. Ключ `api_root=https://...`. Дальше:
  - `System.setProperty("minecraft.api.session.host", root + "/sessionserver")`;
  - `System.setProperty("minecraft.api.services.host", root + "/minecraftservices")`;
  - запись в лог о перенаправлении.
- Если файла нет, мод создаёт шаблон с закомментированным `api_root`, ничего не меняет и пишет WARN.
- Сервер после этого: `online-mode=true`, `enforce-secure-profile=false`.
- Версия 0.1.0, semver повышается при каждом изменении (patch — фикс, minor — фича). `options.encoding = 'UTF-8'`.
- Smoke-тест: `./gradlew runServer` + бэкенд. Вход с токеном нашего сервера проходит, с чужим — «Failed to verify username».

## 3. tools/pack — манифест сборки (только локально у владельца)

Скрипт читает инстанс CurseForge: `minecraftinstance.json`, `mods/`, `config/`, `options.txt`. Результат — `manifest.json`:

```json
{ "packVersion": "YYYY.MM.DD-N", "minecraft": "1.21.1", "neoforge": "21.1.256",
  "files": [ { "path": "mods/x.jar", "sha1": "…", "size": 123, "url": "https://edge.forgecdn.net/…" } ],
  "managedDirs": ["mods"], "firstInstallOnly": ["options.txt"] }
```

- Моды из CurseForge идут ссылками на их CDN, мы их не перераздаём.
- Свои jar и `config.zip` загружаются в GitHub Release `pack-latest` (`gh release upload --clobber`), туда же `manifest.json`.
- `tools/pack/sides.json` хранит моды только для сервера (не уходят клиентам) и только для клиента.
- `*.disabled` пропускаются.
- `options.txt` (раскладка клавиш) ставится только при первой установке.

## 4. launcher — Electron, Windows

- **Экраны:**
  - вход;
  - регистрация, затем «подтвердите почту» и «ждём одобрения»;
  - «забыли пароль»;
  - главная: «Играть», прогресс, онлайн сервера через MC ping, новости;
  - настройки: ОЗУ, папка, «открыть папку», «переустановить»;
  - скин.
- **Установка** (`@xmcl/installer`): Java 21 из java-runtime Mojang, ванилла 1.21.1, `installNeoForged` 21.1.256, authlib-injector (последний релиз, проверка sha256).
- **Синхронизация:** 8 потоков, проверка sha1; лишнее из `managedDirs` удаляется; конфиги перезаписываются при смене `packVersion`, кроме `firstInstallOnly`. Если файл не скачался, лаунчер говорит, какой именно.
- **Запуск** (`@xmcl/core`):
  - `-javaagent:authlib-injector.jar=<apiRoot>`;
  - `--username/--uuid/--accessToken/--userType mojang`;
  - `--quickPlayMultiplayer <serverAddress>`;
  - Xmx из настроек.
- **Хранение:** accessToken шифруется Electron `safeStorage`, пароль не хранится.
- **Автообновление:** electron-updater из публичных GitHub Releases этого репозитория.
- Проект лежит в пути с кириллицей. Если NSIS споткнётся, собирать через `subst X:` с ASCII-путём.

## Известные ограничения

- **Облачные аватары Figura** с нашими аккаунтами не работают: Figura проверяет игрока через Mojang. Возможное решение потом — свой Figura-бэкенд (Sculptor).
- **Установщик не подписан**, Windows SmartScreen покажет предупреждение.

## Кто что делает

| Этап | Где можно делать |
|---|---|
| 1. backend: код, тесты, Dockerfile | облако или локально |
| 2. server-mod: код, сборка jar | облако или локально (сборка Gradle); smoke-тест с клиентом — локально |
| 3. манифест сборки | **только локально** (нужен инстанс CurseForge владельца) |
| 4. launcher: код | облако или локально; **сборка NSIS и проверка — только локально (Windows)** |
| деплой Railway, ввод секретов | владелец |
| переключение сервера: мод на хостинг, `online-mode=true`, рестарт | локально, через панель хостинга |

## Статус

- [x] Исследование, архитектура, решения владельца.
- [x] `backend/package.json`, `tsconfig.json`, зависимости. npm 11: в `allowScripts` разрешён только `esbuild`.
- [x] Этап 1 — backend: код, 42 теста (vitest + PGlite), smoke-тест на настоящем Postgres 16, Dockerfile, `railway.json`. Инструкция деплоя — `backend/README.md`. Осталось владельцу: деплой на Railway и секреты.
- [x] Этап 2 — server-mod: код и JUnit-тесты логики (проверены в облаке против заглушек API). Jar собирает GitHub Actions (`server-mod.yml`): maven.neoforged.net из облачной песочницы недоступен. Осталось: smoke-тест `runServer` локально.
- [x] Этап 3 — `tools/pack/build-pack.mjs` + тесты. Осталось владельцу: запустить на своём инстансе с `--upload` (создаст Release `pack-latest`).
- [x] Этап 4 — launcher: код, 19 тестов (в т.ч. сквозной с `tools/pack`), сборка electron-vite, проверка интерфейса в браузере. Установщик собирает GitHub Actions на Windows по тегу `v*` (`launcher.yml`). Осталось владельцу: переменная `LAUNCHER_API_ROOT`, тег `v0.1.0`, проверка на Windows.
- [ ] Переключение сервера.
