import fs from 'node:fs';
import path from 'node:path';
import { fetchUsageSnapshot } from './bigmodelClient.js';
import { toPublicConfig } from './config.js';

export class UsageMonitor {
  constructor(config) {
    this.config = config;
    this.snapshots = [];
    this.isRefreshing = false;
    this.lastRefreshAt = null;
    this.lastRefreshReason = null;
    this.lastError = null;
    this.publicConfigOverride = null;
    this.nextFiveHourRefreshAt = nextIso(config.fiveHourRefreshMs);
    this.nextWeeklyRefreshAt = nextIso(config.weeklyRefreshMs);
    this.timers = [];
    this.stateFile = config.stateFile ? path.resolve(config.stateFile) : '';
    this.loadPersistedState();
  }

  start() {
    if (this.config.accounts.length > 0) {
      this.refreshAll('startup').catch((error) => {
        this.lastError = error.message;
      });
    }

    this.timers.push(
      setInterval(() => {
        this.nextFiveHourRefreshAt = nextIso(this.config.fiveHourRefreshMs);
        this.refreshAll('5-hour').catch((error) => {
          this.lastError = error.message;
        });
      }, this.config.fiveHourRefreshMs)
    );

    this.timers.push(
      setInterval(() => {
        this.nextWeeklyRefreshAt = nextIso(this.config.weeklyRefreshMs);
        this.refreshAll('weekly').catch((error) => {
          this.lastError = error.message;
        });
      }, this.config.weeklyRefreshMs)
    );
  }

  async refreshAll(reason = 'manual') {
    if (this.isRefreshing) return this.getState();
    if (this.config.accounts.length === 0) return this.getState();

    this.isRefreshing = true;
    this.lastError = null;

    try {
      this.snapshots = await Promise.all(
        this.config.accounts.map((account) =>
          fetchUsageSnapshot(account, {
            requestTimeoutMs: this.config.requestTimeoutMs
          })
        )
      );

      this.lastRefreshAt = new Date().toISOString();
      this.lastRefreshReason = reason;
      this.publicConfigOverride = null;
      this.persistState();
      return this.getState();
    } catch (error) {
      this.lastError = error.message;
      throw error;
    } finally {
      this.isRefreshing = false;
    }
  }

  replaceSnapshots(snapshots, reason = 'external-import', publicConfigOverride = {}) {
    const now = new Date();
    this.snapshots = Array.isArray(snapshots) ? snapshots : [];
    this.lastRefreshAt = now.toISOString();
    this.lastRefreshReason = reason;
    this.lastError = null;
    this.nextFiveHourRefreshAt = new Date(now.getTime() + this.config.fiveHourRefreshMs).toISOString();
    this.nextWeeklyRefreshAt = new Date(now.getTime() + this.config.weeklyRefreshMs).toISOString();
    this.publicConfigOverride = publicConfigOverride;
    this.persistState();
    return this.getState();
  }

  getState() {
    return {
      config: {
        ...toPublicConfig(this.config),
        ...(this.publicConfigOverride || {})
      },
      snapshots: this.snapshots,
      isRefreshing: this.isRefreshing,
      lastRefreshAt: this.lastRefreshAt,
      lastRefreshReason: this.lastRefreshReason,
      nextFiveHourRefreshAt: this.nextFiveHourRefreshAt,
      nextWeeklyRefreshAt: this.nextWeeklyRefreshAt,
      lastError: this.lastError
    };
  }

  stop() {
    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];
  }

  loadPersistedState() {
    if (!this.stateFile || !fs.existsSync(this.stateFile)) return;

    try {
      const parsed = JSON.parse(fs.readFileSync(this.stateFile, 'utf8'));
      if (Array.isArray(parsed.snapshots)) this.snapshots = parsed.snapshots;
      if (parsed.lastRefreshAt) this.lastRefreshAt = parsed.lastRefreshAt;
      if (parsed.lastRefreshReason) this.lastRefreshReason = parsed.lastRefreshReason;
      if (parsed.nextFiveHourRefreshAt) this.nextFiveHourRefreshAt = parsed.nextFiveHourRefreshAt;
      if (parsed.nextWeeklyRefreshAt) this.nextWeeklyRefreshAt = parsed.nextWeeklyRefreshAt;
      if (parsed.publicConfigOverride && typeof parsed.publicConfigOverride === 'object') {
        this.publicConfigOverride = parsed.publicConfigOverride;
      }
    } catch (error) {
      this.lastError = `Could not load persisted usage state: ${error.message}`;
    }
  }

  persistState() {
    if (!this.stateFile) return;

    const state = {
      snapshots: this.snapshots,
      lastRefreshAt: this.lastRefreshAt,
      lastRefreshReason: this.lastRefreshReason,
      nextFiveHourRefreshAt: this.nextFiveHourRefreshAt,
      nextWeeklyRefreshAt: this.nextWeeklyRefreshAt,
      publicConfigOverride: this.publicConfigOverride
    };

    fs.mkdirSync(path.dirname(this.stateFile), { recursive: true });
    fs.writeFileSync(this.stateFile, JSON.stringify(state, null, 2), 'utf8');
  }
}

function nextIso(ms) {
  return new Date(Date.now() + ms).toISOString();
}
