/**
 * Watchlist monitor — polls accounts in watchlist.txt, detects new posts,
 * drafts replies, asks for permission, posts via Chrome.
 *
 * Usage: bun run src/watch.ts
 */

import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { isConfigured as isIMessageConfigured, sendMessage, waitForReply } from "./imessage.js";
import { getRepliedAuthorsToday, getRepliesTodayCount, isPostSeen, markPostSeen } from "./store.js";
import type { PostResult } from "./x-client.js";
import { createXClient, searchPosts } from "./x-client.js";

const WATCHLIST_PATH = new URL("../watchlist.yaml", import.meta.url).pathname;
const PERSONA_PATH = new URL("../config/persona.yaml", import.meta.url).pathname;
const POLL_INTERVAL = 45; // seconds

function loadWatchlist(): Array<string> {
  const raw = readFileSync(WATCHLIST_PATH, "utf-8");
  const data = parse(raw) as { accounts: Array<string> };
  return (data.accounts ?? []).filter((a) => typeof a === "string" && a.length > 0);
}

function loadPersona(): string {
  return readFileSync(PERSONA_PATH, "utf-8");
}

function formatPost(post: PostResult): string {
  const age =
    post.age_minutes < 60 ? `${post.age_minutes}m` : `${Math.round(post.age_minutes / 60)}h`;
  return [
    ``,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `  @${post.author_username} (${age} ago) — ♥ ${post.likes}  💬 ${post.replies}  👁 ${post.views}`,
    `  ${post.text.slice(0, 250)}`,
    `  https://x.com/${post.author_username}/status/${post.id}`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
  ].join("\n");
}

async function generateDrafts(post: PostResult, persona: string): Promise<Array<string>> {
  const { execSync } = await import("node:child_process");

  const prompt = `Draft 3 short X reply options for this post. Output ONLY 3 lines, numbered 1-3. No extra text.

POST by @${post.author_username}:
"${post.text}"

Persona: ${persona.slice(0, 500)}

Rules:
- Never generic ("Great post!", "Love this!")
- Never mention any product
- Match the energy of the original post
- Each under 280 chars

Format:
1. <reply>
2. <reply>
3. <reply>`;

  const result = execSync(`claude -p ${JSON.stringify(prompt)} 2>/dev/null`, {
    encoding: "utf-8",
    timeout: 30000,
  }).trim();

  return result
    .split("\n")
    .filter((line) => /^\d+[.)]/.test(line.trim()))
    .map((line) => line.replace(/^\d+[.)]\s*/, "").trim())
    .slice(0, 3);
}

function notify(title: string, msg: string): void {
  try {
    const { execSync } = require("node:child_process");
    execSync(
      `osascript -e 'display notification "${msg.replace(/"/g, '\\"').slice(0, 100)}" with title "${title.replace(/"/g, '\\"')}" sound name "Ping"'`,
      { stdio: "ignore" },
    );
  } catch {}
}

async function promptUser(question: string): Promise<string> {
  process.stdout.write(question);
  const buf = Buffer.alloc(1024);
  const fd = require("node:fs").openSync("/dev/stdin", "r");
  const n = require("node:fs").readSync(fd, buf, 0, buf.length, null);
  require("node:fs").closeSync(fd);
  return buf.toString("utf-8", 0, n).trim();
}

async function postViaChrome(url: string, replyText: string, useIMessage: boolean): Promise<void> {
  const { execSync } = await import("node:child_process");

  console.log(`\n  🌐 Posting via Chrome: "${replyText}"`);
  if (useIMessage) {
    sendMessage(`⏳ Posting: "${replyText}"`);
  }

  try {
    const agentDir = new URL("..", import.meta.url).pathname;
    execSync(`bun run src/chrome-post.ts ${JSON.stringify(url)} ${JSON.stringify(replyText)}`, {
      encoding: "utf-8",
      timeout: 120000,
      cwd: agentDir,
    });
    console.log("  ✅ Posted!");
    if (useIMessage) {
      sendMessage(`✅ Posted!\n"${replyText}"\n\n${url}`);
    }
  } catch {
    execSync(`echo -n ${JSON.stringify(replyText)} | pbcopy`);
    execSync(`open "${url}"`);
    console.log("  ⚠ Chrome post failed. Copied to clipboard instead.");
    if (useIMessage) {
      sendMessage(
        `⚠ Auto-post failed. Copied to clipboard:\n"${replyText}"\n\nCmd+V and Post.\n${url}`,
      );
    }
  }
}

async function handleNewPost(post: PostResult, persona: string): Promise<void> {
  const todayCount = getRepliesTodayCount();
  const repliedAuthors = getRepliedAuthorsToday();

  if (todayCount >= 20) {
    console.log("  Daily limit reached (20). Skipping.");
    return;
  }

  if (repliedAuthors.includes(post.author_username)) {
    console.log(`  Already replied to @${post.author_username} today. Skipping.`);
    return;
  }

  console.log(formatPost(post));
  console.log("\n  Drafting replies...\n");

  const drafts = await generateDrafts(post, persona);

  if (drafts.length === 0) {
    console.log("  Failed to generate drafts.");
    return;
  }

  for (let i = 0; i < drafts.length; i++) {
    console.log(`  [${i + 1}] ${drafts[i]}`);
  }
  console.log("");

  const useIMessage = isIMessageConfigured();
  let choice: string | null = null;

  if (useIMessage) {
    // Send options via iMessage and wait for reply
    const url = `https://x.com/${post.author_username}/status/${post.id}`;
    const msg = [
      `🚨 @${post.author_username} just posted:`,
      `"${post.text.slice(0, 200)}"`,
      ``,
      ...drafts.map((d, i) => `[${i + 1}] ${d}`),
      ``,
      `Reply 1, 2, or 3 (or "skip")`,
      url,
    ].join("\n");

    sendMessage(msg);
    console.log("  📱 Sent to iMessage. Waiting for your reply...");

    choice = await waitForReply(180); // 3 min timeout

    if (!choice) {
      console.log("  No reply received. Skipping.\n");
      return;
    }
    console.log(`  📱 Got reply: "${choice}"`);
  } else {
    // Fall back to terminal prompt
    choice = await promptUser("  Pick (1/2/3), type custom, or 'skip': ");
  }

  let replyText = "";
  switch (choice) {
    case "1":
    case "2":
    case "3": {
      const idx = parseInt(choice, 10) - 1;
      replyText = drafts[idx] ?? "";
      break;
    }
    case "skip":
    case "s":
    case "":
      console.log("  Skipped.\n");
      return;
    default:
      replyText = choice;
  }

  if (!replyText) {
    console.log("  No reply text. Skipping.\n");
    return;
  }

  const url = `https://x.com/${post.author_username}/status/${post.id}`;
  await postViaChrome(url, replyText, useIMessage);
  console.log("");
}

async function main(): Promise<void> {
  const client = await createXClient();
  const persona = loadPersona();

  console.log("");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  X Watchlist Monitor");
  console.log(`  Polling every ${POLL_INTERVAL}s`);
  console.log("  Edit watchlist.txt to add/remove accounts");
  console.log("  Ctrl+C to stop");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("");

  while (true) {
    const handles = loadWatchlist();
    if (handles.length === 0) {
      console.log(`${timestamp()} No accounts in watchlist.txt`);
      await sleep(POLL_INTERVAL * 1000);
      continue;
    }

    const query = handles.map((h) => `from:${h}`).join(" OR ");

    try {
      const posts = await searchPosts(client, `(${query}) -is:reply -is:retweet`, 30);

      const newPosts = posts.filter((p) => p.age_minutes <= 5 && !isPostSeen(p.id));

      if (newPosts.length === 0) {
        console.log(`${timestamp()} quiet (${handles.length} accounts watched)`);
      } else {
        for (const post of newPosts) {
          markPostSeen(post.id, post.author_username, post.text, post.likes, post.replies);
          notify(`🚨 @${post.author_username} just posted`, post.text.slice(0, 100));
          await handleNewPost(post, persona);
        }
      }
    } catch (err) {
      console.log(`${timestamp()} error: ${String(err).slice(0, 100)}`);
    }

    // Random interval 35-55s
    await sleep((35 + Math.floor(Math.random() * 20)) * 1000);
  }
}

function timestamp(): string {
  return new Date().toLocaleTimeString("en-US", { hour12: false });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch(console.error);
