/**
 * Rate limiter — tracks daily engagement limits using SQLite.
 * Reads limits from strategy.yaml via config-loader.
 */

import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { getStrategy } from "./config-loader.js";

const DB_PATH = new URL("../../data/x-agent.db", import.meta.url).pathname;

// Ensure data directory exists
mkdirSync(dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);

// ── Schema ───────────────────────────────────────────────────

db.run(`CREATE TABLE IF NOT EXISTS rate_replies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  author TEXT NOT NULL,
  loop TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
)`);

db.run(`CREATE TABLE IF NOT EXISTS rate_likes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT DEFAULT (datetime('now'))
)`);

// ── Helpers ──────────────────────────────────────────────────

function today(): string {
  return new Date().toISOString().split("T")[0];
}

function countReplies(where: string, params: Array<string>): number {
  const row = db
    .query(`SELECT COUNT(*) as count FROM rate_replies WHERE date(created_at) = ? AND ${where}`)
    .get(today(), ...params) as { count: number } | null;
  return row?.count ?? 0;
}

// ── Public API ───────────────────────────────────────────────

/** Check whether a reply is allowed given current daily limits. */
export function canReply(author: string, loop: string): boolean {
  const strategy = getStrategy();
  const limits = strategy.limits;

  // Global daily limit
  const totalToday = countReplies("1=1", []);
  if (totalToday >= limits.max_replies_per_day) return false;

  // Per-author daily limit
  const authorToday = countReplies("author = ?", [author]);
  if (authorToday >= limits.max_replies_per_author_per_day) return false;

  // Per-loop daily limit
  const loopToday = countReplies("loop = ?", [loop]);
  if (loopToday >= limits.max_replies_per_loop_per_day) return false;

  return true;
}

/** Record a reply for rate-limiting purposes. */
export function recordReply(author: string, loop: string): void {
  db.run("INSERT INTO rate_replies (author, loop) VALUES (?, ?)", [author, loop]);
}

/** Check whether a like is allowed given the daily limit. */
export function canLike(): boolean {
  const strategy = getStrategy();
  const row = db
    .query("SELECT COUNT(*) as count FROM rate_likes WHERE date(created_at) = ?")
    .get(today()) as { count: number } | null;
  const likesToday = row?.count ?? 0;
  return likesToday < strategy.limits.max_likes_per_day;
}

/** Record a like for rate-limiting purposes. */
export function recordLike(): void {
  db.run("INSERT INTO rate_likes (id, created_at) VALUES (NULL, datetime('now'))");
}

/** Get a summary of today's engagement activity. */
export function getDailyStats(): {
  total_replies: number;
  total_likes: number;
  by_loop: Record<string, number>;
  by_author: Record<string, number>;
} {
  const dateStr = today();

  // Total replies
  const totalRow = db
    .query("SELECT COUNT(*) as count FROM rate_replies WHERE date(created_at) = ?")
    .get(dateStr) as { count: number } | null;
  const total_replies = totalRow?.count ?? 0;

  // Total likes
  const likesRow = db
    .query("SELECT COUNT(*) as count FROM rate_likes WHERE date(created_at) = ?")
    .get(dateStr) as { count: number } | null;
  const total_likes = likesRow?.count ?? 0;

  // By loop
  const loopRows = db
    .query(
      "SELECT loop, COUNT(*) as count FROM rate_replies WHERE date(created_at) = ? GROUP BY loop",
    )
    .all(dateStr) as Array<{ loop: string; count: number }>;
  const by_loop: Record<string, number> = {};
  for (const row of loopRows) {
    by_loop[row.loop] = row.count;
  }

  // By author
  const authorRows = db
    .query(
      "SELECT author, COUNT(*) as count FROM rate_replies WHERE date(created_at) = ? GROUP BY author",
    )
    .all(dateStr) as Array<{ author: string; count: number }>;
  const by_author: Record<string, number> = {};
  for (const row of authorRows) {
    by_author[row.author] = row.count;
  }

  return { total_replies, total_likes, by_loop, by_author };
}
