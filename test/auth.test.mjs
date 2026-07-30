import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const cli = path.resolve('bin/beget.js');

function runCli(args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.setEncoding('utf8').on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

test('auth add verifies credentials before replacing the profile', async (t) => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'beget-cli-auth-test-'));
  const configPath = path.join(tempRoot, 'config.json');
  const requests = [];
  const server = createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost');
    requests.push(url);
    response.setHeader('content-type', 'application/json');
    if (url.searchParams.get('passwd') === 'valid-api-password') {
      response.end(JSON.stringify({
        status: 'success',
        answer: { status: 'success', result: { login: 'demo' } },
      }));
      return;
    }
    response.end(JSON.stringify({
      status: 'error',
      error_code: 'AUTH_ERROR',
      error_text: 'Username/password incorrect',
    }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(tempRoot, { recursive: true, force: true });
  });

  const { port } = server.address();
  const baseArgs = [
    '--config', configPath,
    '--base-url', `http://127.0.0.1:${port}`,
    '--json',
    'auth', 'add', 'main',
    '--login', 'demo',
    '--no-input',
  ];

  const valid = await runCli(baseArgs, { BEGET_API_PASSWORD: 'valid-api-password' });
  assert.equal(valid.status, 0, valid.stderr);
  const before = JSON.parse(await readFile(configPath, 'utf8'));
  assert.equal(before.profiles.main.apiKey, 'valid-api-password');

  const invalid = await runCli(baseArgs, { BEGET_API_PASSWORD: 'not-an-api-password' });
  assert.equal(invalid.status, 3, invalid.stderr);
  assert.match(invalid.stderr, /API password/i);
  assert.deepEqual(JSON.parse(await readFile(configPath, 'utf8')), before);
  assert.equal(requests.length, 2);
  assert.ok(requests.every((url) => url.pathname === '/user/getAccountInfo'));
});

test('--no-input fails without trying to prompt for a missing password', async (t) => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'beget-cli-no-input-test-'));
  const configPath = path.join(tempRoot, 'config.json');
  t.after(() => rm(tempRoot, { recursive: true, force: true }));

  const result = await runCli([
    '--config', configPath,
    '--json',
    'auth', 'add', 'main',
    '--login', 'demo',
    '--no-input',
  ], {
    BEGET_API_KEY: '',
    BEGET_API_PASSWORD: '',
  });

  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stderr, /Missing login\/api key/);
  assert.doesNotMatch(result.stderr, /Cannot prompt/);
});
