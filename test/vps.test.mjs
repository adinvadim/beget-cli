import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { VPS_OPERATIONS } from '../lib/vps-operations.js';

const cli = path.resolve('bin/beget.js');

function runCli(args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

test('VPS command map covers every Beget Cloud VPS v1.8.1 operation', () => {
  const expected = [
    'BackupService_GetAvailableCopies',
    'BackupService_GetBackupFileList',
    'BackupService_GetOrders',
    'BackupService_RestoreFile',
    'BackupService_RestoreServer',
    'ConfiguratorService_GetCalculation',
    'ConfiguratorService_GetConfiguratorInfo',
    'ManageService_AttachIpAddress',
    'ManageService_AttachSshKey',
    'ManageService_AttachToPrivateNetwork',
    'ManageService_BindProject',
    'ManageService_ChangeConfiguration',
    'ManageService_ChangePinned',
    'ManageService_ChangeSshAccess',
    'ManageService_CreateVps',
    'ManageService_DetachFromPrivateNetwork',
    'ManageService_DetachIpAddress',
    'ManageService_DetachSshKey',
    'ManageService_DisablePostInstallAlert',
    'ManageService_GetAvailableConfiguration',
    'ManageService_GetFileManagerSettings',
    'ManageService_GetHistory',
    'ManageService_GetInfo',
    'ManageService_GetInstalledSoftware',
    'ManageService_GetList',
    'ManageService_GetRegionList',
    'ManageService_GetStatuses',
    'ManageService_RebootVps',
    'ManageService_Reinstall',
    'ManageService_RemoveVps',
    'ManageService_ReserveVpsSubdomain',
    'ManageService_ResetPassword',
    'ManageService_ResetVps',
    'ManageService_StartRescue',
    'ManageService_StartVps',
    'ManageService_StopRescue',
    'ManageService_StopVps',
    'ManageService_Unarchive',
    'ManageService_UpdateInfo',
    'MarketplaceService_GetSoftwareInfo',
    'MarketplaceService_GetSoftwareList',
    'ManageService_CheckSoftwareRequirements',
    'NetworkService_CreatePrivateNetwork',
    'NetworkService_GetNetworkInfo',
    'NetworkService_OrderIpAddress',
    'NetworkService_RemoveIpAddress',
    'NetworkService_RemovePrivateNetwork',
    'NetworkService_SuggestPrivateAddress',
    'SnapshotService_Create',
    'SnapshotService_CreateCalculator',
    'SnapshotService_Edit',
    'SnapshotService_GetAll',
    'SnapshotService_GetAllRestores',
    'SnapshotService_Remove',
    'SnapshotService_Restore',
    'SoftwareLicenseService_ChangeLicensePlan',
    'SoftwareLicenseService_GetLicenseInfo',
    'SshKeyService_Add',
    'SshKeyService_GetAll',
    'SshKeyService_Remove',
    'SshKeyService_Update',
    'StatisticService_GetCpu',
    'StatisticService_GetCpuDetails',
    'StatisticService_GetDisk',
    'StatisticService_GetDiskUsage',
    'StatisticService_GetLoadAverage',
    'StatisticService_GetMemory',
    'StatisticService_GetNetwork',
    'StatisticService_GetProcessList',
  ].sort();

  assert.deepEqual(VPS_OPERATIONS.map((operation) => operation.operationId).sort(), expected);
  assert.equal(new Set(VPS_OPERATIONS.map((operation) => operation.command)).size, expected.length);
});

test('VPS reads use the selected profile JWT and preserve filters', async (t) => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'beget-cli-vps-read-'));
  const configPath = path.join(tempRoot, 'config.json');
  await writeFile(configPath, JSON.stringify({
    version: 1,
    activeProfile: 'main',
    profiles: { main: { login: 'demo', cloudToken: 'jwt-value' } },
  }));

  let observed;
  const server = createServer((request, response) => {
    observed = { url: request.url, authorization: request.headers.authorization };
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ vps: [], pagination: { total: 0 } }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(tempRoot, { recursive: true, force: true });
  });

  const { port } = server.address();
  const result = await runCli([
    '--config', configPath,
    '--cloud-base-url', `http://127.0.0.1:${port}`,
    '--json',
    'vps', 'list',
    '--limit', '25',
    '--offset', '50',
    '--filter', 'status = "RUNNING"',
    '--sort', 'id desc',
  ]);

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { vps: [], pagination: { total: 0 } });
  assert.equal(observed.authorization, 'Bearer jwt-value');
  const requestURL = new URL(observed.url, 'http://localhost');
  assert.equal(requestURL.pathname, '/v1/vps/server/list');
  assert.equal(requestURL.searchParams.get('limit'), '25');
  assert.equal(requestURL.searchParams.get('offset'), '50');
  assert.equal(requestURL.searchParams.get('filter'), 'status = "RUNNING"');
  assert.equal(requestURL.searchParams.get('sort'), 'id desc');
});

test('VPS mutations support body files, dry-run redaction, and non-interactive confirmation', async (t) => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'beget-cli-vps-mutate-'));
  const configPath = path.join(tempRoot, 'config.json');
  const bodyPath = path.join(tempRoot, 'create.json');
  await writeFile(configPath, JSON.stringify({
    version: 1,
    activeProfile: 'main',
    profiles: { main: { cloudToken: 'jwt-value' } },
  }));
  await writeFile(bodyPath, JSON.stringify({
    display_name: 'test-vps',
    password: 'do-not-print',
    configuration_id: 'plan-1',
  }));

  const requests = [];
  const server = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    requests.push({ method: request.method, url: request.url, body });
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ id: 'vps-id', status: 'CREATING' }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(tempRoot, { recursive: true, force: true });
  });
  const { port } = server.address();
  const globals = [
    '--config', configPath,
    '--cloud-base-url', `http://127.0.0.1:${port}`,
    '--json',
  ];

  const dryRun = await runCli([
    ...globals,
    'vps', 'create', '--body-file', bodyPath, '--dry-run',
  ]);
  assert.equal(dryRun.status, 0, dryRun.stderr);
  assert.doesNotMatch(dryRun.stdout, /do-not-print/);
  assert.equal(JSON.parse(dryRun.stdout).body.password, '[REDACTED]');
  assert.equal(requests.length, 0);

  const create = await runCli([
    ...globals,
    'vps', 'create', '--body-file', bodyPath,
  ]);
  assert.equal(create.status, 0, create.stderr);
  assert.deepEqual(JSON.parse(requests[0].body), {
    display_name: 'test-vps',
    password: 'do-not-print',
    configuration_id: 'plan-1',
  });

  const remove = await runCli([
    ...globals,
    'vps', 'remove', 'vps-id', '--body-json', '{"ip_action":"DELETE"}',
  ]);
  assert.equal(remove.status, 2, remove.stderr);
  assert.match(remove.stderr, /--yes/);
  assert.equal(requests.length, 1);
});

test('cloud login stores only the returned JWT in the profile', async (t) => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'beget-cli-cloud-auth-'));
  const configPath = path.join(tempRoot, 'config.json');
  const server = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    assert.equal(request.url, '/v1/auth');
    assert.deepEqual(JSON.parse(body), { login: 'demo', password: 'account-password', saveMe: true });
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ token: 'new-jwt' }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(tempRoot, { recursive: true, force: true });
  });

  const { port } = server.address();
  const result = await runCli([
    '--config', configPath,
    '--cloud-base-url', `http://127.0.0.1:${port}`,
    '--json',
    'auth', 'cloud-login', 'main', '--login', 'demo', '--no-input',
  ], { BEGET_CLOUD_PASSWORD: 'account-password' });

  assert.equal(result.status, 0, result.stderr);
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  assert.equal(config.profiles.main.cloudToken, 'new-jwt');
  assert.equal(config.profiles.main.login, 'demo');
  assert.doesNotMatch(JSON.stringify(config), /account-password/);
});

test('non-interactive cloud login submits an authentication code from env', async (t) => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'beget-cli-cloud-otp-'));
  const configPath = path.join(tempRoot, 'config.json');
  const bodies = [];
  const server = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    bodies.push(JSON.parse(body));
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify(bodies.length === 1 ? { error: 'CODE_REQUIRED_TOTP' } : { token: 'otp-jwt' }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(tempRoot, { recursive: true, force: true });
  });
  const { port } = server.address();
  const result = await runCli([
    '--config', configPath,
    '--cloud-base-url', `http://127.0.0.1:${port}`,
    'auth', 'cloud-login', 'main', '--login', 'demo', '--no-input',
  ], {
    BEGET_CLOUD_PASSWORD: 'account-password',
    BEGET_CLOUD_AUTH_CODE: '123456',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(bodies.length, 2);
  assert.equal(bodies[1].code, '123456');
});

test('cloud auth dry-runs do not require secrets', async (t) => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'beget-cli-cloud-dry-run-'));
  const configPath = path.join(tempRoot, 'config.json');
  t.after(() => rm(tempRoot, { recursive: true, force: true }));
  const cleanEnv = { BEGET_CLOUD_PASSWORD: '', BEGET_CLOUD_TOKEN: '' };

  const login = await runCli([
    '--config', configPath, 'auth', 'cloud-login', 'main', '--login', 'demo', '--no-input', '--dry-run',
  ], cleanEnv);
  assert.equal(login.status, 0, login.stderr);

  const token = await runCli([
    '--config', configPath, 'auth', 'cloud-token', 'main', '--no-input', '--dry-run',
  ], cleanEnv);
  assert.equal(token.status, 0, token.stderr);
});

test('--no-input fails without prompting when cloud login is missing', async (t) => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'beget-cli-cloud-no-input-'));
  const configPath = path.join(tempRoot, 'config.json');
  t.after(() => rm(tempRoot, { recursive: true, force: true }));
  const result = await runCli([
    '--config', configPath, 'auth', 'cloud-login', 'main', '--no-input',
  ], { BEGET_CLOUD_PASSWORD: 'account-password' });

  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stderr, /Missing Beget login/);
  assert.doesNotMatch(result.stderr, /Cannot prompt/);
});

test('restoring an archived VPS requires confirmation in non-interactive mode', async (t) => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'beget-cli-archive-restore-'));
  const configPath = path.join(tempRoot, 'config.json');
  await writeFile(configPath, JSON.stringify({
    version: 1,
    activeProfile: 'main',
    profiles: { main: { cloudToken: 'jwt-value' } },
  }));
  t.after(() => rm(tempRoot, { recursive: true, force: true }));
  const result = await runCli([
    '--config', configPath, 'vps', 'archive', 'restore', 'vps-id',
  ]);

  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stderr, /--yes/);
});

test('cloud logout clears a locally stored JWT that is already invalid', async (t) => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'beget-cli-cloud-logout-'));
  const configPath = path.join(tempRoot, 'config.json');
  await writeFile(configPath, JSON.stringify({
    version: 1,
    activeProfile: 'main',
    profiles: { main: { login: 'demo', cloudToken: 'expired-jwt' } },
  }));
  const server = createServer((_request, response) => {
    response.statusCode = 401;
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ code: 'TOKEN_REVOKED', message: 'Expired' }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(tempRoot, { recursive: true, force: true });
  });
  const { port } = server.address();
  const result = await runCli([
    '--config', configPath,
    '--cloud-base-url', `http://127.0.0.1:${port}`,
    'auth', 'cloud-logout', 'main', '--yes',
  ]);

  assert.equal(result.status, 0, result.stderr);
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  assert.equal(config.profiles.main.cloudToken, undefined);
});
