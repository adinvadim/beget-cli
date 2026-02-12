#!/usr/bin/env node
import { Command } from 'commander';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output, stderr } from 'node:process';
import fs from 'node:fs/promises';
import fssync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { URLSearchParams } from 'node:url';
import { spawnSync } from 'node:child_process';

const EXIT = {
  OK: 0,
  GENERIC_ERROR: 1,
  USAGE_ERROR: 2,
  AUTH_ERROR: 3,
  API_ERROR: 4,
  CONFIG_ERROR: 5,
  NETWORK_ERROR: 6,
};

function isTTY() {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
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
    if (err.code === 'ENOENT') {
      return { version: 1, activeProfile: null, profiles: {} };
    }
    throw new CliError(`Failed to read config: ${err.message}`, EXIT.CONFIG_ERROR);
  }
}

async function writeConfig(configPath, cfg) {
  await ensureParentSecure(configPath);
  const payload = JSON.stringify(cfg, null, 2) + '\n';
  await fs.writeFile(configPath, payload, { mode: 0o600 });
  await fs.chmod(configPath, 0o600).catch(() => {});
}

class CliError extends Error {
  constructor(message, code = EXIT.GENERIC_ERROR, details = undefined) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

function printResult(data, opts = {}) {
  if (opts.json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  if (typeof data === 'string') {
    console.log(data);
    return;
  }
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
    throw new CliError(
      'Missing Beget credentials. Set active profile via `beget auth use <name>` or provide BEGET_LOGIN + BEGET_API_PASSWORD (or BEGET_API_KEY) env vars.',
      EXIT.AUTH_ERROR
    );
  }

  return { login, apiKey, baseUrl, selectedProfile };
}

async function promptMasked(query) {
  if (!process.stdin.isTTY) {
    throw new CliError('Cannot prompt for secret in non-interactive mode. Set BEGET_API_PASSWORD (or BEGET_API_KEY).', EXIT.USAGE_ERROR);
  }

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
    if (ch === '\u0003') {
      output.write('^C\n');
      process.exit(130);
    }
    if (ch === '\u007f' || ch === '\b') {
      if (value.length > 0) {
        value = value.slice(0, -1);
      }
      continue;
    }
    value += ch;
  }

  if (input.setRawMode) input.setRawMode(wasRaw);
  return value.trim();
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

async function callBeget({ baseUrl, login, apiKey, section, method, inputData, query = {}, timeoutMs = 20000 }) {
  const params = new URLSearchParams();
  params.set('login', login);
  params.set('passwd', apiKey);
  params.set('output_format', 'json');

  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null) params.set(k, String(v));
  }

  if (inputData) {
    params.set('input_format', 'json');
    params.set('input_data', JSON.stringify(inputData));
  }

  const url = `${baseUrl.replace(/\/$/, '')}/${section}/${method}?${params.toString()}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetch(url, { signal: controller.signal });
  } catch (err) {
    if (err.name === 'AbortError') throw new CliError(`Network timeout after ${timeoutMs}ms`, EXIT.NETWORK_ERROR);
    throw new CliError(`Network error: ${err.message}`, EXIT.NETWORK_ERROR);
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new CliError(`HTTP ${response.status} ${response.statusText}`, EXIT.NETWORK_ERROR);
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new CliError('API returned non-JSON response', EXIT.API_ERROR);
  }

  if (payload.status !== 'success') {
    const code = payload.error_code === 'AUTH_ERROR' ? EXIT.AUTH_ERROR : EXIT.API_ERROR;
    throw new CliError(`Beget API error: ${payload.error_text ?? 'unknown error'}`, code, payload.error_code);
  }

  const answer = payload.answer;
  if (!answer || answer.status !== 'success') {
    const firstErr = answer?.errors?.[0];
    throw new CliError(
      `Method failed: ${firstErr?.error_text ?? 'unknown method error'}`,
      EXIT.API_ERROR,
      firstErr?.error_code
    );
  }

  return answer.result;
}

const program = new Command();
program
  .name('beget')
  .description('CLI for Beget API (MVP)')
  .version('0.1.0')
  .option('--config <path>', 'path to config file')
  .option('--profile <name>', 'profile name to use')
  .option('--login <login>', 'override login for this invocation')
  .option('--base-url <url>', 'override API base URL')
  .option('--timeout <ms>', 'request timeout in milliseconds', '20000')
  .option('--json', 'output machine-readable JSON');

const auth = program.command('auth').description('Manage local Beget credentials');

auth
  .command('add <name>')
  .description('Add/update profile (prompts for login and API password)')
  .option('--dry-run', 'show what would change without writing config')
  .option('--no-input', 'disable interactive prompts')
  .option('--login <login>', 'login for the profile')
  .action(async (name, cmdOpts, cmd) => {
    const globalOpts = cmd.parent.parent.opts();
    const jsonMode = Boolean(globalOpts.json);
    const configPath = getConfigPath(globalOpts.config);
    const cfg = await readConfig(configPath);

    const noInput = cmdOpts.input === false;
    let login = cmdOpts.login ?? globalOpts.login;
    let apiKey = process.env.BEGET_API_PASSWORD ?? process.env.BEGET_API_KEY;

    if (!login) {
      if (noInput) throw new CliError('Missing --login in --no-input mode', EXIT.USAGE_ERROR);
      login = await promptLine('Beget login: ');
    }

    if (!apiKey) {
      if (noInput) throw new CliError('Missing BEGET_API_PASSWORD (or BEGET_API_KEY) in --no-input mode', EXIT.USAGE_ERROR);
      apiKey = await promptMasked('Beget API password: ');
    }

    if (!login || !apiKey) throw new CliError('Both login and API password are required', EXIT.USAGE_ERROR);

    const existed = Boolean(cfg.profiles[name]);
    const next = structuredClone(cfg);
    next.profiles[name] = { login, apiKey };
    if (!next.activeProfile) next.activeProfile = name;

    if (cmdOpts.dryRun) {
      printResult({
        dryRun: true,
        action: existed ? 'update-profile' : 'add-profile',
        profile: name,
        activeProfile: next.activeProfile,
        configPath,
      }, { json: jsonMode });
      return;
    }

    await writeConfig(configPath, next);
    printResult(
      jsonMode
        ? { ok: true, action: existed ? 'updated' : 'added', profile: name, activeProfile: next.activeProfile }
        : `${existed ? 'Updated' : 'Added'} profile '${name}'. Active profile: '${next.activeProfile}'.`,
      { json: jsonMode }
    );
  });

auth
  .command('list')
  .description('List configured profiles')
  .action(async (_, cmd) => {
    const globalOpts = cmd.parent.parent.opts();
    const jsonMode = Boolean(globalOpts.json);
    const cfg = await readConfig(getConfigPath(globalOpts.config));
    const rows = Object.entries(cfg.profiles).map(([name, p]) => ({
      name,
      login: p.login,
      active: cfg.activeProfile === name,
    }));

    if (jsonMode) return printResult({ profiles: rows, activeProfile: cfg.activeProfile }, { json: true });
    if (rows.length === 0) return printResult('No profiles configured. Use: beget auth add <name>');
    for (const r of rows) {
      console.log(`${r.active ? '*' : ' '} ${r.name}\t${r.login}`);
    }
  });

auth
  .command('use <name>')
  .description('Set active profile')
  .option('--dry-run', 'show what would change without writing config')
  .action(async (name, cmdOpts, cmd) => {
    const globalOpts = cmd.parent.parent.opts();
    const jsonMode = Boolean(globalOpts.json);
    const configPath = getConfigPath(globalOpts.config);
    const cfg = await readConfig(configPath);

    if (!cfg.profiles[name]) throw new CliError(`Profile '${name}' not found`, EXIT.CONFIG_ERROR);

    if (cmdOpts.dryRun) {
      return printResult({ dryRun: true, action: 'set-active-profile', profile: name, configPath }, { json: jsonMode });
    }

    cfg.activeProfile = name;
    await writeConfig(configPath, cfg);
    printResult(jsonMode ? { ok: true, activeProfile: name } : `Active profile set to '${name}'.`, { json: jsonMode });
  });

auth
  .command('remove <name>')
  .description('Remove stored profile')
  .option('--dry-run', 'show what would change without writing config')
  .action(async (name, cmdOpts, cmd) => {
    const globalOpts = cmd.parent.parent.opts();
    const jsonMode = Boolean(globalOpts.json);
    const configPath = getConfigPath(globalOpts.config);
    const cfg = await readConfig(configPath);

    if (!cfg.profiles[name]) throw new CliError(`Profile '${name}' not found`, EXIT.CONFIG_ERROR);

    const nextActive = cfg.activeProfile === name ? Object.keys(cfg.profiles).find((k) => k !== name) ?? null : cfg.activeProfile;

    if (cmdOpts.dryRun) {
      return printResult({ dryRun: true, action: 'remove-profile', profile: name, nextActiveProfile: nextActive, configPath }, { json: jsonMode });
    }

    delete cfg.profiles[name];
    cfg.activeProfile = nextActive;
    await writeConfig(configPath, cfg);
    printResult(
      jsonMode ? { ok: true, removed: name, activeProfile: cfg.activeProfile } : `Removed profile '${name}'.`,
      { json: jsonMode }
    );
  });

const account = program.command('account').description('Account operations');
account
  .command('info')
  .description('Get account information (user/getAccountInfo)')
  .action(async (_, cmd) => {
    const globalOpts = cmd.parent.parent.opts();
    const jsonMode = Boolean(globalOpts.json);
    const timeoutMs = Number(globalOpts.timeout);
    const cfg = await readConfig(getConfigPath(globalOpts.config));
    const creds = resolveCredentials(globalOpts, cfg);

    const result = await callBeget({
      ...creds,
      section: 'user',
      method: 'getAccountInfo',
      timeoutMs,
    });

    printResult(result, { json: jsonMode });
  });

const domains = program.command('domains').description('Domain operations');

async function fetchDomainsWithExpiry(globalOpts, cmdOpts = {}) {
  const timeoutMs = Number(globalOpts.timeout);
  const expiringDays = Number(cmdOpts.expiringDays ?? 30);
  const cfg = await readConfig(getConfigPath(globalOpts.config));
  const creds = resolveCredentials(globalOpts, cfg);

  const result = await callBeget({
    ...creds,
    section: 'domain',
    method: 'getList',
    timeoutMs,
  });

  const filtered = cmdOpts.all ? result : result.filter((d) => Number(d.is_under_control) === 1);
  const now = new Date();
  return filtered.map((d) => {
    const exp = d.date_expire ? new Date(`${d.date_expire}T00:00:00Z`) : null;
    const daysToExpire = exp ? Math.ceil((exp.getTime() - now.getTime()) / 86400000) : null;
    const expiresSoon = daysToExpire !== null && daysToExpire >= 0 && daysToExpire <= expiringDays;
    return { ...d, days_to_expire: daysToExpire, expires_soon: expiresSoon };
  });
}

domains
  .command('list')
  .description('List domains (domain/getList). By default returns only active/managed domains.')
  .option('--all', 'include inactive/unmanaged domains too')
  .option('--expiring-days <days>', 'mark domains expiring in N days (default: 30)', '30')
  .action(async (cmdOpts, cmd) => {
    const globalOpts = cmd.parent.parent.opts();
    const jsonMode = Boolean(globalOpts.json);
    const enriched = await fetchDomainsWithExpiry(globalOpts, cmdOpts);

    if (jsonMode) {
      printResult(enriched, { json: true });
      return;
    }

    for (const d of enriched) {
      const badge = d.expires_soon ? '⚠️ expiring soon' : '';
      const expInfo = d.days_to_expire === null ? 'n/a' : `${d.days_to_expire}d`;
      console.log(`${d.fqdn}\t${d.date_expire ?? 'n/a'}\t${expInfo}\t${badge}`.trim());
    }
  });

domains
  .command('expiring')
  .description('Show only domains expiring soon (default window: 30 days, active domains only)')
  .option('--days <days>', 'expiring window in days (default: 30)', '30')
  .option('--all', 'include inactive/unmanaged domains too')
  .action(async (cmdOpts, cmd) => {
    const globalOpts = cmd.parent.parent.opts();
    const jsonMode = Boolean(globalOpts.json);
    const enriched = await fetchDomainsWithExpiry(globalOpts, {
      all: cmdOpts.all,
      expiringDays: Number(cmdOpts.days),
    });

    const expiring = enriched
      .filter((d) => d.expires_soon)
      .sort((a, b) => (a.days_to_expire ?? 999999) - (b.days_to_expire ?? 999999));

    if (jsonMode) {
      printResult(expiring, { json: true });
      return;
    }

    if (expiring.length === 0) {
      console.log(`No domains expiring in next ${cmdOpts.days} days.`);
      return;
    }

    for (const d of expiring) {
      console.log(`${d.fqdn}\t${d.date_expire ?? 'n/a'}\t${d.days_to_expire}d\t⚠️ expiring soon`);
    }
  });

const dns = program.command('dns').description('DNS operations');
dns
  .command('list <domain>')
  .description('Get DNS data for domain (dns/getData)')
  .action(async (domain, _, cmd) => {
    const globalOpts = cmd.parent.parent.opts();
    const jsonMode = Boolean(globalOpts.json);
    const timeoutMs = Number(globalOpts.timeout);
    const cfg = await readConfig(getConfigPath(globalOpts.config));
    const creds = resolveCredentials(globalOpts, cfg);

    const result = await callBeget({
      ...creds,
      section: 'dns',
      method: 'getData',
      inputData: { fqdn: domain },
      timeoutMs,
    });

    printResult(result, { json: jsonMode });
  });

dns
  .command('ns-get <domain>')
  .description('Get current DNS/NS records for domain (dns/getData)')
  .action(async (domain, _, cmd) => {
    const globalOpts = cmd.parent.parent.opts();
    const jsonMode = Boolean(globalOpts.json);
    const timeoutMs = Number(globalOpts.timeout);
    const cfg = await readConfig(getConfigPath(globalOpts.config));
    const creds = resolveCredentials(globalOpts, cfg);

    const result = await callBeget({
      ...creds,
      section: 'dns',
      method: 'getData',
      inputData: { fqdn: domain },
      timeoutMs,
    });

    const out = {
      fqdn: result.fqdn,
      is_under_control: result.is_under_control,
      is_beget_dns: result.is_beget_dns,
      dns: result.records?.DNS ?? [],
      dns_ip: result.records?.DNS_IP ?? [],
    };
    printResult(out, { json: jsonMode });
  });

dns
  .command('ns-set <domain> <ns1> <ns2>')
  .description('Set authoritative nameservers for a Beget-managed domain (dns/changeRecords)')
  .option('--ip1 <ip>', 'IP for ns1 if required by registrar')
  .option('--ip2 <ip>', 'IP for ns2 if required by registrar')
  .action(async (domain, ns1, ns2, cmdOpts, cmd) => {
    const globalOpts = cmd.parent.parent.opts();
    const jsonMode = Boolean(globalOpts.json);
    const timeoutMs = Number(globalOpts.timeout);
    const cfg = await readConfig(getConfigPath(globalOpts.config));
    const creds = resolveCredentials(globalOpts, cfg);

    const records = {
      DNS: [
        { priority: 10, value: ns1 },
        { priority: 20, value: ns2 },
      ],
    };

    if (cmdOpts.ip1 || cmdOpts.ip2) {
      records.DNS_IP = [
        { priority: 10, value: cmdOpts.ip1 ?? null },
        { priority: 20, value: cmdOpts.ip2 ?? null },
      ];
    }

    const result = await callBeget({
      ...creds,
      section: 'dns',
      method: 'changeRecords',
      inputData: { fqdn: domain, records },
      timeoutMs,
    });

    printResult({ ok: Boolean(result), fqdn: domain, ns: [ns1, ns2], dns_ip: records.DNS_IP ?? [] }, { json: jsonMode });
  });

program.configureOutput({
  outputError: (str, write) => write(str),
});

(async () => {
  try {
    await program.parseAsync(process.argv);
  } catch (err) {
    if (err?.code === 'commander.helpDisplayed') {
      process.exit(EXIT.OK);
    }
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
