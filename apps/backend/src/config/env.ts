import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default("0.0.0.0"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  LOG_LEVEL: z.string().default("info"),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().default("redis://localhost:6379"),

  JWT_SECRET: z.string().min(32),
  JWT_ACCESS_EXPIRY: z.string().default("15m"),
  JWT_REFRESH_EXPIRY: z.string().default("30d"),

  ANTHROPIC_API_KEY: z.string().default(""),
  ANTHROPIC_DEFAULT_MODEL: z.string().default("claude-sonnet-4-6"),
  ANTHROPIC_MAX_TOKENS: z.coerce.number().default(16384),

  // OpenAI (optional — leave empty to disable)
  OPENAI_API_KEY: z.string().default(""),
  OPENAI_DEFAULT_MODEL: z.string().default("gpt-4o"),
  OPENAI_CODING_MODEL: z.string().default("gpt-4.1"),  // Used for agent/coding mode — gpt-4.1 is OpenAI's best coding model
  OPENAI_MAX_TOKENS: z.coerce.number().default(16384),

  // Agent mode settings
  AGENT_MAX_TOKENS: z.coerce.number().default(16384),
  AGENT_MAX_TURNS: z.coerce.number().default(50),

  RATE_LIMIT_CHAT_PER_MINUTE: z.coerce.number().default(30),
  RATE_LIMIT_TELEMETRY_PER_MINUTE: z.coerce.number().default(10),

  DEFAULT_MONTHLY_BUDGET_USD: z.coerce.number().default(50),

  CORS_ORIGINS: z.string().default("http://localhost:3001"),

  SCREENSHOT_STORAGE_DIR: z.string().default("/app/data/screenshots"),
  SCREENSHOT_MAX_SIZE_MB: z.coerce.number().default(5),

  // AI Billing — report token usage to ailancers-chat-ui
  AILANCERS_BILLING_API_URL: z.string().default(""),
  AILANCERS_BILLING_HMAC_SECRET: z.string().default(""),
  AILANCERS_BILLING_REPORT_INTERVAL_MS: z.coerce.number().default(180000), // 3 minutes

  // Central wallet user — when set, all `/ai-billing/usage` and
  // `/ai-billing/status` calls pool to this user id regardless of who is
  // chatting. The sub_project_id we send still reflects the user's real
  // active sub-project (so platform reports keep per-project visibility),
  // but every wallet deduction lands on this single account. Empty string
  // = no pooling (per-user wallets, original behaviour). Per-user
  // attribution is preserved in our `messages` table on this side; the
  // platform just sees the central account.
  AILANCERS_BILLING_CENTRAL_LANCER_USER_ID: z.string().default(""),

  // Figma — for the figma_read agent tool. One team-shared Personal Access Token,
  // generated at https://www.figma.com/settings → Personal access tokens with the
  // "File content" + "File metadata" scopes. If empty, the figma_read tool returns
  // an actionable error message to the agent.
  FIGMA_TOKEN: z.string().default(""),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error("Invalid environment variables:", result.error.flatten().fieldErrors);
    process.exit(1);
  }
  return result.data;
}
