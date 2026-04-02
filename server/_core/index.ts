/**
 * Updated server/_core/index.ts for Phase 5
 * Add bot manager initialization
 */

import 'dotenv/config';
import express from "express";
import cors from "cors";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { setupVite, serveStatic } from "./vite";
import { botManager } from "../services/botManager";
import { ensureHistoricalTables, runNightlyAccuracyJob } from "../services/historicalDataService";
import { clearEnsembleCache } from "../services/openMeteoService";
import * as db from "../db";

const app = express();

// Middleware
app.use(cors());
// NOTE: Do NOT add express.json() globally — tRPC v11 handles its own body parsing
// Adding express.json() before tRPC causes POST mutations to hang (stream already consumed)

// Apply express.json() ONLY to non-tRPC routes
app.use((req, res, next) => {
  if (req.path.startsWith('/api/trpc')) return next();
  express.json()(req, res, next);
});

// tRPC middleware (auth handled in context)
app.use(
  "/api/trpc",
  createExpressMiddleware({
    router: appRouter,
    createContext,
  })
);

// Vite dev server or static files
async function startServer() {
  // Start server
  const PORT = Number(process.env.PORT) || 3000;
  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });

  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // Run DB migrations (adds columns if missing)
  await db.runMigrations();
  console.log('[Server] DB migrations applied');

  // Initialize Bot Manager
  console.log('[Server] Initializing Bot Manager...');
  await botManager.initialize();
  console.log('[Server] Bot Manager initialized');

  // Clear stale ensemble cache so date-pinned API calls start fresh
  clearEnsembleCache();

  // Ensure historical tables exist
  await ensureHistoricalTables();
  console.log('[Server] Historical tables ready');

  // Nightly accuracy job: run at startup (catches up on yesterday) then every 24h
  runNightlyAccuracyJob().catch(e => console.error('[Historical] Nightly job failed:', e));
  setInterval(() => {
    runNightlyAccuracyJob().catch(e => console.error('[Historical] Nightly job failed:', e));
  }, 24 * 60 * 60 * 1000);

  // Handle graceful shutdown
  const shutdown = async () => {
    console.log('[Server] Shutting down gracefully...');
    
    // Stop all bots
    await botManager.shutdown();
    
    // Close server
    server.close(() => {
      console.log('[Server] Server closed');
      process.exit(0);
    });
    
    // Force exit after 10 seconds
    setTimeout(() => {
      console.error('[Server] Forced shutdown after timeout');
      process.exit(1);
    }, 10000);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

startServer().catch(console.error);