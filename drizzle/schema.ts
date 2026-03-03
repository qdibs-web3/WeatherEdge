import {
  mysqlTable, int, varchar, text, boolean,
  decimal, timestamp, json, mysqlEnum
} from "drizzle-orm/mysql-core";
import { relations } from "drizzle-orm";

// ─── Users ────────────────────────────────────────────────────────────────────
export const users = mysqlTable("users", {
  id:             int("id").primaryKey().autoincrement(),
  email:          varchar("email", { length: 320 }),
  passwordHash:   varchar("password_hash", { length: 255 }),
  name:           text("name"),
  role:           mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  avatarUrl:      varchar("avatar_url", { length: 512 }),
  createdAt:      timestamp("createdAt").defaultNow().notNull(),
  updatedAt:      timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastLoginAt:    timestamp("last_login_at"),
  walletAddress:  varchar("wallet_address", { length: 42 }).default("").notNull(),
  nonce:          varchar("nonce", { length: 64 }).default("").notNull(),
});
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

// ─── Bot Configurations ───────────────────────────────────────────────────────
export const botConfig = mysqlTable("bot_config_v2", {
  id:             int("id").primaryKey().autoincrement(),
  userId:         int("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  kalshiApiKey:   text("kalshi_api_key"),
  kalshiApiKeyId: varchar("kalshi_api_key_id", { length: 255 }),
  isActive:       boolean("is_active").default(false).notNull(),
  dryRun:         boolean("dry_run").default(true).notNull(),
  flatBetDollars: decimal("flat_bet_dollars", { precision: 10, scale: 2 }).default("20.00"),
  minEvCents:     decimal("min_ev_cents", { precision: 6, scale: 2 }).default("3.00"),
  maxPriceCents:  int("max_price_cents").default(70),
  minLiquidity:   int("min_liquidity").default(100),
  enabledCities:  json("enabled_cities").$type<string[]>(),
  maxDailyTrades: int("max_daily_trades").default(20),
  maxDailyLoss:   decimal("max_daily_loss", { precision: 10, scale: 2 }).default("100.00"),
  createdAt:      timestamp("created_at").defaultNow().notNull(),
  updatedAt:      timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});
export type BotConfig = typeof botConfig.$inferSelect;
export type InsertBotConfig = typeof botConfig.$inferInsert;

// ─── Bot Status ───────────────────────────────────────────────────────────────
export const botStatus = mysqlTable("bot_status_v2", {
  id:           int("id").primaryKey().autoincrement(),
  userId:       int("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  status:       mysqlEnum("status", ["stopped", "running", "error", "paused"]).default("stopped").notNull(),
  lastScanAt:   timestamp("last_scan_at"),
  signalsFound: int("signals_found").default(0),
  errorMessage: text("error_message"),
  updatedAt:    timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});
export type BotStatus = typeof botStatus.$inferSelect;

// ─── Trades ───────────────────────────────────────────────────────────────────
export const trades = mysqlTable("trades_v2", {
  id:              int("id").primaryKey().autoincrement(),
  userId:          int("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  orderId:         varchar("order_id", { length: 255 }).unique(),
  ticker:          varchar("ticker", { length: 100 }).notNull(),
  marketTicker:    varchar("market_ticker", { length: 100 }),
  cityCode:        varchar("city_code", { length: 10 }).notNull(),
  cityName:        varchar("city_name", { length: 100 }).notNull(),
  side:            mysqlEnum("side", ["yes", "no"]).notNull(),
  priceCents:      int("price_cents").notNull(),
  contracts:       int("contracts").notNull(),
  costBasis:       decimal("cost_basis", { precision: 10, scale: 2 }),
  ev:              decimal("ev", { precision: 8, scale: 4 }),
  ourProb:         decimal("our_prob", { precision: 6, scale: 4 }),
  forecastTemp:    decimal("forecast_temp", { precision: 5, scale: 1 }),
  strikeDesc:      varchar("strike_desc", { length: 50 }),
  status:          mysqlEnum("status", ["pending", "filled", "cancelled", "settled"]).default("pending").notNull(),
  settledAt:       timestamp("settled_at"),
  settlementValue: decimal("settlement_value", { precision: 10, scale: 2 }),
  pnl:             decimal("pnl", { precision: 10, scale: 2 }),
  won:             boolean("won"),
  createdAt:       timestamp("created_at").defaultNow().notNull(),
  updatedAt:       timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});
export type Trade = typeof trades.$inferSelect;
export type NewTrade = typeof trades.$inferInsert;

// ─── Bot Logs ─────────────────────────────────────────────────────────────────
export const botLogs = mysqlTable("bot_logs_v2", {
  id:        int("id").primaryKey().autoincrement(),
  userId:    int("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  level:     mysqlEnum("level", ["info", "warn", "error", "success", "warning", "trade"]).notNull(),
  message:   text("message").notNull(),
  context:   json("context"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type BotLog = typeof botLogs.$inferSelect;

// ─── Forecast Cache ───────────────────────────────────────────────────────────
export const forecastCache = mysqlTable("forecast_cache", {
  id:            int("id").primaryKey().autoincrement(),
  cityCode:      varchar("city_code", { length: 10 }).notNull(),
  cityName:      varchar("city_name", { length: 100 }).notNull(),
  highTemp:      decimal("high_temp", { precision: 5, scale: 1 }),
  lowTemp:       decimal("low_temp", { precision: 5, scale: 1 }),
  shortForecast: varchar("short_forecast", { length: 255 }),
  forecastDate:  varchar("forecast_date", { length: 20 }),
  sigma:         decimal("sigma", { precision: 5, scale: 2 }),
  updatedAt:     timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
  fetchedAt:     timestamp("fetched_at").defaultNow().notNull(),
});

// ─── Magic Links ──────────────────────────────────────────────────────────────
export const magicLinks = mysqlTable("magic_links_v2", {
  id:        int("id").primaryKey().autoincrement(),
  email:     varchar("email", { length: 255 }).notNull(),
  token:     varchar("token", { length: 255 }).unique().notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  usedAt:    timestamp("used_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── Sessions ─────────────────────────────────────────────────────────────────
export const sessions = mysqlTable("sessions", {
  id:        varchar("id", { length: 255 }).primaryKey(),
  userId:    int("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── Relations ────────────────────────────────────────────────────────────────
export const usersRelations = relations(users, ({ many, one }) => ({
  botConfig: one(botConfig, { fields: [users.id], references: [botConfig.userId] }),
  botStatus: one(botStatus, { fields: [users.id], references: [botStatus.userId] }),
  trades:    many(trades),
  botLogs:   many(botLogs),
  sessions:  many(sessions),
}));
