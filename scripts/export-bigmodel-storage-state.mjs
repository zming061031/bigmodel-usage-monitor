import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { chromium } from 'playwright';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const officialUrl = 'https://bigmodel.cn/coding-plan/team/usage-stats';
const defaultProfile = path.join(
  process.env.LOCALAPPDATA || os.tmpdir(),
  'bigmodel-usage-monitor',
  'browser-profile'
);
const profileDir = process.env.BIGMODEL_EXPORT_PROFILE_DIR || defaultProfile;
const outputPath = path.resolve(
  process.env.BIGMODEL_STORAGE_STATE_OUT || path.join(rootDir, 'data', 'bigmodel-storage-state.json')
);
const browserPath = findBrowserExecutable();
const timeoutMs = Number(process.env.BIGMODEL_EXPORT_TIMEOUT_MS || 900_000);

async function main() {
  fs.mkdirSync(profileDir, { recursive: true });
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  const context = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    executablePath: browserPath,
    viewport: { width: 1280, height: 900 },
    locale: 'zh-CN'
  });
  const page = context.pages()[0] || (await context.newPage());
  let capturedQuota = false;

  page.on('response', async (response) => {
    const url = response.url();
    if (!url.includes('/api/monitor/usage/quota/limit')) return;
    try {
      const json = await response.json();
      if (json?.success === true || json?.code === 200 || json?.code === 0) {
        capturedQuota = true;
        console.log('Detected successful BigModel quota response.');
      }
    } catch {
    }
  });

  console.log('A browser window will open. Log in to BigModel there.');
  console.log('No account, password, token, or cookie will be printed.');
  await page.goto(officialUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });

  const startedAt = Date.now();
  while (!capturedQuota && Date.now() - startedAt < timeoutMs) {
    await delay(1000);
  }

  if (!capturedQuota) {
    await context.close();
    throw new Error('Timed out waiting for a successful BigModel quota response.');
  }

  await context.storageState({ path: outputPath });
  const storageJson = fs.readFileSync(outputPath, 'utf8');
  const storageB64 = Buffer.from(storageJson, 'utf8').toString('base64');
  const storageGzB64 = zlib.gzipSync(Buffer.from(storageJson, 'utf8'), { level: 9 }).toString('base64');
  const b64Path = `${outputPath}.b64`;
  const gzB64Path = `${outputPath}.gz.b64`;
  fs.writeFileSync(b64Path, `${storageB64}\n`, 'utf8');
  fs.writeFileSync(gzB64Path, `${storageGzB64}\n`, 'utf8');
  await context.close();

  console.log(`Storage state saved to: ${outputPath}`);
  console.log(`Compressed base64 secret payload saved to: ${gzB64Path}`);
  console.log('Set GitHub secret with:');
  console.log(`Get-Content -LiteralPath "${gzB64Path}" -Raw | gh secret set BIGMODEL_STORAGE_STATE_GZ_B64 --repo zming061031/bigmodel-usage-monitor`);
}

function findBrowserExecutable() {
  const candidates = [
    path.join(process.env.ProgramFiles || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env['ProgramFiles(x86)'] || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env.ProgramFiles || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env['ProgramFiles(x86)'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe')
  ];
  const found = candidates.find((candidate) => candidate && fs.existsSync(candidate));
  if (!found) return undefined;
  return found;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

await main();
