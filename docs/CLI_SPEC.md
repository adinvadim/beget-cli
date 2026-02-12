# CLI_SPEC (create-cli aligned)

## Name
`beget`

## Scope
Полный CLI для методов Beget API из KB:
- account (`user/*`)
- domains (`domain/*`)
- dns (`dns/*`)
- ftp (`ftp/*`)
- mail (`mail/*`)
- mysql (`mysql/*`)
- backup (`backup/*`)
- cron (`cron/*`)
- sites (`site/*`)

## UX contract
- Команда: `beget [global flags] <namespace> <command> [options]`
- Общие флаги:
  - `--config <path>`
  - `--profile <name>`
  - `--login <login>`
  - `--base-url <url>`
  - `--timeout <ms>`
  - `--json`
  - `--yes` (global confirmation for risky actions)
- `--help` и примеры по каждой группе/команде через Commander help.

## stdout/stderr
- Успешные данные → stdout
- Ошибки/диагностика → stderr
- `--json` делает вывод и ошибки machine-friendly JSON

## Secrets policy
- Секреты не передаются positional args.
- Источники секретов:
  - env (`BEGET_API_PASSWORD`, `BEGET_API_KEY`, `BEGET_FTP_PASSWORD`, `BEGET_MAILBOX_PASSWORD`, `BEGET_MYSQL_PASSWORD`)
  - masked prompt (TTY)
- В `--no-input` режиме без env-секретов команда завершается с code `2`.

## Precedence (flags/env/config)
1. flags
2. env
3. config (active profile)

## Mutations, dry-run, confirmations
- Любая mutate-команда поддерживает `--dry-run`.
- Risky mutate-команды (delete/drop/restore и т.п.):
  - interactive: подтверждение `y/N` если нет `--yes`
  - non-interactive: без `--yes` блокируются

## Exit codes
- `0` OK
- `1` generic
- `2` usage/validation
- `3` auth
- `4` API-level
- `5` config
- `6` network/timeout/http

## API coverage matrix

### account
- `user/getAccountInfo` → `account info`
- `user/toggleSsh` → `account toggle-ssh`

### domains
- `domain/getList` → `domains list`
- `domain/getZoneList` → `domains zone-list`
- `domain/addVirtual` → `domains add-virtual`
- `domain/delete` → `domains delete`
- `domain/getSubdomainList` → `domains subdomain-list`
- `domain/addSubdomainVirtual` → `domains add-subdomain-virtual`
- `domain/deleteSubdomain` → `domains delete-subdomain`
- `domain/checkDomainToRegister` → `domains check-to-register`
- `domain/getPhpVersion` → `domains php-version-get`
- `domain/changePhpVersion` → `domains php-version-change`
- `domain/getDirectives` → `domains directives-get`
- `domain/addDirectives` → `domains directives-add`
- `domain/removeDirectives` → `domains directives-remove`

### dns
- `dns/getData` → `dns list`, `dns ns-get`
- `dns/changeRecords` → `dns change-records`, `dns ns-set`

### ftp
- `ftp/getList` → `ftp list`
- `ftp/add` → `ftp add`
- `ftp/changePassword` → `ftp change-password`
- `ftp/delete` → `ftp delete`

### mail
- `mail/getMailboxList` → `mail mailbox-list`
- `mail/changeMailboxPassword` → `mail mailbox-password-change`
- `mail/createMailbox` → `mail mailbox-create`
- `mail/dropMailbox` → `mail mailbox-drop`
- `mail/changeMailboxSettings` → `mail mailbox-settings-change`
- `mail/forwardListAddMailbox` → `mail forward-add`
- `mail/forwardListDeleteMailbox` → `mail forward-delete`
- `mail/forwardListShow` → `mail forward-show`
- `mail/setDomainMail` → `mail domain-mail-set`
- `mail/clearDomainMail` → `mail domain-mail-clear`

### mysql
- `mysql/getList` → `mysql list`
- `mysql/addDb` → `mysql db-add`
- `mysql/addAccess` → `mysql access-add`
- `mysql/dropDb` → `mysql db-drop`
- `mysql/dropAccess` → `mysql access-drop`
- `mysql/changeAccessPassword` → `mysql access-password-change`

### backup
- `backup/getFileBackupList` → `backup file-backup-list`
- `backup/getMysqlBackupList` → `backup mysql-backup-list`
- `backup/getFileList` → `backup file-list`
- `backup/getMysqlList` → `backup mysql-list`
- `backup/restoreFile` → `backup restore-file`
- `backup/restoreMysql` → `backup restore-mysql`
- `backup/downloadFile` → `backup download-file`
- `backup/downloadMysql` → `backup download-mysql`
- `backup/getLog` → `backup log`

### cron
- `cron/getList` → `cron list`
- `cron/add` → `cron add`
- `cron/delete` → `cron delete`
- `cron/changeHiddenState` → `cron change-hidden-state`
- `cron/getEmail` → `cron email-get`
- `cron/setEmail` → `cron email-set`

### sites
- `site/getList` → `sites list`
- `site/add` → `sites add`
- `site/delete` → `sites delete`
- `site/linkDomain` → `sites link-domain`
- `site/unlinkDomain` → `sites unlink-domain`
- `site/freeze` → `sites freeze`
- `site/unfreeze` → `sites unfreeze`
- `site/isSiteFrozen` → `sites is-frozen`
