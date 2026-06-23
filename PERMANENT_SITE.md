# Permanent website setup

Use this to make a permanent site similar to:

```text
https://zming061031.github.io/stockvue/dashboard.html
```

For BigModel Coding Plan usage, the preferred setup is now GitHub Pages plus GitHub Actions:

- GitHub Pages hosts the dashboard frontend.
- GitHub Actions opens a temporary Playwright browser, reads the official BigModel usage page with your saved browser session, writes `usage-state.json`, refreshes the saved browser session secret when possible, and redeploys Pages.
- Cloudflare Worker Cron triggers the workflow every hour at UTC minute 07. GitHub's native schedule remains as a fallback because it can be delayed or skipped.

No always-on Windows VM is required. The workflow now rotates the saved BigModel browser session after successful official-page captures. The tradeoff is that BigModel can still force a fresh login or reject GitHub's runner IP; if that happens, export and update the GitHub Secret again.

## 1. Export BigModel browser session

On your own PC:

```powershell
cd C:\Users\chium\bigmodel-usage-monitor
npm run export:storage-state
```

Do not paste your account or password into chat. The script opens a browser; log in there if needed. It saves a compressed secret payload locally under:

```text
data\bigmodel-storage-state.json.gz.b64
```

Set it as a GitHub Secret:

```powershell
Get-Content -LiteralPath "data\bigmodel-storage-state.json.gz.b64" -Raw |
  gh secret set BIGMODEL_STORAGE_STATE_GZ_B64 --repo zming061031/bigmodel-usage-monitor
```

Set the secret-rotation token once so Actions can keep `BIGMODEL_STORAGE_STATE_GZ_B64` fresh after successful captures:

```powershell
gh auth token |
  gh secret set SESSION_ROTATION_TOKEN --repo zming061031/bigmodel-usage-monitor
```

## 2. GitHub Pages frontend

This repo includes:

```text
.github/workflows/deploy-pages.yml
```

In GitHub:

1. Push this project to a GitHub repository.
2. Go to `Settings -> Pages`.
3. Set Source to `GitHub Actions`.
4. Push to `main`, or manually run `Deploy GitHub Pages`.

The dashboard URL will be:

```text
https://zming061031.github.io/REPO_NAME/dashboard.html
```

If the repo is named `bigmodel-usage-monitor`, the URL is:

```text
https://zming061031.github.io/bigmodel-usage-monitor/dashboard.html
```

## Automation behavior

- BigModel capture: Cloudflare Cron triggers once per hour; GitHub schedule remains as fallback.
- Saved official login state: refreshed automatically after successful captures via `SESSION_ROTATION_TOKEN`.
- Dashboard data reload: every 5 minutes in the browser, while cloud capture remains hourly.
- GitHub Pages deployment: every push to `main`.
- API key/Header input: not shown on the website.

## More Reliable Cron

GitHub's native `schedule` can be delayed or skipped. For more reliable hourly triggering without a VM, deploy the included Cloudflare Worker cron trigger:

```powershell
npm run cloudflare:install
```

This requires logging in to Cloudflare once. The Worker stores a GitHub token as a Cloudflare secret and calls GitHub's `workflow_dispatch` API every hour. GitHub's own schedule remains enabled as a fallback.

Worker files:

```text
cloudflare-refresh-worker/wrangler.toml
cloudflare-refresh-worker/src/worker.js
```

## Security

- `usage-state.json` is public and contains usage data only.
- `BIGMODEL_STORAGE_STATE_GZ_B64` is a GitHub Secret and contains BigModel browser login state. It is rotated automatically after successful cloud captures when `SESSION_ROTATION_TOKEN` is present.
- `SESSION_ROTATION_TOKEN` is a GitHub Secret used only by the workflow to update `BIGMODEL_STORAGE_STATE_GZ_B64`. Do not expose it publicly.
- Cloudflare Worker mode stores a GitHub workflow-dispatch token as a Cloudflare secret. Do not expose it publicly.
- Local BigModel browser login state is stored under:

```text
%LOCALAPPDATA%\bigmodel-usage-monitor\browser-profile
```

Treat both the GitHub Secret and the local profile as sensitive.
