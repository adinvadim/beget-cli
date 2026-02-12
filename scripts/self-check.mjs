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
  assert(Array.isArray(list.profiles) && list.profiles.length === 1, 'one profile expected');

  r = run(['auth', 'use', 'main', '--dry-run', '--json']);
  assert(r.status === 0, 'auth use dry-run should succeed');

  r = run(['auth', 'remove', 'main', '--dry-run', '--json']);
  assert(r.status === 0, 'auth remove dry-run should succeed');

  r = run(['account', 'info']);
  assert(r.status !== 0, 'account info without valid creds/network should not be smoke-validated as success');

  console.log('Self-check: OK');
  process.exit(0);
} catch (err) {
  console.error(`Self-check failed: ${err.message}`);
  process.exit(1);
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
