import * as vscode from "vscode";
import * as path from "node:path";
import type { ApiClient } from "../services/ApiClient";
import type { ActivityTracker } from "../services/ActivityTracker";

export class ActivityDashboardProvider {
  private panel: vscode.WebviewPanel | null = null;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly apiClient: ApiClient,
    private readonly activityTracker: ActivityTracker
  ) {}

  async show(): Promise<void> {
    if (this.panel) {
      this.panel.reveal();
      await this.refreshData();
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      "ailancers.activityDashboard",
      "Ailancers Activity",
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      }
    );

    this.panel.onDidDispose(() => {
      this.panel = null;
    });

    this.panel.webview.onDidReceiveMessage(async (msg) => {
      switch (msg.type) {
        case "requestData":
          await this.refreshData();
          break;
        case "requestScreenshots":
          await this.loadScreenshots(msg.from, msg.to);
          break;
      }
    });

    this.panel.webview.html = this.getHtml();
    await this.refreshData();
  }

  private async refreshData(): Promise<void> {
    if (!this.panel) return;

    try {
      // Get current session local metrics
      const localMetrics = {
        activeSeconds: this.activityTracker.getTotalActiveSeconds(),
        aiRequests: this.activityTracker.getAiRequestCount(),
      };

      // Get summary from backend (last 30 days)
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const from = thirtyDaysAgo.toISOString();

      const [summary, daily, sessions] = await Promise.all([
        this.apiClient.get(`/api/activity/me/summary?from=${from}`).catch(() => ({ data: null })),
        this.apiClient.get(`/api/activity/me/daily?from=${from}&limit=30`).catch(() => ({ data: [] })),
        this.apiClient.get(`/api/activity/me/sessions?limit=10`).catch(() => ({ data: [] })),
      ]);

      this.panel.webview.postMessage({
        type: "dataLoaded",
        localMetrics,
        summary: (summary as { data: unknown }).data,
        daily: (daily as { data: unknown[] }).data,
        sessions: (sessions as { data: unknown[] }).data,
      });
    } catch (err) {
      this.panel.webview.postMessage({
        type: "error",
        error: err instanceof Error ? err.message : "Failed to load activity data",
      });
    }
  }

  private async loadScreenshots(from?: string, to?: string): Promise<void> {
    if (!this.panel) return;

    try {
      let url = "/api/telemetry/screenshots/me?limit=20";
      if (from) url += `&from=${from}`;
      if (to) url += `&to=${to}`;

      const result = await this.apiClient.get(url);
      this.panel.webview.postMessage({
        type: "screenshotsLoaded",
        data: (result as { data: unknown[] }).data,
      });
    } catch {
      // Non-critical
    }
  }

  private getHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body {
      margin: 0;
      padding: 16px;
      font-family: var(--vscode-font-family, system-ui);
      font-size: var(--vscode-font-size, 13px);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      line-height: 1.6;
    }

    h1 { font-size: 20px; font-weight: 600; margin: 0 0 16px 0; }
    h2 { font-size: 15px; font-weight: 600; margin: 20px 0 8px 0; color: var(--vscode-descriptionForeground); text-transform: uppercase; letter-spacing: 0.5px; }

    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 12px;
      margin-bottom: 20px;
    }

    .stat-card {
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-widget-border, transparent);
      border-radius: 8px;
      padding: 12px 16px;
    }

    .stat-value {
      font-size: 24px;
      font-weight: 700;
      color: var(--vscode-charts-blue, #4fc1ff);
    }

    .stat-value.green { color: var(--vscode-charts-green, #89d185); }
    .stat-value.yellow { color: var(--vscode-charts-yellow, #cca700); }
    .stat-value.purple { color: var(--vscode-charts-purple, #b180d7); }

    .stat-label {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      text-transform: uppercase;
      letter-spacing: 0.3px;
      margin-top: 4px;
    }

    .chart-container {
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-widget-border, transparent);
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 16px;
    }

    .bar-chart {
      display: flex;
      align-items: flex-end;
      gap: 4px;
      height: 120px;
      padding-top: 8px;
    }

    .bar-group {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      height: 100%;
      justify-content: flex-end;
    }

    .bar {
      width: 100%;
      max-width: 24px;
      background: var(--vscode-charts-blue, #4fc1ff);
      border-radius: 3px 3px 0 0;
      min-height: 2px;
      transition: height 0.3s ease;
    }

    .bar-label {
      font-size: 9px;
      color: var(--vscode-descriptionForeground);
      margin-top: 4px;
      text-align: center;
    }

    .sessions-list {
      list-style: none;
      padding: 0;
      margin: 0;
    }

    .session-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 8px 12px;
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-widget-border, transparent);
      border-radius: 6px;
      margin-bottom: 6px;
      font-size: 12px;
    }

    .session-date { font-weight: 500; }
    .session-meta { color: var(--vscode-descriptionForeground); display: flex; gap: 12px; }

    .screenshots-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
      gap: 8px;
    }

    .screenshot-thumb {
      border-radius: 6px;
      overflow: hidden;
      border: 1px solid var(--vscode-widget-border, transparent);
      cursor: pointer;
    }

    .screenshot-thumb img {
      width: 100%;
      display: block;
    }

    .screenshot-time {
      font-size: 10px;
      padding: 4px 8px;
      color: var(--vscode-descriptionForeground);
      background: var(--vscode-input-background);
    }

    .section { margin-bottom: 24px; }

    .refresh-btn {
      padding: 6px 14px;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
      margin-bottom: 16px;
    }

    .refresh-btn:hover { background: var(--vscode-button-hoverBackground); }

    .loading {
      text-align: center;
      padding: 32px;
      color: var(--vscode-descriptionForeground);
    }

    .tabs {
      display: flex;
      gap: 2px;
      border-bottom: 1px solid var(--vscode-widget-border, transparent);
      margin-bottom: 16px;
    }

    .tab {
      padding: 8px 16px;
      background: transparent;
      color: var(--vscode-descriptionForeground);
      border: none;
      border-bottom: 2px solid transparent;
      cursor: pointer;
      font-size: 12px;
      font-weight: 500;
    }

    .tab.active {
      color: var(--vscode-foreground);
      border-bottom-color: var(--vscode-focusBorder);
    }

    .tab:hover { color: var(--vscode-foreground); }
  </style>
</head>
<body>
  <h1>Activity Dashboard</h1>
  <button class="refresh-btn" onclick="requestData()">Refresh</button>

  <div class="tabs">
    <button class="tab active" onclick="showTab('overview', this)">Overview</button>
    <button class="tab" onclick="showTab('daily', this)">Daily</button>
    <button class="tab" onclick="showTab('sessions', this)">Sessions</button>
    <button class="tab" onclick="showTab('screenshots', this)">Screenshots</button>
  </div>

  <div id="tab-overview" class="section">
    <div class="loading" id="loading">Loading activity data...</div>
    <div id="stats-container" style="display:none;">
      <h2>Current Session</h2>
      <div class="stats-grid" id="local-stats"></div>
      <h2>Last 30 Days</h2>
      <div class="stats-grid" id="summary-stats"></div>
    </div>
  </div>

  <div id="tab-daily" class="section" style="display:none;">
    <h2>Daily Activity (Last 30 Days)</h2>
    <div class="chart-container">
      <div class="bar-chart" id="daily-chart"></div>
    </div>
  </div>

  <div id="tab-sessions" class="section" style="display:none;">
    <h2>Recent Sessions</h2>
    <ul class="sessions-list" id="sessions-list"></ul>
  </div>

  <div id="tab-screenshots" class="section" style="display:none;">
    <h2>Recent Screenshots</h2>
    <div class="screenshots-grid" id="screenshots-grid"></div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();

    function requestData() {
      vscode.postMessage({ type: 'requestData' });
      vscode.postMessage({ type: 'requestScreenshots' });
    }

    function showTab(name, btn) {
      document.querySelectorAll('.section').forEach(s => s.style.display = 'none');
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.getElementById('tab-' + name).style.display = '';
      btn.classList.add('active');

      if (name === 'screenshots') {
        vscode.postMessage({ type: 'requestScreenshots' });
      }
    }

    function formatTime(seconds) {
      if (!seconds) return '0m';
      const h = Math.floor(seconds / 3600);
      const m = Math.floor((seconds % 3600) / 60);
      if (h > 0) return h + 'h ' + m + 'm';
      return m + 'm';
    }

    function formatNumber(n) {
      if (!n) return '0';
      return n.toLocaleString();
    }

    function renderStats(localMetrics, summary) {
      document.getElementById('loading').style.display = 'none';
      document.getElementById('stats-container').style.display = '';

      document.getElementById('local-stats').innerHTML =
        statCard(formatTime(localMetrics.activeSeconds), 'Active Time', '') +
        statCard(formatNumber(localMetrics.aiRequests), 'AI Requests', 'purple');

      if (summary) {
        document.getElementById('summary-stats').innerHTML =
          statCard(formatTime(summary.totalActiveSeconds), 'Total Active', '') +
          statCard(formatTime(summary.totalIdleSeconds), 'Total Idle', 'yellow') +
          statCard(formatNumber(summary.totalKeystrokes), 'Keystrokes', 'green') +
          statCard(formatNumber(summary.totalFileSaves), 'File Saves', 'purple') +
          statCard(formatNumber(summary.totalSessions), 'Sessions', '');
      }
    }

    function statCard(value, label, colorClass) {
      return '<div class="stat-card"><div class="stat-value ' + colorClass + '">' + value + '</div><div class="stat-label">' + label + '</div></div>';
    }

    function renderDailyChart(daily) {
      const chart = document.getElementById('daily-chart');
      if (!daily || daily.length === 0) {
        chart.innerHTML = '<div style="width:100%;text-align:center;color:var(--vscode-descriptionForeground)">No data yet</div>';
        return;
      }

      const maxSeconds = Math.max(...daily.map(d => d.totalActiveSeconds), 1);

      chart.innerHTML = daily.map(d => {
        const heightPct = Math.max((d.totalActiveSeconds / maxSeconds) * 100, 2);
        const dateLabel = new Date(d.date).toLocaleDateString('en', { month: 'short', day: 'numeric' });
        return '<div class="bar-group"><div class="bar" style="height:' + heightPct + '%" title="' + formatTime(d.totalActiveSeconds) + '"></div><div class="bar-label">' + dateLabel + '</div></div>';
      }).join('');
    }

    function renderSessions(sessions) {
      const list = document.getElementById('sessions-list');
      if (!sessions || sessions.length === 0) {
        list.innerHTML = '<li class="session-item">No sessions recorded yet</li>';
        return;
      }

      list.innerHTML = sessions.map(s => {
        const started = new Date(s.startedAt).toLocaleString();
        const duration = formatTime(s.activeSeconds + s.idleSeconds);
        return '<li class="session-item"><span class="session-date">' + started + '</span><span class="session-meta"><span>' + formatTime(s.activeSeconds) + ' active</span><span>' + formatNumber(s.totalKeystrokes) + ' keys</span><span>' + formatNumber(s.totalFileSaves) + ' saves</span></span></li>';
      }).join('');
    }

    function renderScreenshots(data) {
      const grid = document.getElementById('screenshots-grid');
      if (!data || data.length === 0) {
        grid.innerHTML = '<div style="color:var(--vscode-descriptionForeground)">No screenshots captured yet</div>';
        return;
      }

      grid.innerHTML = data.map(s => {
        const time = new Date(s.capturedAt).toLocaleString();
        return '<div class="screenshot-thumb"><div class="screenshot-time">' + time + '</div><div style="padding:8px;font-size:11px;color:var(--vscode-descriptionForeground)">' + s.filename + ' (' + Math.round(s.fileSizeBytes / 1024) + ' KB)</div></div>';
      }).join('');
    }

    window.addEventListener('message', event => {
      const msg = event.data;
      switch (msg.type) {
        case 'dataLoaded':
          renderStats(msg.localMetrics, msg.summary);
          renderDailyChart(msg.daily);
          renderSessions(msg.sessions);
          break;
        case 'screenshotsLoaded':
          renderScreenshots(msg.data);
          break;
        case 'error':
          document.getElementById('loading').textContent = 'Error: ' + msg.error;
          break;
      }
    });

    // Initial load
    requestData();
  </script>
</body>
</html>`;
  }
}
