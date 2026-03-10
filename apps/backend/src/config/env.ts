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
  ANTHROPIC_MAX_TOKENS: z.coerce.number().default(4096),

  // OpenAI (optional — leave empty to disable)
  OPENAI_API_KEY: z.string().default(""),
  OPENAI_DEFAULT_MODEL: z.string().default("gpt-4o"),
  OPENAI_MAX_TOKENS: z.coerce.number().default(4096),

  // Agent mode settings
  AGENT_MAX_TOKENS: z.coerce.number().default(16384),
  AGENT_MAX_TURNS: z.coerce.number().default(50),

  RATE_LIMIT_CHAT_PER_MINUTE: z.coerce.number().default(30),
  RATE_LIMIT_TELEMETRY_PER_MINUTE: z.coerce.number().default(10),

  DEFAULT_MONTHLY_BUDGET_USD: z.coerce.number().default(50),

  CORS_ORIGINS: z.string().default("http://localhost:3001"),

  SCREENSHOT_STORAGE_DIR: z.string().default("./data/screenshots"),
  SCREENSHOT_MAX_SIZE_MB: z.coerce.number().default(5),
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
