const port = Number(process.env.CAPTURE_CDP_PORT || 9337);
const monitorTarget = createMonitorTarget(process.env.CAPTURE_MONITOR_URL || 'http://127.0.0.1:5179');
const monitorUrl = monitorTarget.url;
const officialUrl = 'https://bigmodel.cn/coding-plan/team/usage-stats';
const quotaPath = '/api/monitor/usage/quota/limit';
const usagePathMarker = '/api/monitor/usage/';
const timeoutMs = Number(process.env.CAPTURE_TIMEOUT_MS || 900_000);

const deadline = Date.now() + timeoutMs;

async function main() {
  const firstTarget = await waitForPageTarget();
  const clients = new Map();
  const requests = new Map();
  const officialPayloads = {};
  let initialNavigationDone = false;

  const attachTarget = async (target) => {
    if (!target?.id || !target?.webSocketDebuggerUrl || clients.has(target.id)) return null;

    const cdp = await CdpClient.connect(target.webSocketDebuggerUrl);
    clients.set(target.id, cdp);

    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });

    wireNetworkCapture(cdp, requests, officialPayloads, (headers) => {
      if (!captured.resolve) return;
      const resolve = captured.resolve;
      captured.resolve = null;
      captured.reject = null;
      resolve({ headers, cdp });
    });

    if (!initialNavigationDone && target.id === firstTarget.id) {
      initialNavigationDone = true;
      console.log('Opening BigModel usage page...');
      await cdp.send('Page.navigate', { url: officialUrl });
      console.log('Waiting for BigModel usage request...');
      console.log('Log in in the browser window. If the usage page is visible but nothing happens, press Ctrl+R once.');
    }

    return cdp;
  };

  const captured = {};

  const captureResult = await new Promise(async (resolve, reject) => {
    const timer = setInterval(() => {
      if (Date.now() > deadline) {
        clearInterval(timer);
        clearInterval(attachTimer);
        captured.resolve = null;
        captured.reject = null;
        reject(new Error('Timed out while waiting for BigModel usage request.'));
      }
    }, 1000);

    const attachTimer = setInterval(async () => {
      try {
        const targets = await getJson(`http://127.0.0.1:${port}/json/list`);
        for (const target of targets.filter((item) => item.type === 'page')) {
          await attachTarget(target);
        }
      } catch {
      }
    }, 1000);

    captured.resolve = (value) => {
      clearInterval(timer);
      clearInterval(attachTimer);
      captured.resolve = null;
      captured.reject = null;
      resolve(value);
    };
    captured.reject = (error) => {
      clearInterval(timer);
      clearInterval(attachTimer);
      captured.resolve = null;
      captured.reject = null;
      reject(error);
    };

    try {
      await attachTarget(firstTarget);
    } catch (error) {
      captured.reject(error);
      return;
    }
  });

  await delay(3000);
  const whitelisted = pickWebSessionHeaders(captureResult.headers);
  if (!hasUsableAuth(whitelisted)) {
    throw new Error('Captured the quota request, but authorization/cookie headers were not visible.');
  }
  const headersText = toHeaderText(whitelisted);

  let queryResult;
  if (officialPayloads.quota || officialPayloads.modelUsage || officialPayloads.toolUsage) {
    console.log('Importing successful official page responses into the local monitor...');
    queryResult = await queryLocalMonitorFromOfficialPayloads(officialPayloads);
  } else {
    console.log('No official response body was captured. Falling back to header replay...');
    queryResult = await queryLocalMonitor(headersText);
  }
  console.log(`Captured header names: ${formatHeaderNames(whitelisted)}`);
  console.log(formatQuerySummary(queryResult));

  if (shouldOpenMonitorPage()) {
    console.log('Opening local monitor and displaying the captured official usage...');
    const cdp = captureResult.cdp;
    await cdp.send('Page.navigate', { url: monitorUrl });
    await waitForPageReady(cdp);
    await submitStateToMonitorPage(cdp, queryResult);
  } else {
    console.log('Imported usage into the monitor backend. Skipping monitor page injection for protected/cloud mode.');
  }

  console.log(`Done. Check the browser window or open ${monitorUrl}`);
  for (const client of clients.values()) {
    client.close();
  }
}

async function waitForPageTarget() {
  let lastError;
  while (Date.now() < deadline) {
    try {
      const targets = await getJson(`http://127.0.0.1:${port}/json/list`);
      const pageTarget = targets.find((item) => item.type === 'page');
      if (pageTarget?.webSocketDebuggerUrl) return pageTarget;
    } catch (error) {
      lastError = error;
    }

    await delay(250);
  }

  throw new Error(`Could not connect to the browser DevTools port ${port}: ${lastError?.message || 'unknown error'}`);
}

async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return response.json();
}

function createMonitorTarget(rawValue) {
  const parsed = new URL(String(rawValue || 'http://127.0.0.1:5179'));
  const urlAuth =
    parsed.username || parsed.password
      ? `${decodeURIComponent(parsed.username)}:${decodeURIComponent(parsed.password)}`
      : '';
  const rawAuth = String(process.env.CAPTURE_MONITOR_AUTH || urlAuth || '').trim();
  parsed.username = '';
  parsed.password = '';

  return {
    url: parsed.toString().replace(/\/$/, ''),
    authHeader: rawAuth ? toBasicAuthHeader(rawAuth) : ''
  };
}

function toBasicAuthHeader(value) {
  if (/^Basic\s+/i.test(value)) return value;
  return `Basic ${Buffer.from(value, 'utf8').toString('base64')}`;
}

function monitorHeaders(headers = {}) {
  return {
    ...headers,
    ...(monitorTarget.authHeader ? { Authorization: monitorTarget.authHeader } : {})
  };
}

function shouldOpenMonitorPage() {
  const requested = String(process.env.CAPTURE_OPEN_MONITOR_PAGE || '').trim().toLowerCase();
  if (requested === '1' || requested === 'true') return true;
  if (requested === '0' || requested === 'false') return false;
  return !monitorTarget.authHeader;
}

function normalizeHeaderObject(headers = {}) {
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), String(value)])
  );
}

function wireNetworkCapture(cdp, requests, officialPayloads, onCaptured) {
  cdp.on('Network.requestWillBeSent', (event) => {
    if (!event?.requestId || !event?.request?.url) return;
    const record = requests.get(event.requestId) || { headers: {} };
    record.url = event.request.url;
    record.headers = { ...record.headers, ...normalizeHeaderObject(event.request.headers) };
    record.isUsage = isUsageRequest(event.request.url);
    requests.set(event.requestId, record);

    if (record.isUsage && hasUsableAuth(record.headers)) {
      onCaptured(record.headers);
    }
  });

  cdp.on('Network.requestWillBeSentExtraInfo', (event) => {
    if (!event?.requestId) return;
    const record = requests.get(event.requestId) || { headers: {} };
    record.headers = { ...record.headers, ...normalizeHeaderObject(event.headers) };
    requests.set(event.requestId, record);

    if (record.isUsage && hasUsableAuth(record.headers)) {
      onCaptured(record.headers);
    }
  });

  cdp.on('Network.responseReceived', (event) => {
    if (!event?.requestId) return;
    const record = requests.get(event.requestId) || { headers: {} };
    record.status = event.response?.status;
    record.contentType = event.response?.mimeType || event.response?.headers?.['content-type'];
    requests.set(event.requestId, record);
  });

  cdp.on('Network.loadingFinished', async (event) => {
    if (!event?.requestId) return;
    const record = requests.get(event.requestId);
    if (!record?.isUsage || record.reported) return;
    record.reported = true;
    requests.set(event.requestId, record);

    try {
      const body = await cdp.send('Network.getResponseBody', { requestId: event.requestId });
      saveOfficialPayload(officialPayloads, record.url, body.body);
      console.log(formatOfficialResponseSummary(record.url, record.status, body.body));
    } catch {
      console.log(formatOfficialResponseSummary(record.url, record.status, ''));
    }
  });
}

function isUsageRequest(url) {
  return String(url || '').includes(quotaPath) || String(url || '').includes(usagePathMarker);
}

function saveOfficialPayload(officialPayloads, url, body) {
  const parsed = parseJson(body);
  if (!parsed) return;

  if (String(url || '').includes('/quota/limit')) {
    officialPayloads.quota = parsed;
  } else if (String(url || '').includes('/model-usage')) {
    officialPayloads.modelUsage = parsed;
  } else if (String(url || '').includes('/tool-usage')) {
    officialPayloads.toolUsage = parsed;
  }
}

function formatOfficialResponseSummary(url, status, body) {
  const parsed = parseJson(body);
  const payload = parsed?.data || parsed || {};
  const limits = findArray(payload, (item) => item && typeof item === 'object' && ('type' in item || 'percentage' in item));
  const records = findArray(payload, (item) => item && typeof item === 'object');
  const safeUrl = redactQuery(url);
  const parts = [
    `Official response ${safeUrl}`,
    `http=${status ?? 'unknown'}`,
    `code=${parsed?.code ?? 'none'}`,
    `success=${parsed?.success ?? 'none'}`,
    `limits=${limits?.length || 0}`,
    `records=${records?.length || 0}`
  ];
  const message = parsed?.msg || parsed?.message;
  if (message) parts.push(`msg=${message}`);
  return parts.join(' | ');
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function findArray(value, predicate, depth = 0) {
  if (!value || depth > 5) return null;
  if (Array.isArray(value)) return value.some(predicate) ? value : null;
  if (typeof value !== 'object') return null;
  for (const child of Object.values(value)) {
    const found = findArray(child, predicate, depth + 1);
    if (found) return found;
  }
  return null;
}

function redactQuery(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}${parsed.search ? '?...' : ''}`;
  } catch {
    return String(url || '').split('?')[0];
  }
}

function pickWebSessionHeaders(headers) {
  const picked = {};
  const names = [
    'authorization',
    'cookie',
    'bigmodel-organization',
    'bigmodel-project',
    'set-language',
    'accept-language',
    'user-agent'
  ];

  for (const name of names) {
    if (headers[name]) picked[name] = headers[name];
  }

  for (const [name, value] of Object.entries(headers)) {
    if ((name.startsWith('bigmodel-') || name.startsWith('x-')) && value) {
      picked[name] = value;
    }
  }

  return picked;
}

function hasUsableAuth(headers) {
  return Boolean(headers?.authorization || headers?.cookie);
}

function toHeaderText(headers) {
  return Object.entries(headers)
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n');
}

async function queryLocalMonitor(headersText) {
  const response = await fetch(`${monitorUrl}/api/query-web-session`, {
    method: 'POST',
    headers: monitorHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      apiUri: 'https://bigmodel.cn',
      headersText
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Local monitor returned HTTP ${response.status}`);
  }
  return payload;
}

async function queryLocalMonitorFromOfficialPayloads(payloads) {
  const response = await fetch(`${monitorUrl}/api/query-official-payload`, {
    method: 'POST',
    headers: monitorHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payloads)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Local monitor returned HTTP ${response.status}`);
  }
  return payload;
}

function formatQuerySummary(result) {
  const snapshot = result?.snapshots?.[0];
  if (!snapshot) return 'Local monitor returned no snapshot.';

  const limits = snapshot.quota?.limits || [];
  const limitSummary = limits
    .map((limit) => {
      const pct = Number.isFinite(limit.percentage) ? `${limit.percentage.toFixed(0)}%` : 'unknown';
      return `${limit.label || limit.type}: ${pct}`;
    })
    .join('; ');

  const errors = (snapshot.endpointErrors || [])
    .map((item) => `${item.endpoint}: ${item.message}`)
    .join('; ');

  if (limitSummary) return `Query status: ${snapshot.status}. ${limitSummary}`;
  if (errors) return `Query status: ${snapshot.status}. ${errors}`;
  return `Query status: ${snapshot.status}.`;
}

function formatHeaderNames(headers) {
  return Object.keys(headers).sort().join(', ');
}

async function waitForPageReady(cdp) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 20_000) {
    const result = await cdp.send('Runtime.evaluate', {
      expression: 'document.readyState',
      returnByValue: true
    });
    if (result.result?.value === 'complete' || result.result?.value === 'interactive') {
      return;
    }
    await delay(250);
  }
  throw new Error('Local monitor page did not finish loading.');
}

async function submitStateToMonitorPage(cdp, state) {
  const expression = `
    (async (state) => {
      const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const waitFor = async (selector, timeoutMs = 15000) => {
        const startedAt = Date.now();
        while (Date.now() - startedAt < timeoutMs) {
          const element = document.querySelector(selector);
          if (element) return element;
          await delay(100);
        }
        throw new Error('Missing element: ' + selector);
      };
      await waitFor('#root');
      window.dispatchEvent(new CustomEvent('bigmodel-usage-state', { detail: state }));
      await delay(150);
      return true;
    })(${JSON.stringify(state)});
  `;

  const result = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true
  });

  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || 'Failed to display imported usage on monitor page.');
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class CdpClient {
  static connect(webSocketDebuggerUrl) {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(webSocketDebuggerUrl);
      const client = new CdpClient(socket);
      socket.addEventListener('open', () => resolve(client), { once: true });
      socket.addEventListener('error', () => reject(new Error('Could not open DevTools WebSocket.')), {
        once: true
      });
    });
  }

  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.handlers = new Map();

    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(message.error.message || JSON.stringify(message.error)));
        else resolve(message.result || {});
        return;
      }

      const callbacks = this.handlers.get(message.method) || [];
      for (const callback of callbacks) callback(message.params || {});
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    this.socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP command timed out: ${method}`));
        }
      }, 20_000);
    });
  }

  on(method, callback) {
    const callbacks = this.handlers.get(method) || [];
    callbacks.push(callback);
    this.handlers.set(method, callbacks);
  }

  close() {
    this.socket.close();
  }
}

await main();
