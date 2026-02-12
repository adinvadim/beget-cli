#!/usr/bin/env node
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const cli = path.resolve('./bin/beget.js');
const tempRoot = mkdtempSync(path.join(tmpdir(), 'beget-cli-check-'));
const cfg = path.join(tempRoot, 'config.json');

function run(args, env = {}) {
  return spawnSync('node', [cli, ...args], {
    encoding: 'utf8',
    env: { ...process.env, BEGET_CONFIG: cfg, ...env },
  });
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

try {
  let r;

  r = run(['--help']);
  assert(r.status === 0, 'help should exit 0');

  r = run(['auth', 'add', 'main', '--login', 'demo', '--no-input'], { BEGET_API_KEY: 'secret' });
  assert(r.status === 0, 'auth add should succeed');
  assert(existsSync(cfg), 'config file should exist');

  r = run(['auth', 'list', '--json']);
  assert(r.status === 0, 'auth list should succeed');
  const list = JSON.parse(r.stdout || '{}');
  assert(Array.isArray(list.profiles), 'profiles array expected');

  const dryRuns = [
    ['domains', 'add-virtual', '--hostname', 'example', '--zone-id', '1', '--dry-run', '--json'],
    ['dns', 'change-records', '--fqdn', 'example.com', '--records-json', '{"A":[{"priority":10,"value":"127.0.0.1"}]}', '--dry-run', '--json'],
    ['ftp', 'add', '--suffix', 'x', '--homedir', '/tmp', '--no-input', '--dry-run', '--json'],
    ['mail', 'mailbox-create', '--domain', 'example.com', '--mailbox', 'info', '--no-input', '--dry-run', '--json'],
    ['mysql', 'db-add', '--suffix', 'db1', '--no-input', '--dry-run', '--json'],
    ['backup', 'restore-file', '--backup-id', '1', '--paths', '/a,/b', '--dry-run', '--json'],
    ['cron', 'add', '--minutes', '*', '--hours', '*', '--days', '*', '--months', '*', '--weekdays', '*', '--command', 'echo 1', '--dry-run', '--json'],
    ['cron', 'edit', '--row-number', '1', '--minutes', '*', '--hours', '*', '--days', '*', '--months', '*', '--weekdays', '*', '--command', 'echo 2', '--dry-run', '--json'],
    ['sites', 'add', '--name', 'mysite', '--dry-run', '--json'],
  ];

  for (const args of dryRuns) {
    const env = {
      BEGET_FTP_PASSWORD: 'x',
      BEGET_MAILBOX_PASSWORD: 'x',
      BEGET_MYSQL_PASSWORD: 'x',
    };
    r = run(args, env);
    assert(r.status === 0, `dry-run should succeed: ${args.join(' ')}`);
  }

  r = run(['stats', '--help']);
  assert(r.status === 0, 'stats help should succeed');

  r = run(['account', 'info']);
  assert(r.status !== 0, 'account info without valid creds/network should fail in smoke');

  console.log('Self-check: OK');
  process.exit(0);
} catch (err) {
  console.error(`Self-check failed: ${err.message}`);
  process.exit(1);
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
