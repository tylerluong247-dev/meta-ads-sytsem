/** Lazy env access so tests and the demo mode work without any configuration. */
export const env = {
  get supabaseUrl() { return process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""; },
  get supabaseAnonKey() { return process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ""; },
  get supabaseServiceKey() { return process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""; },
  get appUrl() { return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"; },
  get cronSecret() { return process.env.CRON_SECRET ?? ""; },
  get tokenKey() { return process.env.TOKEN_ENCRYPTION_KEY ?? ""; },
  get metaAppId() { return process.env.META_APP_ID ?? ""; },
  get metaAppSecret() { return process.env.META_APP_SECRET ?? ""; },
  get metaVerifyToken() { return process.env.META_WEBHOOK_VERIFY_TOKEN ?? ""; },
  get metaVersion() { return process.env.META_GRAPH_VERSION ?? "v21.0"; },
  get resendKey() { return process.env.RESEND_API_KEY ?? ""; },
  get calSecret() { return process.env.CAL_WEBHOOK_SECRET ?? ""; },
  get anthropicKey() { return process.env.ANTHROPIC_API_KEY ?? ""; },
  /** Demo mode: no Supabase configured. Uses a seeded in-memory store and a built-in demo user. */
  get isDemo() { return !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY; },
};
