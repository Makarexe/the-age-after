# The Age After

Лаунчер и сервер аккаунтов для модового сервера Minecraft «The Age After» (NeoForge 1.21.1).

- **launcher/** — лаунчер для Windows. Вход своим аккаунтом, автоустановка Java, Minecraft, NeoForge и сборки модов.
- **backend/** — сервер аккаунтов: регистрация с подтверждением почты и одобрением админа, Yggdrasil API для authlib-injector, скины, админка.
- **server-mod/** — мод `ageafterauth`: на сервере проверяет игроков через наш сервер аккаунтов вместо Mojang, у игроков чинит аватары Figura.
- **tools/pack/** — сборка манифеста модпака.
- **figura/** — облако аватаров Figura (Sculptor) для наших аккаунтов.

Подробный план и статус — в [docs/PLAN.md](docs/PLAN.md).
