# CLI_SPEC

## Name
`beget`

## Scope
Полное покрытие методов Beget API (hosting KB, RU+EN):
`user`, `domain`, `dns`, `ftp`, `mail`, `mysql`, `backup`, `cron`, `site`, `stat`.

Источники каталога методов:
- `https://beget.com/ru/kb/api/funkczii-upravleniya-akkauntom`
- `https://beget.com/ru/kb/api/funkczii-upravleniya-bekapami`
- `https://beget.com/ru/kb/api/funkczii-upravleniya-cron`
- `https://beget.com/ru/kb/api/funkczii-upravleniya-dns`
- `https://beget.com/ru/kb/api/funkczii-upravleniya-ftp`
- `https://beget.com/ru/kb/api/funkczii-upravleniya-mysql`
- `https://beget.com/ru/kb/api/funkczii-upravleniya-sajtami`
- `https://beget.com/ru/kb/api/funkczii-dlya-raboty-s-domenami`
- `https://beget.com/ru/kb/api/funkczii-dlya-raboty-s-pochtoj`
- `https://beget.com/ru/kb/api/funkczii-dlya-sbora-statistiki`
(EN mirror pages содержат тот же набор методов.)

## Global flags
- `--config <path>`
- `--profile <name>`
- `--login <login>`
- `--base-url <url>`
- `--timeout <ms>`
- `--json`
- `--yes`

## Safety contract
- Все mutate-команды поддерживают `--dry-run`.
- Risky mutate (delete/drop/restore) требуют подтверждение:
  - interactive: prompt `y/N`
  - non-interactive: обязателен `--yes`

## Full method → command map

### user
- `user/getAccountInfo` → `account info`
- `user/toggleSsh` → `account toggle-ssh`

### domain
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
- `dns/getData` → `dns list` (+ shortcut `dns ns-get`)
- `dns/changeRecords` → `dns change-records` (+ shortcut `dns ns-set`)

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
- `cron/edit` → `cron edit`
- `cron/delete` → `cron delete`
- `cron/changeHiddenState` → `cron change-hidden-state`
- `cron/getEmail` → `cron email-get`
- `cron/setEmail` → `cron email-set`

### site
- `site/getList` → `sites list`
- `site/add` → `sites add`
- `site/delete` → `sites delete`
- `site/linkDomain` → `sites link-domain`
- `site/unlinkDomain` → `sites unlink-domain`
- `site/freeze` → `sites freeze`
- `site/unfreeze` → `sites unfreeze`
- `site/isSiteFrozen` → `sites is-frozen`

### stat
- `stat/getSitesListLoad` → `stats sites-list-load`
- `stat/getSiteLoad` → `stats site-load`
- `stat/getDbListLoad` → `stats db-list-load`
- `stat/getDbLoad` → `stats db-load`

## Exit codes
- `0` OK
- `1` generic
- `2` usage/validation
- `3` auth
- `4` API-level
- `5` config
- `6` network/timeout/http
