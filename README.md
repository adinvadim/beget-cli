# beget-cli

CLI для Beget API с единым UX по clig.dev/create-cli.

Покрытие: `account`, `domains`, `dns`, `ftp`, `mail`, `mysql`, `backup`, `cron`, `sites`.

## Установка

```bash
cd /Users/mini/.openclaw/workspace/projects/beget-cli
npm install
npm link   # опционально, чтобы вызывать как `beget`
beget --help
```

## Авторизация

Интерактивно:

```bash
beget auth add main
beget auth use main
beget account info --json
```

Неинтерактивно:

```bash
BEGET_API_PASSWORD='***' beget auth add main --login mylogin --no-input
```

## Быстрые примеры

```bash
# аккаунт
beget account info --json

# домены (по умолчанию: только active/managed)
beget domains list --json

# только истекающие домены
beget domains expiring --days 45 --json

# DNS/NS
beget dns list adinvadim.ru --json
beget dns ns-get adinvadim.ru --json
beget dns ns-set adinvadim.ru ns1.example.net ns2.example.net --dry-run --json
```

## Безопасность

- Секреты не передавай через аргументы CLI.
- Используй env-переменные или masked prompt.
- Для mutate-команд есть `--dry-run`.
- Для рискованных операций в non-interactive режиме обязателен `--yes`.

## Конфиг и precedence

Config path:
- `--config`
- `BEGET_CONFIG`
- `$XDG_CONFIG_HOME/beget-cli/config.json`
- `~/.config/beget-cli/config.json`

Precedence:
1. flags
2. env
3. active profile в config

## Namespace map

### account
- `info`
- `toggle-ssh`

### domains
- `list`
- `expiring`
- `zone-list`
- `add-virtual`
- `delete`
- `subdomain-list`
- `add-subdomain-virtual`
- `delete-subdomain`
- `check-to-register`
- `php-version-get`
- `php-version-change`
- `directives-get`
- `directives-add`
- `directives-remove`

### dns
- `list`
- `ns-get`
- `ns-set`
- `change-records`

### ftp
- `list`
- `add`
- `change-password`
- `delete`

### mail
- `mailbox-list`
- `mailbox-password-change`
- `mailbox-create`
- `mailbox-drop`
- `mailbox-settings-change`
- `forward-add`
- `forward-delete`
- `forward-show`
- `domain-mail-set`
- `domain-mail-clear`

### mysql
- `list`
- `db-add`
- `access-add`
- `db-drop`
- `access-drop`
- `access-password-change`

### backup
- `file-backup-list`
- `mysql-backup-list`
- `file-list`
- `mysql-list`
- `restore-file`
- `restore-mysql`
- `download-file`
- `download-mysql`
- `log`

### cron
- `list`
- `add`
- `delete`
- `change-hidden-state`
- `email-get`
- `email-set`

### sites
- `list`
- `add`
- `delete`
- `link-domain`
- `unlink-domain`
- `freeze`
- `unfreeze`
- `is-frozen`

## Выходные коды

- `0` успех
- `1` непредвиденная ошибка
- `2` usage/validation
- `3` auth/credentials
- `4` API error
- `5` config error
- `6` network/timeout/http

## Self-check

```bash
npm run self-check
```
