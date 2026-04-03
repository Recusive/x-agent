/**
 * X Presence Agent — main orchestrator.
 *
 * Reads strategy.yaml, launches all enabled loops in parallel,
 * enforces working hours, jitters intervals, handles shutdown.
 *
 * Usage: bun run src/agent.ts
 */

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { TwitterApi } from "twitter-api-v2";
import { parse } from "yaml";
import { getDailySummary, logError } from "./core/logger.js";
import { isConfigured as isIMessageConfigured, sendMessage } from "./imessage.js";
import { getRepliesTodayCount } from "./store.js";
import { createXClient } from "./x-client.js";

// ── Constants ───────────────────────────────────────────────

const PROJECT_ROOT = new URL("../", import.meta.url).pathname;
const STRATEGY_PATH = `${PROJECT_ROOT}config/strategy.yaml`;
const PID_PATH = `${PROJECT_ROOT}data/agent.pid`;
const LOGS_ROOT = `${PROJECT_ROOT}logs`;

let running = true;

// ── Types ───────────────────────────────────────────────────

interface LoopConfig {
  enabled: boolean;
  interval_seconds: number;
  [key: string]: unknown;
}

interface StrategyYaml {
  loops: Record<string, LoopConfig>;
  global: {
    max_total_replies_per_day: number;
    working_hours: { start: number; end: number };
    [key: string]: unknown;
  };
}

interface LoopModule {
  runCycle: (client: TwitterApi) => Promise<void>;
}

// Map from strategy.yaml loop names to module filenames
const LOOP_MODULE_MAP: Record<string, string> = {
  priority_watch: "priority-watch",
  niche_engage: "niche-engage",
  solution_hunt: "solution-hunt",
  content_create: "content-create",
  casual_engage: "casual-engage",
  conversation_track: "conversation-track",
};

// Map from strategy.yaml loop names to display labels (uppercase, short)
const LOOP_LABEL_MAP: Record<string, string> = {
  priority_watch: "WATCH",
  niche_engage: "NICHE",
  solution_hunt: "SOLUTION",
  content_create: "CONTENT",
  casual_engage: "CASUAL",
  conversation_track: "TRACK",
};

// ── Helpers ─────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function timestamp(): string {
  return new Date().toLocaleTimeString("en-US", { hour12: false });
}

function todayDateStr(): string {
  return new Date().toISOString().split("T")[0] ?? "unknown";
}

function isWorkingHours(start: number, end: number): boolean {
  const hour = new Date().getHours();
  return hour >= start && hour < end;
}

function loadStrategyYaml(): StrategyYaml {
  const raw = readFileSync(STRATEGY_PATH, "utf-8");
  return parse(raw) as StrategyYaml;
}

function getEnabledLoops(): Array<{ name: string; label: string; intervalMs: number }> {
  const strategy = loadStrategyYaml();
  const result: Array<{ name: string; label: string; intervalMs: number }> = [];

  for (const [name, config] of Object.entries(strategy.loops)) {
    if (config.enabled) {
      result.push({
        name,
        label: LOOP_LABEL_MAP[name] ?? name.toUpperCase(),
        intervalMs: (config.interval_seconds ?? 60) * 1000,
      });
    }
  }

  return result;
}

async function tryLoadLoopModule(name: string): Promise<LoopModule | null> {
  const filename = LOOP_MODULE_MAP[name];
  if (!filename) {
    log("AGENT", `Unknown loop: ${name} (no module mapping)`);
    return null;
  }

  const modulePath = `./loops/${filename}.js`;
  try {
    const mod = (await import(modulePath)) as LoopModule;
    if (typeof mod.runCycle !== "function") {
      log("AGENT", `Loop module ${filename} has no runCycle export, skipping`);
      return null;
    }
    return mod;
  } catch {
    log("AGENT", `Loop module ${filename} not found, skipping`);
    return null;
  }
}

function log(label: string, message: string): void {
  const padded = label.padEnd(10);
  console.log(`${timestamp()} [${padded}] ${message}`);
}

// ── PID file ────────────────────────────────────────────────

function writePidFile(): void {
  mkdirSync(dirname(PID_PATH), { recursive: true });
  writeFileSync(PID_PATH, String(process.pid));
}

function removePidFile(): void {
  try {
    if (existsSync(PID_PATH)) {
      unlinkSync(PID_PATH);
    }
  } catch {
    // Best effort
  }
}

// ── Loop runner ─────────────────────────────────────────────

async function runLoop(
  name: string,
  label: string,
  intervalMs: number,
  workingHours: { start: number; end: number },
  fn: () => Promise<void>,
): Promise<void> {
  while (running) {
    if (isWorkingHours(workingHours.start, workingHours.end)) {
      try {
        await fn();
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        log(label, `error: ${errorMsg.slice(0, 120)}`);
        logError({ loop: name, error: String(err), context: "cycle failed" });
      }
    } else {
      log(label, "outside working hours, sleeping");
    }

    // Bail early if shutdown was requested during the cycle
    if (!running) break;

    // Add +/-20% jitter
    const jitter = intervalMs * 0.2 * (Math.random() * 2 - 1);
    await sleep(intervalMs + jitter);
  }
}

// ── Banner ──────────────────────────────────────────────────

function printBanner(loopCount: number, maxReplies: number): void {
  const date = todayDateStr();
  console.log("");
  console.log("\u2501".repeat(46));
  console.log(`  X Presence Agent \u2014 @Orbitbuild`);
  console.log(`  ${loopCount} loops active | ${maxReplies} replies/day max`);
  console.log(`  Config: config/ | Logs: logs/${date}/`);
  console.log(`  Ctrl+C to stop`);
  console.log("\u2501".repeat(46));
  console.log("");
}

// ── Startup / Shutdown ──────────────────────────────────────

function notifyStartup(loopCount: number): void {
  if (isIMessageConfigured()) {
    try {
      sendMessage(`X Agent started \u2014 ${loopCount} loops active`);
    } catch {
      log("AGENT", "Failed to send iMessage startup notification");
    }
  }
}

function notifyShutdown(): void {
  const todayReplies = getRepliesTodayCount();
  if (isIMessageConfigured()) {
    try {
      sendMessage(`X Agent stopped \u2014 ${todayReplies} replies today`);
    } catch {
      // Shutdown path, don't throw
    }
  }
}

function logStartupToActivity(): void {
  const dir = `${LOGS_ROOT}/${todayDateStr()}`;
  mkdirSync(dir, { recursive: true });
  const activityPath = `${dir}/activity.md`;

  let existing = "";
  if (existsSync(activityPath)) {
    existing = readFileSync(activityPath, "utf-8");
  } else {
    existing = `# Activity Log \u2014 ${todayDateStr()}\n\n`;
  }

  writeFileSync(
    activityPath,
    `${existing}### ${timestamp()} \u2014 Agent Started\n- **PID:** ${process.pid}\n\n`,
  );
}

// ── Main ────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Load strategy
  const strategy = loadStrategyYaml();
  const workingHours = strategy.global.working_hours;
  const maxReplies = strategy.global.max_total_replies_per_day;
  const enabledLoops = getEnabledLoops();

  // Print banner
  printBanner(enabledLoops.length, maxReplies);

  // Write PID file
  writePidFile();
  log("AGENT", `PID ${process.pid} written to ${PID_PATH}`);

  // Log startup
  logStartupToActivity();

  // Create X API client
  log("AGENT", "Connecting to X API...");
  const client = await createXClient();
  log("AGENT", "Connected");

  // Notify via iMessage
  notifyStartup(enabledLoops.length);

  // Load and launch all enabled loops
  const loopPromises: Array<Promise<void>> = [];

  for (const loop of enabledLoops) {
    const mod = await tryLoadLoopModule(loop.name);
    if (!mod) continue;

    log(loop.label, `starting (every ${Math.round(loop.intervalMs / 1000)}s)`);

    loopPromises.push(
      runLoop(loop.name, loop.label, loop.intervalMs, workingHours, () => mod.runCycle(client)),
    );
  }

  if (loopPromises.length === 0) {
    log("AGENT", "No loop modules loaded. Exiting.");
    removePidFile();
    return;
  }

  // All loops run forever (until running = false)
  await Promise.all(loopPromises);
}

// ── Signal handlers ─────────────────────────────────────────

function shutdown(): void {
  if (!running) return; // Prevent double-shutdown
  running = false;

  console.log("");
  log("AGENT", "Shutting down...");

  notifyShutdown();

  const summary = getDailySummary();
  log(
    "AGENT",
    `Today: ${summary.replies} replies, ${summary.posts} posts, ${summary.discoveries} discoveries`,
  );

  removePidFile();
  log("AGENT", "Goodbye");
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// ── Run ─────────────────────────────────────────────────────

main().catch((err) => {
  console.error("Fatal:", err);
  removePidFile();
  process.exit(1);
});
