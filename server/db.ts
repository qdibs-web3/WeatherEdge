/**
 * db.ts — All database operations use raw SQL via mysql2 pool.
 * Drizzle ORM is intentionally NOT used here because it silently fails
 * on TiDB Cloud connections when using a pool. Raw SQL is faster anyway.
 */
import mysql from "mysql2/promise";
import { nanoid } from "nanoid";

/**
 * Create a fresh connection per query to avoid exhausting TiDB Cloud free-tier
 * connection limits (max 5). Connections are opened and immediately closed after
 * each query, so no idle connections are held.
 */
async function getConn(): Promise<mysql.Connection> {
  return mysql.createConnection({
    uri: process.env.DATABASE_URL!,
    ssl: { rejectUnauthorized: false },
    connectTimeout: 10000,
    timezone: "Z",
  });
}

async function q(sql: string, params: any[] = []): Promise<any[]> {
  const conn = await getConn();
  try {
    const [rows] = await conn.execute(sql, params);
    return rows as any[];
  } finally {
    await conn.end();
  }
}

async function exec(sql: string, params: any[] = []): Promise<mysql.ResultSetHeader> {
  const conn = await getConn();
  try {
    const [result] = await conn.execute(sql, params);
    return result as mysql.ResultSetHeader;
  } finally {
    await conn.end();
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────
export type User = {
  id: number;
  email: string;
  name: string | null;
  role: string;
  passwordHash: string | null;
  avatarUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type BotConfig = {
  id: number;
  userId: number;
  kalshiApiKey: string | null;
  kalshiApiKeyId: string | null;
  isActive: boolean;
  dryRun: boolean;
  flatBetDollars: number;
  minEvCents: number;
  maxPriceCents: number;
  minLiquidity: number;
  enabledCities: string[];
  maxDailyTrades: number;
  maxDailyLoss: number;
  createdAt: Date;
  updatedAt: Date;
};

export type BotStatus = {
  id: number;
  userId: number;
  status: string;
  lastScanAt: Date | null;
  signalsFound: number;
  errorMessage: string | null;
  updatedAt: Date;
};

export type Trade = {
  id: number;
  userId: number;
  marketTicker: string | null;
  cityCode: string | null;
  cityName: string | null;
  side: string | null;
  contracts: number;
  priceCents: number;
  costBasis: string | null;
  status: string;
  won: boolean | null;
  pnl: string | null;
  feeCents: number | null;
  kalshiOrderId: string | null;
  settledAt: Date | null;
  createdAt: Date;
};

export type NewTrade = Omit<Trade, "id" | "createdAt" | "costBasis"> & { costBasis?: string };

export type BotLog = {
  id: number;
  userId: number;
  level: string;
  message: string;
  context: any;
  createdAt: Date;
};

// ─── Users ────────────────────────────────────────────────────────────────────
function mapUser(row: any): User | null {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    name: row.name ?? null,
    role: row.role ?? "user",
    passwordHash: row.passwordHash ?? row.password_hash ?? null,
    avatarUrl: row.avatarUrl ?? row.avatar_url ?? null,
    createdAt: row.createdAt ?? row.created_at,
    updatedAt: row.updatedAt ?? row.updated_at,
  };
}

export async function getUserById(id: number): Promise<User | null> {
  const rows = await q("SELECT * FROM users WHERE id = ? LIMIT 1", [id]);
  return mapUser(rows[0]);
}

export async function getUserByEmail(email: string): Promise<User | null> {
  const rows = await q("SELECT * FROM users WHERE email = ? LIMIT 1", [email]);
  return mapUser(rows[0]);
}

export async function createUser(data: { email: string; name?: string; passwordHash?: string }): Promise<User | null> {
  const result = await exec(
    "INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?)",
    [data.email, data.name ?? null, data.passwordHash ?? null]
  );
  const id = result.insertId;
  await exec("INSERT INTO bot_config_v2 (user_id) VALUES (?) ON DUPLICATE KEY UPDATE user_id=user_id", [id]);
  await exec("INSERT INTO bot_status_v2 (user_id, status) VALUES (?, 'stopped') ON DUPLICATE KEY UPDATE user_id=user_id", [id]);
  return getUserById(id);
}

export async function updateUser(id: number, data: Partial<User> & { lastLoginAt?: Date }): Promise<User | null> {
  const parts: string[] = [];
  const vals: any[] = [];
  if (data.name !== undefined) { parts.push("name = ?"); vals.push(data.name); }
  if (data.avatarUrl !== undefined) { parts.push("avatar_url = ?"); vals.push(data.avatarUrl); }
  if (data.passwordHash !== undefined) { parts.push("password_hash = ?"); vals.push(data.passwordHash); }
  if ((data as any).lastLoginAt !== undefined) { parts.push("last_login_at = ?"); vals.push((data as any).lastLoginAt); }
  if (parts.length === 0) return getUserById(id);
  vals.push(id);
  await exec(`UPDATE users SET ${parts.join(", ")} WHERE id = ?`, vals);
  return getUserById(id);
}

// ─── Auth ─────────────────────────────────────────────────────────────────────
export async function createMagicLink(email: string): Promise<string> {
  const token = nanoid(48);
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
  await exec("INSERT INTO magic_links_v2 (email, token, expires_at) VALUES (?, ?, ?)", [email, token, expiresAt]);
  return token;
}

export async function verifyMagicLink(token: string): Promise<string | null> {
  const rows = await q("SELECT * FROM magic_links_v2 WHERE token = ? LIMIT 1", [token]);
  const link = rows[0];
  if (!link || link.used_at || new Date(link.expires_at) < new Date()) return null;
  await exec("UPDATE magic_links_v2 SET used_at = NOW() WHERE token = ?", [token]);
  return link.email;
}

export async function createSession(userId: number): Promise<{ id: string; expiresAt: Date }> {
  const id = nanoid(48);
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  await exec("INSERT INTO sessions_v2 (id, user_id, expires_at) VALUES (?, ?, ?)", [id, userId, expiresAt]);
  return { id, expiresAt };
}

export async function getSession(id: string): Promise<any | null> {
  const rows = await q("SELECT * FROM sessions_v2 WHERE id = ? LIMIT 1", [id]);
  const session = rows[0];
  if (!session) return null;
  if (new Date(session.expires_at) < new Date()) {
    await exec("DELETE FROM sessions_v2 WHERE id = ?", [id]);
    return null;
  }
  return session;
}

export async function deleteSession(id: string): Promise<void> {
  await exec("DELETE FROM sessions_v2 WHERE id = ?", [id]);
}

// ─── Bot Config ───────────────────────────────────────────────────────────────
function mapBotConfig(row: any): BotConfig | null {
  if (!row) return null;
  let cities: string[] = [];
  // TiDB returns JSON columns as already-parsed JS values; handle both string and array
  if (Array.isArray(row.enabled_cities)) {
    cities = row.enabled_cities;
  } else if (typeof row.enabled_cities === 'string' && row.enabled_cities) {
    try { cities = JSON.parse(row.enabled_cities); } catch {}
  }
  return {
    id: row.id,
    userId: row.user_id,
    kalshiApiKey: row.kalshi_api_key ?? null,
    kalshiApiKeyId: row.kalshi_api_key_id ?? null,
    isActive: Boolean(row.is_active),
    dryRun: Boolean(row.dry_run),
    flatBetDollars: Number(row.flat_bet_dollars ?? 20),
    minEvCents: Number(row.min_ev_cents ?? 3),
    maxPriceCents: Number(row.max_price_cents ?? 70),
    minLiquidity: Number(row.min_liquidity ?? 100),
    enabledCities: cities,
    maxDailyTrades: Number(row.max_daily_trades ?? 50),
    maxDailyLoss: Number(row.max_daily_loss ?? 200),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getBotConfig(userId: number): Promise<BotConfig | null> {
  const rows = await q("SELECT * FROM bot_config_v2 WHERE user_id = ? LIMIT 1", [userId]);
  return mapBotConfig(rows[0]);
}

export async function upsertBotConfig(userId: number, data: Partial<BotConfig>): Promise<BotConfig | null> {
  const colMap: Record<string, string> = {
    flatBetDollars: "flat_bet_dollars",
    minEvCents: "min_ev_cents",
    maxPriceCents: "max_price_cents",
    dryRun: "dry_run",
    enabledCities: "enabled_cities",
    maxDailyTrades: "max_daily_trades",
    maxDailyLoss: "max_daily_loss",
    isActive: "is_active",
    kalshiApiKey: "kalshi_api_key",
    kalshiApiKeyId: "kalshi_api_key_id",
  };

  const fields: string[] = [];
  const values: any[] = [userId];
  const updateParts: string[] = [];

  for (const [key, col] of Object.entries(colMap)) {
    if (key in data) {
      const val = (data as any)[key];
      const serialized = key === "enabledCities" && Array.isArray(val) ? JSON.stringify(val) : val;
      fields.push(col);
      values.push(serialized);
      updateParts.push(`${col} = VALUES(${col})`);
    }
  }

  if (fields.length === 0) return getBotConfig(userId);

  const colList = ["user_id", ...fields].join(", ");
  const placeholders = values.map(() => "?").join(", ");
  const onDup = updateParts.join(", ");

  await exec(
    `INSERT INTO bot_config_v2 (${colList}) VALUES (${placeholders}) ON DUPLICATE KEY UPDATE ${onDup}`,
    values
  );
  return getBotConfig(userId);
}

export async function getAllActiveBotConfigs(): Promise<BotConfig[]> {
  const rows = await q("SELECT * FROM bot_config_v2 WHERE is_active = 1");
  return rows.map(mapBotConfig).filter(Boolean) as BotConfig[];
}

// ─── Bot Status ───────────────────────────────────────────────────────────────
function mapBotStatus(row: any): BotStatus | null {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    status: row.status ?? "stopped",
    lastScanAt: row.last_scan_at ?? null,
    signalsFound: Number(row.signals_found ?? 0),
    errorMessage: row.error_message ?? null,
    updatedAt: row.updated_at,
  };
}

export async function getBotStatus(userId: number): Promise<BotStatus | null> {
  const rows = await q("SELECT * FROM bot_status_v2 WHERE user_id = ? LIMIT 1", [userId]);
  return mapBotStatus(rows[0]);
}

export async function upsertBotStatus(data: {
  userId: number;
  status?: string;
  lastScanAt?: Date;
  signalsFound?: number;
  errorMessage?: string | null;
}): Promise<void> {
  const fields: string[] = ["user_id"];
  const values: any[] = [data.userId];
  const updateParts: string[] = ["updated_at = NOW()"];

  if (data.status !== undefined) { fields.push("status"); values.push(data.status); updateParts.push("status = VALUES(status)"); }
  if (data.lastScanAt !== undefined) { fields.push("last_scan_at"); values.push(data.lastScanAt); updateParts.push("last_scan_at = VALUES(last_scan_at)"); }
  if (data.signalsFound !== undefined) { fields.push("signals_found"); values.push(data.signalsFound); updateParts.push("signals_found = VALUES(signals_found)"); }
  if ("errorMessage" in data) { fields.push("error_message"); values.push(data.errorMessage); updateParts.push("error_message = VALUES(error_message)"); }

  const colList = fields.join(", ");
  const placeholders = values.map(() => "?").join(", ");
  const onDup = updateParts.join(", ");

  await exec(
    `INSERT INTO bot_status_v2 (${colList}) VALUES (${placeholders}) ON DUPLICATE KEY UPDATE ${onDup}`,
    values
  );
}

// ─── Trades ───────────────────────────────────────────────────────────────────
function mapTrade(row: any): Trade {
  return {
    id: row.id,
    userId: row.user_id,
    marketTicker: row.market_ticker ?? row.ticker ?? null,
    cityCode: row.city_code ?? null,
    cityName: row.city_name ?? null,
    side: row.side ?? null,
    contracts: Number(row.contracts ?? 0),
    priceCents: Number(row.price_cents ?? 0),
    costBasis: row.cost_basis ?? null,
    status: row.status ?? "pending",
    won: row.won == null ? null : Boolean(row.won),
    pnl: row.pnl ?? null,
    feeCents: null,
    kalshiOrderId: row.order_id ?? null,
    settledAt: row.settled_at ?? null,
    createdAt: row.created_at,
  };
}

/** Map Kalshi API status strings to the DB enum values */
function normalizeTradeStatus(status: string | null | undefined): string {
  switch ((status ?? "").toLowerCase()) {
    case "filled":
    case "executed":
    case "resting":  // partially filled / resting on book → treat as filled
      return "filled";
    case "cancelled":
    case "canceled":
      return "cancelled";
    case "settled":
      return "settled";
    default:
      return "pending";
  }
}

export async function insertTrade(data: NewTrade): Promise<number> {
  const costBasis = String((data.priceCents / 100) * data.contracts);
  const status = normalizeTradeStatus(data.status);
  const result = await exec(
    `INSERT INTO trades_v2 (user_id, order_id, market_ticker, city_code, city_name, side, contracts, price_cents, cost_basis, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [data.userId, data.kalshiOrderId ?? null, data.marketTicker, data.cityCode, data.cityName, data.side, data.contracts, data.priceCents, costBasis, status]
  );
  return result.insertId;
}

export async function getTradesByUser(userId: number, limit = 50, offset = 0): Promise<Trade[]> {
  const safeLimit = Math.max(1, Math.min(500, Number(limit) || 50));
  const safeOffset = Math.max(0, Number(offset) || 0);
  const rows = await q(
    `SELECT * FROM trades_v2 WHERE user_id = ? ORDER BY created_at DESC LIMIT ${safeLimit} OFFSET ${safeOffset}`,
    [userId]
  );
  return rows.map(mapTrade);
}

export async function getTradeCount(userId: number): Promise<number> {
  const rows = await q("SELECT COUNT(*) as cnt FROM trades_v2 WHERE user_id = ?", [userId]);
  return Number(rows[0]?.cnt ?? 0);
}

export async function getTradeStats(userId: number) {
  const rows = await q("SELECT * FROM trades_v2 WHERE user_id = ? AND status = 'settled'", [userId]);
  const total = rows.length;
  const wins = rows.filter((t) => t.won == 1 || t.won === true).length;
  const totalPnl = rows.reduce((s, t) => s + parseFloat(String(t.pnl ?? 0)), 0);
  const totalCost = rows.reduce((s, t) => s + parseFloat(String(t.cost_basis ?? 0)), 0);
  const winRows = rows.filter((t) => t.won == 1 || t.won === true);
  const lossRows = rows.filter((t) => t.won == 0 || t.won === false);
  const avgWin = winRows.length > 0 ? winRows.reduce((s, t) => s + parseFloat(String(t.pnl ?? 0)), 0) / winRows.length : 0;
  const avgLoss = lossRows.length > 0 ? lossRows.reduce((s, t) => s + parseFloat(String(t.pnl ?? 0)), 0) / lossRows.length : 0;
  return { total, wins, losses: total - wins, winRate: total > 0 ? wins / total : 0, totalPnl, roi: totalCost > 0 ? totalPnl / totalCost : 0, avgWin, avgLoss };
}

export async function getDailyPnl(userId: number, days = 30) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const rows = await q(
    "SELECT * FROM trades_v2 WHERE user_id = ? AND status = 'settled' AND settled_at >= ? ORDER BY settled_at ASC",
    [userId, since]
  );
  const byDate: Record<string, { pnl: number; trades: number; wins: number }> = {};
  for (const t of rows) {
    const date = new Date(t.settled_at ?? t.created_at).toISOString().split("T")[0];
    if (!byDate[date]) byDate[date] = { pnl: 0, trades: 0, wins: 0 };
    byDate[date].pnl += parseFloat(String(t.pnl ?? 0));
    byDate[date].trades++;
    if (t.won == 1 || t.won === true) byDate[date].wins++;
  }
  return Object.entries(byDate).map(([date, v]) => ({ date, ...v }));
}

export async function getOpenTrades(userId: number): Promise<Trade[]> {
  const rows = await q(
    "SELECT * FROM trades_v2 WHERE user_id = ? AND status IN ('filled','pending') ORDER BY created_at DESC",
    [userId]
  );
  return rows.map(mapTrade);
}

// ─── Bot Logs ─────────────────────────────────────────────────────────────────
export async function insertBotLog(data: {
  userId: number;
  level: string;
  message: string;
  context?: any;
}): Promise<void> {
  await exec(
    "INSERT INTO bot_logs_v2 (user_id, level, message, context, created_at) VALUES (?, ?, ?, ?, NOW())",
    [data.userId, data.level, data.message, data.context ? JSON.stringify(data.context) : null]
  );
}

export async function getBotLogs(userId: number, limit = 100): Promise<BotLog[]> {
  const safeLimit = Math.max(1, Math.min(1000, Number(limit) || 100));
  const rows = await q(
    `SELECT * FROM bot_logs_v2 WHERE user_id = ? ORDER BY created_at DESC LIMIT ${safeLimit}`,
    [userId]
  );
  return rows.map((r) => ({
    id: r.id,
    userId: r.user_id,
    level: r.level,
    message: r.message,
    context: r.context ? (typeof r.context === "string" ? JSON.parse(r.context) : r.context) : null,
    createdAt: r.created_at,
  }));
}

// ─── City Stats ───────────────────────────────────────────────────────────────
export async function getCityStats(userId: number) {
  const rows = await q("SELECT * FROM trades_v2 WHERE user_id = ? AND status = 'settled'", [userId]);
  const cityMap: Record<string, any> = {};
  for (const t of rows) {
    const code = t.city_code ?? "UNKNOWN";
    if (!cityMap[code]) cityMap[code] = { cityCode: code, cityName: t.city_name ?? code, total: 0, wins: 0, pnl: 0, winPnl: 0, lossPnl: 0, winCount: 0, lossCount: 0 };
    cityMap[code].total++;
    cityMap[code].pnl += parseFloat(String(t.pnl ?? 0));
    if (t.won == 1 || t.won === true) { cityMap[code].wins++; cityMap[code].winPnl += parseFloat(String(t.pnl ?? 0)); cityMap[code].winCount++; }
    if (t.won == 0 || t.won === false) { cityMap[code].lossPnl += parseFloat(String(t.pnl ?? 0)); cityMap[code].lossCount++; }
  }
  return Object.values(cityMap).map((c) => ({
    ...c,
    winRate: c.total > 0 ? c.wins / c.total : 0,
    avgWin: c.winCount > 0 ? c.winPnl / c.winCount : 0,
    avgLoss: c.lossCount > 0 ? c.lossPnl / c.lossCount : 0,
  }));
}

// ─── Latest Signals ───────────────────────────────────────────────────────────
export async function getLatestSignals(userId: number) {
  const rows = await q(
    "SELECT * FROM trades_v2 WHERE user_id = ? AND status = 'filled' ORDER BY created_at DESC LIMIT 50",
    [userId]
  );
  const seen = new Set<string>();
  return rows
    .filter((t) => { if (seen.has(t.city_code ?? "")) return false; seen.add(t.city_code ?? ""); return true; })
    .map((t) => ({ cityCode: t.city_code, cityName: t.city_name, marketTicker: t.market_ticker, side: t.side, evCents: null }));
}

export async function getLatestForecasts() {
  const rows = await q(`
    SELECT f.*
    FROM forecast_cache_v2 f
    INNER JOIN (
      SELECT city_code, MAX(fetched_at) as max_fetched
      FROM forecast_cache_v2
      GROUP BY city_code
    ) latest ON f.city_code = latest.city_code AND f.fetched_at = latest.max_fetched
    ORDER BY f.city_name ASC
  `);
  return rows.map((r) => ({
    id: r.id,
    cityCode: r.city_code,
    cityName: r.city_name,
    highTemp: r.forecast_high,
    lowTemp: r.low_temp,
    sigma: r.sigma,
    shortForecast: r.short_forecast,
    detailedForecast: r.detailed_forecast,
    windSpeed: r.wind_speed ?? null,
    windDirection: r.wind_direction ?? null,
    precipChance: r.precip_chance != null ? Number(r.precip_chance) : null,
    updatedAt: r.fetched_at,
  }));
}

export async function upsertForecast(data: {
  cityCode: string;
  cityName: string;
  forecastHigh: number;
  lowTemp?: number;
  sigma: number;
  shortForecast?: string;
  detailedForecast?: string;
  windSpeed?: string;
  windDirection?: string;
  precipChance?: number | null;
}) {
  await q(
    `INSERT INTO forecast_cache_v2
       (city_code, city_name, forecast_high, low_temp, sigma, short_forecast, detailed_forecast, wind_speed, wind_direction, precip_chance, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE
       forecast_high = VALUES(forecast_high),
       low_temp = VALUES(low_temp),
       sigma = VALUES(sigma),
       short_forecast = VALUES(short_forecast),
       detailed_forecast = VALUES(detailed_forecast),
       wind_speed = VALUES(wind_speed),
       wind_direction = VALUES(wind_direction),
       precip_chance = VALUES(precip_chance),
       fetched_at = NOW()`,
    [
      data.cityCode,
      data.cityName,
      data.forecastHigh,
      data.lowTemp ?? null,
      data.sigma,
      data.shortForecast ?? null,
      data.detailedForecast ?? null,
      data.windSpeed ?? null,
      data.windDirection ?? null,
      data.precipChance ?? null,
    ]
  );
}
