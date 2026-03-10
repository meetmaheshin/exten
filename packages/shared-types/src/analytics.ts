export interface OverviewStats {
  totalDevelopers: number;
  activeDevelopers: number;
  totalRequests: number;
  totalCostUsd: number;
  totalActiveHours: number;
  period: { from: string; to: string };
}

export interface DeveloperUsageSummary {
  userId: string;
  fullName: string;
  email: string;
  team: string | null;
  totalRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  totalActiveHours: number;
  totalIdleHours: number;
  lastActiveAt: string | null;
}

export interface DailyUsage {
  date: string;
  totalRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  modelBreakdown: Record<
    string,
    { requests: number; inputTokens: number; outputTokens: number; costUsd: number }
  >;
}

export interface DailyActivity {
  date: string;
  activeSeconds: number;
  idleSeconds: number;
  totalKeystrokes: number;
  totalFileSaves: number;
  languagesUsed: Record<string, number>;
}

export interface CostForecast {
  currentMonthSpend: number;
  currentMonthBudget: number | null;
  projectedMonthEnd: number;
  dailyAverage: number;
  daysRemaining: number;
}
