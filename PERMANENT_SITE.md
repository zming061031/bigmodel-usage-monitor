# Permanent website setup

Use this to make a permanent site similar to:

```text
https://zming061031.github.io/stockvue/dashboard.html
```

For BigModel Coding Plan usage, the permanent setup has two parts:

- GitHub Pages hosts the public dashboard frontend.
- A private Windows cloud VM runs the backend and the hourly BigModel official-page capture.

GitHub Pages cannot run the BigModel browser login/capture by itself. The VM is required because BigModel usage data comes from the logged-in official usage page.

## 1. Cloud VM backend

On the Windows cloud VM:

```powershell
cd C:\Users\Administrator\bigmodel-usage-monitor
npm run permanent:install -OpenFirewall
```

The script will:

- create `.env`
- build the frontend
- install the website service
- install the hourly capture scheduled task
- make `/api/usage` publicly readable
- keep write/import endpoints protected by `DASHBOARD_PASSWORD`

Then run once:

```powershell
npm run capture:web-session
```

Log in to BigModel in the browser window. After this first login, the VM will keep using the same browser profile for hourly captures.

Your backend URL is one of these:

```text
http://YOUR_VM_IP:5179
https://your-domain.example.com
```

Use HTTPS with a domain/reverse proxy if possible. Plain HTTP works for testing.

## 2. GitHub Pages frontend

This repo includes:

```text
.github/workflows/deploy-pages.yml
```

In GitHub:

1. Push this project to a GitHub repository.
2. Go to `Settings -> Pages`.
3. Set Source to `GitHub Actions`.
4. Go to `Settings -> Secrets and variables -> Actions -> Variables`.
5. Add repository variable:

```text
VITE_API_BASE_URL=http://YOUR_VM_IP:5179
```

If you use a domain:

```text
VITE_API_BASE_URL=https://your-domain.example.com
```

Push to `main`. GitHub Actions will build and publish the site.

The dashboard URL will be:

```text
https://zming061031.github.io/REPO_NAME/dashboard.html
```

If the repo is named `bigmodel-usage-monitor`, the URL is:

```text
https://zming061031.github.io/bigmodel-usage-monitor/dashboard.html
```

## Automation behavior

- BigModel capture: every 1 hour on the Windows cloud VM.
- Dashboard data reload: every 1 hour in the browser.
- GitHub Pages deployment: every push to `main`.
- API key/Header input: not shown on the website.

## Security

- `/api/usage` is public and contains usage data only.
- `/api/query-official-payload` is protected by dashboard Basic Auth.
- BigModel Cookie/login state is stored only in the VM browser profile:

```text
%LOCALAPPDATA%\bigmodel-usage-monitor\browser-profile
```

Treat the VM as sensitive.
