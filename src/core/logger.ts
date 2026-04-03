/**
 * Logger — writes structured daily logs to logs/YYYY-MM-DD/.
 * Human-readable activity.md + machine-readable JSON files.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const LOGS_ROOT = new URL("../../logs", import.meta.url).pathname;

// ── Types ────────────────────────────────────────────────────

interface ReplyEntry {
  timestamp: string;
  loop: string;
  author: string;
  post_text: string;
  reply_text: string;
  post_url: string;
  reason: string;
}

interface DiscoveryEntry {
  timestamp: string;
  author: string;
  post_text: string;
  likes: number;
  post_url: string;
}

interface PostEntry {
  timestamp: string;
  text: string;
  reason: string;
}

// ErrorEntry not stored as JSON — errors go to activity.md only.

// ── Helpers ──────────────────────────────────────────────────

function todayDir(): string {
  const date = new Date().toISOString().split("T")[0];
  const dir = `${LOGS_ROOT}/${date}`;
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function timestamp(): string {
  return new Date().toISOString();
}

function timeOnly(): string {
  return new Date().toLocaleTimeString("en-US", { hour12: false });
}

function readJsonArray<T>(filePath: string): Array<T> {
  if (!existsSync(filePath)) return [];
  try {
    const raw = readFileSync(filePath, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as Array<T>;
    return [];
  } catch {
    return [];
  }
}

function writeJsonArray<T>(filePath: string, data: Array<T>): void {
  writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function appendToActivityLog(line: string): void {
  const dir = todayDir();
  const filePath = `${dir}/activity.md`;

  let existing = "";
  if (existsSync(filePath)) {
    existing = readFileSync(filePath, "utf-8");
  } else {
    const date = new Date().toISOString().split("T")[0];
    existing = `# Activity Log — ${date}\n\n`;
  }

  writeFileSync(filePath, `${existing}${line}\n`);
}

// ── Public API ───────────────────────────────────────────────

/** Log a reply that was posted. */
export function logReply(data: {
  loop: string;
  author: string;
  postText: string;
  replyText: string;
  postUrl: string;
  reason: string;
}): void {
  const dir = todayDir();
  const ts = timestamp();

  // Write to replies.json
  const filePath = `${dir}/replies.json`;
  const entries = readJsonArray<ReplyEntry>(filePath);
  entries.push({
    timestamp: ts,
    loop: data.loop,
    author: data.author,
    post_text: data.postText,
    reply_text: data.replyText,
    post_url: data.postUrl,
    reason: data.reason,
  });
  writeJsonArray(filePath, entries);

  // Write to activity.md
  appendToActivityLog(
    [
      `### ${timeOnly()} — Reply to @${data.author}`,
      `- **Loop:** ${data.loop}`,
      `- **Post:** "${data.postText.slice(0, 150)}"`,
      `- **Reply:** "${data.replyText}"`,
      `- **Reason:** ${data.reason}`,
      `- **URL:** ${data.postUrl}`,
      "",
    ].join("\n"),
  );
}

/** Log a discovered account/post. */
export function logDiscovery(data: {
  author: string;
  postText: string;
  likes: number;
  postUrl: string;
}): void {
  const dir = todayDir();
  const ts = timestamp();

  // Write to discoveries.json
  const filePath = `${dir}/discoveries.json`;
  const entries = readJsonArray<DiscoveryEntry>(filePath);
  entries.push({
    timestamp: ts,
    author: data.author,
    post_text: data.postText,
    likes: data.likes,
    post_url: data.postUrl,
  });
  writeJsonArray(filePath, entries);

  // Write to activity.md
  appendToActivityLog(
    [
      `### ${timeOnly()} — Discovery: @${data.author}`,
      `- **Post:** "${data.postText.slice(0, 150)}"`,
      `- **Likes:** ${data.likes}`,
      `- **URL:** ${data.postUrl}`,
      "",
    ].join("\n"),
  );
}

/** Log an original post that was created. */
export function logPost(data: { text: string; reason: string }): void {
  const dir = todayDir();
  const ts = timestamp();

  // Write to posts.json
  const filePath = `${dir}/posts.json`;
  const entries = readJsonArray<PostEntry>(filePath);
  entries.push({
    timestamp: ts,
    text: data.text,
    reason: data.reason,
  });
  writeJsonArray(filePath, entries);

  // Write to activity.md
  appendToActivityLog(
    [
      `### ${timeOnly()} — Original Post`,
      `- **Text:** "${data.text}"`,
      `- **Reason:** ${data.reason}`,
      "",
    ].join("\n"),
  );
}

/** Log an error that occurred during a loop. */
export function logError(data: { loop: string; error: string; context: string }): void {
  // Ensure today's directory exists (side effect of todayDir)
  todayDir();
  appendToActivityLog(
    [
      `### ${timeOnly()} — ERROR in ${data.loop}`,
      `- **Error:** ${data.error}`,
      `- **Context:** ${data.context}`,
      "",
    ].join("\n"),
  );
}

/** Get a summary of today's logged activity. */
export function getDailySummary(): {
  replies: number;
  likes: number;
  posts: number;
  discoveries: number;
  errors: number;
} {
  const dir = todayDir();

  const replies = readJsonArray<ReplyEntry>(`${dir}/replies.json`).length;
  const posts = readJsonArray<PostEntry>(`${dir}/posts.json`).length;
  const discoveries = readJsonArray<DiscoveryEntry>(`${dir}/discoveries.json`).length;

  // Count errors from activity.md
  let errors = 0;
  const activityPath = `${dir}/activity.md`;
  if (existsSync(activityPath)) {
    const content = readFileSync(activityPath, "utf-8");
    const errorMatches = content.match(/### .+ — ERROR/g);
    errors = errorMatches?.length ?? 0;
  }

  // Likes are tracked in rate-limiter DB, not in logs.
  // Return 0 here — callers should use getDailyStats() from rate-limiter for like count.
  return { replies, likes: 0, posts, discoveries, errors };
}
