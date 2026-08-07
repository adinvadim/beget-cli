# Beget Cloud VPS

`beget vps` covers all 69 operations in the published Beget Cloud VPS API
v1.8.1. This API is separate from the legacy hosting API: it uses JSON over
HTTP and a Bearer JWT issued by `POST /v1/auth`.

Sources:

- `https://developer.beget.com/?api=vps`
- `https://developer.beget.com/ltd-beget/vps/v1.8.1/openapi_tagged.yaml`
- `https://developer.beget.com/ltd-beget/auth/v1.2.1/openapi_tagged.yaml`

## Authentication

Enable API authentication in the Beget control panel, then authenticate without
putting the account password on the command line:

```bash
beget auth cloud-login main --login mylogin
beget auth use main
beget vps regions --json
```

For non-interactive use, pass the password through `BEGET_CLOUD_PASSWORD` and
add `--no-input`. A one-time code can be supplied through
`BEGET_CLOUD_AUTH_CODE`. Neither value is stored; only the returned JWT is
written to the selected profile.

An existing JWT can be imported with `BEGET_CLOUD_TOKEN`:

```bash
BEGET_CLOUD_TOKEN='***' beget auth cloud-token main --no-input
beget auth cloud-refresh main
beget auth cloud-logout main --yes
```

At execution time, `BEGET_CLOUD_TOKEN` overrides the token stored in the
selected profile. `--cloud-base-url` or `BEGET_CLOUD_API_BASE_URL` overrides
the default `https://api.beget.com` endpoint.

## JSON request bodies

Beget's create, update, and restore messages contain nested structures that
change independently of the CLI. Commands therefore accept the documented API
object through `--body-file`, stdin, or `--body-json`:

```bash
beget vps create --body-file create-vps.json --dry-run --json
beget vps create --body-file create-vps.json --json

printf '%s\n' '{"name":"deploy","public_key":"ssh-ed25519 AAAA..."}' |
  beget vps ssh-key add --body-file - --json
```

Prefer `--body-file -` or a permission-restricted file when a body contains a
password. `--body-json` is visible in the process argument list. Dry-run output
recursively redacts fields whose names contain `password`, `token`, or
`secret`, and does not resolve credentials or contact Beget.

Every non-GET command supports `--dry-run`. Destructive or difficult-to-reverse
commands prompt in a terminal; in non-interactive use they require `--yes`.
Reads may retry temporary transport, throttling, and server failures. Mutations
are sent once; an ambiguous transport failure exits with code 7 and must be
reconciled before retrying.

## Full method → command map

### Servers and catalog

- `ManageService_GetList` → `vps list`
- `ManageService_GetInfo` → `vps get <id>`
- `ManageService_CreateVps` → `vps create`
- `ManageService_UpdateInfo` → `vps update <id>`
- `ManageService_ChangeConfiguration` → `vps resize <id>`
- `ManageService_ChangePinned` → `vps pin <id>`
- `ManageService_BindProject` → `vps project-bind <id>`
- `ManageService_GetStatuses` → `vps statuses`
- `ManageService_GetAvailableConfiguration` → `vps configurations`
- `ManageService_GetRegionList` → `vps regions`
- `ManageService_ReserveVpsSubdomain` → `vps reserve-subdomain`
- `ConfiguratorService_GetCalculation` → `vps configurator calculate`
- `ConfiguratorService_GetConfiguratorInfo` → `vps configurator info`

### Lifecycle and access

- `ManageService_StartVps` → `vps start <id>`
- `ManageService_StopVps` → `vps stop <id>`
- `ManageService_RebootVps` → `vps reboot <id>`
- `ManageService_ResetVps` → `vps reset <id>`
- `ManageService_Reinstall` → `vps reinstall <id>`
- `ManageService_RemoveVps` → `vps remove <id>`
- `ManageService_Unarchive` → `vps archive restore <id>`
- `ManageService_StartRescue` → `vps rescue-start <id>`
- `ManageService_StopRescue` → `vps rescue-stop <id>`
- `ManageService_ResetPassword` → `vps password-reset <id>`
- `ManageService_ChangeSshAccess` → `vps ssh-access <id>`
- `ManageService_GetFileManagerSettings` → `vps file-manager <id>`
- `ManageService_GetHistory` → `vps history <id>`

### Public and private networks

- `NetworkService_GetNetworkInfo` → `vps network list`
- `NetworkService_OrderIpAddress` → `vps network order`
- `ManageService_AttachIpAddress` → `vps network attach <id> <ip_address>`
- `ManageService_DetachIpAddress` → `vps network detach <ip_address>`
- `NetworkService_RemoveIpAddress` → `vps network remove <ip_address>`
- `NetworkService_CreatePrivateNetwork` → `vps private-network create`
- `NetworkService_RemovePrivateNetwork` → `vps private-network remove <network_id>`
- `NetworkService_SuggestPrivateAddress` → `vps private-network suggest-address <network_id>`
- `ManageService_AttachToPrivateNetwork` → `vps private-network attach <id> <network_id>`
- `ManageService_DetachFromPrivateNetwork` → `vps private-network detach <id> <network_id>`

### SSH keys

- `SshKeyService_GetAll` → `vps ssh-key list`
- `SshKeyService_Add` → `vps ssh-key add`
- `SshKeyService_Update` → `vps ssh-key update <id>`
- `SshKeyService_Remove` → `vps ssh-key remove <id>`
- `ManageService_AttachSshKey` → `vps ssh-key attach <id> <ssh_key_id>`
- `ManageService_DetachSshKey` → `vps ssh-key detach <id> <ssh_key_id>`

### Snapshots and backups

- `SnapshotService_GetAll` → `vps snapshot list`
- `SnapshotService_Create` → `vps snapshot create`
- `SnapshotService_CreateCalculator` → `vps snapshot calculate`
- `SnapshotService_GetAllRestores` → `vps snapshot restores`
- `SnapshotService_Edit` → `vps snapshot update <id>`
- `SnapshotService_Remove` → `vps snapshot remove <id>`
- `SnapshotService_Restore` → `vps snapshot restore <id>`
- `BackupService_GetAvailableCopies` → `vps backup copies`
- `BackupService_GetOrders` → `vps backup orders`
- `BackupService_GetBackupFileList` → `vps backup files <id> <copy_id>`
- `BackupService_RestoreFile` → `vps backup restore-file <id> <copy_id>`
- `BackupService_RestoreServer` → `vps backup restore-server <id> <copy_id>`

### Software and licenses

- `MarketplaceService_GetSoftwareList` → `vps marketplace list`
- `MarketplaceService_GetSoftwareInfo` → `vps marketplace get <name> <version>`
- `ManageService_CheckSoftwareRequirements` → `vps software requirements`
- `ManageService_GetInstalledSoftware` → `vps software installed <id>`
- `ManageService_DisablePostInstallAlert` → `vps software alert-disable <id>`
- `SoftwareLicenseService_GetLicenseInfo` → `vps license get`
- `SoftwareLicenseService_ChangeLicensePlan` → `vps license change <vps_id>`

### Statistics

- `StatisticService_GetCpuDetails` → `vps stats cpu-details <id>`
- `StatisticService_GetCpu` → `vps stats cpu <id>`
- `StatisticService_GetDiskUsage` → `vps stats disk-usage <id>`
- `StatisticService_GetDisk` → `vps stats disk <id>`
- `StatisticService_GetLoadAverage` → `vps stats load-average <id>`
- `StatisticService_GetMemory` → `vps stats memory <id>`
- `StatisticService_GetNetwork` → `vps stats network <id>`
- `StatisticService_GetProcessList` → `vps stats processes <id>`

Use `beget vps <command> --help` for endpoint-specific filters and body input
flags. Query flag names follow CLI kebab-case and are translated to the exact
OpenAPI names, including configurator fields such as `params.cpu_count`.
