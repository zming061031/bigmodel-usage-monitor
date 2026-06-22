import { AlertCircle, KeyRound, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

const ONE_HOUR_MS = 60 * 60 * 1000;
const EMPTY_STATE = {
  config: {
    clientPollMs: ONE_HOUR_MS,
    accountCount: 0
  },
  snapshots: [],
  isRefreshing: false,
  lastRefreshAt: null,
  lastRefreshReason: null,
  nextFiveHourRefreshAt: null,
  nextWeeklyRefreshAt: null,
  lastError: null
};
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
const STATIC_USAGE_URL =
  import.meta.env.VITE_STATIC_USAGE_URL ||
  (import.meta.env.PROD && !API_BASE_URL ? './usage-state.json' : '');

export default function App() {
  const [state, setState] = useState(EMPTY_STATE);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadUsage = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);

    try {
      const response = await fetch(usageUrl(), { cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      setState(payload);
      setError(null);
    } catch (loadError) {
      setError(
        loadError.message === 'Failed to fetch'
          ? '無法連線到雲端後端。請確認網站服務正在執行。'
          : loadError.message
      );
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadUsage();
  }, [loadUsage]);

  const pollMs = Number(state?.config?.clientPollMs) || ONE_HOUR_MS;
  useEffect(() => {
    const timer = setInterval(() => {
      loadUsage({ silent: true });
    }, pollMs);
    return () => clearInterval(timer);
  }, [loadUsage, pollMs]);

  useEffect(() => {
    function handleImportedState(event) {
      if (event.detail?.snapshots) {
        setState(event.detail);
        setError(null);
      }
    }

    window.addEventListener('bigmodel-usage-state', handleImportedState);
    return () => window.removeEventListener('bigmodel-usage-state', handleImportedState);
  }, []);

  const snapshots = state?.snapshots || [];
  const primarySnapshot = snapshots[0] || null;
  const quotaCards = useMemo(
    () => buildQuotaCards(sortLimits(primarySnapshot?.quota?.limits || [])),
    [primarySnapshot]
  );

  return (
    <main className="app-shell dashboard-only">
      <header className="topbar">
        <div>
          <p className="eyebrow">Coding Plan</p>
          <h1>BigModel 用量監控</h1>
          <p className="refresh-line">
            狀態：{primarySnapshot ? statusLabel(primarySnapshot.status) : '等待官方頁資料'} · 上次刷新：
            {formatDateTime(state?.lastRefreshAt) || '尚未刷新'} · 網站每 {formatInterval(pollMs)} 自動刷新
          </p>
        </div>
        <button className="icon-button" onClick={() => loadUsage()} disabled={loading} type="button">
          <RefreshCw className={loading ? 'spin' : ''} aria-hidden="true" />
          <span>重新整理</span>
        </button>
      </header>

      {error && (
        <section className="notice error">
          <AlertCircle aria-hidden="true" />
          <span>{error}</span>
        </section>
      )}

      {primarySnapshot?.endpointErrors?.length > 0 && (
        <section className="endpoint-errors">
          {primarySnapshot.endpointErrors.map((item) => (
            <span key={item.endpoint}>
              {item.endpoint}: {item.message}
            </span>
          ))}
        </section>
      )}

      {primarySnapshot ? (
        <section className="quota-card-grid direct-quota-grid" aria-label="quota usage">
          {quotaCards.map((card) => (
            <QuotaCard key={card.key} card={card} />
          ))}
        </section>
      ) : (
        <section className="empty-state">
          <KeyRound aria-hidden="true" />
          <h2>等待官方頁自動刷新</h2>
          <p>雲端排程匯入 BigModel 官方用量後，這裡會直接顯示 5 小時、每週與 MCP 額度。</p>
        </section>
      )}
    </main>
  );
}

function usageUrl() {
  if (API_BASE_URL) return apiUrl('/api/usage');
  return STATIC_USAGE_URL || '/api/usage';
}

function apiUrl(path) {
  return `${API_BASE_URL}${path}`;
}

function QuotaCard({ card }) {
  const percentage = card.limit?.percentage;
  const boundedPercentage = clamp(percentage ?? 0, 0, 100);
  const tone = boundedPercentage >= 90 ? 'danger' : boundedPercentage >= 70 ? 'warning' : 'good';

  return (
    <div className="quota-card">
      <div className="quota-card-title">
        <span>{card.title}</span>
        <span className="info-dot">i</span>
      </div>
      <div className="quota-card-main">
        {percentage == null ? (
          <strong>--</strong>
        ) : (
          <>
            <strong>{boundedPercentage.toFixed(0)}</strong>
            <span>% 已使用</span>
          </>
        )}
        {card.limit && (card.limit.current != null || card.limit.total != null) && (
          <em>{formatUsagePair(card.limit.current, card.limit.total, card.unit)}</em>
        )}
      </div>
      <div className="progress-track" aria-hidden="true">
        <div className={`progress-fill ${tone}`} style={{ width: `${boundedPercentage}%` }} />
      </div>
      <p className="quota-card-reset">
        重置時間：{card.limit?.resetAt ? formatDateTime(card.limit.resetAt) : '未返回'}
      </p>
    </div>
  );
}

function sortLimits(limits) {
  return [...limits].sort((a, b) => limitOrder(a) - limitOrder(b));
}

function limitOrder(limit) {
  const text = `${limit.label || ''} ${limit.type || ''}`.toUpperCase();
  if (text.includes('5') || text.includes('TOKEN')) return 1;
  if (text.includes('WEEK') || text.includes('周')) return 2;
  if (text.includes('MCP') || text.includes('TIME_LIMIT') || text.includes('TOOL')) return 3;
  return 9;
}

function buildQuotaCards(limits) {
  const fiveHour = findQuota(limits, 'five-hour');
  const weekly = findQuota(limits, 'weekly');
  const mcp = findQuota(limits, 'mcp');

  return [
    {
      key: 'five-hour',
      title: '每5小時使用額度',
      unit: '',
      limit: fiveHour
    },
    {
      key: 'weekly',
      title: '每周使用額度',
      unit: '',
      limit: weekly
    },
    {
      key: 'mcp-monthly',
      title: 'MCP 每月額度',
      unit: '次',
      limit: mcp
    }
  ];
}

function findQuota(limits, kind) {
  if (kind === 'five-hour') {
    return limits.find((limit) => {
      const text = `${limit.label || ''} ${limit.type || ''}`.toUpperCase();
      return !text.includes('WEEK') && !text.includes('周') && (text.includes('5') || text.includes('TOKEN'));
    });
  }

  if (kind === 'weekly') {
    return limits.find((limit) => {
      const text = `${limit.label || ''} ${limit.type || ''}`.toUpperCase();
      return text.includes('WEEK') || text.includes('周');
    });
  }

  return limits.find((limit) => {
    const text = `${limit.label || ''} ${limit.type || ''}`.toUpperCase();
    return text.includes('MCP') || text.includes('TIME_LIMIT') || text.includes('TOOL');
  });
}

function formatDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-TW', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}

function formatInterval(ms) {
  const minutes = Math.round(ms / 60_000);
  if (minutes >= 60 && minutes % 60 === 0) return `${minutes / 60} 小時`;
  return `${minutes} 分鐘`;
}

function formatUsagePair(current, total, unit) {
  if (current == null && total == null) return '';
  const suffix = unit ? ` ${unit}` : '';
  if (current != null && total != null) {
    return `${formatNumber(current)} / ${formatNumber(total)}${suffix}`;
  }
  return `${formatNumber(current ?? total)}${suffix}`;
}

function formatNumber(value) {
  if (value == null || value === '') return '';
  if (typeof value !== 'number') return String(value);
  return new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 2 }).format(value);
}

function statusLabel(status) {
  const labels = {
    ok: '正常',
    partial: '部分成功',
    error: '失敗'
  };
  return labels[status] || status || '未知';
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
