const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

export class CloudApiError extends Error {
  constructor(message, { kind = 'api', status = 0, details, providerCode } = {}) {
    super(message);
    this.name = 'CloudApiError';
    this.kind = kind;
    this.status = status;
    this.details = details;
    this.providerCode = providerCode;
  }
}

function retryableStatus(status) {
  return status === 408 || status === 429 || status >= 500;
}

function ambiguousMutationStatus(method, status) {
  return method !== 'GET' && (status === 408 || status >= 500);
}

function retryDelay(attempt) {
  return 250 * (2 ** attempt);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readResponse(response, signal) {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw new CloudApiError('Beget Cloud response exceeds the 8 MiB safety limit', { kind: 'contract', status: response.status });
  }
  if (!response.body) return '';

  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  let rejectOnAbort;
  const aborted = new Promise((_, reject) => { rejectOnAbort = reject; });
  const onAbort = () => rejectOnAbort(signal.reason ?? new DOMException('Aborted', 'AbortError'));
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), aborted]);
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => {});
        throw new CloudApiError('Beget Cloud response exceeds the 8 MiB safety limit', { kind: 'contract', status: response.status });
      }
      chunks.push(value);
    }
  } finally {
    signal.removeEventListener('abort', onAbort);
    if (signal.aborted) await reader.cancel().catch(() => {});
  }

  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

function errorFields(payload) {
  if (!payload || typeof payload !== 'object') return {};
  const nestedError = payload.error && typeof payload.error === 'object' ? payload.error : null;
  const providerCode = nestedError?.code ?? payload.error ?? payload.code ?? payload.error_code;
  const details = nestedError?.message ?? payload.message ?? payload.error_text ?? payload.details;
  return { providerCode: providerCode ? String(providerCode) : undefined, details };
}

export class CloudApiClient {
  constructor({ baseUrl = 'https://api.beget.com', token, timeoutMs = 20000, fetchImpl = fetch } = {}) {
    let parsed;
    try {
      parsed = new URL(baseUrl);
    } catch {
      throw new CloudApiError('Invalid Beget Cloud API base URL', { kind: 'config' });
    }
    if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.host) {
      throw new CloudApiError('Invalid Beget Cloud API base URL', { kind: 'config' });
    }
    this.baseUrl = parsed;
    this.token = token;
    this.timeoutMs = Number(timeoutMs);
    this.fetchImpl = fetchImpl;
  }

  async request({ method = 'GET', path, query = {}, body, authenticated = true }) {
    if (authenticated && !this.token) {
      throw new CloudApiError('Missing Beget Cloud JWT. Use `beget auth cloud-login` or set BEGET_CLOUD_TOKEN.', { kind: 'auth' });
    }

    const isRead = method === 'GET';
    const attempts = isRead ? 3 : 1;
    let lastError;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        return await this.#requestOnce({ method, path, query, body, authenticated });
      } catch (error) {
        lastError = error;
        const retryable = error instanceof CloudApiError
          && (error.kind === 'network' || retryableStatus(error.status));
        if (!isRead || !retryable || attempt === attempts - 1) throw error;
        await sleep(retryDelay(attempt));
      }
    }
    throw lastError;
  }

  async #requestOnce({ method, path, query, body, authenticated }) {
    const url = new URL(this.baseUrl);
    url.pathname = `${url.pathname.replace(/\/$/, '')}${path}`;
    url.search = '';
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value));
      }
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response;
    let text;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers: {
          Accept: 'application/json',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(authenticated ? { Authorization: `Bearer ${this.token}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      text = await readResponse(response, controller.signal);
    } catch (error) {
      if (response && ambiguousMutationStatus(method, response.status)) {
        throw new CloudApiError(`Beget Cloud mutation outcome is unknown after HTTP ${response.status}`, {
          kind: 'outcome_unknown',
          status: response.status,
          details: error.message,
        });
      }
      if (error instanceof CloudApiError) {
        if (method !== 'GET' && response?.ok && error.kind === 'contract') {
          throw new CloudApiError('Beget Cloud mutation may have succeeded, but its response could not be validated', {
            kind: 'outcome_unknown',
            status: response.status,
            details: error.message,
          });
        }
        throw error;
      }
      if (response && !response.ok) {
        throw new CloudApiError(`Beget Cloud API returned HTTP ${response.status}`, {
          kind: response.status === 401 ? 'auth' : 'api',
          status: response.status,
          details: error.message,
        });
      }
      const message = controller.signal.aborted || error.name === 'AbortError'
        ? `Beget Cloud request timed out after ${this.timeoutMs}ms`
        : `Beget Cloud network error: ${error.message}`;
      const kind = method === 'GET' ? 'network' : 'outcome_unknown';
      throw new CloudApiError(message, { kind, details: error.message });
    } finally {
      clearTimeout(timer);
    }

    let payload = null;
    if (text.trim()) {
      try {
        payload = JSON.parse(text);
      } catch {
        const kind = ambiguousMutationStatus(method, response.status) || (response.ok && method !== 'GET')
          ? 'outcome_unknown'
          : response.ok ? 'contract' : 'api';
        const message = kind === 'outcome_unknown'
          ? 'Beget Cloud mutation may have succeeded, but its response was not valid JSON'
          : 'Beget Cloud API returned a non-JSON response';
        throw new CloudApiError(message, { kind, status: response.status });
      }
    }

    if (!response.ok) {
      const fields = errorFields(payload);
      const ambiguousMutation = ambiguousMutationStatus(method, response.status);
      const kind = ambiguousMutation ? 'outcome_unknown' : response.status === 401 ? 'auth' : 'api';
      const suffix = fields.details ? `: ${fields.details}` : '';
      const prefix = ambiguousMutation
        ? 'Beget Cloud mutation outcome is unknown after HTTP'
        : 'Beget Cloud API returned HTTP';
      throw new CloudApiError(`${prefix} ${response.status}${suffix}`, {
        kind,
        status: response.status,
        ...fields,
      });
    }

    const fields = errorFields(payload);
    if (fields.providerCode && fields.providerCode !== '0') {
      throw new CloudApiError(`Beget Cloud API error: ${fields.providerCode}`, {
        kind: fields.providerCode.includes('TOKEN') ? 'auth' : 'api',
        status: response.status,
        ...fields,
      });
    }
    return payload ?? { ok: true };
  }
}
