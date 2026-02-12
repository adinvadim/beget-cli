# beget-cli

Полный CLI для Beget API (account/domains/dns/ftp/mail/mysql/backup/cron/sites) с единым UX, `--json`, кодами выхода, безопасной работой с секретами, `--dry-run` и подтверждениями рискованных операций.

## Установка

```bash
cd /Users/mini/.openclaw/workspace/projects/beget-cli
npm install
npm link   # опционально
beget --help
```

## Быстрый старт (auth)

```bash
beget auth add main
beget auth use main
beget account info --json
```

Неинтерактивно:

```bash
BEGET_API_PASSWORD='***' beget auth add main --login mylogin --no-input
```

## Принципы CLI (create-cli)

- Единый формат: `beget <namespace> <command> [options]`
- Машинный вывод: `--json`
- Ошибки в `stderr`, данные в `stdout`
- Коды выхода (см. ниже)
- Без секретов в аргументах: пароли читаются из env / prompt
- Для mutate-команд: `--dry-run`
- Для рискованных mutate-команд: подтверждение (`--yes` в non-interactive)
- Приоритет: flags > env > config

## Конфиг / приоритет

- Config path: `--config` > `BEGET_CONFIG` > `$XDG_CONFIG_HOME/beget-cli/config.json` > `~/.config/beget-cli/config.json`
- Credentials/runtime precedence:
  1. flags (`--profile`, `--login`, `--base-url`, `--timeout`, `--config`)
  2. env (`BEGET_PROFILE`, `BEGET_LOGIN`, `BEGET_API_PASSWORD`/`BEGET_API_KEY`, `BEGET_API_BASE_URL`, `BEGET_CONFIG`)
  3. active profile из config

## Namespace / команды

### account
- `account info`
- `account toggle-ssh --status <0|1> [--ftplogin ...] [--dry-run]`

### domains
- `domains list`
- `domains zone-list`
- `domains add-virtual --hostname ... --zone-id ... [--dry-run]`
- `domains delete --id ... [--dry-run] [--yes]`
- `domains subdomain-list`
- `domains add-subdomain-virtual --subdomain ... --domain-id ... [--dry-run]`
- `domains delete-subdomain --id ... [--dry-run] [--yes]`
- `domains check-to-register --hostname ... --zone-id ... --period ...`
- `domains php-version-get --full-fqdn ...`
- `domains php-version-change --full-fqdn ... --php-version ... [--is-cgi true|false] [--dry-run]`
- `domains directives-get --full-fqdn ...`
- `domains directives-add --full-fqdn ... --directives-json '[...]' [--dry-run]`
- `domains directives-remove --full-fqdn ... --directives-json '[...]' [--dry-run]`

### dns
- `dns list <domain>`
- `dns ns-get <domain>`
- `dns ns-set <domain> <ns1> <ns2> [--ip1 ... --ip2 ...] [--dry-run]`
- `dns change-records --fqdn ... --records-json '{...}' [--dry-run]`

### ftp
- `ftp list`
- `ftp add --suffix ... --homedir ... [--dry-run] [--no-input]` (`BEGET_FTP_PASSWORD`)
- `ftp change-password --suffix ... [--dry-run] [--no-input]` (`BEGET_FTP_PASSWORD`)
- `ftp delete --suffix ... [--dry-run] [--yes]`

### mail
- `mail mailbox-list --domain ...`
- `mail mailbox-password-change --domain ... --mailbox ... [--dry-run] [--no-input]` (`BEGET_MAILBOX_PASSWORD`)
- `mail mailbox-create --domain ... --mailbox ... [--dry-run] [--no-input]` (`BEGET_MAILBOX_PASSWORD`)
- `mail mailbox-drop --domain ... --mailbox ... [--dry-run] [--yes]`
- `mail mailbox-settings-change --domain ... --mailbox ... --spam-filter-status ... --spam-filter ... --forward-mail-status ... [--dry-run]`
- `mail forward-add --domain ... --mailbox ... --forward-mailbox ... [--dry-run]`
- `mail forward-delete --domain ... --mailbox ... --forward-mailbox ... [--dry-run]`
- `mail forward-show --domain ... --mailbox ...`
- `mail domain-mail-set --domain ... --domain-mailbox ... [--dry-run]`
- `mail domain-mail-clear --domain ... [--dry-run]`

### mysql
- `mysql list`
- `mysql db-add --suffix ... [--dry-run] [--no-input]` (`BEGET_MYSQL_PASSWORD`)
- `mysql access-add --suffix ... --access ... [--dry-run] [--no-input]` (`BEGET_MYSQL_PASSWORD`)
- `mysql db-drop --suffix ... [--dry-run] [--yes]`
- `mysql access-drop --suffix ... --access ... [--dry-run] [--yes]`
- `mysql access-password-change --suffix ... --access ... [--dry-run] [--no-input]` (`BEGET_MYSQL_PASSWORD`)

### backup
- `backup file-backup-list`
- `backup mysql-backup-list`
- `backup file-list [--backup-id ...] [--path ...]`
- `backup mysql-list [--backup-id ...]`
- `backup restore-file --backup-id ... --paths a,b [--dry-run] [--yes]`
- `backup restore-mysql --backup-id ... --bases a,b [--dry-run] [--yes]`
- `backup download-file --paths a,b [--backup-id ...] [--dry-run]`
- `backup download-mysql --bases a,b [--backup-id ...] [--dry-run]`
- `backup log`

### cron
- `cron list`
- `cron add --minutes ... --hours ... --days ... --months ... --weekdays ... --command ... [--dry-run]`
- `cron delete --row-number ... [--dry-run] [--yes]`
- `cron change-hidden-state --row-number ... --is-hidden 0|1 [--dry-run]`
- `cron email-get`
- `cron email-set --email ... [--dry-run]`

### sites
- `sites list`
- `sites add --name ... [--dry-run]`
- `sites delete --id ... [--dry-run] [--yes]`
- `sites link-domain --domain-id ... --site-id ... [--dry-run]`
- `sites unlink-domain --domain-id ... [--dry-run]`
- `sites freeze --id ... [--excluded-paths p1,p2] [--dry-run]`
- `sites unfreeze --id ... [--dry-run]`
- `sites is-frozen --site-id ...`

## Коды выхода

- `0` успех
- `1` непредвиденная ошибка
- `2` usage/validation
- `3` auth/credentials
- `4` Beget API error
- `5` config error
- `6` network/timeout/http

## Self-check

```bash
npm run self-check
```
