#!/usr/bin/env node
import { Command } from 'commander';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output, stderr } from 'node:process';
import fs from 'node:fs/promises';
import fssync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { URLSearchParams } from 'node:url';
import { CloudApiClient, CloudApiError } from '../lib/cloud-api.js';
import { registerVpsCommands } from '../lib/vps-commands.js';

const EXIT = { OK: 0, GENERIC_ERROR: 1, USAGE_ERROR: 2, AUTH_ERROR: 3, API_ERROR: 4, CONFIG_ERROR: 5, NETWORK_ERROR: 6, OUTCOME_UNKNOWN: 7 };

class CliError extends Error {
  constructor(message, code = EXIT.GENERIC_ERROR, details = undefined) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

function getConfigPath(explicitPath) {
  if (explicitPath) return explicitPath;
  if (process.env.BEGET_CONFIG) return process.env.BEGET_CONFIG;
  const xdg = process.env.XDG_CONFIG_HOME;
  if (xdg) return path.join(xdg, 'beget-cli', 'config.json');
  return path.join(os.homedir(), '.config', 'beget-cli', 'config.json');
}

async function ensureParentSecure(filePath) {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  await fs.chmod(dir, 0o700).catch(() => {});
}

async function readConfig(configPath) {
  try {
    const raw = await fs.readFile(configPath, 'utf8');
    const parsed = JSON.parse(raw);
    parsed.profiles ??= {};
    parsed.activeProfile ??= null;
    return parsed;
  } catch (err) {
    if (err.code === 'ENOENT') return { version: 1, activeProfile: null, profiles: {} };
    throw new CliError(`Failed to read config: ${err.message}`, EXIT.CONFIG_ERROR);
  }
}

async function writeConfig(configPath, cfg) {
  await ensureParentSecure(configPath);
  await fs.writeFile(configPath, JSON.stringify(cfg, null, 2) + '\n', { mode: 0o600 });
  await fs.chmod(configPath, 0o600).catch(() => {});
}

function jsonModeFrom(globalOpts) {
  return Boolean(globalOpts.json);
}

function printResult(data, opts = {}) {
  if (opts.json) return console.log(JSON.stringify(data, null, 2));
  if (typeof data === 'string') return console.log(data);
  console.log(JSON.stringify(data, null, 2));
}

function printError(err, jsonMode = false) {
  if (jsonMode) {
    stderr.write(JSON.stringify({ error: err.message, details: err.details ?? null }, null, 2) + '\n');
    return;
  }
  stderr.write(`Error: ${err.message}\n`);
  if (err.details) stderr.write(`${err.details}\n`);
}

function resolveCredentials(globalOpts, cfg) {
  const selectedProfile = globalOpts.profile ?? process.env.BEGET_PROFILE ?? cfg.activeProfile;
  const profile = selectedProfile ? cfg.profiles[selectedProfile] : null;
  const login = globalOpts.login ?? process.env.BEGET_LOGIN ?? profile?.login;
  const apiKey = process.env.BEGET_API_PASSWORD ?? process.env.BEGET_API_KEY ?? profile?.apiKey;
  const baseUrl = globalOpts.baseUrl ?? process.env.BEGET_API_BASE_URL ?? 'https://api.beget.com/api';

  if (!login || !apiKey) {
    throw new CliError('Missing Beget credentials. Use `beget auth add/use` or set BEGET_LOGIN + BEGET_API_PASSWORD.', EXIT.AUTH_ERROR);
  }
  return { login, apiKey, baseUrl, selectedProfile };
}

function resolveCloudCredentials(globalOpts, cfg) {
  const selectedProfile = globalOpts.profile ?? process.env.BEGET_PROFILE ?? cfg.activeProfile;
  const profile = selectedProfile ? cfg.profiles[selectedProfile] : null;
  const token = process.env.BEGET_CLOUD_TOKEN ?? profile?.cloudToken;
  const baseUrl = globalOpts.cloudBaseUrl ?? process.env.BEGET_CLOUD_API_BASE_URL ?? 'https://api.beget.com';
  if (!token) {
    throw new CliError('Missing Beget Cloud JWT. Use `beget auth cloud-login` or set BEGET_CLOUD_TOKEN.', EXIT.AUTH_ERROR);
  }
  return { token, baseUrl, selectedProfile };
}

function cloudError(error) {
  if (!(error instanceof CloudApiError)) return error;
  const code = {
    auth: EXIT.AUTH_ERROR,
    config: EXIT.CONFIG_ERROR,
    network: EXIT.NETWORK_ERROR,
    outcome_unknown: EXIT.OUTCOME_UNKNOWN,
  }[error.kind] ?? EXIT.API_ERROR;
  return new CliError(error.message, code, error.details ?? error.providerCode);
}

function redactSecrets(value) {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    /password|token|secret/i.test(key) ? '[REDACTED]' : redactSecrets(item),
  ]));
}

async function promptLine(query) {
  const rl = createInterface({ input, output });
  try {
    const answer = await rl.question(query);
    return answer.trim();
  } finally {
    rl.close();
  }
}

async function promptMasked(query) {
  if (!process.stdin.isTTY) throw new CliError('Cannot prompt for secret in non-interactive mode.', EXIT.USAGE_ERROR);
  output.write(query);
  const wasRaw = Boolean(input.isRaw);
  if (input.setRawMode) input.setRawMode(true);
  let value = '';
  while (true) {
    const buf = Buffer.alloc(1);
    const read = fssync.readSync(process.stdin.fd, buf, 0, 1);
    if (!read) continue;
    const ch = buf.toString('utf8');
    if (ch === '\r' || ch === '\n') {
      output.write('\n');
      break;
    }
    if (ch === '\u0003') process.exit(130);
    if (ch === '\u007f' || ch === '\b') {
      if (value.length) value = value.slice(0, -1);
      continue;
    }
    value += ch;
  }
  if (input.setRawMode) input.setRawMode(wasRaw);
  return value.trim();
}

function parseJsonOption(value, label) {
  if (!value) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    throw new CliError(`${label} must be valid JSON`, EXIT.USAGE_ERROR);
  }
}

function parseCsv(value) {
  return String(value || '').split(',').map((x) => x.trim()).filter(Boolean);
}

async function ensureRiskConfirmation({ cmdOpts, globalOpts, title }) {
  if (cmdOpts.yes || globalOpts.yes) return;
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new CliError(`${title} is risky; run with --yes in non-interactive mode`, EXIT.USAGE_ERROR);
  }
  const ans = (await promptLine(`${title}. Continue? [y/N]: `)).toLowerCase();
  if (!['y', 'yes'].includes(ans)) throw new CliError('Cancelled by user', EXIT.USAGE_ERROR);
}

async function getSecret({ cmdOpts, envKeys = [], prompt }) {
  for (const key of envKeys) {
    if (process.env[key]) return process.env[key];
  }
  if (noInputFrom(cmdOpts)) throw new CliError(`Missing secret in env (${envKeys.join(', ')}) for --no-input mode`, EXIT.USAGE_ERROR);
  return promptMasked(prompt);
}

function noInputFrom(cmdOpts) {
  return cmdOpts?.input === false || cmdOpts?.noInput === true;
}

async function callBeget({ baseUrl, login, apiKey, section, method, inputData, query = {}, timeoutMs = 20000 }) {
  const params = new URLSearchParams({ login, passwd: apiKey, output_format: 'json' });
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null) params.set(k, String(v));
  if (inputData !== undefined) {
    params.set('input_format', 'json');
    params.set('input_data', JSON.stringify(inputData));
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const url = `${baseUrl.replace(/\/$/, '')}/${section}/${method}?${params.toString()}`;

  let res;
  try {
    res = await fetch(url, { signal: controller.signal });
  } catch (err) {
    if (err.name === 'AbortError') throw new CliError(`Network timeout after ${timeoutMs}ms`, EXIT.NETWORK_ERROR);
    throw new CliError(`Network error: ${err.message}`, EXIT.NETWORK_ERROR);
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) throw new CliError(`HTTP ${res.status} ${res.statusText}`, EXIT.NETWORK_ERROR);

  let payload;
  try {
    payload = await res.json();
  } catch {
    throw new CliError('API returned non-JSON response', EXIT.API_ERROR);
  }

  if (payload.status !== 'success') {
    const isAuthError = payload.error_code === 'AUTH_ERROR';
    const authHint = isAuthError
      ? ' Check the account login and Beget API password; API access must be enabled in the Beget control panel.'
      : '';
    throw new CliError(`Beget API error: ${payload.error_text ?? 'unknown error'}.${authHint}`, isAuthError ? EXIT.AUTH_ERROR : EXIT.API_ERROR, payload.error_code);
  }

  const answer = payload.answer;
  if (!answer || answer.status !== 'success') {
    const firstErr = answer?.errors?.[0];
    throw new CliError(`Method failed: ${firstErr?.error_text ?? 'unknown method error'}`, EXIT.API_ERROR, firstErr?.error_code);
  }
  return answer.result;
}

async function executeApi({ globalOpts, cmdOpts, section, method, inputData, query, mutate = false, risky = false, riskTitle }) {
  const cfg = await readConfig(getConfigPath(globalOpts.config));
  const creds = resolveCredentials(globalOpts, cfg);
  if (mutate && cmdOpts.dryRun) {
    return { dryRun: true, section, method, inputData: inputData ?? null, query: query ?? null };
  }
  if (mutate && risky) {
    await ensureRiskConfirmation({ cmdOpts, globalOpts, title: riskTitle ?? `${section}/${method}` });
  }
  return callBeget({ ...creds, section, method, inputData, query, timeoutMs: Number(globalOpts.timeout) });
}

async function executeVpsOperation({ spec, cmd, options, path: requestPath, query, body }) {
  const globalOpts = cmd.optsWithGlobals();
  if (spec.mutate && options.dryRun) {
    return printResult({
      dryRun: true,
      operationId: spec.operationId,
      method: spec.method,
      path: requestPath,
      query,
      body: redactSecrets(body ?? null),
    }, { json: jsonModeFrom(globalOpts) });
  }
  if (spec.risky) {
    await ensureRiskConfirmation({ cmdOpts: options, globalOpts, title: spec.description });
  }

  const cfg = await readConfig(getConfigPath(globalOpts.config));
  const credentials = resolveCloudCredentials(globalOpts, cfg);
  const client = new CloudApiClient({
    baseUrl: credentials.baseUrl,
    token: credentials.token,
    timeoutMs: Number(globalOpts.timeout),
  });
  let result;
  try {
    result = await client.request({
      method: spec.method,
      path: requestPath,
      query,
      body,
    });
  } catch (error) {
    throw cloudError(error);
  }
  printResult(result, { json: jsonModeFrom(globalOpts) });
}

const program = new Command();
program
  .name('beget')
  .description('CLI for Beget API')
  .version('1.0.0')
  .option('--config <path>', 'path to config file')
  .option('--profile <name>', 'profile to use')
  .option('--login <login>', 'override login for this invocation')
  .option('--base-url <url>', 'override API base URL')
  .option('--cloud-base-url <url>', 'override Beget Cloud API base URL')
  .option('--timeout <ms>', 'request timeout in milliseconds', '20000')
  .option('--json', 'JSON output')
  .option('--yes', 'auto-confirm risky actions');

const auth = program.command('auth').description('Manage local Beget credentials');
auth.command('add <name>').description('Add/update profile').option('--dry-run').option('--no-input').option('--no-verify', 'store credentials without checking them against Beget').option('--login <login>').action(async (name, cmdOpts, cmd) => {
  const globalOpts = cmd.parent.parent.opts();
  const cfgPath = getConfigPath(globalOpts.config);
  const cfg = await readConfig(cfgPath);
  let login = cmdOpts.login ?? globalOpts.login;
  const apiKey = process.env.BEGET_API_PASSWORD ?? process.env.BEGET_API_KEY ?? (!noInputFrom(cmdOpts) ? await promptMasked('Beget API password: ') : null);
  if (!login && !noInputFrom(cmdOpts)) login = await promptLine('Beget login: ');
  if (!login || !apiKey) throw new CliError('Missing login/api key', EXIT.USAGE_ERROR);
  if (cmdOpts.dryRun) return printResult({ dryRun: true, action: 'auth.add', name, login, configPath: cfgPath }, { json: jsonModeFrom(globalOpts) });
  if (cmdOpts.verify) {
    const baseUrl = globalOpts.baseUrl ?? process.env.BEGET_API_BASE_URL ?? 'https://api.beget.com/api';
    await callBeget({
      baseUrl,
      login,
      apiKey,
      section: 'user',
      method: 'getAccountInfo',
      timeoutMs: Number(globalOpts.timeout),
    });
  }
  const next = structuredClone(cfg);
  next.profiles[name] = { ...next.profiles[name], login, apiKey };
  if (!next.activeProfile) next.activeProfile = name;
  await writeConfig(cfgPath, next);
  printResult({ ok: true, profile: name, activeProfile: next.activeProfile, verified: Boolean(cmdOpts.verify) }, { json: jsonModeFrom(globalOpts) });
});
auth.command('list').description('List profiles').action(async (_, cmd) => {
  const globalOpts = cmd.parent.parent.opts();
  const cfg = await readConfig(getConfigPath(globalOpts.config));
  const rows = Object.entries(cfg.profiles).map(([name, p]) => ({ name, login: p.login, cloud: Boolean(p.cloudToken), active: cfg.activeProfile === name }));
  printResult(jsonModeFrom(globalOpts) ? { profiles: rows, activeProfile: cfg.activeProfile } : rows.map((r) => `${r.active ? '*' : ' '} ${r.name}\t${r.login ?? '-'}\tcloud:${r.cloud ? 'yes' : 'no'}`).join('\n') || 'No profiles configured', { json: jsonModeFrom(globalOpts) });
});
auth.command('use <name>').description('Set active profile').option('--dry-run').action(async (name, cmdOpts, cmd) => {
  const globalOpts = cmd.parent.parent.opts();
  const cfgPath = getConfigPath(globalOpts.config);
  const cfg = await readConfig(cfgPath);
  if (!cfg.profiles[name]) throw new CliError(`Profile '${name}' not found`, EXIT.CONFIG_ERROR);
  if (cmdOpts.dryRun) return printResult({ dryRun: true, action: 'auth.use', profile: name }, { json: jsonModeFrom(globalOpts) });
  cfg.activeProfile = name;
  await writeConfig(cfgPath, cfg);
  printResult({ ok: true, activeProfile: name }, { json: jsonModeFrom(globalOpts) });
});
auth.command('remove <name>').description('Remove profile').option('--dry-run').action(async (name, cmdOpts, cmd) => {
  const globalOpts = cmd.parent.parent.opts();
  const cfgPath = getConfigPath(globalOpts.config);
  const cfg = await readConfig(cfgPath);
  if (!cfg.profiles[name]) throw new CliError(`Profile '${name}' not found`, EXIT.CONFIG_ERROR);
  const nextActive = cfg.activeProfile === name ? Object.keys(cfg.profiles).find((k) => k !== name) ?? null : cfg.activeProfile;
  if (cmdOpts.dryRun) return printResult({ dryRun: true, action: 'auth.remove', profile: name, nextActiveProfile: nextActive }, { json: jsonModeFrom(globalOpts) });
  delete cfg.profiles[name];
  cfg.activeProfile = nextActive;
  await writeConfig(cfgPath, cfg);
  printResult({ ok: true, removed: name, activeProfile: nextActive }, { json: jsonModeFrom(globalOpts) });
});

auth.command('cloud-login <name>')
  .description('Authenticate to Beget Cloud and store the returned JWT')
  .option('--login <login>')
  .option('--no-input')
  .option('--dry-run')
  .action(async (name, cmdOpts, cmd) => {
    const globalOpts = cmd.parent.parent.opts();
    const cfgPath = getConfigPath(globalOpts.config);
    const cfg = await readConfig(cfgPath);
    let login = cmdOpts.login ?? globalOpts.login ?? cfg.profiles[name]?.login;
    if (!login && !noInputFrom(cmdOpts)) login = await promptLine('Beget login: ');
    if (!login) throw new CliError('Missing Beget login', EXIT.USAGE_ERROR);
    if (cmdOpts.dryRun) {
      return printResult({ dryRun: true, action: 'auth.cloud-login', name, login }, { json: jsonModeFrom(globalOpts) });
    }
    const password = await getSecret({ cmdOpts, envKeys: ['BEGET_CLOUD_PASSWORD'], prompt: 'Beget account password: ' });

    const client = new CloudApiClient({
      baseUrl: globalOpts.cloudBaseUrl ?? process.env.BEGET_CLOUD_API_BASE_URL,
      timeoutMs: Number(globalOpts.timeout),
    });
    let response;
    try {
      response = await client.request({
        method: 'POST',
        path: '/v1/auth',
        authenticated: false,
        body: { login, password, saveMe: true },
      });
    } catch (error) {
      const needsCode = error instanceof CloudApiError && error.providerCode?.startsWith('CODE_REQUIRED');
      if (!needsCode) throw cloudError(error);
      const code = process.env.BEGET_CLOUD_AUTH_CODE
        ?? (!noInputFrom(cmdOpts) ? await promptMasked('Authentication code: ') : null);
      if (!code) throw new CliError(`Beget Cloud authentication requires a code (${error.providerCode}); set BEGET_CLOUD_AUTH_CODE in --no-input mode.`, EXIT.AUTH_ERROR);
      try {
        response = await client.request({
          method: 'POST',
          path: '/v1/auth',
          authenticated: false,
          body: { login, password, code, saveMe: true },
        });
      } catch (secondError) {
        throw cloudError(secondError);
      }
    }
    if (!response?.token) throw new CliError('Beget Cloud authentication returned no JWT', EXIT.API_ERROR);

    const next = structuredClone(cfg);
    next.profiles[name] = { ...next.profiles[name], login, cloudToken: response.token };
    if (!next.activeProfile) next.activeProfile = name;
    await writeConfig(cfgPath, next);
    printResult({ ok: true, profile: name, activeProfile: next.activeProfile, cloudAuthenticated: true }, { json: jsonModeFrom(globalOpts) });
  });

auth.command('cloud-token <name>')
  .description('Store an existing Beget Cloud JWT')
  .option('--no-input')
  .option('--no-verify', 'store the JWT without a read-only Cloud API check')
  .option('--dry-run')
  .action(async (name, cmdOpts, cmd) => {
    const globalOpts = cmd.parent.parent.opts();
    const cfgPath = getConfigPath(globalOpts.config);
    const cfg = await readConfig(cfgPath);
    if (cmdOpts.dryRun) {
      return printResult({ dryRun: true, action: 'auth.cloud-token', name }, { json: jsonModeFrom(globalOpts) });
    }
    const token = await getSecret({ cmdOpts, envKeys: ['BEGET_CLOUD_TOKEN'], prompt: 'Beget Cloud JWT: ' });
    if (cmdOpts.verify) {
      const client = new CloudApiClient({
        baseUrl: globalOpts.cloudBaseUrl ?? process.env.BEGET_CLOUD_API_BASE_URL,
        token,
        timeoutMs: Number(globalOpts.timeout),
      });
      try {
        await client.request({ path: '/v1/vps/region' });
      } catch (error) {
        throw cloudError(error);
      }
    }
    const next = structuredClone(cfg);
    next.profiles[name] = { ...next.profiles[name], cloudToken: token };
    if (!next.activeProfile) next.activeProfile = name;
    await writeConfig(cfgPath, next);
    printResult({ ok: true, profile: name, activeProfile: next.activeProfile, cloudAuthenticated: true, verified: Boolean(cmdOpts.verify) }, { json: jsonModeFrom(globalOpts) });
  });

auth.command('cloud-refresh [name]')
  .description('Refresh the stored Beget Cloud JWT')
  .option('--dry-run')
  .action(async (name, cmdOpts, cmd) => {
    const globalOpts = cmd.parent.parent.opts();
    const cfgPath = getConfigPath(globalOpts.config);
    const cfg = await readConfig(cfgPath);
    const profileName = name ?? globalOpts.profile ?? process.env.BEGET_PROFILE ?? cfg.activeProfile;
    const profile = profileName ? cfg.profiles[profileName] : null;
    if (!profile?.cloudToken) throw new CliError('Selected profile has no Beget Cloud JWT', EXIT.AUTH_ERROR);
    if (cmdOpts.dryRun) {
      return printResult({ dryRun: true, action: 'auth.cloud-refresh', profile: profileName }, { json: jsonModeFrom(globalOpts) });
    }
    const client = new CloudApiClient({
      baseUrl: globalOpts.cloudBaseUrl ?? process.env.BEGET_CLOUD_API_BASE_URL,
      token: profile.cloudToken,
      timeoutMs: Number(globalOpts.timeout),
    });
    let response;
    try {
      response = await client.request({ method: 'POST', path: '/v1/auth/refresh' });
    } catch (error) {
      throw cloudError(error);
    }
    if (!response?.token) throw new CliError('Beget Cloud refresh returned no JWT', EXIT.API_ERROR);
    cfg.profiles[profileName].cloudToken = response.token;
    await writeConfig(cfgPath, cfg);
    printResult({ ok: true, profile: profileName, cloudAuthenticated: true, refreshed: true }, { json: jsonModeFrom(globalOpts) });
  });

auth.command('cloud-logout [name]')
  .description('Revoke and remove the stored Beget Cloud JWT')
  .option('--dry-run')
  .option('--yes')
  .action(async (name, cmdOpts, cmd) => {
    const globalOpts = cmd.parent.parent.opts();
    const cfgPath = getConfigPath(globalOpts.config);
    const cfg = await readConfig(cfgPath);
    const profileName = name ?? globalOpts.profile ?? process.env.BEGET_PROFILE ?? cfg.activeProfile;
    const profile = profileName ? cfg.profiles[profileName] : null;
    if (!profile?.cloudToken) throw new CliError('Selected profile has no Beget Cloud JWT', EXIT.AUTH_ERROR);
    if (cmdOpts.dryRun) {
      return printResult({ dryRun: true, action: 'auth.cloud-logout', profile: profileName }, { json: jsonModeFrom(globalOpts) });
    }
    await ensureRiskConfirmation({ cmdOpts, globalOpts, title: `Revoke Beget Cloud JWT for profile '${profileName}'` });
    const client = new CloudApiClient({
      baseUrl: globalOpts.cloudBaseUrl ?? process.env.BEGET_CLOUD_API_BASE_URL,
      token: profile.cloudToken,
      timeoutMs: Number(globalOpts.timeout),
    });
    let alreadyRevoked = false;
    try {
      await client.request({ method: 'POST', path: '/v1/auth/logout' });
    } catch (error) {
      if (error instanceof CloudApiError && error.kind === 'auth') {
        alreadyRevoked = true;
      } else {
        throw cloudError(error);
      }
    }
    delete cfg.profiles[profileName].cloudToken;
    await writeConfig(cfgPath, cfg);
    printResult({ ok: true, profile: profileName, cloudAuthenticated: false, alreadyRevoked }, { json: jsonModeFrom(globalOpts) });
  });

const account = program.command('account').description('Account operations');
account.command('info').description('user/getAccountInfo').action(async (_, cmd) => {
  const globalOpts = cmd.parent.parent.opts();
  const result = await executeApi({ globalOpts, cmdOpts: {}, section: 'user', method: 'getAccountInfo' });
  printResult(result, { json: jsonModeFrom(globalOpts) });
});
account.command('toggle-ssh').description('user/toggleSsh').requiredOption('--status <0|1>').option('--ftplogin <login>').option('--dry-run').action(async (cmdOpts, cmd) => {
  const globalOpts = cmd.parent.parent.opts();
  const result = await executeApi({ globalOpts, cmdOpts, section: 'user', method: 'toggleSsh', mutate: true, inputData: { status: Number(cmdOpts.status), ftplogin: cmdOpts.ftplogin } });
  printResult(result, { json: jsonModeFrom(globalOpts) });
});

const domains = program.command('domains').description('Domain operations');
domains.command('list').description('domain/getList').action(async (_, cmd) => {
  const globalOpts = cmd.parent.parent.opts();
  printResult(await executeApi({ globalOpts, cmdOpts: {}, section: 'domain', method: 'getList' }), { json: jsonModeFrom(globalOpts) });
});
domains.command('zone-list').description('domain/getZoneList').action(async (_, cmd) => {
  const globalOpts = cmd.parent.parent.opts();
  printResult(await executeApi({ globalOpts, cmdOpts: {}, section: 'domain', method: 'getZoneList' }), { json: jsonModeFrom(globalOpts) });
});
domains.command('add-virtual').description('domain/addVirtual').requiredOption('--hostname <name>').requiredOption('--zone-id <id>').option('--dry-run').action(async (cmdOpts, cmd) => {
  const globalOpts = cmd.parent.parent.opts();
  printResult(await executeApi({ globalOpts, cmdOpts, section: 'domain', method: 'addVirtual', mutate: true, inputData: { hostname: cmdOpts.hostname, zone_id: Number(cmdOpts.zoneId) } }), { json: jsonModeFrom(globalOpts) });
});
domains.command('delete').description('domain/delete').requiredOption('--id <id>').option('--dry-run').option('--yes').action(async (cmdOpts, cmd) => {
  const globalOpts = cmd.parent.parent.opts();
  printResult(await executeApi({ globalOpts, cmdOpts, section: 'domain', method: 'delete', mutate: true, risky: true, riskTitle: 'Delete domain', inputData: { id: Number(cmdOpts.id) } }), { json: jsonModeFrom(globalOpts) });
});
domains.command('subdomain-list').description('domain/getSubdomainList').action(async (_, cmd) => {
  const globalOpts = cmd.parent.parent.opts();
  printResult(await executeApi({ globalOpts, cmdOpts: {}, section: 'domain', method: 'getSubdomainList' }), { json: jsonModeFrom(globalOpts) });
});
domains.command('add-subdomain-virtual').description('domain/addSubdomainVirtual').requiredOption('--subdomain <name>').requiredOption('--domain-id <id>').option('--dry-run').action(async (cmdOpts, cmd) => {
  const globalOpts = cmd.parent.parent.opts();
  printResult(await executeApi({ globalOpts, cmdOpts, section: 'domain', method: 'addSubdomainVirtual', mutate: true, inputData: { subdomain: cmdOpts.subdomain, domain_id: Number(cmdOpts.domainId) } }), { json: jsonModeFrom(globalOpts) });
});
domains.command('delete-subdomain').description('domain/deleteSubdomain').requiredOption('--id <id>').option('--dry-run').option('--yes').action(async (cmdOpts, cmd) => {
  const globalOpts = cmd.parent.parent.opts();
  printResult(await executeApi({ globalOpts, cmdOpts, section: 'domain', method: 'deleteSubdomain', mutate: true, risky: true, riskTitle: 'Delete subdomain', inputData: { id: Number(cmdOpts.id) } }), { json: jsonModeFrom(globalOpts) });
});
domains.command('check-to-register').description('domain/checkDomainToRegister').requiredOption('--hostname <name>').requiredOption('--zone-id <id>').requiredOption('--period <years>').action(async (cmdOpts, cmd) => {
  const globalOpts = cmd.parent.parent.opts();
  printResult(await executeApi({ globalOpts, cmdOpts, section: 'domain', method: 'checkDomainToRegister', inputData: { hostname: cmdOpts.hostname, zone_id: Number(cmdOpts.zoneId), period: Number(cmdOpts.period) } }), { json: jsonModeFrom(globalOpts) });
});
domains.command('php-version-get').description('domain/getPhpVersion').requiredOption('--full-fqdn <fqdn>').action(async (cmdOpts, cmd) => {
  const globalOpts = cmd.parent.parent.opts();
  printResult(await executeApi({ globalOpts, cmdOpts, section: 'domain', method: 'getPhpVersion', query: { full_fqdn: cmdOpts.fullFqdn } }), { json: jsonModeFrom(globalOpts) });
});
domains.command('php-version-change').description('domain/changePhpVersion').requiredOption('--full-fqdn <fqdn>').requiredOption('--php-version <ver>').option('--is-cgi <bool>', 'true/false', 'false').option('--dry-run').action(async (cmdOpts, cmd) => {
  const globalOpts = cmd.parent.parent.opts();
  const isCgi = ['1', 'true', 'yes'].includes(String(cmdOpts.isCgi).toLowerCase());
  printResult(await executeApi({ globalOpts, cmdOpts, section: 'domain', method: 'changePhpVersion', mutate: true, inputData: { full_fqdn: cmdOpts.fullFqdn, php_version: cmdOpts.phpVersion, is_cgi: isCgi } }), { json: jsonModeFrom(globalOpts) });
});
domains.command('directives-get').description('domain/getDirectives').requiredOption('--full-fqdn <fqdn>').action(async (cmdOpts, cmd) => {
  const globalOpts = cmd.parent.parent.opts();
  printResult(await executeApi({ globalOpts, cmdOpts, section: 'domain', method: 'getDirectives', query: { full_fqdn: cmdOpts.fullFqdn } }), { json: jsonModeFrom(globalOpts) });
});
domains.command('directives-add').description('domain/addDirectives').requiredOption('--full-fqdn <fqdn>').requiredOption('--directives-json <json>').option('--dry-run').action(async (cmdOpts, cmd) => {
  const globalOpts = cmd.parent.parent.opts();
  const directives = parseJsonOption(cmdOpts.directivesJson, 'directives-json');
  printResult(await executeApi({ globalOpts, cmdOpts, section: 'domain', method: 'addDirectives', mutate: true, inputData: { full_fqdn: cmdOpts.fullFqdn, directives_list: directives } }), { json: jsonModeFrom(globalOpts) });
});
domains.command('directives-remove').description('domain/removeDirectives').requiredOption('--full-fqdn <fqdn>').requiredOption('--directives-json <json>').option('--dry-run').action(async (cmdOpts, cmd) => {
  const globalOpts = cmd.parent.parent.opts();
  const directives = parseJsonOption(cmdOpts.directivesJson, 'directives-json');
  printResult(await executeApi({ globalOpts, cmdOpts, section: 'domain', method: 'removeDirectives', mutate: true, inputData: { full_fqdn: cmdOpts.fullFqdn, directives_list: directives } }), { json: jsonModeFrom(globalOpts) });
});

const dns = program.command('dns').description('DNS operations');
dns.command('list <domain>').description('dns/getData').action(async (domain, _, cmd) => {
  const globalOpts = cmd.parent.parent.opts();
  printResult(await executeApi({ globalOpts, cmdOpts: {}, section: 'dns', method: 'getData', inputData: { fqdn: domain } }), { json: jsonModeFrom(globalOpts) });
});
dns.command('change-records').description('dns/changeRecords').requiredOption('--fqdn <fqdn>').requiredOption('--records-json <json>').option('--dry-run').action(async (cmdOpts, cmd) => {
  const globalOpts = cmd.parent.parent.opts();
  printResult(await executeApi({ globalOpts, cmdOpts, section: 'dns', method: 'changeRecords', mutate: true, inputData: { fqdn: cmdOpts.fqdn, records: parseJsonOption(cmdOpts.recordsJson, 'records-json') } }), { json: jsonModeFrom(globalOpts) });
});
dns.command('ns-get <domain>').description('Shortcut for DNS records').action(async (domain, _, cmd) => {
  const globalOpts = cmd.parent.parent.opts();
  const result = await executeApi({ globalOpts, cmdOpts: {}, section: 'dns', method: 'getData', inputData: { fqdn: domain } });
  printResult({ fqdn: result.fqdn, dns: result.records?.DNS ?? [], dns_ip: result.records?.DNS_IP ?? [] }, { json: jsonModeFrom(globalOpts) });
});
dns.command('ns-set <domain> <ns1> <ns2>').description('dns/changeRecords shortcut').option('--ip1 <ip>').option('--ip2 <ip>').option('--dry-run').action(async (domain, ns1, ns2, cmdOpts, cmd) => {
  const globalOpts = cmd.parent.parent.opts();
  const records = { DNS: [{ priority: 10, value: ns1 }, { priority: 20, value: ns2 }] };
  if (cmdOpts.ip1 || cmdOpts.ip2) records.DNS_IP = [{ priority: 10, value: cmdOpts.ip1 ?? null }, { priority: 20, value: cmdOpts.ip2 ?? null }];
  printResult(await executeApi({ globalOpts, cmdOpts, section: 'dns', method: 'changeRecords', mutate: true, inputData: { fqdn: domain, records } }), { json: jsonModeFrom(globalOpts) });
});

const ftp = program.command('ftp').description('FTP operations');
ftp.command('list').description('ftp/getList').action(async (_, cmd) => { const globalOpts = cmd.parent.parent.opts(); printResult(await executeApi({ globalOpts, cmdOpts: {}, section: 'ftp', method: 'getList' }), { json: jsonModeFrom(globalOpts) }); });
ftp.command('add').description('ftp/add').requiredOption('--suffix <suffix>').requiredOption('--homedir <path>').option('--dry-run').option('--no-input').action(async (cmdOpts, cmd) => {
  const globalOpts = cmd.parent.parent.opts();
  const password = await getSecret({ cmdOpts, envKeys: ['BEGET_FTP_PASSWORD'], prompt: 'FTP account password: ' });
  printResult(await executeApi({ globalOpts, cmdOpts, section: 'ftp', method: 'add', mutate: true, inputData: { suffix: cmdOpts.suffix, homedir: cmdOpts.homedir, password } }), { json: jsonModeFrom(globalOpts) });
});
ftp.command('change-password').description('ftp/changePassword').requiredOption('--suffix <suffix>').option('--dry-run').option('--no-input').action(async (cmdOpts, cmd) => {
  const globalOpts = cmd.parent.parent.opts();
  const password = await getSecret({ cmdOpts, envKeys: ['BEGET_FTP_PASSWORD'], prompt: 'New FTP password: ' });
  printResult(await executeApi({ globalOpts, cmdOpts, section: 'ftp', method: 'changePassword', mutate: true, inputData: { suffix: cmdOpts.suffix, password } }), { json: jsonModeFrom(globalOpts) });
});
ftp.command('delete').description('ftp/delete').requiredOption('--suffix <suffix>').option('--dry-run').option('--yes').action(async (cmdOpts, cmd) => {
  const globalOpts = cmd.parent.parent.opts();
  printResult(await executeApi({ globalOpts, cmdOpts, section: 'ftp', method: 'delete', mutate: true, risky: true, riskTitle: 'Delete FTP account', inputData: { suffix: cmdOpts.suffix } }), { json: jsonModeFrom(globalOpts) });
});

const mail = program.command('mail').description('Mail operations');
mail.command('mailbox-list').requiredOption('--domain <domain>').description('mail/getMailboxList').action(async (cmdOpts, cmd) => { const globalOpts = cmd.parent.parent.opts(); printResult(await executeApi({ globalOpts, cmdOpts, section: 'mail', method: 'getMailboxList', inputData: { domain: cmdOpts.domain } }), { json: jsonModeFrom(globalOpts) }); });
mail.command('mailbox-password-change').requiredOption('--domain <domain>').requiredOption('--mailbox <name>').option('--dry-run').option('--no-input').description('mail/changeMailboxPassword').action(async (cmdOpts, cmd) => {
  const globalOpts = cmd.parent.parent.opts();
  const mailbox_password = await getSecret({ cmdOpts, envKeys: ['BEGET_MAILBOX_PASSWORD'], prompt: 'Mailbox password: ' });
  printResult(await executeApi({ globalOpts, cmdOpts, section: 'mail', method: 'changeMailboxPassword', mutate: true, inputData: { domain: cmdOpts.domain, mailbox: cmdOpts.mailbox, mailbox_password } }), { json: jsonModeFrom(globalOpts) });
});
mail.command('mailbox-create').requiredOption('--domain <domain>').requiredOption('--mailbox <name>').option('--dry-run').option('--no-input').description('mail/createMailbox').action(async (cmdOpts, cmd) => {
  const globalOpts = cmd.parent.parent.opts();
  const mailbox_password = await getSecret({ cmdOpts, envKeys: ['BEGET_MAILBOX_PASSWORD'], prompt: 'Mailbox password: ' });
  printResult(await executeApi({ globalOpts, cmdOpts, section: 'mail', method: 'createMailbox', mutate: true, inputData: { domain: cmdOpts.domain, mailbox: cmdOpts.mailbox, mailbox_password } }), { json: jsonModeFrom(globalOpts) });
});
mail.command('mailbox-drop').requiredOption('--domain <domain>').requiredOption('--mailbox <name>').option('--dry-run').option('--yes').description('mail/dropMailbox').action(async (cmdOpts, cmd) => {
  const globalOpts = cmd.parent.parent.opts();
  printResult(await executeApi({ globalOpts, cmdOpts, section: 'mail', method: 'dropMailbox', mutate: true, risky: true, riskTitle: 'Drop mailbox', inputData: { domain: cmdOpts.domain, mailbox: cmdOpts.mailbox } }), { json: jsonModeFrom(globalOpts) });
});
mail.command('mailbox-settings-change').requiredOption('--domain <domain>').requiredOption('--mailbox <name>').requiredOption('--spam-filter-status <0|1>').requiredOption('--spam-filter <0-100>').requiredOption('--forward-mail-status <mode>').option('--dry-run').description('mail/changeMailboxSettings').action(async (cmdOpts, cmd) => {
  const globalOpts = cmd.parent.parent.opts();
  printResult(await executeApi({ globalOpts, cmdOpts, section: 'mail', method: 'changeMailboxSettings', mutate: true, inputData: { domain: cmdOpts.domain, mailbox: cmdOpts.mailbox, spam_filter_status: Number(cmdOpts.spamFilterStatus), spam_filter: Number(cmdOpts.spamFilter), forward_mail_status: cmdOpts.forwardMailStatus } }), { json: jsonModeFrom(globalOpts) });
});
mail.command('forward-add').requiredOption('--domain <domain>').requiredOption('--mailbox <name>').requiredOption('--forward-mailbox <email>').option('--dry-run').description('mail/forwardListAddMailbox').action(async (cmdOpts, cmd) => { const globalOpts = cmd.parent.parent.opts(); printResult(await executeApi({ globalOpts, cmdOpts, section: 'mail', method: 'forwardListAddMailbox', mutate: true, inputData: { domain: cmdOpts.domain, mailbox: cmdOpts.mailbox, forward_mailbox: cmdOpts.forwardMailbox } }), { json: jsonModeFrom(globalOpts) }); });
mail.command('forward-delete').requiredOption('--domain <domain>').requiredOption('--mailbox <name>').requiredOption('--forward-mailbox <email>').option('--dry-run').description('mail/forwardListDeleteMailbox').action(async (cmdOpts, cmd) => { const globalOpts = cmd.parent.parent.opts(); printResult(await executeApi({ globalOpts, cmdOpts, section: 'mail', method: 'forwardListDeleteMailbox', mutate: true, inputData: { domain: cmdOpts.domain, mailbox: cmdOpts.mailbox, forward_mailbox: cmdOpts.forwardMailbox } }), { json: jsonModeFrom(globalOpts) }); });
mail.command('forward-show').requiredOption('--domain <domain>').requiredOption('--mailbox <name>').description('mail/forwardListShow').action(async (cmdOpts, cmd) => { const globalOpts = cmd.parent.parent.opts(); printResult(await executeApi({ globalOpts, cmdOpts, section: 'mail', method: 'forwardListShow', inputData: { domain: cmdOpts.domain, mailbox: cmdOpts.mailbox } }), { json: jsonModeFrom(globalOpts) }); });
mail.command('domain-mail-set').requiredOption('--domain <domain>').requiredOption('--domain-mailbox <email>').option('--dry-run').description('mail/setDomainMail').action(async (cmdOpts, cmd) => { const globalOpts = cmd.parent.parent.opts(); printResult(await executeApi({ globalOpts, cmdOpts, section: 'mail', method: 'setDomainMail', mutate: true, inputData: { domain: cmdOpts.domain, domain_mailbox: cmdOpts.domainMailbox } }), { json: jsonModeFrom(globalOpts) }); });
mail.command('domain-mail-clear').requiredOption('--domain <domain>').option('--dry-run').description('mail/clearDomainMail').action(async (cmdOpts, cmd) => { const globalOpts = cmd.parent.parent.opts(); printResult(await executeApi({ globalOpts, cmdOpts, section: 'mail', method: 'clearDomainMail', mutate: true, inputData: { domain: cmdOpts.domain } }), { json: jsonModeFrom(globalOpts) }); });

const mysql = program.command('mysql').description('MySQL operations');
mysql.command('list').description('mysql/getList').action(async (_, cmd) => { const globalOpts = cmd.parent.parent.opts(); printResult(await executeApi({ globalOpts, cmdOpts: {}, section: 'mysql', method: 'getList' }), { json: jsonModeFrom(globalOpts) }); });
mysql.command('db-add').requiredOption('--suffix <suffix>').option('--dry-run').option('--no-input').description('mysql/addDb').action(async (cmdOpts, cmd) => { const globalOpts = cmd.parent.parent.opts(); const password = await getSecret({ cmdOpts, envKeys: ['BEGET_MYSQL_PASSWORD'], prompt: 'MySQL password: ' }); printResult(await executeApi({ globalOpts, cmdOpts, section: 'mysql', method: 'addDb', mutate: true, inputData: { suffix: cmdOpts.suffix, password } }), { json: jsonModeFrom(globalOpts) }); });
mysql.command('access-add').requiredOption('--suffix <suffix>').requiredOption('--access <access>').option('--dry-run').option('--no-input').description('mysql/addAccess').action(async (cmdOpts, cmd) => { const globalOpts = cmd.parent.parent.opts(); const password = await getSecret({ cmdOpts, envKeys: ['BEGET_MYSQL_PASSWORD'], prompt: 'MySQL access password: ' }); printResult(await executeApi({ globalOpts, cmdOpts, section: 'mysql', method: 'addAccess', mutate: true, inputData: { suffix: cmdOpts.suffix, access: cmdOpts.access, password } }), { json: jsonModeFrom(globalOpts) }); });
mysql.command('db-drop').requiredOption('--suffix <suffix>').option('--dry-run').option('--yes').description('mysql/dropDb').action(async (cmdOpts, cmd) => { const globalOpts = cmd.parent.parent.opts(); printResult(await executeApi({ globalOpts, cmdOpts, section: 'mysql', method: 'dropDb', mutate: true, risky: true, riskTitle: 'Drop MySQL database', inputData: { suffix: cmdOpts.suffix } }), { json: jsonModeFrom(globalOpts) }); });
mysql.command('access-drop').requiredOption('--suffix <suffix>').requiredOption('--access <access>').option('--dry-run').option('--yes').description('mysql/dropAccess').action(async (cmdOpts, cmd) => { const globalOpts = cmd.parent.parent.opts(); printResult(await executeApi({ globalOpts, cmdOpts, section: 'mysql', method: 'dropAccess', mutate: true, risky: true, riskTitle: 'Drop MySQL access', inputData: { suffix: cmdOpts.suffix, access: cmdOpts.access } }), { json: jsonModeFrom(globalOpts) }); });
mysql.command('access-password-change').requiredOption('--suffix <suffix>').requiredOption('--access <access>').option('--dry-run').option('--no-input').description('mysql/changeAccessPassword').action(async (cmdOpts, cmd) => { const globalOpts = cmd.parent.parent.opts(); const password = await getSecret({ cmdOpts, envKeys: ['BEGET_MYSQL_PASSWORD'], prompt: 'New MySQL password: ' }); printResult(await executeApi({ globalOpts, cmdOpts, section: 'mysql', method: 'changeAccessPassword', mutate: true, inputData: { suffix: cmdOpts.suffix, access: cmdOpts.access, password } }), { json: jsonModeFrom(globalOpts) }); });

const backup = program.command('backup').description('Backup operations');
backup.command('file-backup-list').description('backup/getFileBackupList').action(async (_, cmd) => { const globalOpts = cmd.parent.parent.opts(); printResult(await executeApi({ globalOpts, cmdOpts: {}, section: 'backup', method: 'getFileBackupList' }), { json: jsonModeFrom(globalOpts) }); });
backup.command('mysql-backup-list').description('backup/getMysqlBackupList').action(async (_, cmd) => { const globalOpts = cmd.parent.parent.opts(); printResult(await executeApi({ globalOpts, cmdOpts: {}, section: 'backup', method: 'getMysqlBackupList' }), { json: jsonModeFrom(globalOpts) }); });
backup.command('file-list').description('backup/getFileList').option('--backup-id <id>').option('--path <path>', '/', 'path in backup').action(async (cmdOpts, cmd) => { const globalOpts = cmd.parent.parent.opts(); printResult(await executeApi({ globalOpts, cmdOpts, section: 'backup', method: 'getFileList', inputData: { backup_id: cmdOpts.backupId ? Number(cmdOpts.backupId) : undefined, path: cmdOpts.path } }), { json: jsonModeFrom(globalOpts) }); });
backup.command('mysql-list').description('backup/getMysqlList').option('--backup-id <id>').action(async (cmdOpts, cmd) => { const globalOpts = cmd.parent.parent.opts(); printResult(await executeApi({ globalOpts, cmdOpts, section: 'backup', method: 'getMysqlList', inputData: { backup_id: cmdOpts.backupId ? Number(cmdOpts.backupId) : undefined } }), { json: jsonModeFrom(globalOpts) }); });
backup.command('restore-file').description('backup/restoreFile').requiredOption('--backup-id <id>').requiredOption('--paths <csv>').option('--dry-run').option('--yes').action(async (cmdOpts, cmd) => { const globalOpts = cmd.parent.parent.opts(); printResult(await executeApi({ globalOpts, cmdOpts, section: 'backup', method: 'restoreFile', mutate: true, risky: true, riskTitle: 'Restore files from backup', inputData: { backup_id: Number(cmdOpts.backupId), paths: parseCsv(cmdOpts.paths) } }), { json: jsonModeFrom(globalOpts) }); });
backup.command('restore-mysql').description('backup/restoreMysql').requiredOption('--backup-id <id>').requiredOption('--bases <csv>').option('--dry-run').option('--yes').action(async (cmdOpts, cmd) => { const globalOpts = cmd.parent.parent.opts(); printResult(await executeApi({ globalOpts, cmdOpts, section: 'backup', method: 'restoreMysql', mutate: true, risky: true, riskTitle: 'Restore MySQL databases from backup', inputData: { backup_id: Number(cmdOpts.backupId), bases: parseCsv(cmdOpts.bases) } }), { json: jsonModeFrom(globalOpts) }); });
backup.command('download-file').description('backup/downloadFile').requiredOption('--paths <csv>').option('--backup-id <id>').option('--dry-run').action(async (cmdOpts, cmd) => { const globalOpts = cmd.parent.parent.opts(); printResult(await executeApi({ globalOpts, cmdOpts, section: 'backup', method: 'downloadFile', mutate: true, inputData: { backup_id: cmdOpts.backupId ? Number(cmdOpts.backupId) : undefined, paths: parseCsv(cmdOpts.paths) } }), { json: jsonModeFrom(globalOpts) }); });
backup.command('download-mysql').description('backup/downloadMysql').requiredOption('--bases <csv>').option('--backup-id <id>').option('--dry-run').action(async (cmdOpts, cmd) => { const globalOpts = cmd.parent.parent.opts(); printResult(await executeApi({ globalOpts, cmdOpts, section: 'backup', method: 'downloadMysql', mutate: true, inputData: { backup_id: cmdOpts.backupId ? Number(cmdOpts.backupId) : undefined, bases: parseCsv(cmdOpts.bases) } }), { json: jsonModeFrom(globalOpts) }); });
backup.command('log').description('backup/getLog').action(async (_, cmd) => { const globalOpts = cmd.parent.parent.opts(); printResult(await executeApi({ globalOpts, cmdOpts: {}, section: 'backup', method: 'getLog' }), { json: jsonModeFrom(globalOpts) }); });

const cron = program.command('cron').description('Cron operations');
cron.command('list').description('cron/getList').action(async (_, cmd) => { const globalOpts = cmd.parent.parent.opts(); printResult(await executeApi({ globalOpts, cmdOpts: {}, section: 'cron', method: 'getList' }), { json: jsonModeFrom(globalOpts) }); });
cron.command('add').description('cron/add').requiredOption('--minutes <m>').requiredOption('--hours <h>').requiredOption('--days <d>').requiredOption('--months <m>').requiredOption('--weekdays <w>').requiredOption('--command <cmd>').option('--dry-run').action(async (cmdOpts, cmd) => { const globalOpts = cmd.parent.parent.opts(); printResult(await executeApi({ globalOpts, cmdOpts, section: 'cron', method: 'add', mutate: true, inputData: { minutes: cmdOpts.minutes, hours: cmdOpts.hours, days: cmdOpts.days, months: cmdOpts.months, weekdays: cmdOpts.weekdays, command: cmdOpts.command } }), { json: jsonModeFrom(globalOpts) }); });
cron.command('edit').description('cron/edit').requiredOption('--row-number <id>').requiredOption('--minutes <m>').requiredOption('--hours <h>').requiredOption('--days <d>').requiredOption('--months <m>').requiredOption('--weekdays <w>').requiredOption('--command <cmd>').option('--dry-run').action(async (cmdOpts, cmd) => { const globalOpts = cmd.parent.parent.opts(); printResult(await executeApi({ globalOpts, cmdOpts, section: 'cron', method: 'edit', mutate: true, inputData: { row_number: Number(cmdOpts.rowNumber), minutes: cmdOpts.minutes, hours: cmdOpts.hours, days: cmdOpts.days, months: cmdOpts.months, weekdays: cmdOpts.weekdays, command: cmdOpts.command } }), { json: jsonModeFrom(globalOpts) }); });
cron.command('delete').description('cron/delete').requiredOption('--row-number <id>').option('--dry-run').option('--yes').action(async (cmdOpts, cmd) => { const globalOpts = cmd.parent.parent.opts(); printResult(await executeApi({ globalOpts, cmdOpts, section: 'cron', method: 'delete', mutate: true, risky: true, riskTitle: 'Delete cron task', inputData: { row_number: Number(cmdOpts.rowNumber) } }), { json: jsonModeFrom(globalOpts) }); });
cron.command('change-hidden-state').description('cron/changeHiddenState').requiredOption('--row-number <id>').requiredOption('--is-hidden <0|1>').option('--dry-run').action(async (cmdOpts, cmd) => { const globalOpts = cmd.parent.parent.opts(); printResult(await executeApi({ globalOpts, cmdOpts, section: 'cron', method: 'changeHiddenState', mutate: true, inputData: { row_number: Number(cmdOpts.rowNumber), is_hidden: Number(cmdOpts.isHidden) } }), { json: jsonModeFrom(globalOpts) }); });
cron.command('email-get').description('cron/getEmail').action(async (_, cmd) => { const globalOpts = cmd.parent.parent.opts(); printResult(await executeApi({ globalOpts, cmdOpts: {}, section: 'cron', method: 'getEmail' }), { json: jsonModeFrom(globalOpts) }); });
cron.command('email-set').description('cron/setEmail').requiredOption('--email <email>').option('--dry-run').action(async (cmdOpts, cmd) => { const globalOpts = cmd.parent.parent.opts(); printResult(await executeApi({ globalOpts, cmdOpts, section: 'cron', method: 'setEmail', mutate: true, inputData: { email: cmdOpts.email } }), { json: jsonModeFrom(globalOpts) }); });

const sites = program.command('sites').description('Site operations (API section: site)');
sites.command('list').description('site/getList').action(async (_, cmd) => { const globalOpts = cmd.parent.parent.opts(); printResult(await executeApi({ globalOpts, cmdOpts: {}, section: 'site', method: 'getList' }), { json: jsonModeFrom(globalOpts) }); });
sites.command('add').description('site/add').requiredOption('--name <dir>').option('--dry-run').action(async (cmdOpts, cmd) => { const globalOpts = cmd.parent.parent.opts(); printResult(await executeApi({ globalOpts, cmdOpts, section: 'site', method: 'add', mutate: true, inputData: { name: cmdOpts.name } }), { json: jsonModeFrom(globalOpts) }); });
sites.command('delete').description('site/delete').requiredOption('--id <id>').option('--dry-run').option('--yes').action(async (cmdOpts, cmd) => { const globalOpts = cmd.parent.parent.opts(); printResult(await executeApi({ globalOpts, cmdOpts, section: 'site', method: 'delete', mutate: true, risky: true, riskTitle: 'Delete site', inputData: { id: Number(cmdOpts.id) } }), { json: jsonModeFrom(globalOpts) }); });
sites.command('link-domain').description('site/linkDomain').requiredOption('--domain-id <id>').requiredOption('--site-id <id>').option('--dry-run').action(async (cmdOpts, cmd) => { const globalOpts = cmd.parent.parent.opts(); printResult(await executeApi({ globalOpts, cmdOpts, section: 'site', method: 'linkDomain', mutate: true, inputData: { domain_id: Number(cmdOpts.domainId), site_id: Number(cmdOpts.siteId) } }), { json: jsonModeFrom(globalOpts) }); });
sites.command('unlink-domain').description('site/unlinkDomain').requiredOption('--domain-id <id>').option('--dry-run').action(async (cmdOpts, cmd) => { const globalOpts = cmd.parent.parent.opts(); printResult(await executeApi({ globalOpts, cmdOpts, section: 'site', method: 'unlinkDomain', mutate: true, inputData: { domain_id: Number(cmdOpts.domainId) } }), { json: jsonModeFrom(globalOpts) }); });
sites.command('freeze').description('site/freeze').requiredOption('--id <id>').option('--excluded-paths <csv>').option('--dry-run').action(async (cmdOpts, cmd) => { const globalOpts = cmd.parent.parent.opts(); printResult(await executeApi({ globalOpts, cmdOpts, section: 'site', method: 'freeze', mutate: true, inputData: { id: Number(cmdOpts.id), excludedPaths: cmdOpts.excludedPaths ? parseCsv(cmdOpts.excludedPaths) : undefined } }), { json: jsonModeFrom(globalOpts) }); });
sites.command('unfreeze').description('site/unfreeze').requiredOption('--id <id>').option('--dry-run').action(async (cmdOpts, cmd) => { const globalOpts = cmd.parent.parent.opts(); printResult(await executeApi({ globalOpts, cmdOpts, section: 'site', method: 'unfreeze', mutate: true, inputData: { id: Number(cmdOpts.id) } }), { json: jsonModeFrom(globalOpts) }); });
sites.command('is-frozen').description('site/isSiteFrozen').requiredOption('--site-id <id>').action(async (cmdOpts, cmd) => { const globalOpts = cmd.parent.parent.opts(); printResult(await executeApi({ globalOpts, cmdOpts, section: 'site', method: 'isSiteFrozen', inputData: { site_id: Number(cmdOpts.siteId) } }), { json: jsonModeFrom(globalOpts) }); });

const stats = program.command('stats').description('Statistics operations (API section: stat)');
stats.command('sites-list-load').description('stat/getSitesListLoad').action(async (_, cmd) => { const globalOpts = cmd.parent.parent.opts(); printResult(await executeApi({ globalOpts, cmdOpts: {}, section: 'stat', method: 'getSitesListLoad' }), { json: jsonModeFrom(globalOpts) }); });
stats.command('site-load').description('stat/getSiteLoad').requiredOption('--site-name <name>').action(async (cmdOpts, cmd) => { const globalOpts = cmd.parent.parent.opts(); printResult(await executeApi({ globalOpts, cmdOpts, section: 'stat', method: 'getSiteLoad', inputData: { site_name: cmdOpts.siteName } }), { json: jsonModeFrom(globalOpts) }); });
stats.command('db-list-load').description('stat/getDbListLoad').action(async (_, cmd) => { const globalOpts = cmd.parent.parent.opts(); printResult(await executeApi({ globalOpts, cmdOpts: {}, section: 'stat', method: 'getDbListLoad' }), { json: jsonModeFrom(globalOpts) }); });
stats.command('db-load').description('stat/getDbLoad').requiredOption('--db-name <name>').action(async (cmdOpts, cmd) => { const globalOpts = cmd.parent.parent.opts(); printResult(await executeApi({ globalOpts, cmdOpts, section: 'stat', method: 'getDbLoad', inputData: { db_name: cmdOpts.dbName } }), { json: jsonModeFrom(globalOpts) }); });

registerVpsCommands(program, {
  execute: executeVpsOperation,
  usageError: (message) => new CliError(message, EXIT.USAGE_ERROR),
});

program.configureOutput({ outputError: (str, write) => write(str) });

(async () => {
  try {
    await program.parseAsync(process.argv);
  } catch (err) {
    if (err?.code === 'commander.helpDisplayed') process.exit(EXIT.OK);
    const globalJson = process.argv.includes('--json');
    if (err instanceof CliError) {
      printError(err, globalJson);
      process.exit(err.code);
      return;
    }
    printError(new CliError(err.message || 'Unexpected error', EXIT.GENERIC_ERROR), globalJson);
    process.exit(EXIT.GENERIC_ERROR);
  }
})();
