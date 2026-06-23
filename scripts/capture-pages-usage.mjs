import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { chromium } from 'playwright';
import { buildUsageSnapshotFromOfficialPayload } from '../server/bigmodelClient.js';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputPath = path.resolve(
  process.env.PAGES_USAGE_STATE_PATH || path.join(rootDir, 'public', 'usage-state.json')
);
const officialUrl = 'https://bigmodel.cn/coding-plan/team/usage-stats';
const timeoutMs = Number(process.env.PAGES_CAPTURE_TIMEOUT_MS || 180_000);
const refreshedStorageStatePath = String(process.env.PAGES_REFRESHED_STORAGE_STATE_GZ_B64_PATH || '').trim();
const fiveMinutesMs = 5 * 60 * 1000;
const oneHourMs = 60 * 60 * 1000;
const fiveHoursMs = 5 * oneHourMs;
const oneWeekMs = 7 * 24 * oneHourMs;

async function main() {
  const storageState = readStorageStateSecret();
  if (!storageState) {
    console.log('BIGMODEL_STORAGE_STATE_B64 is not set. Keeping placeholder usage-state.json.');
    writeState(createEmptyState('missing-storage-secret'));
    return;
  }

  const storagePath = path.join(os.tmpdir(), `bigmodel-storage-${Date.now()}.json`);
  fs.writeFileSync(storagePath, storageState, 'utf8');

  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled']
  });
  const context = await browser.newContext({
    locale: 'zh-CN',
    storageState: storagePath,
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();
  const payloads = {};

  page.on('response', async (response) => {
    const url = response.url();
    if (!isUsageResponse(url)) return;

    try {
      const json = await response.json();
      savePayload(payloads, url, json);
      console.log(formatResponseSummary(url, response.status(), json));
    } catch {
      console.log(`Official response ${redactQuery(url)} | http=${response.status()} | json=parse-failed`);
    }
  });

  try {
    try {
      await page.goto(officialUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    } catch (error) {
      if (!Object.keys(payloads).length) throw error;
      console.log(`Official page navigation warning after usage responses started: ${error.name || 'Error'}`);
    }

    await waitForPayloads(page, payloads);

    const snapshot = buildUsageSnapshotFromOfficialPayload(
      {
        id: 'github-actions-official-page',
        name: 'BigModel 官方頁回應',
        baseUrl: 'https://bigmodel.cn'
      },
      payloads
    );

    if (snapshot.status === 'error') {
      throw new Error(
        `Official page returned no usable quota data: ${(snapshot.endpointErrors || [])
          .map((item) => `${item.endpoint}: ${item.message}`)
          .join('; ')}`
      );
    }

    writeState(createState(snapshot));
    await writeRefreshedStorageState(context);
    console.log(`Wrote ${path.relative(rootDir, outputPath)} with status=${snapshot.status}`);
  } finally {
    await browser.close();
    fs.rmSync(storagePath, { force: true });
  }
}

function readStorageStateSecret() {
  const gzipBase64File = String(process.env.BIGMODEL_STORAGE_STATE_GZ_B64_FILE || '').trim();
  if (gzipBase64File) {
    return zlib
      .gunzipSync(Buffer.from(fs.readFileSync(gzipBase64File, 'utf8').trim(), 'base64'))
      .toString('utf8');
  }

  const gzipBase64 = String(process.env.BIGMODEL_STORAGE_STATE_GZ_B64 || '').trim();
  if (gzipBase64) return zlib.gunzipSync(Buffer.from(gzipBase64, 'base64')).toString('utf8');

  const base64 = String(process.env.BIGMODEL_STORAGE_STATE_B64 || '').trim();
  if (base64) return Buffer.from(base64, 'base64').toString('utf8');

  const json = String(process.env.BIGMODEL_STORAGE_STATE_JSON || '').trim();
  return json || '';
}

async function writeRefreshedStorageState(context) {
  if (!refreshedStorageStatePath) return;

  const state = await context.storageState();
  const gzipBase64 = zlib.gzipSync(Buffer.from(JSON.stringify(state), 'utf8')).toString('base64');

  fs.mkdirSync(path.dirname(refreshedStorageStatePath), { recursive: true });
  fs.writeFileSync(refreshedStorageStatePath, gzipBase64, {
    encoding: 'utf8',
    mode: 0o600
  });

  console.log('Wrote refreshed BigModel storage state for secret rotation.');
}

function isUsageResponse(url) {
  const text = String(url || '');
  return (
    text.includes('/api/monitor/usage/quota/limit') ||
    text.includes('/api/monitor/usage/model-usage') ||
    text.includes('/api/monitor/usage/tool-usage')
  );
}

function savePayload(payloads, url, json) {
  if (url.includes('/quota/limit')) payloads.quota = json;
  if (url.includes('/model-usage')) payloads.modelUsage = json;
  if (url.includes('/tool-usage')) payloads.toolUsage = json;
}

async function waitForPayloads(page, payloads) {
  const startedAt = Date.now();
  let reloaded = false;

  while (Date.now() - startedAt < timeoutMs) {
    if (payloads.quota && (payloads.modelUsage || payloads.toolUsage)) return;

    if (!reloaded && Date.now() - startedAt > 45_000) {
      reloaded = true;
      console.log('Usage responses not complete yet. Reloading official page once.');
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
    }

    await delay(500);
  }

  throw new Error(
    `Timed out waiting for official usage responses. Captured: ${Object.keys(payloads).join(', ') || 'none'}`
  );
}

function createState(snapshot) {
  const now = new Date();
  return {
    config: {
      defaultBaseUrl: 'https://bigmodel.cn',
      publicQueryOnly: true,
      publicUsageRead: true,
      clientPollMs: fiveMinutesMs,
      fiveHourRefreshMs: fiveHoursMs,
      weeklyRefreshMs: oneWeekMs,
      staticRefreshMs: oneHourMs,
      accountCount: 1,
      accounts: [
        {
          id: snapshot.id,
          name: snapshot.name,
          baseUrl: snapshot.baseUrl,
          maskedKey: snapshot.maskedKey
        }
      ],
      queryMode: 'github-actions-official-page'
    },
    snapshots: [snapshot],
    isRefreshing: false,
    lastRefreshAt: now.toISOString(),
    lastRefreshReason: 'github-actions-official-page',
    nextFiveHourRefreshAt: new Date(now.getTime() + fiveHoursMs).toISOString(),
    nextWeeklyRefreshAt: new Date(now.getTime() + oneWeekMs).toISOString(),
    lastError: null
  };
}

function createEmptyState(reason) {
  return {
    config: {
      defaultBaseUrl: 'https://bigmodel.cn',
      publicQueryOnly: true,
      publicUsageRead: true,
      clientPollMs: fiveMinutesMs,
      fiveHourRefreshMs: fiveHoursMs,
      weeklyRefreshMs: oneWeekMs,
      staticRefreshMs: oneHourMs,
      accountCount: 0,
      accounts: [],
      queryMode: 'github-pages-static'
    },
    snapshots: [],
    isRefreshing: false,
    lastRefreshAt: null,
    lastRefreshReason: reason,
    nextFiveHourRefreshAt: null,
    nextWeeklyRefreshAt: null,
    lastError: null
  };
}

function writeState(state) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

function formatResponseSummary(url, status, json) {
  const payload = json?.data || json || {};
  const limits = findArray(payload, (item) => item && typeof item === 'object' && ('type' in item || 'percentage' in item));
  const records = findArray(payload, (item) => item && typeof item === 'object');
  const message = json?.msg || json?.message;
  return [
    `Official response ${redactQuery(url)}`,
    `http=${status}`,
    `code=${json?.code ?? 'none'}`,
    `success=${json?.success ?? 'none'}`,
    `limits=${limits?.length || 0}`,
    `records=${records?.length || 0}`,
    message ? `msg=${message}` : ''
  ]
    .filter(Boolean)
    .join(' | ');
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
  const parsed = new URL(url);
  return `${parsed.origin}${parsed.pathname}${parsed.search ? '?...' : ''}`;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

await main();
