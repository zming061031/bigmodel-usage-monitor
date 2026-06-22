import crypto from 'node:crypto';
import dotenv from 'dotenv';

dotenv.config();

const FIVE_HOURS_MS = 5 * 60 * 60 * 1000;
const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;

export function loadConfig() {
  const defaultBaseUrl = normalizeBaseUrl(
    process.env.BIGMODEL_API_BASE || 'https://open.bigmodel.cn'
  );
  const defaultAuthScheme = (process.env.BIGMODEL_AUTH_SCHEME || 'Bearer').trim();
  const publicQueryOnly = String(process.env.PUBLIC_QUERY_ONLY || 'true').toLowerCase() !== 'false';
  const accounts = publicQueryOnly
    ? []
    : parseAccounts(process.env.BIGMODEL_KEYS, defaultBaseUrl, defaultAuthScheme);

  if (!publicQueryOnly && accounts.length === 0 && process.env.BIGMODEL_API_KEY) {
    accounts.push(
      createAccount(
        {
          name: process.env.BIGMODEL_API_NAME || 'default',
          key: process.env.BIGMODEL_API_KEY,
          baseUrl: defaultBaseUrl,
          authScheme: defaultAuthScheme
        },
        0
      )
    );
  }

  return {
    port: numberFrom(process.env.PORT, 5179),
    host: process.env.HOST || '127.0.0.1',
    defaultBaseUrl,
    publicQueryOnly,
    publicUsageRead: String(process.env.PUBLIC_USAGE_READ || 'true').toLowerCase() !== 'false',
    dashboardUser: process.env.DASHBOARD_USER || 'admin',
    dashboardPassword: process.env.DASHBOARD_PASSWORD || '',
    stateFile: process.env.USAGE_STATE_FILE || 'data/usage-state.json',
    allowedOrigins: parseList(process.env.ALLOWED_ORIGINS),
    clientPollMs: numberFrom(process.env.LIVE_POLL_MS, ONE_HOUR_MS),
    fiveHourRefreshMs: numberFrom(process.env.FIVE_HOUR_REFRESH_MS, FIVE_HOURS_MS),
    weeklyRefreshMs: numberFrom(process.env.WEEKLY_REFRESH_MS, ONE_WEEK_MS),
    staticRefreshMs: numberFrom(process.env.STATIC_REFRESH_MS, 60 * 60 * 1000),
    requestTimeoutMs: numberFrom(process.env.BIGMODEL_REQUEST_TIMEOUT_MS, 20_000),
    accounts
  };
}

export function toPublicConfig(config) {
  return {
    defaultBaseUrl: config.defaultBaseUrl,
    publicQueryOnly: config.publicQueryOnly,
    publicUsageRead: config.publicUsageRead,
    clientPollMs: config.clientPollMs,
    fiveHourRefreshMs: config.fiveHourRefreshMs,
    weeklyRefreshMs: config.weeklyRefreshMs,
    staticRefreshMs: config.staticRefreshMs,
    accountCount: config.accounts.length,
    accounts: config.accounts.map(toPublicAccount)
  };
}

export function toPublicAccount(account) {
  return {
    id: account.id,
    name: account.name,
    baseUrl: account.baseUrl,
    maskedKey: maskSecret(account.key)
  };
}

function parseAccounts(rawValue, defaultBaseUrl, defaultAuthScheme) {
  if (!rawValue || !rawValue.trim()) return [];
  const raw = rawValue.trim();

  try {
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed)
      ? parsed
      : Object.entries(parsed).map(([name, value]) =>
          typeof value === 'string' ? { name, key: value } : { name, ...value }
        );
    return list
      .map((entry, index) =>
        createAccount(
          {
            ...entry,
            baseUrl: entry.baseUrl || defaultBaseUrl,
            authScheme: entry.authScheme || defaultAuthScheme
          },
          index
        )
      )
      .filter(Boolean);
  } catch {
    return raw
      .split(/[;\n]+/)
      .map((piece) => piece.trim())
      .filter(Boolean)
      .map((piece, index) => {
        const equalsIndex = piece.indexOf('=');
        if (equalsIndex === -1) {
          return createAccount(
            {
              name: `key-${index + 1}`,
              key: piece,
              baseUrl: defaultBaseUrl,
              authScheme: defaultAuthScheme
            },
            index
          );
        }

        return createAccount(
          {
            name: piece.slice(0, equalsIndex).trim(),
            key: piece.slice(equalsIndex + 1).trim(),
            baseUrl: defaultBaseUrl,
            authScheme: defaultAuthScheme
          },
          index
        );
      })
      .filter(Boolean);
  }
}

function createAccount(entry, index) {
  const name = String(entry.name || `key-${index + 1}`).trim();
  const key = String(entry.key || (entry.keyEnv ? process.env[entry.keyEnv] : '') || '').trim();
  if (!key) return null;

  const baseUrl = normalizeBaseUrl(entry.baseUrl || 'https://open.bigmodel.cn');
  const authScheme = String(entry.authScheme || 'Bearer').trim();
  const id = crypto
    .createHash('sha256')
    .update(`${name}:${baseUrl}:${key}`)
    .digest('hex')
    .slice(0, 12);

  return { id, name, key, baseUrl, authScheme };
}

function normalizeBaseUrl(value) {
  const url = new URL(value);
  return url.origin;
}

function numberFrom(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseList(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function maskSecret(value) {
  const trimmed = String(value || '').replace(/^Bearer\s+/i, '').trim();
  if (!trimmed) return '';
  if (trimmed.length <= 10) return `${trimmed.slice(0, 2)}***${trimmed.slice(-2)}`;
  return `${trimmed.slice(0, 5)}...${trimmed.slice(-5)}`;
}
