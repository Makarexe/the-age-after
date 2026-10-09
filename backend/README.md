# backend — сервер аккаунтов The Age After

Node 22+/24, TypeScript, Fastify 5, Drizzle ORM, PostgreSQL. Отдаёт:

- Yggdrasil API для authlib-injector (корень API — `PUBLIC_URL`);
- API лаунчера `/launcher/*`;
- страницы из писем `/verify`, `/reset`;
- админку `/admin`.

## Локально

```bash
npm ci
cp .env.example .env      # заполнить DATABASE_URL и PUBLIC_URL
npm run dev               # без SIGNING_PRIVATE_KEY создаст ключ и сохранит его в базе
npm test                  # vitest + PGlite, Postgres не нужен
npm run typecheck
```

Если `npm ci` ругается `EBADPLATFORM` на `@esbuild/*`, обновите npm до 11 (`npx npm@11 ci`): lockfile сделан npm 11.

Миграции лежат в `drizzle/` и применяются при старте. После изменения `src/db/schema.ts`: `npm run db:generate`.

## Деплой на Railway

1. New Project → Deploy from GitHub repo → этот репозиторий. В настройках сервиса: **Root Directory** = `backend`. Сборка по `Dockerfile`, healthcheck `/health` (см. `railway.json`).
2. Add → Database → PostgreSQL. В переменных сервиса: `DATABASE_URL` = `${{Postgres.DATABASE_URL}}`.
3. Settings → Networking → Generate Domain. Этот адрес — `PUBLIC_URL` (с `https://`, без `/` в конце).
4. Ключ подписи: ничего делать не нужно. При первом запуске сервер сам создаст ключ RSA-4096 и сохранит его в базе (таблица `app_secrets`); при следующих запусках берёт его оттуда. Не удаляйте базу: при смене ключа игроки не смогут зайти, пока не перезапустится MC-сервер. Свой ключ можно задать переменной `SIGNING_PRIVATE_KEY` (PEM, `npm run gen-key`) — она важнее ключа из базы.
5. Остальные переменные:

| Переменная | Пример |
|---|---|
| `SERVER_ADDRESS` | `play.example.ru:25565` |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE` | `smtp.yandex.ru`, `465`, `true` (Gmail: `smtp.gmail.com`, `465`, `true`) |
| `SMTP_USER`, `SMTP_PASS` | почта и **пароль приложения** (не основной пароль) |
| `MAIL_FROM` | `The Age After <you@yandex.ru>` (адрес должен совпадать с `SMTP_USER`) |
| `ADMIN_NOTIFY_EMAIL` | куда слать письма о новых заявках |
| `PACK_MANIFEST_URL` | можно не задавать: по умолчанию Release `pack-latest` этого репозитория |

Без `SMTP_HOST` письма пишутся в лог, а подтверждение почты пропускается.

6. Первый админ: зарегистрируйтесь через лаунчер (или `POST /launcher/register`), затем в Railway → сервис → Shell:

   ```bash
   node dist/scripts/make-admin.js <ваш ник>
   ```

   Админка: `PUBLIC_URL/admin`.

## API

Yggdrasil — по [спецификации authlib-injector](https://github.com/yushijinhun/authlib-injector/wiki/Yggdrasil-服务端技术规范). Все ошибки — `{error, errorMessage}`.

Лаунчер (`Authorization: Bearer <accessToken>` там, где нужен вход):

| Метод | Путь | Тело / ответ |
|---|---|---|
| GET | `/launcher/config` | `{serverName, serverAddress, packManifestUrl, apiRoot}` |
| POST | `/launcher/register` | `{username, email, password}` → 201 `{status, mailSent}` |
| POST | `/launcher/resend-verification` | `{login}` → 204 |
| POST | `/launcher/forgot-password` | `{login}` → 204 |
| POST | `/launcher/reset-password` | `{token, password}` → 204 |
| GET | `/launcher/me` | профиль, статус, скин |
| POST | `/launcher/change-password` | `{oldPassword, newPassword}` → 204 |
| POST | `/launcher/skin` | `{png: base64, model: classic\|slim}` → профиль; без `png` меняется только модель |
| DELETE | `/launcher/skin` | → профиль |
| GET | `/launcher/news` | `[{id, title, body, createdAt}]` |

Вход в лаунчере — обычный `POST /authserver/authenticate` (ник или почта).
