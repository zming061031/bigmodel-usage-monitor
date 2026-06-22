const key = process.env.BIGMODEL_DIAG_KEY || '';
const apiUri = process.env.BIGMODEL_DIAG_URI || 'https://open.bigmodel.cn/api/anthropic';

if (!key.trim()) {
  console.error('No key was provided.');
  process.exit(1);
}

const selectedOrigin = new URL(apiUri).origin;
const origins =
  selectedOrigin === 'https://api.z.ai'
    ? ['https://api.z.ai']
    : [...new Set([selectedOrigin, 'https://open.bigmodel.cn', 'https://bigmodel.cn', 'https://dev.bigmodel.cn'])];
const authValues = key.trim().match(/^(Bearer|Basic)\s+/i)
  ? [{ scheme: 'raw', value: key.trim() }]
  : [
      { scheme: 'raw', value: key.trim() },
      { scheme: 'Bearer', value: `Bearer ${key.trim()}` }
    ];

const endpoints = [
  ['quota', '/api/monitor/usage/quota/limit'],
  ['modelUsage', '/api/monitor/usage/model-usage'],
  ['toolUsage', '/api/monitor/usage/tool-usage']
];

const now = new Date();
const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, now.getHours(), 0, 0, 0);
const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), 59, 59, 999);
const params = new URLSearchParams({
  startTime: formatDateTime(start),
  endTime: formatDateTime(end)
});

const output = {
  apiUri,
  maskedKey: maskSecret(key),
  codingApiChecks: [],
  attempts: []
};

for (const auth of authValues) {
  for (const url of codingCheckUrls(apiUri)) {
    output.codingApiChecks.push({
      url,
      authScheme: auth.scheme,
      ...(await callCodingEndpoint(url, auth.value))
    });
  }
}

for (const origin of origins) {
  for (const auth of authValues) {
    for (const [name, path] of endpoints) {
      const url = `${origin}${path}${name === 'quota' ? '' : `?${params.toString()}`}`;
      const result = await callEndpoint(url, origin, auth.value);
      output.attempts.push({
        origin,
        endpoint: name,
        authScheme: auth.scheme,
        ...result
      });
    }
  }
}

output.interpretation = interpret(output);

console.log(JSON.stringify(output, null, 2));

function interpret(result) {
  const codingModelsOk = result.codingApiChecks.some(
    (check) => check.httpStatus >= 200 && check.httpStatus < 300 && check.hasModels
  );
  const monitorQuotaOk = result.attempts.some(
    (attempt) => attempt.endpoint === 'quota' && attempt.limitsCount > 0
  );
  const codingPlanErrors = result.attempts.filter((attempt) =>
    String(attempt.message || '').includes('不存在coding plan')
  ).length;

  return {
    codingModelsOk,
    monitorQuotaOk,
    summary: monitorQuotaOk
      ? '這支 key 可透過 monitor API 查到配額。'
      : codingModelsOk
        ? '這支 key 可呼叫 Coding API models，但 monitor 用量端點沒有接受它；請改用網站的「官方登入 Header」模式。'
        : codingPlanErrors > 0
          ? 'monitor 用量端點沒有把這支 key 識別為 Coding Plan；請確認 key 來源，或改用「官方登入 Header」模式。'
          : '沒有取得 monitor 配額；請查看 codingApiChecks 與 attempts 的 httpStatus/message。'
  };
}

function codingCheckUrls(uri) {
  const url = new URL(uri);
  const urls = new Set();

  if (url.pathname.includes('/api/coding/paas/v4')) {
    urls.add(`${url.origin}/api/coding/paas/v4/models`);
  }

  urls.add(`${url.origin}/api/coding/paas/v4/models`);
  return [...urls];
}

async function callCodingEndpoint(url, authorization) {
  try {
    const response = await fetch(url, {
      headers: {
        authorization,
        accept: 'application/json',
        'user-agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36'
      }
    });
    const text = await response.text();
    const parsed = parseJson(text);

    return {
      httpStatus: response.status,
      contentType: response.headers.get('content-type'),
      apiCode: parsed?.code || parsed?.error?.code || null,
      message: parsed?.msg || parsed?.message || parsed?.error?.message || null,
      hasModels: Array.isArray(parsed?.data),
      modelCount: Array.isArray(parsed?.data) ? parsed.data.length : 0,
      bodyPreview: redact(text.slice(0, 240))
    };
  } catch (error) {
    return {
      error: error.message
    };
  }
}

async function callEndpoint(url, origin, authorization) {
  try {
    const response = await fetch(url, {
      headers: {
        authorization,
        accept: 'application/json',
        'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
        origin,
        referer: `${origin}/coding-plan/team/usage-stats`,
        'user-agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36'
      }
    });
    const text = await response.text();
    const parsed = parseJson(text);
    const payload = parsed?.data || parsed;
    const limits = findArray(payload, (item) => item && typeof item === 'object' && ('type' in item || 'percentage' in item));
    const records = findArray(payload, (item) => item && typeof item === 'object');

    return {
      httpStatus: response.status,
      contentType: response.headers.get('content-type'),
      apiCode: parsed?.code ?? null,
      success: parsed?.success ?? null,
      message: parsed?.msg || parsed?.message || null,
      hasData: Boolean(parsed && typeof parsed === 'object' && parsed.data),
      limitsCount: limits?.length || 0,
      recordsCount: records?.length || 0,
      bodyPreview: redact(text.slice(0, 240))
    };
  } catch (error) {
    return {
      error: error.message
    };
  }
}

function findArray(value, predicate, depth = 0) {
  if (!value || depth > 4) return null;
  if (Array.isArray(value)) return value.some(predicate) ? value : null;
  if (typeof value !== 'object') return null;

  for (const child of Object.values(value)) {
    const found = findArray(child, predicate, depth + 1);
    if (found) return found;
  }
  return null;
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
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

function maskSecret(value) {
  const trimmed = String(value || '').replace(/^Bearer\s+/i, '').trim();
  if (!trimmed) return '';
  if (trimmed.length <= 10) return `${trimmed.slice(0, 2)}***${trimmed.slice(-2)}`;
  return `${trimmed.slice(0, 5)}...${trimmed.slice(-5)}`;
}

function redact(value) {
  return value.split(key).join(maskSecret(key));
}
