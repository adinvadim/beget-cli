import assert from 'node:assert/strict';
import test from 'node:test';

import { CloudApiClient, CloudApiError } from '../lib/cloud-api.js';

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

test('Cloud client decodes Beget 200 responses with nested provider errors', async () => {
  const client = new CloudApiClient({
    token: 'jwt',
    fetchImpl: async () => jsonResponse({
      error: { code: 'INSUFFICIENT_FUNDS', message: 'Balance is too low' },
    }),
  });

  await assert.rejects(
    client.request({ method: 'POST', path: '/v1/vps/server', body: {} }),
    (error) => {
      assert.ok(error instanceof CloudApiError);
      assert.equal(error.providerCode, 'INSUFFICIENT_FUNDS');
      assert.equal(error.details, 'Balance is too low');
      return true;
    },
  );
});

test('Cloud client retries reads but never replays an ambiguous mutation', async () => {
  let readAttempts = 0;
  const readClient = new CloudApiClient({
    token: 'jwt',
    fetchImpl: async () => {
      readAttempts += 1;
      if (readAttempts < 3) throw new TypeError('socket closed');
      return jsonResponse({ vps: [] });
    },
  });
  assert.deepEqual(await readClient.request({ path: '/v1/vps/server/list' }), { vps: [] });
  assert.equal(readAttempts, 3);

  let mutationAttempts = 0;
  const mutationClient = new CloudApiClient({
    token: 'jwt',
    fetchImpl: async () => {
      mutationAttempts += 1;
      throw new TypeError('socket closed');
    },
  });
  await assert.rejects(
    mutationClient.request({ method: 'POST', path: '/v1/vps/server', body: {} }),
    (error) => error instanceof CloudApiError && error.kind === 'outcome_unknown',
  );
  assert.equal(mutationAttempts, 1);
});

test('Cloud client keeps JWTs out of auth bootstrap requests', async () => {
  let authorization;
  const client = new CloudApiClient({
    fetchImpl: async (_url, request) => {
      authorization = request.headers.Authorization;
      return jsonResponse({ token: 'new-jwt' });
    },
  });

  const result = await client.request({
    method: 'POST',
    path: '/v1/auth',
    authenticated: false,
    body: { login: 'demo', password: 'password' },
  });
  assert.equal(authorization, undefined);
  assert.equal(result.token, 'new-jwt');
});

test('Cloud client enforces timeout and size limits while streaming response bodies', async () => {
  const stalledClient = new CloudApiClient({
    token: 'jwt',
    timeoutMs: 10,
    fetchImpl: async () => new Response(new ReadableStream({ start() {} })),
  });
  await assert.rejects(
    stalledClient.request({ path: '/v1/vps/server/list' }),
    (error) => error instanceof CloudApiError && error.kind === 'network' && /timed out/.test(error.message),
  );

  const oversizedClient = new CloudApiClient({
    token: 'jwt',
    fetchImpl: async () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array((8 * 1024 * 1024) + 1));
        controller.close();
      },
    })),
  });
  await assert.rejects(
    oversizedClient.request({ path: '/v1/vps/server/list' }),
    (error) => error instanceof CloudApiError && error.kind === 'contract' && /8 MiB/.test(error.message),
  );
});

test('Cloud client classifies a mutation body-stream reset as outcome unknown', async () => {
  const client = new CloudApiClient({
    token: 'jwt',
    fetchImpl: async () => new Response(new ReadableStream({
      start(controller) {
        controller.error(new TypeError('body socket closed'));
      },
    })),
  });
  await assert.rejects(
    client.request({ method: 'POST', path: '/v1/vps/server', body: {} }),
    (error) => error instanceof CloudApiError && error.kind === 'outcome_unknown',
  );
});

test('Cloud client treats ambiguous mutation HTTP and success-contract failures as outcome unknown', async () => {
  for (const response of [
    new Response(JSON.stringify({ code: 'UPSTREAM_FAILURE' }), { status: 503 }),
    new Response('not json', { status: 200 }),
    new Response('', { status: 200, headers: { 'content-length': String((8 * 1024 * 1024) + 1) } }),
  ]) {
    const client = new CloudApiClient({ token: 'jwt', fetchImpl: async () => response });
    await assert.rejects(
      client.request({ method: 'POST', path: '/v1/vps/server', body: {} }),
      (error) => error instanceof CloudApiError && error.kind === 'outcome_unknown',
    );
  }
});

test('Cloud client keeps explicit mutation validation failures definitive', async () => {
  const client = new CloudApiClient({
    token: 'jwt',
    fetchImpl: async () => jsonResponse({ code: 'INVALID_ARGUMENT', message: 'Bad request' }, 400),
  });
  await assert.rejects(
    client.request({ method: 'POST', path: '/v1/vps/server', body: {} }),
    (error) => error instanceof CloudApiError && error.kind === 'api' && error.status === 400,
  );
});

test('Cloud client preserves ambiguity for unreadable 503 mutation bodies', async () => {
  const responses = [
    () => new Response('<html>gateway failed</html>', { status: 503 }),
    () => new Response(new ReadableStream({
      start(controller) {
        controller.error(new TypeError('gateway body reset'));
      },
    }), { status: 503 }),
    () => new Response('', { status: 503, headers: { 'content-length': String((8 * 1024 * 1024) + 1) } }),
  ];
  for (const makeResponse of responses) {
    const client = new CloudApiClient({ token: 'jwt', fetchImpl: async () => makeResponse() });
    await assert.rejects(
      client.request({ method: 'POST', path: '/v1/vps/server', body: {} }),
      (error) => error instanceof CloudApiError && error.kind === 'outcome_unknown' && error.status === 503,
    );
  }
});
