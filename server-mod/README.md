# server-mod — `ageafterauth`

Серверный мод для NeoForge 1.21.1. Перенаправляет проверку игроков (authlib) с Mojang на наш сервер аккаунтов, чтобы сервер работал в `online-mode=true` с нашими аккаунтами. На клиенте ничего не делает, игрокам его ставить не нужно.

Как работает: в конструкторе мода (он выполняется до создания сервиса авторизации) читается `config/ageafterauth.properties` и задаются системные свойства `minecraft.api.session.host = <api_root>/sessionserver` и `minecraft.api.services.host = <api_root>/minecraftservices`. Флаги JVM не нужны.

## Сборка

- **GitHub Actions** (workflow `server-mod`): jar лежит в артефактах каждого запуска. Тег `ageafterauth-v0.1.0` публикует его в GitHub Release.
- **Локально:** `./gradlew build` (Windows: `gradlew.bat build`), нужен JDK 21. Jar — `build/libs/ageafterauth-<версия>.jar`.

Тесты логики (без Minecraft): `./gradlew test`. Запуск сервера для проверки: `./gradlew runServer` (папка `run/`).

## Установка на сервер

1. Положить `ageafterauth-<версия>.jar` в `mods/` сервера.
2. Запустить сервер один раз — появится `config/ageafterauth.properties` с шаблоном.
3. Вписать адрес сервера аккаунтов (тот же, что `PUBLIC_URL` бэкенда):

   ```properties
   api_root=https://<app>.up.railway.app
   ```

4. В `server.properties`:

   ```properties
   online-mode=true
   enforce-secure-profile=false
   ```

5. Перезапустить сервер. В логе должна быть строка `Player verification redirected to https://...`. Если в `server.properties` что-то не так, мод напишет WARN.

Откатиться: убрать мод (или закомментировать `api_root`) и вернуть `online-mode=false`.

## Smoke-тест

`./gradlew runServer` + запущенный бэкенд, в `run/config/ageafterauth.properties` — `api_root` бэкенда. Клиент через лаунчер (с authlib-injector) заходит; клиент с чужим токеном получает «Failed to verify username».

## Версии

`gradle.properties`: `mod_version` по semver (patch — фикс, minor — фича), NeoForge `21.1.256`, ModDevGradle `2.0.78`, parchment `2024.11.17`.
