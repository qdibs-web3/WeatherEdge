import "dotenv/config";

export const ENV = {
  // ─── App ──────────────────────────────────────────────────────────────────
  appId:        process.env.VITE_APP_ID     ?? "predictive-apex",
  appTitle:     process.env.VITE_APP_TITLE  ?? "Predictive Apex",
  ownerName:    process.env.OWNER_NAME      ?? "Admin",
  isProduction: process.env.NODE_ENV        === "production",
  port:         parseInt(process.env.PORT   ?? "5000"),

  // ─── Auth ─────────────────────────────────────────────────────────────────
  jwtSecret:    process.env.JWT_SECRET      ?? "change-me-in-production",

  // ─── Database ─────────────────────────────────────────────────────────────
  databaseUrl:  process.env.DATABASE_URL    ?? process.env.databaseUrl ?? "",

  // ─── Kalshi ───────────────────────────────────────────────────────────────
  // Key ID from Kalshi API key management page
  kalshiApiKeyId:     process.env.KALSHI_API_KEY_ID     ?? process.env.KALSHI_API_KEY ?? "",
  // Full RSA private key PEM string (newlines as \n in .env)
  kalshiPrivateKeyPem: process.env.KALSHI_PRIVATE_KEY_PEM ?? "",
  // API base URL — production endpoint
  kalshiApiUrl:       process.env.KALSHI_API_URL ?? "https://api.elections.kalshi.com/trade-api/v2",

  // ─── NWS ──────────────────────────────────────────────────────────────────
  // NWS requires a User-Agent string with app name and contact email
  nwsUserAgent: process.env.NWS_USER_AGENT ?? "(PredictiveApex, admin@example.com)",

  // ─── Email (optional) ─────────────────────────────────────────────────────
  resendApiKey: process.env.RESEND_API_KEY ?? "",
  fromEmail:    process.env.FROM_EMAIL     ?? "noreply@predictiveapex.com",
};
