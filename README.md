# beget-cli

CLI для Beget API с полным покрытием hosting API из KB (RU+EN) и всех
69 операций Beget Cloud VPS API v1.8.1.

Покрытие namespace: `account`, `domains`, `dns`, `ftp`, `mail`, `mysql`,
`backup`, `cron`, `sites`, `stats`, `vps`.

## Установка

```bash
cd /Users/mini/.openclaw/workspace/projects/beget-cli
npm install
npm link   # опционально, чтобы вызывать как `beget`
beget --help
```

## Авторизация

```bash
beget auth add main
beget auth use main
beget account info --json
```

Non-interactive:

```bash
BEGET_API_PASSWORD='***' beget auth add main --login mylogin --no-input
```

`auth add` проверяет данные безопасным read-only вызовом `user/getAccountInfo`
до записи профиля. Нужен именно пароль Beget API, а доступ к API должен быть
разрешён в панели управления. Для подготовки профиля без сети можно явно
пропустить проверку флагом `--no-verify`.

## Beget Cloud VPS

Cloud API использует отдельный JWT. CLI получает его по паролю аккаунта и
хранит только JWT в выбранном профиле:

```bash
beget auth cloud-login main --login mylogin
beget auth use main
beget vps regions --json
beget vps configurations --json
beget vps list --json
beget vps get VPS_ID --json
```

Создание и сложные изменения принимают тело из актуальной OpenAPI-схемы:

```bash
beget vps create --body-file create-vps.json --dry-run --json
beget vps create --body-file create-vps.json --json
beget vps stop VPS_ID --dry-run --json
beget vps remove VPS_ID --body-json '{"ip_action":"DELETE"}' --dry-run --json
beget vps remove VPS_ID --body-json '{"ip_action":"DELETE"}' --yes --json
```

Полное дерево из 69 операций, JWT-поток и правила безопасных мутаций описаны
в [docs/CLOUD_VPS.md](docs/CLOUD_VPS.md).

## Безопасность

- Секреты не передавать через positional args.
- Для mutate-команд есть `--dry-run`.
- Для рискованных операций (delete/drop/restore) в non-interactive обязателен `--yes`.
- Cloud-пароль не сохраняется; JWT никогда не печатается.
- Cloud read-запросы могут повторяться при временном сбое, mutate-запросы отправляются ровно один раз.

## Полный method -> command map

### user
- `user/getAccountInfo` → `beget account info`
- `user/toggleSsh` → `beget account toggle-ssh`

### domain
- `domain/getList` → `beget domains list`
- `domain/getZoneList` → `beget domains zone-list`
- `domain/addVirtual` → `beget domains add-virtual`
- `domain/delete` → `beget domains delete`
- `domain/getSubdomainList` → `beget domains subdomain-list`
- `domain/addSubdomainVirtual` → `beget domains add-subdomain-virtual`
- `domain/deleteSubdomain` → `beget domains delete-subdomain`
- `domain/checkDomainToRegister` → `beget domains check-to-register`
- `domain/getPhpVersion` → `beget domains php-version-get`
- `domain/changePhpVersion` → `beget domains php-version-change`
- `domain/getDirectives` → `beget domains directives-get`
- `domain/addDirectives` → `beget domains directives-add`
- `domain/removeDirectives` → `beget domains directives-remove`

### dns
- `dns/getData` → `beget dns list` (и shortcut `beget dns ns-get`)
- `dns/changeRecords` → `beget dns change-records` (и shortcut `beget dns ns-set`)

### ftp
- `ftp/getList` → `beget ftp list`
- `ftp/add` → `beget ftp add`
- `ftp/changePassword` → `beget ftp change-password`
- `ftp/delete` → `beget ftp delete`

### mail
- `mail/getMailboxList` → `beget mail mailbox-list`
- `mail/changeMailboxPassword` → `beget mail mailbox-password-change`
- `mail/createMailbox` → `beget mail mailbox-create`
- `mail/dropMailbox` → `beget mail mailbox-drop`
- `mail/changeMailboxSettings` → `beget mail mailbox-settings-change`
- `mail/forwardListAddMailbox` → `beget mail forward-add`
- `mail/forwardListDeleteMailbox` → `beget mail forward-delete`
- `mail/forwardListShow` → `beget mail forward-show`
- `mail/setDomainMail` → `beget mail domain-mail-set`
- `mail/clearDomainMail` → `beget mail domain-mail-clear`

### mysql
- `mysql/getList` → `beget mysql list`
- `mysql/addDb` → `beget mysql db-add`
- `mysql/addAccess` → `beget mysql access-add`
- `mysql/dropDb` → `beget mysql db-drop`
- `mysql/dropAccess` → `beget mysql access-drop`
- `mysql/changeAccessPassword` → `beget mysql access-password-change`

### backup
- `backup/getFileBackupList` → `beget backup file-backup-list`
- `backup/getMysqlBackupList` → `beget backup mysql-backup-list`
- `backup/getFileList` → `beget backup file-list`
- `backup/getMysqlList` → `beget backup mysql-list`
- `backup/restoreFile` → `beget backup restore-file`
- `backup/restoreMysql` → `beget backup restore-mysql`
- `backup/downloadFile` → `beget backup download-file`
- `backup/downloadMysql` → `beget backup download-mysql`
- `backup/getLog` → `beget backup log`

### cron
- `cron/getList` → `beget cron list`
- `cron/add` → `beget cron add`
- `cron/edit` → `beget cron edit`
- `cron/delete` → `beget cron delete`
- `cron/changeHiddenState` → `beget cron change-hidden-state`
- `cron/getEmail` → `beget cron email-get`
- `cron/setEmail` → `beget cron email-set`

### site
- `site/getList` → `beget sites list`
- `site/add` → `beget sites add`
- `site/delete` → `beget sites delete`
- `site/linkDomain` → `beget sites link-domain`
- `site/unlinkDomain` → `beget sites unlink-domain`
- `site/freeze` → `beget sites freeze`
- `site/unfreeze` → `beget sites unfreeze`
- `site/isSiteFrozen` → `beget sites is-frozen`

### stat
- `stat/getSitesListLoad` → `beget stats sites-list-load`
- `stat/getSiteLoad` → `beget stats site-load`
- `stat/getDbListLoad` → `beget stats db-list-load`
- `stat/getDbLoad` → `beget stats db-load`

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
