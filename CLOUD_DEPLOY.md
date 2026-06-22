# Cloud deployment

This project can run in the cloud, but the working Team Coding Plan quota flow is not API-key-only.

Preferred no-VM mode: GitHub Pages plus scheduled GitHub Actions. See [PERMANENT_SITE.md](./PERMANENT_SITE.md).

For your Team Coding Plan key, BigModel returned `当前用户不存在coding plan` from the monitor API. The official usage page works because it uses the logged-in BigModel web session in a browser. The Windows VM setup below is a fallback when GitHub Actions browser session capture stops working.

1. A private cloud Windows VM runs the monitor website.
2. The same VM keeps a logged-in Edge/Chrome profile for `https://bigmodel.cn/coding-plan/team/usage-stats`.
3. A scheduled task runs `npm run capture:web-session` every hour.
4. The capture script imports the official page's successful quota/model/tool JSON into the monitor backend.
5. The cloud website shows the latest imported snapshot from `/api/usage`.
6. The frontend reloads `/api/usage` every hour.

For a GitHub Pages-style permanent URL like `https://zming061031.github.io/.../dashboard.html`, use [PERMANENT_SITE.md](./PERMANENT_SITE.md).

No API key, Cookie, or Authorization header is saved into the project. The VM browser profile does store the BigModel login session, so treat the VM as sensitive.

## What will not work

- GitHub Pages only: it cannot run the backend or browser capture.
- API key only for this Team key: BigModel's monitor API does not recognize it as the logged-in Coding Plan user.
- A public site asking visitors for BigModel Cookies: do not do this.

GitHub Pages can still host the frontend, but for this quota monitor you still need a private backend and a trusted browser automation environment.

## Recommended: private Windows cloud VM

Use any Windows VM/VPS where you can RDP in and keep the user signed in. Install:

- Node.js 22 or newer
- Git
- Microsoft Edge or Google Chrome

Clone the project into the VM, then run:

```powershell
cd C:\Users\Administrator\bigmodel-usage-monitor
npm ci
npm run build
```

Create `.env`:

```env
HOST=0.0.0.0
PORT=5179
PUBLIC_QUERY_ONLY=true
PUBLIC_USAGE_READ=true
DASHBOARD_USER=admin
DASHBOARD_PASSWORD=change_this_to_a_strong_password
USAGE_STATE_FILE=.\data\usage-state.json
LIVE_POLL_MS=3600000
```

Open the VM firewall or cloud security group for port `5179`, or put the app behind your own reverse proxy. Because this dashboard shows account usage, keep `DASHBOARD_PASSWORD` enabled.

Install and start the website service:

```powershell
npm run service:install
npm run service:status
```

Open:

```text
http://YOUR_VM_IP:5179
```

The browser should ask for the dashboard username/password.

## First BigModel login on the VM

In the VM RDP session, run:

```powershell
npm run capture:web-session
```

An Edge/Chrome window opens. Log in to BigModel in that window and open the official usage page. When the usage API responses return successfully, the script imports the quota snapshot into the monitor backend.

The BigModel login profile is kept here:

```text
%LOCALAPPDATA%\bigmodel-usage-monitor\browser-profile
```

Delete that folder if you need to clear the stored BigModel login.

## Hourly cloud refresh

Install the hourly capture task:

```powershell
npm run capture:install
```

The task runs once per hour under the current Windows user. Keep that VM user logged in, because the capture uses that user's browser profile and BigModel login session.

If the dashboard has Basic Auth and the capture script cannot import, set this user environment variable on the VM:

```powershell
[System.Environment]::SetEnvironmentVariable('CAPTURE_MONITOR_AUTH', 'admin:change_this_to_a_strong_password', 'User')
```

Then open a new PowerShell window and test:

```powershell
npm run capture:web-session
```

## Docker/Render/Railway/Fly

The included Dockerfile can run the monitor website/backend, but it does not include the official browser capture environment. Use Docker/Render/Railway/Fly only for API-key query mode or for displaying snapshots imported by another trusted machine.

For this Team Coding Plan quota case, prefer the Windows VM setup above.

## Security notes

- Keep the repository private.
- Never commit `.env`.
- Never put BigModel API keys, Cookies, or Authorization headers into GitHub Secrets for public pages.
- Protect the cloud dashboard with `DASHBOARD_PASSWORD`.
- The saved `USAGE_STATE_FILE` contains usage data only, not raw credentials.
