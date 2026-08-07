function query(key, flag = key.replaceAll('.', '-').replaceAll('_', '-'), type = 'string') {
  return { key, flag, type };
}

function operation(parent, usage, operationId, method, path, options = {}) {
  return Object.freeze({
    parent,
    usage,
    command: [parent, usage].filter(Boolean).join(' '),
    operationId,
    method,
    path,
    description: options.description ?? operationId,
    query: options.query ?? [],
    body: options.body ?? false,
    bodyPath: options.bodyPath ?? [],
    risky: options.risky ?? false,
    mutate: method !== 'GET',
  });
}

const period = query('period');

// This is a one-to-one command map for the published Beget Cloud VPS v1.8.1
// OpenAPI document. Keep operationId values intact so coverage can be audited.
export const VPS_OPERATIONS = Object.freeze([
  operation('archive', 'restore <id>', 'ManageService_Unarchive', 'DELETE', '/v1/vps/archive/{id}', {
    description: 'Restore an archived VPS', risky: true,
  }),

  operation('backup', 'copies', 'BackupService_GetAvailableCopies', 'GET', '/v1/vps/backup', {
    description: 'List available backup copies', query: [query('filter')],
  }),
  operation('backup', 'orders', 'BackupService_GetOrders', 'GET', '/v1/vps/backup/orders', {
    description: 'List backup restore orders', query: [query('limit', 'limit', 'integer'), query('offset', 'offset', 'integer')],
  }),
  operation('backup', 'files <id> <copy_id>', 'BackupService_GetBackupFileList', 'GET', '/v1/vps/{id}/backup/{copy_id}', {
    description: 'List files in a VPS backup', query: [query('path')],
  }),
  operation('backup', 'restore-file <id> <copy_id>', 'BackupService_RestoreFile', 'POST', '/v1/vps/{id}/backup/{copy_id}/file', {
    description: 'Restore files from a VPS backup', body: true, bodyPath: ['id', 'copy_id'], risky: true,
  }),
  operation('backup', 'restore-server <id> <copy_id>', 'BackupService_RestoreServer', 'POST', '/v1/vps/{id}/backup/{copy_id}/server', {
    description: 'Restore a complete VPS backup', body: true, bodyPath: ['id', 'copy_id'], risky: true,
  }),

  operation('', 'configurations', 'ManageService_GetAvailableConfiguration', 'GET', '/v1/vps/configuration', {
    description: 'List available VPS configurations',
  }),
  operation('configurator', 'calculate', 'ConfiguratorService_GetCalculation', 'GET', '/v1/vps/configurator/calculation', {
    description: 'Calculate a VPS configuration price',
    query: [
      query('params.cpu_count', 'cpu-count', 'integer'), query('params.disk_size', 'disk-size', 'integer'),
      query('params.memory', 'memory', 'integer'), query('region'), query('vps_id', 'vps-id'),
      query('software_id', 'software-id', 'integer'), query('snapshot_id', 'snapshot-id'),
      query('image_id', 'image-id'), query('configuration_group', 'configuration-group'),
    ],
  }),
  operation('configurator', 'info', 'ConfiguratorService_GetConfiguratorInfo', 'GET', '/v1/vps/configurator/info', {
    description: 'Show VPS configurator limits and choices',
    query: [query('region'), query('configuration_group', 'configuration-group')],
  }),

  operation('marketplace', 'list', 'MarketplaceService_GetSoftwareList', 'GET', '/v1/vps/marketplace/software/list', {
    description: 'List marketplace software',
    query: [query('category_name', 'category-name'), query('display_name', 'display-name'), query('is_pinned', 'is-pinned', 'boolean')],
  }),
  operation('marketplace', 'get <name> <version>', 'MarketplaceService_GetSoftwareInfo', 'GET', '/v1/vps/marketplace/software/{name}/{version}', {
    description: 'Show marketplace software details',
  }),

  operation('network', 'list', 'NetworkService_GetNetworkInfo', 'GET', '/v1/vps/network', {
    description: 'List public IP addresses', query: [query('filter')],
  }),
  operation('network', 'order', 'NetworkService_OrderIpAddress', 'POST', '/v1/vps/network', {
    description: 'Order a public IP address', body: true,
  }),
  operation('network', 'detach <ip_address>', 'ManageService_DetachIpAddress', 'DELETE', '/v1/vps/network/detach/{ip_address}', {
    description: 'Detach a public IP address from its VPS', risky: true,
  }),
  operation('network', 'remove <ip_address>', 'NetworkService_RemoveIpAddress', 'DELETE', '/v1/vps/network/{ip_address}', {
    description: 'Remove a public IP address', risky: true,
  }),
  operation('network', 'attach <id> <ip_address>', 'ManageService_AttachIpAddress', 'POST', '/v1/vps/{id}/network/{ip_address}', {
    description: 'Attach a public IP address to a VPS', body: true, bodyPath: ['id', 'ip_address'],
  }),

  operation('private-network', 'create', 'NetworkService_CreatePrivateNetwork', 'POST', '/v1/vps/private-network', {
    description: 'Create a private network', body: true,
  }),
  operation('private-network', 'remove <network_id>', 'NetworkService_RemovePrivateNetwork', 'DELETE', '/v1/vps/private-network/{network_id}', {
    description: 'Remove a private network', risky: true,
  }),
  operation('private-network', 'suggest-address <network_id>', 'NetworkService_SuggestPrivateAddress', 'POST', '/v1/vps/private-network/{network_id}/suggested-address', {
    description: 'Suggest a private address for a VPS', body: true, bodyPath: ['network_id'],
  }),
  operation('private-network', 'attach <id> <network_id>', 'ManageService_AttachToPrivateNetwork', 'POST', '/v1/vps/{id}/private-network/{network_id}', {
    description: 'Attach a VPS to a private network', body: true, bodyPath: ['id', 'network_id'],
  }),
  operation('private-network', 'detach <id> <network_id>', 'ManageService_DetachFromPrivateNetwork', 'DELETE', '/v1/vps/{id}/private-network/{network_id}', {
    description: 'Detach a VPS from a private network', risky: true,
  }),

  operation('', 'regions', 'ManageService_GetRegionList', 'GET', '/v1/vps/region', {
    description: 'List VPS regions',
  }),
  operation('', 'create', 'ManageService_CreateVps', 'POST', '/v1/vps/server', {
    description: 'Create a VPS from a JSON request body', body: true,
  }),
  operation('', 'list', 'ManageService_GetList', 'GET', '/v1/vps/server/list', {
    description: 'List VPS instances',
    query: [query('offset', 'offset', 'integer'), query('limit', 'limit', 'integer'), query('filter'), query('sort')],
  }),
  operation('', 'statuses', 'ManageService_GetStatuses', 'GET', '/v1/vps/server/statuses', {
    description: 'List VPS statuses',
  }),
  operation('', 'get <id>', 'ManageService_GetInfo', 'GET', '/v1/vps/server/{id}', {
    description: 'Show VPS details',
  }),
  operation('', 'resize <id>', 'ManageService_ChangeConfiguration', 'PUT', '/v1/vps/server/{id}/configuration', {
    description: 'Change VPS configuration', body: true, bodyPath: ['id'],
  }),
  operation('', 'update <id>', 'ManageService_UpdateInfo', 'PUT', '/v1/vps/server/{id}/info', {
    description: 'Update VPS name, hostname, or description', body: true, bodyPath: ['id'],
  }),
  operation('', 'pin <id>', 'ManageService_ChangePinned', 'PUT', '/v1/vps/server/{id}/pin', {
    description: 'Change VPS pinning in the control panel', body: true, bodyPath: ['id'],
  }),
  operation('', 'project-bind <id>', 'ManageService_BindProject', 'PUT', '/v1/vps/server/{id}/project', {
    description: 'Bind a VPS to a project', body: true, bodyPath: ['id'],
  }),
  operation('', 'reboot <id>', 'ManageService_RebootVps', 'POST', '/v1/vps/server/{id}/reboot', {
    description: 'Reboot a VPS',
  }),
  operation('', 'reinstall <id>', 'ManageService_Reinstall', 'POST', '/v1/vps/server/{id}/reinstall', {
    description: 'Reinstall a VPS', body: true, bodyPath: ['id'], risky: true,
  }),
  operation('', 'remove <id>', 'ManageService_RemoveVps', 'POST', '/v1/vps/server/{id}/remove', {
    description: 'Remove a VPS', body: true, bodyPath: ['id'], risky: true,
  }),
  operation('', 'rescue-start <id>', 'ManageService_StartRescue', 'POST', '/v1/vps/server/{id}/rescue', {
    description: 'Start VPS rescue mode',
  }),
  operation('', 'rescue-stop <id>', 'ManageService_StopRescue', 'DELETE', '/v1/vps/server/{id}/rescue', {
    description: 'Stop VPS rescue mode',
  }),
  operation('', 'reset <id>', 'ManageService_ResetVps', 'POST', '/v1/vps/server/{id}/reset', {
    description: 'Hard-reset a VPS', risky: true,
  }),
  operation('', 'start <id>', 'ManageService_StartVps', 'POST', '/v1/vps/server/{id}/start', {
    description: 'Start a VPS',
  }),
  operation('', 'stop <id>', 'ManageService_StopVps', 'POST', '/v1/vps/server/{id}/stop', {
    description: 'Stop a VPS', query: [query('force', 'force', 'boolean')],
  }),

  operation('snapshot', 'list', 'SnapshotService_GetAll', 'GET', '/v1/vps/snapshot', {
    description: 'List VPS snapshots',
  }),
  operation('snapshot', 'create', 'SnapshotService_Create', 'POST', '/v1/vps/snapshot', {
    description: 'Create a VPS snapshot', body: true,
  }),
  operation('snapshot', 'calculate', 'SnapshotService_CreateCalculator', 'POST', '/v1/vps/snapshot/calculator', {
    description: 'Calculate snapshot price', body: true,
  }),
  operation('snapshot', 'restores', 'SnapshotService_GetAllRestores', 'GET', '/v1/vps/snapshot/restore', {
    description: 'List snapshot restore operations', query: [query('id')],
  }),
  operation('snapshot', 'update <id>', 'SnapshotService_Edit', 'PUT', '/v1/vps/snapshot/{id}', {
    description: 'Update a snapshot', body: true, bodyPath: ['id'],
  }),
  operation('snapshot', 'remove <id>', 'SnapshotService_Remove', 'DELETE', '/v1/vps/snapshot/{id}', {
    description: 'Remove a snapshot', risky: true,
  }),
  operation('snapshot', 'restore <id>', 'SnapshotService_Restore', 'POST', '/v1/vps/snapshot/{id}/restore', {
    description: 'Restore a snapshot to a VPS', body: true, bodyPath: ['id'], risky: true,
  }),

  operation('license', 'get', 'SoftwareLicenseService_GetLicenseInfo', 'GET', '/v1/vps/software/license', {
    description: 'Show a software license', query: [query('license_id', 'license-id', 'integer')],
  }),
  operation('license', 'change <vps_id>', 'SoftwareLicenseService_ChangeLicensePlan', 'PATCH', '/v1/vps/software/license/{vps_id}', {
    description: 'Change a VPS software license plan', body: true, bodyPath: ['vps_id'], risky: true,
  }),

  operation('software', 'requirements', 'ManageService_CheckSoftwareRequirements', 'POST', '/v1/vps/software/requirements', {
    description: 'Check software installation requirements', body: true,
  }),
  operation('software', 'installed <id>', 'ManageService_GetInstalledSoftware', 'GET', '/v1/vps/{id}/software', {
    description: 'List software installed on a VPS',
  }),
  operation('software', 'alert-disable <id>', 'ManageService_DisablePostInstallAlert', 'DELETE', '/v1/vps/{id}/software/post-install-alert', {
    description: 'Disable a VPS post-install alert',
  }),

  operation('ssh-key', 'list', 'SshKeyService_GetAll', 'GET', '/v1/vps/sshKey', {
    description: 'List SSH keys',
  }),
  operation('ssh-key', 'add', 'SshKeyService_Add', 'POST', '/v1/vps/sshKey', {
    description: 'Add an SSH key', body: true,
  }),
  operation('ssh-key', 'update <id>', 'SshKeyService_Update', 'PUT', '/v1/vps/sshKey/{id}', {
    description: 'Rename an SSH key', body: true, bodyPath: ['id'],
  }),
  operation('ssh-key', 'remove <id>', 'SshKeyService_Remove', 'DELETE', '/v1/vps/sshKey/{id}', {
    description: 'Remove an SSH key', query: [query('force', 'force', 'boolean')], risky: true,
  }),
  operation('ssh-key', 'attach <id> <ssh_key_id>', 'ManageService_AttachSshKey', 'POST', '/v1/vps/{id}/sshKey/{ssh_key_id}', {
    description: 'Attach an SSH key to a VPS',
  }),
  operation('ssh-key', 'detach <id> <ssh_key_id>', 'ManageService_DetachSshKey', 'DELETE', '/v1/vps/{id}/sshKey/{ssh_key_id}', {
    description: 'Detach an SSH key from a VPS', risky: true,
  }),

  operation('stats', 'cpu-details <id>', 'StatisticService_GetCpuDetails', 'GET', '/v1/vps/statistic/cpu-details/{id}', {
    description: 'Show detailed VPS CPU statistics', query: [period],
  }),
  operation('stats', 'cpu <id>', 'StatisticService_GetCpu', 'GET', '/v1/vps/statistic/cpu/{id}', {
    description: 'Show VPS CPU statistics', query: [period],
  }),
  operation('stats', 'disk-usage <id>', 'StatisticService_GetDiskUsage', 'GET', '/v1/vps/statistic/disk-usage/{id}', {
    description: 'Show VPS disk-usage statistics', query: [period],
  }),
  operation('stats', 'disk <id>', 'StatisticService_GetDisk', 'GET', '/v1/vps/statistic/disk/{id}', {
    description: 'Show VPS disk I/O statistics', query: [period],
  }),
  operation('stats', 'load-average <id>', 'StatisticService_GetLoadAverage', 'GET', '/v1/vps/statistic/load-average/{id}', {
    description: 'Show VPS load-average statistics', query: [period],
  }),
  operation('stats', 'memory <id>', 'StatisticService_GetMemory', 'GET', '/v1/vps/statistic/memory/{id}', {
    description: 'Show VPS memory statistics', query: [period],
  }),
  operation('stats', 'network <id>', 'StatisticService_GetNetwork', 'GET', '/v1/vps/statistic/network/{id}', {
    description: 'Show VPS network statistics', query: [period],
  }),
  operation('stats', 'processes <id>', 'StatisticService_GetProcessList', 'GET', '/v1/vps/statistic/processes/{id}', {
    description: 'List VPS processes',
  }),

  operation('', 'reserve-subdomain', 'ManageService_ReserveVpsSubdomain', 'GET', '/v1/vps/subdomain/reserve', {
    description: 'Reserve a VPS technical subdomain',
  }),
  operation('', 'file-manager <id>', 'ManageService_GetFileManagerSettings', 'POST', '/v1/vps/{id}/fm', {
    description: 'Get temporary VPS file-manager settings',
  }),
  operation('', 'history <id>', 'ManageService_GetHistory', 'GET', '/v1/vps/{id}/history', {
    description: 'Show VPS operation history',
  }),
  operation('', 'password-reset <id>', 'ManageService_ResetPassword', 'PUT', '/v1/vps/{id}/password', {
    description: 'Reset a VPS password', risky: true,
  }),
  operation('', 'ssh-access <id>', 'ManageService_ChangeSshAccess', 'PUT', '/v1/vps/{id}/ssh/access', {
    description: 'Change Beget SSH access to a VPS', body: true, bodyPath: ['id'], risky: true,
  }),
]);

export const VPS_GROUPS = Object.freeze({
  archive: 'Archived VPS operations',
  backup: 'VPS backups and restores',
  configurator: 'VPS configuration calculator',
  license: 'VPS software licenses',
  marketplace: 'VPS marketplace software',
  network: 'Public VPS IP addresses',
  'private-network': 'Private VPS networks',
  snapshot: 'VPS snapshots',
  software: 'Installed and marketplace software',
  'ssh-key': 'VPS SSH keys',
  stats: 'VPS statistics',
});
