const ENDPOINTS = {
  quota: '/api/monitor/usage/quota/limit',
  modelUsage: '/api/monitor/usage/model-usage',
  toolUsage: '/api/monitor/usage/tool-usage'
};

export async function fetchUsageSnapshot(account, options = {}) {
  const now = new Date();
  const window = createQueryWindow(now);
  const authorization = createAuthorizationHeader(account);
  const headers = { authorization };
  const requestTimeoutMs = options.requestTimeoutMs || 20_000;

  const jobs = {
    quota: fetchJson({
      url: `${account.baseUrl}${ENDPOINTS.quota}`,
      label: 'quota',
      headers,
      requestTimeoutMs
    }),
    modelUsage: fetchJson({
      url: `${account.baseUrl}${ENDPOINTS.modelUsage}${toQueryString(window)}`,
      label: 'model usage',
      headers,
      requestTimeoutMs
    }),
    toolUsage: fetchJson({
      url: `${account.baseUrl}${ENDPOINTS.toolUsage}${toQueryString(window)}`,
      label: 'tool usage',
      headers,
      requestTimeoutMs
    })
  };

  const settled = await Promise.allSettled(Object.values(jobs));
  const [quotaResult, modelUsageResult, toolUsageResult] = settled.map(readSettled);
  const quota = quotaResult.ok ? normalizeQuota(unwrapApiPayload(quotaResult.value)) : null;
  const modelUsage = modelUsageResult.ok
    ? normalizeActivityPayload(unwrapApiPayload(modelUsageResult.value))
    : null;
  const toolUsage = toolUsageResult.ok
    ? normalizeActivityPayload(unwrapApiPayload(toolUsageResult.value))
    : null;
  const endpointErrors = [
    quotaResult.error && { endpoint: 'quota', message: quotaResult.error },
    quotaResult.ok &&
      (!quota?.limits || quota.limits.length === 0) && {
        endpoint: 'quota',
        message: 'BigModel 沒有返回配額 limits；請確認選擇的是 Coding Plan key 和正確平台。'
      },
    modelUsageResult.error && { endpoint: 'modelUsage', message: modelUsageResult.error },
    toolUsageResult.error && { endpoint: 'toolUsage', message: toolUsageResult.error }
  ].filter(Boolean);
  const okCount =
    (quota?.limits?.length ? 1 : 0) +
    (modelUsageResult.ok ? 1 : 0) +
    (toolUsageResult.ok ? 1 : 0);

  return {
    id: account.id,
    name: account.name,
    maskedKey: maskSecret(account.key),
    baseUrl: account.baseUrl,
    fetchedAt: now.toISOString(),
    queryWindow: window,
    status: okCount === 3 ? 'ok' : okCount > 0 ? 'partial' : 'error',
    endpointErrors,
    quota,
    modelUsage,
    toolUsage
  };
}

export async function fetchUsageSnapshotAuto(account, options = {}) {
  const schemes = authSchemesFor(account);
  const baseUrls = baseUrlsFor(account);
  const attempts = [];

  for (const baseUrl of baseUrls) {
    for (const authScheme of schemes) {
      const candidate = { ...account, baseUrl, authScheme };
      const probe = await probeQuota(candidate, options);
      attempts.push(probe);

      if (probe.quota?.limits?.length) {
        const snapshot = await fetchUsageSnapshot(candidate, options);
        return {
          ...snapshot,
          attemptedQuotaEndpoints: attempts.map(toPublicAttempt)
        };
      }
    }
  }

  const bestAttempt = attempts.find((attempt) => attempt.ok) || attempts[0];
  const fallbackSnapshot = bestAttempt
    ? await fetchUsageSnapshot(
        {
          ...account,
          baseUrl: bestAttempt.baseUrl,
          authScheme: bestAttempt.authScheme
        },
        options
      )
    : await fetchUsageSnapshot(account, options);

  const tried = attempts.map(toPublicAttempt);

  return {
    ...fallbackSnapshot,
    attemptedQuotaEndpoints: tried,
    endpointErrors: [
      ...(fallbackSnapshot.endpointErrors || []),
      {
        endpoint: 'quotaProbe',
        message: `已嘗試 ${tried.map((item) => `${item.baseUrl}/${item.authScheme}`).join('、')}，但都沒有返回配額 limits。`
      }
    ]
  };
}

export async function fetchUsageSnapshotWithWebSession(account, options = {}) {
  const now = new Date();
  const window = createQueryWindow(now);
  const baseUrl = normalizeOrigin(account.baseUrl || 'https://bigmodel.cn');
  const headers = createWebSessionHeaders(account.webSession || {});
  const requestTimeoutMs = options.requestTimeoutMs || 20_000;

  const jobs = {
    quota: fetchJsonWithFallback({
      urls: [
        `${baseUrl}${ENDPOINTS.quota}${toQueryString({ type: 2 })}`,
        `${baseUrl}${ENDPOINTS.quota}${toQueryString({ type: 3 })}`,
        `${baseUrl}${ENDPOINTS.quota}`
      ],
      label: 'quota',
      headers,
      requestTimeoutMs,
      baseUrl
    }),
    modelUsage: fetchJsonWithFallback({
      urls: [
        `${baseUrl}${ENDPOINTS.modelUsage}${toQueryString({ ...window, type: 3 })}`,
        `${baseUrl}${ENDPOINTS.modelUsage}${toQueryString({ ...window, type: 2 })}`,
        `${baseUrl}${ENDPOINTS.modelUsage}${toQueryString(window)}`
      ],
      label: 'model usage',
      headers,
      requestTimeoutMs,
      baseUrl
    }),
    toolUsage: fetchJsonWithFallback({
      urls: [
        `${baseUrl}${ENDPOINTS.toolUsage}${toQueryString({ ...window, type: 3 })}`,
        `${baseUrl}${ENDPOINTS.toolUsage}${toQueryString({ ...window, type: 2 })}`,
        `${baseUrl}${ENDPOINTS.toolUsage}${toQueryString(window)}`
      ],
      label: 'tool usage',
      headers,
      requestTimeoutMs,
      baseUrl
    })
  };

  const settled = await Promise.allSettled(Object.values(jobs));
  const [quotaResult, modelUsageResult, toolUsageResult] = settled.map(readSettled);
  const quota = quotaResult.ok ? normalizeQuota(unwrapApiPayload(quotaResult.value)) : null;
  const modelUsage = modelUsageResult.ok
    ? normalizeActivityPayload(unwrapApiPayload(modelUsageResult.value))
    : null;
  const toolUsage = toolUsageResult.ok
    ? normalizeActivityPayload(unwrapApiPayload(toolUsageResult.value))
    : null;
  const endpointErrors = [
    quotaResult.error && { endpoint: 'quota', message: quotaResult.error },
    quotaResult.ok &&
      (!quota?.limits || quota.limits.length === 0) && {
        endpoint: 'quota',
        message: 'BigModel 官方登入 API 沒有返回配額 limits；請重新複製 usage-stats 的 request headers。'
      },
    modelUsageResult.error && { endpoint: 'modelUsage', message: modelUsageResult.error },
    toolUsageResult.error && { endpoint: 'toolUsage', message: toolUsageResult.error }
  ].filter(Boolean);
  const okCount =
    (quota?.limits?.length ? 1 : 0) +
    (modelUsageResult.ok ? 1 : 0) +
    (toolUsageResult.ok ? 1 : 0);

  return {
    id: account.id,
    name: account.name,
    maskedKey: maskWebSession(account.webSession),
    baseUrl,
    authMode: 'webSession',
    fetchedAt: now.toISOString(),
    queryWindow: window,
    status: okCount === 3 ? 'ok' : okCount > 0 ? 'partial' : 'error',
    endpointErrors,
    quota,
    modelUsage,
    toolUsage
  };
}

export function buildUsageSnapshotFromOfficialPayload(account, payloads = {}) {
  const now = new Date();
  const quotaResult = normalizeOfficialPayload('quota', payloads.quota, normalizeQuota);
  const modelUsageResult = normalizeOfficialPayload(
    'model usage',
    payloads.modelUsage,
    normalizeActivityPayload
  );
  const toolUsageResult = normalizeOfficialPayload(
    'tool usage',
    payloads.toolUsage,
    normalizeActivityPayload
  );
  const quota = quotaResult.ok ? quotaResult.value : null;
  const modelUsage = modelUsageResult.ok ? modelUsageResult.value : null;
  const toolUsage = toolUsageResult.ok ? toolUsageResult.value : null;
  const endpointErrors = [
    quotaResult.error && { endpoint: 'quota', message: quotaResult.error },
    quotaResult.ok &&
      (!quota?.limits || quota.limits.length === 0) && {
        endpoint: 'quota',
        message: '官方頁回應沒有包含 quota limits。'
      },
    modelUsageResult.error && { endpoint: 'modelUsage', message: modelUsageResult.error },
    toolUsageResult.error && { endpoint: 'toolUsage', message: toolUsageResult.error }
  ].filter(Boolean);
  const okCount =
    (quota?.limits?.length ? 1 : 0) +
    (modelUsageResult.ok ? 1 : 0) +
    (toolUsageResult.ok ? 1 : 0);

  return {
    id: account.id,
    name: account.name,
    maskedKey: '官方頁回應',
    baseUrl: account.baseUrl,
    authMode: 'officialPayload',
    fetchedAt: now.toISOString(),
    status: okCount === 3 ? 'ok' : okCount > 0 ? 'partial' : 'error',
    endpointErrors,
    quota,
    modelUsage,
    toolUsage
  };
}

function normalizeOfficialPayload(label, payload, normalizer) {
  if (!payload) return { ok: false, error: `[${label}] 官方頁沒有返回資料。` };

  try {
    assertApiSuccess(payload, label);
    return {
      ok: true,
      value: normalizer(unwrapApiPayload(payload))
    };
  } catch (error) {
    return {
      ok: false,
      error: error.message
    };
  }
}

function authSchemesFor(account) {
  const key = String(account.key || '').trim();
  if (/^(Bearer|Basic)\s+/i.test(key)) return ['raw'];

  const requested = String(account.authScheme || 'auto').toLowerCase();
  if (requested === 'raw') return ['raw', 'Bearer'];
  if (requested === 'bearer') return ['Bearer', 'raw'];
  return ['raw', 'Bearer'];
}

function baseUrlsFor(account) {
  const selected = normalizeOrigin(account.baseUrl || 'https://open.bigmodel.cn');
  const ordered =
    selected === 'https://api.z.ai'
      ? [selected, 'https://api.z.ai']
      : [selected, 'https://open.bigmodel.cn', 'https://bigmodel.cn', 'https://dev.bigmodel.cn'];
  return [...new Set(ordered)];
}

async function probeQuota(account, options = {}) {
  const authorization = createAuthorizationHeader(account);
  const headers = { authorization };
  const requestTimeoutMs = options.requestTimeoutMs || 20_000;

  try {
    const response = await fetchJson({
      url: `${account.baseUrl}${ENDPOINTS.quota}`,
      label: `quota probe ${account.baseUrl}/${account.authScheme}`,
      headers,
      requestTimeoutMs,
      baseUrl: account.baseUrl
    });
    const quota = normalizeQuota(unwrapApiPayload(response));

    return {
      ok: true,
      baseUrl: account.baseUrl,
      authScheme: account.authScheme,
      quota,
      limitsCount: quota.limits.length
    };
  } catch (error) {
    return {
      ok: false,
      baseUrl: account.baseUrl,
      authScheme: account.authScheme,
      error: error.message
    };
  }
}

function toPublicAttempt(attempt) {
  return {
    baseUrl: attempt.baseUrl,
    authScheme: attempt.authScheme,
    ok: attempt.ok,
    limitsCount: attempt.limitsCount || 0,
    error: attempt.error || null
  };
}

async function fetchJson({ url, label, authorization, headers = {}, requestTimeoutMs, baseUrl }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  const origin = baseUrl ? normalizeOrigin(baseUrl) : new URL(url).origin;
  const requestHeaders = {
    ...(authorization ? { authorization } : {}),
    ...headers,
    'Accept-Language': headers['Accept-Language'] || headers['accept-language'] || 'zh-CN,zh;q=0.9,en;q=0.8',
    Accept: headers.Accept || headers.accept || 'application/json',
    'Content-Type': headers['Content-Type'] || headers['content-type'] || 'application/json',
    Origin: headers.Origin || headers.origin || origin,
    Referer: headers.Referer || headers.referer || `${origin}/coding-plan/team/usage-stats`,
    'User-Agent':
      headers['User-Agent'] ||
      headers['user-agent'] ||
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36'
  };

  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: requestHeaders
    });
    const body = await response.text();
    const parsed = parseJsonBody(body);

    if (!response.ok) {
      const detail = typeof parsed === 'object' ? JSON.stringify(parsed) : body;
      throw new Error(`[${label}] HTTP ${response.status}: ${truncate(detail, 400)}`);
    }

    assertApiSuccess(parsed, label);

    return parsed;
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(`[${label}] request timed out after ${requestTimeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJsonWithFallback({ urls, label, headers, requestTimeoutMs, baseUrl }) {
  const errors = [];

  for (const url of urls) {
    try {
      return await fetchJson({ url, label, headers, requestTimeoutMs, baseUrl });
    } catch (error) {
      errors.push(error.message);
    }
  }

  throw new Error(errors[0] || `[${label}] all fallback requests failed`);
}

function createAuthorizationHeader(account) {
  const key = String(account.key || '').trim();
  if (/^(Bearer|Basic)\s+/i.test(key)) return key;
  if (account.authScheme.toLowerCase() === 'raw') return key;
  return `${account.authScheme} ${key}`;
}

function createWebSessionHeaders(webSession) {
  const headers = { ...(webSession?.extraHeaders || {}) };
  const mappings = [
    ['authorization', 'Authorization'],
    ['cookie', 'Cookie'],
    ['bigmodelOrganization', 'Bigmodel-Organization'],
    ['bigmodelProject', 'Bigmodel-Project'],
    ['setLanguage', 'Set-Language'],
    ['acceptLanguage', 'Accept-Language'],
    ['userAgent', 'User-Agent']
  ];

  for (const [key, headerName] of mappings) {
    const value = String(webSession?.[key] || '').trim();
    if (value) headers[headerName] = value;
  }

  return headers;
}

function normalizeOrigin(value) {
  return new URL(value).origin;
}

function createQueryWindow(now) {
  const start = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - 1,
    now.getHours(),
    0,
    0,
    0
  );
  const end = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    now.getHours(),
    59,
    59,
    999
  );

  return {
    startTime: formatDateTime(start),
    endTime: formatDateTime(end)
  };
}

function toQueryString(window) {
  const params = new URLSearchParams({
    startTime: window.startTime,
    endTime: window.endTime
  });
  return `?${params.toString()}`;
}

function formatDateTime(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

function readSettled(result) {
  if (result.status === 'fulfilled') return { ok: true, value: result.value };
  return { ok: false, error: result.reason?.message || String(result.reason) };
}

function parseJsonBody(body) {
  if (!body) return null;
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

function unwrapApiPayload(value) {
  if (value && typeof value === 'object' && 'data' in value && value.data !== null) {
    return value.data;
  }
  return value;
}

function assertApiSuccess(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;

  const code = Number(value.code);
  const hasCode = value.code !== undefined && value.code !== null && value.code !== '';
  const explicitFailure = value.success === false || value.ok === false;
  const badCode = hasCode && Number.isFinite(code) && code !== 0 && code !== 200;

  if (explicitFailure || badCode) {
    const originalMessage = value.msg || value.message || value.error?.message || JSON.stringify(value);
    const message = enrichBigModelMessage(originalMessage);
    throw new Error(`[${label}] ${message}`);
  }
}

function enrichBigModelMessage(message) {
  const text = String(message || '');
  if (text.includes('不存在coding plan') || text.toLowerCase().includes('coding plan')) {
    return `${text}。官方用量頁使用登入後的 Web 身分，不是 Coding API key。請用 npm run diagnose:key 檢查 codingApiChecks；如果 /api/coding/paas/v4/models 可用但 monitor 仍失敗，代表 BigModel 暫不支援用這支 team key 透過 API key 查額度，請改用「官方登入 Header」模式。`;
  }
  if (text.includes('未登录') || text.toLowerCase().includes('login')) {
    return `${text}。官方登入 Header 可能已過期，請重新從 BigModel 用量頁複製 request headers。`;
  }
  return text;
}

function normalizeQuota(payload) {
  const source = payload && typeof payload === 'object' ? payload : {};
  const limits = findLikelyArray(source, (item) =>
    Boolean(item && typeof item === 'object' && ('percentage' in item || 'type' in item))
  );

  return {
    plan: firstString(source, ['plan', 'planName', 'packageName', 'package', 'tier', 'level']),
    totals: collectTopLevelNumbers(source),
    limits: (limits || []).map(normalizeLimit)
  };
}

function normalizeLimit(item, index) {
  const type = String(item.type || item.limitType || item.name || item.key || `limit-${index + 1}`);
  const periodUnit = firstNumber(item, ['unit']);
  const periodNumber = firstNumber(item, ['number']);
  const current = firstNumber(item, [
    'currentValue',
    'currentUsage',
    'used',
    'consumed',
    'value',
    'totalUsed',
    'usedValue',
    'usageValue'
  ]);
  const total = firstNumber(item, [
    'limit',
    'total',
    'max',
    'quota',
    'usage',
    'totalValue',
    'limitValue',
    'maxValue'
  ]);
  const percentage = normalizePercentage(
    firstNumber(item, ['percentage', 'percent', 'rate', 'ratio', 'usageRate', 'usedRate']),
    current,
    total
  );

  return {
    type,
    label: labelForLimit(type, item),
    percentage,
    current,
    total,
    periodUnit,
    periodNumber,
    remaining: firstNumber(item, ['remaining']),
    unit: firstString(item, ['unit', 'unitName', 'metric']),
    resetAt: formatResetValue(
      firstDefined(item, ['resetAt', 'resetTime', 'endTime', 'expireAt', 'nextResetTime'])
    ),
    usageDetails: item.usageDetails || item.details || null
  };
}

function normalizeActivityPayload(payload) {
  const source = payload && typeof payload === 'object' ? payload : {};
  const rows = findLikelyArray(source, (item) => item && typeof item === 'object') || [];

  return {
    totals: collectTopLevelNumbers(source),
    rows: rows.slice(0, 30).map(compactObject)
  };
}

function findLikelyArray(value, predicate, depth = 0) {
  if (depth > 3 || value == null) return null;
  if (Array.isArray(value)) {
    return value.some(predicate) ? value : null;
  }
  if (typeof value !== 'object') return null;

  for (const key of ['limits', 'items', 'records', 'list', 'usageDetails', 'details', 'data']) {
    const nested = value[key];
    const found = findLikelyArray(nested, predicate, depth + 1);
    if (found) return found;
  }

  for (const nested of Object.values(value)) {
    const found = findLikelyArray(nested, predicate, depth + 1);
    if (found) return found;
  }

  return null;
}

function collectTopLevelNumbers(source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return [];

  return Object.entries(source)
    .filter(([, value]) => typeof value === 'number' && Number.isFinite(value))
    .map(([key, value]) => ({ key, value }))
    .slice(0, 12);
}

function compactObject(value) {
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entry]) => ['string', 'number', 'boolean'].includes(typeof entry) || entry == null)
      .slice(0, 8)
  );
}

function firstNumber(source, keys) {
  for (const key of keys) {
    const raw = source?.[key];
    const value =
      typeof raw === 'string' ? Number(raw.trim().replace(/%$/, '')) : Number(raw);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function firstString(source, keys) {
  for (const key of keys) {
    const value = source?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function firstDefined(source, keys) {
  for (const key of keys) {
    const value = source?.[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return null;
}

function formatResetValue(value) {
  if (value === null || value === undefined || value === '') return null;

  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    const milliseconds = numeric > 10_000_000_000 ? numeric : numeric * 1000;
    const date = new Date(milliseconds);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }

  return String(value);
}

function normalizePercentage(value, current, total) {
  if (Number.isFinite(value)) {
    return value > 0 && value <= 1 ? value * 100 : value;
  }

  if (Number.isFinite(current) && Number.isFinite(total) && total > 0) {
    return (current / total) * 100;
  }

  return null;
}

function labelForLimit(type, item = {}) {
  const upper = type.toUpperCase();
  const unit = Number(item.unit);
  const number = Number(item.number);

  if (upper.includes('WEEK')) return '每周使用額度';
  if (upper.includes('MCP') || upper.includes('TOOL') || upper.includes('TIME_LIMIT')) {
    return 'MCP 每月額度';
  }
  if (unit === 4 || unit === 6 || unit === 7 || number === 7) return '每周使用額度';
  if (unit === 5) return 'MCP 每月額度';
  if (
    upper.includes('TOKEN') ||
    upper.includes('TOKENS') ||
    upper.includes('FIVE') ||
    upper.includes('5')
  ) {
    return '每5小時使用額度';
  }
  return type.replaceAll('_', ' ');
}

function maskSecret(value) {
  const trimmed = String(value || '').replace(/^Bearer\s+/i, '').trim();
  if (trimmed.length <= 10) return `${trimmed.slice(0, 2)}***${trimmed.slice(-2)}`;
  return `${trimmed.slice(0, 5)}...${trimmed.slice(-5)}`;
}

function maskWebSession(webSession = {}) {
  const parts = [];
  if (webSession.authorization) parts.push(`Authorization ${maskSecret(webSession.authorization)}`);
  if (webSession.cookie) parts.push('Cookie 已輸入');
  if (webSession.bigmodelOrganization) parts.push('Organization 已輸入');
  if (webSession.bigmodelProject) parts.push('Project 已輸入');
  return parts.length ? parts.join(' · ') : 'Web session';
}

function truncate(value, maxLength) {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}
