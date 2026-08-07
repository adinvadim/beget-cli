import fs from 'node:fs/promises';

import { VPS_GROUPS, VPS_OPERATIONS } from './vps-operations.js';

function camelCaseFlag(value) {
  return value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function parseBoolean(value) {
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes'].includes(normalized)) return true;
  if (['0', 'false', 'no'].includes(normalized)) return false;
  throw new Error(`Expected a boolean value, received '${value}'`);
}

function parseInteger(value) {
  if (!/^-?\d+$/.test(String(value))) throw new Error(`Expected an integer, received '${value}'`);
  return Number(value);
}

function positionalNames(usage) {
  return [...usage.matchAll(/[<[]([^>\]]+)[>\]]/g)].map((match) => match[1]);
}

async function readStdin() {
  let data = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) data += chunk;
  return data;
}

async function requestBody(spec, options, pathValues, usageError) {
  if (options.bodyJson && options.bodyFile) {
    throw usageError('Use only one of --body-json and --body-file');
  }
  let raw;
  if (options.bodyFile) {
    raw = options.bodyFile === '-' ? await readStdin() : await fs.readFile(options.bodyFile, 'utf8');
  } else if (options.bodyJson) {
    raw = options.bodyJson;
  }

  let body = {};
  if (raw !== undefined) {
    try {
      body = JSON.parse(raw);
    } catch {
      throw usageError('VPS request body must be valid JSON');
    }
    if (!body || Array.isArray(body) || typeof body !== 'object') {
      throw usageError('VPS request body must be a JSON object');
    }
  }

  for (const key of spec.bodyPath) {
    const expected = pathValues[key];
    if (Object.hasOwn(body, key) && String(body[key]) !== String(expected)) {
      throw usageError(`Request body '${key}' must match the path argument`);
    }
    body[key] = expected;
  }
  return spec.body ? body : undefined;
}

function buildPath(template, values) {
  return template.replace(/\{([^}]+)\}/g, (_, key) => encodeURIComponent(values[key]));
}

function buildQuery(spec, options) {
  return Object.fromEntries(spec.query.flatMap(({ key, flag }) => {
    const value = options[camelCaseFlag(flag)];
    return value === undefined ? [] : [[key, value]];
  }));
}

export function registerVpsCommands(program, { execute, usageError }) {
  const vps = program.command('vps').description('Manage Beget Cloud VPS resources (API v1.8.1)');
  const parents = new Map([['', vps]]);
  for (const [name, description] of Object.entries(VPS_GROUPS)) {
    parents.set(name, vps.command(name).description(description));
  }

  for (const spec of VPS_OPERATIONS) {
    const command = parents.get(spec.parent).command(spec.usage).description(spec.description);
    for (const option of spec.query) {
      const parser = option.type === 'integer' ? parseInteger : option.type === 'boolean' ? parseBoolean : undefined;
      command.option(`--${option.flag} <${option.type}>`, `Set ${option.key}`, parser);
    }
    if (spec.body) {
      command
        .option('--body-json <json>', 'JSON request body; use --body-file when it contains secrets')
        .option('--body-file <path>', 'read JSON request body from a file, or - for stdin');
    }
    if (spec.mutate) command.option('--dry-run', 'validate and print the request without sending it');
    if (spec.risky) command.option('--yes', 'confirm the risky operation');

    command.action(async (...args) => {
      const cmd = args.at(-1);
      const options = args.at(-2);
      const values = Object.fromEntries(positionalNames(spec.usage).map((name, index) => [name, args[index]]));
      const body = await requestBody(spec, options, values, usageError);
      await execute({
        spec,
        cmd,
        options,
        path: buildPath(spec.path, values),
        query: buildQuery(spec, options),
        body,
      });
    });
  }

  return vps;
}
