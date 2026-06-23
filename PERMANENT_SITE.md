# Permanent website setup

Use this to make a permanent site similar to:

```text
https://zming061031.github.io/stockvue/dashboard.html
```

For BigModel Coding Plan usage, the preferred setup is now GitHub Pages plus GitHub Actions:

- GitHub Pages hosts the dashboard frontend.
- GitHub Actions is scheduled four times per hour at UTC minutes 07, 22, 37, and 52 to avoid GitHub cron peak minutes and compensate for non-guaranteed cron timing. In practice this keeps the dashboard refreshed within roughly one hour, opens a temporary Playwright browser, reads the official BigModel usage page with your saved browser session, writes `usage-state.json`, and redeploys Pages.

No always-on Windows VM is required. The tradeoff is that the saved BigModel browser session may expire or may be rejected by BigModel from GitHub's runner IP; if that happens, export and update the GitHub Secret again.

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

- BigModel capture: scheduled four times per hour in GitHub Actions so skipped/delayed runs still usually refresh within one hour.
- Dashboard data reload: every 1 hour in the browser.
- GitHub Pages deployment: every push to `main`.
- API key/Header input: not shown on the website.

## Security

- `usage-state.json` is public and contains usage data only.
- `BIGMODEL_STORAGE_STATE_GZ_B64` is a GitHub Secret and contains BigModel browser login state. Rotate it by rerunning `npm run export:storage-state`.
- Local BigModel browser login state is stored under:

```text
%LOCALAPPDATA%\bigmodel-usage-monitor\browser-profile
```

Treat both the GitHub Secret and the local profile as sensitive.
