import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import {
  buildUsageSnapshotFromOfficialPayload,
  fetchUsageSnapshotAuto,
  fetchUsageSnapshotWithWebSession
} from './bigmodelClient.js';
import { loadConfig, toPublicConfig } from './config.js';
import { UsageMonitor } from './monitor.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');
const config = loadConfig();
const monitor = new UsageMonitor(config);
const app = express();

app.use(express.json({ limit: '2mb' }));
app.use((request, response, next) => {
  const origin = request.headers.origin;
  if (origin && (config.allowedOrigins.includes(origin) || isPublicCorsRoute(request))) {
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Vary', 'Origin');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  }

  if (request.method === 'OPTIONS') {
    return response.sendStatus(204);
  }

  return next();
});

app.get('/api/health', (request, response) => {
  response.json({ ok: true });
});

app.use((request, response, next) => {
  if (isPublicReadRoute(request)) return next();
  if (!config.dashboardPassword) return next();

  const header = request.headers.authorization || '';
  const [scheme, encoded] = header.split(' ');
  if (scheme !== 'Basic' || !encoded) {
    return requestAuth(response);
  }

  const decoded = Buffer.from(encoded, 'base64').toString('utf8');
  const separatorIndex = decoded.indexOf(':');
  const user = decoded.slice(0, separatorIndex);
  const password = decoded.slice(separatorIndex + 1);

  if (user === config.dashboardUser && password === config.dashboardPassword) {
    return next();
  }

  return requestAuth(response);
});

app.get('/api/config', (request, response) => {
  response.json(toPublicConfig(config));
});

app.get('/api/usage', (request, response) => {
  response.json(monitor.getState());
});

app.post('/api/refresh', async (request, response) => {
  try {
    const state = await monitor.refreshAll('manual');
    response.json(state);
  } catch (error) {
    response.status(500).json({
      error: error.message,
      state: monitor.getState()
    });
  }
});

app.post('/api/query-key', async (request, response) => {
  try {
    const accounts = parseSubmittedAccounts(request.body);
    if (accounts.length === 0) {
      return response.status(400).json({ error: '請輸入 API key。' });
    }
    if (accounts.length > 10) {
      return response.status(400).json({ error: '一次最多查詢 10 個 API key。' });
    }

    const snapshots = await Promise.all(
      accounts.map(async (account) => {
        try {
          return await fetchUsageSnapshotAuto(account, {
            requestTimeoutMs: config.requestTimeoutMs
          });
        } catch (error) {
          return {
            id: account.id,
            name: account.name,
            maskedKey: maskSecret(account.key),
            baseUrl: account.baseUrl,
            fetchedAt: new Date().toISOString(),
            status: 'error',
            endpointErrors: [{ endpoint: 'all', message: error.message }],
            quota: null,
            modelUsage: null,
            toolUsage: null
          };
        }
      })
    );
    const now = new Date();

    response.json({
      config: {
        ...toPublicConfig(config),
        accountCount: snapshots.length,
        accounts: snapshots.map(({ id, name, baseUrl, maskedKey }) => ({
          id,
          name,
          baseUrl,
          maskedKey
        }))
      },
      snapshots,
      isRefreshing: false,
      lastRefreshAt: now.toISOString(),
      lastRefreshReason: 'user-key-query',
      nextFiveHourRefreshAt: new Date(now.getTime() + config.fiveHourRefreshMs).toISOString(),
      nextWeeklyRefreshAt: new Date(now.getTime() + config.weeklyRefreshMs).toISOString(),
      lastError: null
    });
  } catch (error) {
    response.status(400).json({ error: error.message });
  }
});

app.post('/api/query-web-session', async (request, response) => {
  try {
    const account = parseSubmittedWebSession(request.body);
    const snapshot = await fetchUsageSnapshotWithWebSession(account, {
      requestTimeoutMs: config.requestTimeoutMs
    });
    const now = new Date();

    response.json({
      config: {
        ...toPublicConfig(config),
        queryMode: 'web-session',
        accountCount: 1,
        accounts: [
          {
            id: snapshot.id,
            name: snapshot.name,
            baseUrl: snapshot.baseUrl,
            maskedKey: snapshot.maskedKey
          }
        ]
      },
      snapshots: [snapshot],
      isRefreshing: false,
      lastRefreshAt: now.toISOString(),
      lastRefreshReason: 'web-session-query',
      nextFiveHourRefreshAt: new Date(now.getTime() + config.fiveHourRefreshMs).toISOString(),
      nextWeeklyRefreshAt: new Date(now.getTime() + config.weeklyRefreshMs).toISOString(),
      lastError: null
    });
  } catch (error) {
    response.status(400).json({ error: error.message });
  }
});

app.post('/api/query-official-payload', async (request, response) => {
  try {
    const now = new Date();
    const snapshot = buildUsageSnapshotFromOfficialPayload(
      {
        id: crypto
          .createHash('sha256')
          .update(`official-payload:${now.toISOString()}`)
          .digest('hex')
          .slice(0, 12),
        name: 'BigModel 官方頁回應',
        baseUrl: 'https://bigmodel.cn'
      },
      {
        quota: request.body?.quota,
        modelUsage: request.body?.modelUsage,
        toolUsage: request.body?.toolUsage
      }
    );
    const state = monitor.replaceSnapshots([snapshot], 'official-page-import', {
      queryMode: 'official-payload',
      accountCount: 1,
      accounts: [
        {
          id: snapshot.id,
          name: snapshot.name,
          baseUrl: snapshot.baseUrl,
          maskedKey: snapshot.maskedKey
        }
      ]
    });

    response.json(state);
  } catch (error) {
    response.status(400).json({ error: error.message });
  }
});

if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get(/.*/, (request, response) => {
    response.sendFile(path.join(distDir, 'index.html'));
  });
}

app.listen(config.port, config.host, () => {
  console.log(`BigModel usage API listening on http://${config.host}:${config.port}`);
  console.log(`Configured accounts: ${config.accounts.length}`);
  console.log(`Public query only: ${config.publicQueryOnly}`);
});

monitor.start();

function requestAuth(response) {
  response.setHeader('WWW-Authenticate', 'Basic realm="BigModel Usage Monitor"');
  return response.status(401).send('Authentication required');
}

function isPublicReadRoute(request) {
  if (!config.publicUsageRead || request.method !== 'GET') return false;
  return request.path === '/api/usage' || request.path === '/api/config';
}

function isPublicCorsRoute(request) {
  if (!config.publicUsageRead) return false;
  if (!['GET', 'OPTIONS'].includes(request.method)) return false;
  return request.path === '/api/usage' || request.path === '/api/config';
}

function parseSubmittedAccounts(body) {
  const baseUrl = normalizeAllowedBaseUrl(body?.apiUri || body?.baseUrl || config.defaultBaseUrl);
  const authScheme = normalizeAuthScheme(body?.authScheme || 'auto');
  const entries = Array.isArray(body?.keys)
    ? body.keys
    : String(body?.keysText || body?.key || '')
        .split(/[;\n]+/)
        .map((value) => value.trim())
        .filter(Boolean);

  return entries
    .map((entry, index) => {
      const parsed = typeof entry === 'string' ? parseKeyText(entry, index) : entry;
      const key = String(parsed.key || '').trim();
      if (!key) return null;
      const name = String(parsed.name || `key-${index + 1}`).trim();
      const accountBaseUrl = normalizeAllowedBaseUrl(parsed.baseUrl || baseUrl);
      return {
        id: crypto
          .createHash('sha256')
          .update(`${name}:${accountBaseUrl}:${key}`)
          .digest('hex')
          .slice(0, 12),
        name,
        key,
        baseUrl: accountBaseUrl,
        authScheme
      };
    })
    .filter(Boolean);
}

function parseSubmittedWebSession(body) {
  const baseUrl = normalizeAllowedBaseUrl(body?.apiUri || body?.baseUrl || 'https://bigmodel.cn');
  const name = String(body?.name || 'BigModel 官方登入').trim();
  const webSession = parseWebSessionText(body?.headersText || body?.webHeaders || body?.cookie || '');

  if (!webSession.authorization && !webSession.cookie) {
    throw new Error('請貼上官方用量頁 request headers，至少需要 authorization 或 cookie。');
  }

  return {
    id: crypto
      .createHash('sha256')
      .update(`${name}:${baseUrl}:${webSession.authorization || ''}:${webSession.cookie || ''}`)
      .digest('hex')
      .slice(0, 12),
    name,
    baseUrl,
    webSession
  };
}

function parseWebSessionText(value) {
  const text = String(value || '').trim();
  const webSession = { extraHeaders: {} };
  if (!text) return webSession;

  for (const header of extractHeaderLines(text)) {
    const colonIndex = header.indexOf(':');
    if (colonIndex === -1) continue;

    const name = header.slice(0, colonIndex).trim().toLowerCase();
    const headerValue = header.slice(colonIndex + 1).trim();
    assignWebSessionHeader(webSession, name, headerValue);
  }

  if (!webSession.cookie && !webSession.authorization && /^[A-Za-z0-9_.%-]+=/.test(text)) {
    webSession.cookie = text;
  }

  return webSession;
}

function extractHeaderLines(text) {
  const headers = [];
  const curlHeaderPattern = /(?:^|\s)(?:-H|--header)\s+(["'])(.*?)\1/gs;
  let match;

  while ((match = curlHeaderPattern.exec(text)) !== null) {
    headers.push(match[2]);
  }

  if (headers.length > 0) return headers;

  return text
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean);
}

function assignWebSessionHeader(webSession, name, value) {
  if (!value) return;

  const normalized = name.toLowerCase();
  if (normalized === 'authorization') webSession.authorization = value;
  if (normalized === 'cookie') webSession.cookie = value;
  if (normalized === 'bigmodel-organization') webSession.bigmodelOrganization = value;
  if (normalized === 'bigmodel-project') webSession.bigmodelProject = value;
  if (normalized === 'set-language') webSession.setLanguage = value;
  if (normalized === 'accept-language') webSession.acceptLanguage = value;
  if (normalized === 'user-agent') webSession.userAgent = value;
  if (isForwardableWebHeader(normalized)) {
    webSession.extraHeaders[toHeaderCase(normalized)] = value;
  }
}

function isForwardableWebHeader(name) {
  if (name.startsWith(':')) return false;
  if (['host', 'connection', 'content-length', 'origin', 'referer'].includes(name)) return false;
  if (name.startsWith('sec-')) return false;
  if (name.startsWith('bigmodel-') || name.startsWith('x-')) return true;
  return ['authorization', 'cookie', 'set-language', 'accept-language', 'user-agent'].includes(name);
}

function toHeaderCase(name) {
  return name
    .split('-')
    .map((part) => (part ? `${part.slice(0, 1).toUpperCase()}${part.slice(1)}` : part))
    .join('-');
}

function parseKeyText(value, index) {
  const equalsIndex = value.indexOf('=');
  if (equalsIndex === -1) {
    return { name: `key-${index + 1}`, key: value };
  }

  const possibleName = value.slice(0, equalsIndex).trim();
  const looksLikeName = /^[A-Za-z0-9_-]{1,32}$/.test(possibleName);
  const looksLikeKeyPrefix = /^(sk|key|api)[-_]/i.test(possibleName);
  if (!looksLikeName || looksLikeKeyPrefix) {
    return { name: `key-${index + 1}`, key: value };
  }

  return {
    name: possibleName || `key-${index + 1}`,
    key: value.slice(equalsIndex + 1).trim()
  };
}

function normalizeAllowedBaseUrl(value) {
  const origin = new URL(value).origin;
  const allowed = new Set([
    'https://bigmodel.cn',
    'https://open.bigmodel.cn',
    'https://dev.bigmodel.cn',
    'https://api.z.ai'
  ]);
  if (!allowed.has(origin)) {
    throw new Error('只允許 https://bigmodel.cn、https://open.bigmodel.cn、https://dev.bigmodel.cn 或 https://api.z.ai。');
  }
  return origin;
}

function normalizeAuthScheme(value) {
  const scheme = String(value || 'Bearer').trim();
  if (scheme.toLowerCase() === 'auto') return 'auto';
  if (scheme.toLowerCase() === 'raw') return 'raw';
  return 'Bearer';
}

function maskSecret(value) {
  const trimmed = String(value || '').replace(/^Bearer\s+/i, '').trim();
  if (!trimmed) return '';
  if (trimmed.length <= 10) return `${trimmed.slice(0, 2)}***${trimmed.slice(-2)}`;
  return `${trimmed.slice(0, 5)}...${trimmed.slice(-5)}`;
}
