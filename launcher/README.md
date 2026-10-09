# launcher — лаунчер The Age After (Windows)

Electron + TypeScript + React (electron-vite), установка через `@xmcl/installer`, запуск через `@xmcl/core`, установщик — electron-builder (NSIS x64).

## Что делает

- Вход своим аккаунтом (ник или почта), регистрация → подтверждение почты → одобрение админом, сброс и смена пароля.
- По кнопке «Играть»:
  1. обновляет токен (`/authserver/refresh`) и берёт `/launcher/config` (адрес сервера, ссылка на манифест);
  2. ставит Minecraft 1.21.1, Java из java-runtime Mojang (компонент берётся из версии, для 1.21.1 — Java 21), NeoForge 21.1.256;
  3. скачивает последний authlib-injector (sha256 проверяется; запасной источник — GitHub Releases);
  4. синхронизирует сборку по манифесту из `tools/pack`: 8 потоков, проверка sha1, лишнее из `mods/` удаляется, `config.zip` распаковывается, только когда он сам изменился (`options.txt` — только если его ещё нет); если файл не скачался, лаунчер пишет, какой именно;
  5. запускает игру с `-javaagent:authlib-injector.jar=<API>`, `--quickPlayMultiplayer <адрес>`, `-Xmx` из настроек.
- Онлайн сервера (Server List Ping, с SRV), новости, скин (PNG 64×64/64×32, обычная или тонкая модель).
- Настройки: память, папка игры (по умолчанию `%APPDATA%\.theageafter`), «Проверить файлы», логи.
- Токен хранится зашифрованным через Electron `safeStorage` (DPAPI), пароль не хранится.
- Автообновление: electron-updater из GitHub Releases этого репозитория.

## Разработка

```powershell
cd launcher
npm ci                 # нужен npm 11 (Node 24); на npm 10: npx npm@11 ci
npm run dev            # лаунчер с hot reload
npm run preview:ui     # только интерфейс в браузере, с фейковыми данными (http://localhost:5199, ?login — экран входа)
npm run typecheck
npm test
```

Адрес сервера аккаунтов по умолчанию — `https://the-age-after-production.up.railway.app` (`src/main/index.ts`). Для другой сборки его можно заменить переменной `MAIN_VITE_API_ROOT` (например, в `launcher/.env.local`). Игрок может переопределить адрес в «Настройки → Дополнительно».

## Сборка установщика

**Через GitHub Actions (рекомендуется), без командной строки:**

1. Для новой версии поднять `version` в `launcher/package.json` (в `main`). Для первой — ничего менять не надо, там `0.1.0`.
2. GitHub → **Actions** → workflow **launcher** → **Run workflow** → ветка `main` → галочка **Опубликовать релиз** → **Run workflow**.
3. Через ~10 минут в **Releases** появится `v<версия>` с `TheAgeAfter-Setup-<версия>.exe`. Уже установленные лаунчеры обновятся сами.

Без галочки (или на любой другой ветке) установщик только собирается и прикрепляется к запуску workflow (артефакт `installer`) — так его можно проверить до релиза.

Можно и тегом: `git tag v0.1.0 && git push origin v0.1.0` — версия в теге должна совпадать с `package.json`. Необязательная переменная репозитория `LAUNCHER_API_ROOT` (Settings → Secrets and variables → Actions → Variables) заменяет адрес сервера аккаунтов при сборке.

**Локально (Windows):**

```powershell
$env:MAIN_VITE_API_ROOT = "https://<app>.up.railway.app"
npm run dist           # → launcher\release\TheAgeAfter-Setup-<версия>.exe
```

Если NSIS споткнётся о кириллицу в пути проекта — соберите из ASCII-пути: `subst X: "C:\путь\к\the-age-after"`, затем `X:` и `cd launcher`.

Релизы `pack-latest` (сборка модов) и `ageafterauth-v*` (серверный мод) публикуются как pre-release, чтобы electron-updater не принял их за новую версию лаунчера.

## Известные ограничения

- Установщик не подписан: Windows SmartScreen покажет «Неизвестный издатель» → «Подробнее» → «Выполнить в любом случае».
- Облачные аватары Figura с нашими аккаунтами не работают (Figura проверяет игрока через Mojang).
