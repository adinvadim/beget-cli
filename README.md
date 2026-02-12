# beget-cli (MVP)

Практичный CLI для Beget API: хранит профили локально, умеет получать данные аккаунта, доменов и DNS.

## Что реализовано
- `beget auth add <name>` — добавить/обновить профиль (интерактивно, API password маскируется)
- `beget auth list` — список профилей
- `beget auth use <name>` — выбрать активный профиль
- `beget auth remove <name>` — удалить профиль
- `beget account info` — `user/getAccountInfo`
- `beget domains list [--all] [--expiring-days N]` — `domain/getList` (по умолчанию только активные/managed домены, с меткой скорого истечения)
- `beget domains expiring [--days N] [--all]` — только домены, которые скоро истекают
- `beget dns list <domain>` — `dns/getData`
- `beget dns ns-get <domain>` — посмотреть текущие NS (`DNS`)
- `beget dns ns-set <domain> <ns1> <ns2> [--ip1 <ip> --ip2 <ip>]` — сменить NS через `dns/changeRecords`
- `--json` для машинного вывода
- `--dry-run` для команд, меняющих локальное состояние (`auth add/use/remove`)
- аккуратные ошибки + коды выхода
- self-check скрипт

## Установка/запуск
```bash
cd /Users/mini/.openclaw/workspace/projects/beget-cli
npm install

# запуск без global install
node ./bin/beget.js --help

# опционально: линк как beget
npm link
beget --help
```

## Быстрый старт
```bash
# 1) Добавить профиль (интерактивно)
beget auth add main

# 2) Проверить профили
beget auth list

# 3) Запросить данные аккаунта
beget account info --json

# 4) Список доменов
beget domains list --json

# 5) DNS по домену
beget dns list example.com --json
```

## Неинтерактивный режим
API ключ через env (не через аргументы):
```bash
BEGET_API_PASSWORD='your_api_password' beget auth add main --login your_login --no-input
# (совместимость: BEGET_API_KEY тоже поддерживается)
```

## Конфиг и безопасность
- Путь по умолчанию:
  - `$XDG_CONFIG_HOME/beget-cli/config.json` (если `XDG_CONFIG_HOME` задан)
  - иначе `~/.config/beget-cli/config.json`
- Можно переопределить: `--config` или `BEGET_CONFIG`
- Права выставляются автоматически:
  - директория `0700`
  - файл `0600`

Пример формата:
```json
{
  "version": 1,
  "activeProfile": "main",
  "profiles": {
    "main": {
      "login": "your_login",
      "apiKey": "your_api_password"
    }
  }
}
```

## Приоритет источников (flags/env/config)
1. Flags (`--profile`, `--login`, `--base-url`, `--config`, `--timeout`)
2. Env (`BEGET_PROFILE`, `BEGET_LOGIN`, `BEGET_API_PASSWORD` или `BEGET_API_KEY`, `BEGET_API_BASE_URL`, `BEGET_CONFIG`)
3. Активный профиль в user config

## Коды выхода
- `0` — успех
- `1` — непредвиденная ошибка
- `2` — ошибка использования CLI / валидации
- `3` — ошибка авторизации/кредитов
- `4` — ошибка Beget API
- `5` — ошибка конфига
- `6` — сеть/таймаут/HTTP

## Self-check
```bash
npm run self-check
```
Проверяет базовые сценарии CLI (без сетевых вызовов к Beget API).

## Ограничения MVP
- Реализованы только базовые read-команды API + локальное управление профилями.
- Нет команд изменения данных на стороне Beget (DNS/domain mutate) — только чтение.
- Нет retry/backoff и расширенной телеметрии.
- Нет шифрования API password (хранится в локальном файле с ограниченными правами).

## Документация API
- https://beget.com/en/kb/api/beget-api
- https://beget.com/en/kb/api/basic-principles-of-operation-with-api
- https://beget.com/en/kb/api/account-administration-functions
- https://beget.com/en/kb/api/functions-for-work-with-domains
- https://beget.com/en/kb/api/dns-administration-functions
