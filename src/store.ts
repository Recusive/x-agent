import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const DB_PATH = new URL("../data/x-agent.db", import.meta.url).pathname;

// Ensure data directory exists
mkdirSync(dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);

// Initialize tables
db.run(`CREATE TABLE IF NOT EXISTS seen_posts (
  tweet_id TEXT PRIMARY KEY,
  author_username TEXT NOT NULL,
  text TEXT NOT NULL,
  likes INTEGER DEFAULT 0,
  replies INTEGER DEFAULT 0,
  seen_at TEXT DEFAULT (datetime('now'))
)`);

db.run(`CREATE TABLE IF NOT EXISTS posted_replies (
  reply_id TEXT PRIMARY KEY,
  tweet_id TEXT NOT NULL,
  author_username TEXT NOT NULL,
  reply_text TEXT NOT NULL,
  posted_at TEXT DEFAULT (datetime('now'))
)`);

db.run(`CREATE TABLE IF NOT EXISTS daily_stats (
  date TEXT NOT NULL,
  replies_posted INTEGER DEFAULT 0,
  total_views INTEGER DEFAULT 0,
  total_likes INTEGER DEFAULT 0,
  PRIMARY KEY (date)
)`);

export function isPostSeen(tweetId: string): boolean {
  const row = db.query("SELECT 1 FROM seen_posts WHERE tweet_id = ?").get(tweetId);
  return row !== null;
}

export function markPostSeen(
  tweetId: string,
  authorUsername: string,
  text: string,
  likes: number,
  replies: number,
): void {
  db.run(
    `INSERT OR IGNORE INTO seen_posts (tweet_id, author_username, text, likes, replies)
     VALUES (?, ?, ?, ?, ?)`,
    [tweetId, authorUsername, text, likes, replies],
  );
}

export function logReply(
  replyId: string,
  tweetId: string,
  authorUsername: string,
  replyText: string,
): void {
  db.run(
    `INSERT OR IGNORE INTO posted_replies (reply_id, tweet_id, author_username, reply_text)
     VALUES (?, ?, ?, ?)`,
    [replyId, tweetId, authorUsername, replyText],
  );

  // Update daily stats
  const today = new Date().toISOString().split("T")[0];
  db.run(
    `INSERT INTO daily_stats (date, replies_posted) VALUES (?, 1)
     ON CONFLICT(date) DO UPDATE SET replies_posted = replies_posted + 1`,
    [today],
  );
}

export function getRepliedAuthorsToday(): Array<string> {
  const today = new Date().toISOString().split("T")[0];
  const rows = db
    .query(
      `SELECT DISTINCT author_username FROM posted_replies
       WHERE date(posted_at) = ?`,
    )
    .all(today) as Array<{ author_username: string }>;
  return rows.map((r) => r.author_username);
}

export function getRepliesTodayCount(): number {
  const today = new Date().toISOString().split("T")[0];
  const row = db.query("SELECT replies_posted FROM daily_stats WHERE date = ?").get(today) as {
    replies_posted: number;
  } | null;
  return row?.replies_posted ?? 0;
}

export function getRecentReplies(limit: number = 20): Array<{
  reply_id: string;
  tweet_id: string;
  author_username: string;
  reply_text: string;
  posted_at: string;
}> {
  return db
    .query(`SELECT * FROM posted_replies ORDER BY posted_at DESC LIMIT ?`)
    .all(limit) as Array<{
    reply_id: string;
    tweet_id: string;
    author_username: string;
    reply_text: string;
    posted_at: string;
  }>;
}

export function getStats(): {
  today_replies: number;
  total_replies: number;
  unique_authors_today: number;
  recent_replies: Array<{
    author_username: string;
    reply_text: string;
    posted_at: string;
  }>;
} {
  const todayReplies = getRepliesTodayCount();
  const authorsToday = getRepliedAuthorsToday();

  const totalRow = db.query("SELECT COUNT(*) as count FROM posted_replies").get() as {
    count: number;
  };

  const recent = getRecentReplies(10);

  return {
    today_replies: todayReplies,
    total_replies: totalRow.count,
    unique_authors_today: authorsToday.length,
    recent_replies: recent.map((r) => ({
      author_username: r.author_username,
      reply_text: r.reply_text,
      posted_at: r.posted_at,
    })),
  };
}
