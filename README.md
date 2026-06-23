# BigModel 用量監控網站

網站用來顯示 GLM Coding Plan / Team Coding Plan 的用量。畫面不再提供 API key 或 Header 輸入框，會直接顯示後端最近一次從 BigModel 官方用量頁匯入的 5 小時、每週與 MCP 額度。

BigModel 官方用量頁目前使用登入後的 Web 身分查詢用量；部分 Team Coding Plan API key 可以呼叫模型，但不會被用量監控 API 識別。遇到 `当前用户不存在coding plan` 時，請使用 `npm run capture:web-session` 從官方用量頁匯入結果。

## 設定

```powershell
cd C:\Users\chium\bigmodel-usage-monitor
npm install
Copy-Item .env.example .env
notepad .env
```

預設不需要在 `.env` 放 API key：

```env
PUBLIC_QUERY_ONLY=true
BIGMODEL_API_BASE=https://bigmodel.cn
BIGMODEL_AUTH_SCHEME=Bearer
LIVE_POLL_MS=3600000
```

如果你使用的是 Global Z.AI 帳號，把 `BIGMODEL_API_BASE` 改成：

```env
BIGMODEL_API_BASE=https://api.z.ai
```

不要把真實 key、Cookie 或 Authorization 貼到聊天、README 或 Git。現在前端不需要使用者輸入這些資料。

## 官方頁自動抓取

如果 API key 查詢回傳 `当前用户不存在coding plan`，請在同一台可信任電腦或雲端 VM 上使用官方頁自動抓取：

1. 用瀏覽器登入 `https://bigmodel.cn/coding-plan/team/usage-stats`。
2. 開啟 DevTools Network，重新整理頁面。
3. 找到 `/api/monitor/usage/quota/limit` 請求，複製 request headers。
4. 目前不需要把 headers 貼到網站；請使用 `npm run capture:web-session` 讓工具匯入官方頁已成功返回的 JSON。

建議至少包含：

```text
authorization: ...
bigmodel-organization: ...
bigmodel-project: ...
cookie: ...
```

不要在公開網站要求陌生人輸入 Cookie；官方登入抓取只適合自己的本機或私人雲端 VM。

也可以讓本機工具自動抓 headers：

```powershell
npm run capture:web-session
```

它會開一個 Edge/Chrome 視窗到官方用量頁。你只需要在那個視窗登入 BigModel；工具偵測到 `/api/monitor/usage/quota/limit` 後，會讀取官方頁已成功返回的用量 JSON，交給監控網站格式化顯示，不會把 Cookie/token 印到終端或寫入專案檔案。

目前工具會優先匯入官方頁已成功返回的 quota/model/tool JSON，再交給本機監控網站格式化顯示；這比重放 Cookie 更穩，也不需要把 Cookie 傳給本機後端。登入狀態保存在本機瀏覽器 profile：

```text
%LOCALAPPDATA%\bigmodel-usage-monitor\browser-profile
```

刪除這個資料夾即可清除自動抓取工具的 BigModel 登入狀態。

## 啟動

```powershell
npm run dev
```

開啟：

```text
http://127.0.0.1:5173
```

## 本機診斷 API key

不要把 API key 貼到聊天。需要診斷時在本機執行：

```powershell
npm run diagnose:key
```

腳本會要求你在本機輸入 key，輸出會自動遮罩，不會保存完整 key。

## 建置後啟動

```powershell
npm run build
npm start
```

建置版會由後端服務同時提供 API 和網站。

## 設成 Windows 背景常駐

安裝登入自動啟動：

```powershell
npm run service:install
```

安裝腳本會先嘗試建立 Windows Scheduled Task；如果目前帳號沒有權限，會改用使用者 Startup 資料夾捷徑。

檢查狀態：

```powershell
npm run service:status
```

手動啟動或停止：

```powershell
npm run service:start
npm run service:stop
```

移除自動啟動：

```powershell
npm run service:uninstall
```

這個任務會在 Windows 登入後背景啟動。若電腦完全關機或睡眠，程式不會執行；要在電腦關機時也持續刷新，需要部署到雲主機。

## 部署到雲端

電腦關機也要繼續刷新時，可以用 GitHub Pages + GitHub Actions + Cloudflare Worker Cron。Cloudflare 每小時觸發一次 GitHub Actions；GitHub 自帶 schedule 仍保留作為備用。每次執行會開臨時瀏覽器，使用 GitHub Secret 裡保存的 BigModel 瀏覽器登入狀態，抓官方用量頁後重新部署 Pages。

最接近 `https://zming061031.github.io/stockvue/dashboard.html` 的做法是：

- GitHub Pages：永久網站前端，網址會像 `https://zming061031.github.io/bigmodel-usage-monitor/dashboard.html`
- GitHub Actions：被 Cloudflare 每小時觸發，抓 BigModel 官方頁並更新 `usage-state.json`
- Secret rotation：抓取成功後自動刷新 Cloudflare KV 裡的 BigModel 登入狀態，盡量延長官方登入狀態

完整步驟見 [PERMANENT_SITE.md](./PERMANENT_SITE.md)。

設定 BigModel 瀏覽器登入狀態 Secret：

```powershell
npm run export:storage-state
Get-Content -LiteralPath "data\bigmodel-storage-state.json.gz.b64" -Raw |
  gh secret set BIGMODEL_STORAGE_STATE_GZ_B64 --repo zming061031/bigmodel-usage-monitor

npm run cloudflare:install
```

`npm run cloudflare:install` 會同步 Cloudflare Worker 的 `REFRESH_TOKEN` 和 GitHub 的 `CLOUDFLARE_REFRESH_TOKEN`，並在本機有 `data\bigmodel-storage-state.json.gz.b64` 時先寫入 Cloudflare KV。之後 GitHub Actions 會先從 Cloudflare KV 取最新登入狀態，抓取成功後再寫回 KV。如果 BigModel 強制登出或要求重新驗證，重新跑 `npm run export:storage-state` 並更新 `BIGMODEL_STORAGE_STATE_GZ_B64` 即可。

如果 GitHub 自帶 `schedule` 沒有準時跑，可以部署 Cloudflare Worker Cron 觸發器，不需要 VM：

```powershell
npm run cloudflare:install
```

這會用 Cloudflare Cron 每小時呼叫 GitHub Actions 的 `workflow_dispatch`。GitHub 自帶 schedule 仍會保留作為備用。

## 後端端點

- `GET /api/usage`：目前所有 key 的快取用量
- `POST /api/refresh`：立即刷新所有 key
- `POST /api/query-key`：保留的 API key 即時查詢端點，不儲存完整 key
- `POST /api/query-web-session`：保留的官方登入 headers 查詢端點，不儲存 headers/Cookie
- `POST /api/query-official-payload`：匯入官方用量頁已成功返回的 JSON，保存為後端最新快照
- `GET /api/config`：公開設定，不包含完整 API key
- `GET /api/health`：健康檢查

## BigModel 端點

後端會查詢：

- `/api/monitor/usage/quota/limit`
- `/api/monitor/usage/model-usage`
- `/api/monitor/usage/tool-usage`

這些端點由 BigModel / Z.AI 官方用量查詢插件使用。若 BigModel 調整回應格式，前端仍會盡量顯示可解析的配額、總量與明細。
