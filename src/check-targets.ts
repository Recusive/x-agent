/**
 * Standalone target checker — runs without Claude Code.
 * Called by x-monitor.sh every 60 seconds.
 * Outputs JSON to stdout: { new_posts: [...] } or { status: "quiet" }
 */

import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { isPostSeen, markPostSeen } from "./store.js";
import { createXClient, searchPosts } from "./x-client.js";

const CONFIG_PATH = new URL("../config/targets.yaml", import.meta.url).pathname;

interface TargetConfig {
  priority_accounts: Array<{
    handle: string;
    context: string;
    angles: Array<string>;
  }>;
  monitor_accounts: Array<{ handle: string }>;
  keywords: Array<string>;
}

function loadTargets(): TargetConfig {
  const raw = readFileSync(CONFIG_PATH, "utf-8");
  return parse(raw) as TargetConfig;
}

async function main(): Promise<void> {
  const targets = loadTargets();
  const client = await createXClient();

  // Combine all accounts into one search query
  const allHandles = [
    ...targets.priority_accounts.map((a) => a.handle),
    ...targets.monitor_accounts.map((a) => a.handle),
  ];

  const query = allHandles.map((h) => `from:${h}`).join(" OR ");
  const posts = await searchPosts(client, `(${query}) -is:reply -is:retweet`, 30);

  // Filter: only new posts under 5 minutes old
  const newPosts = posts.filter((p) => p.age_minutes <= 5 && !isPostSeen(p.id));

  if (newPosts.length === 0) {
    console.log(JSON.stringify({ status: "quiet" }));
    return;
  }

  // Mark as seen
  for (const post of newPosts) {
    markPostSeen(post.id, post.author_username, post.text, post.likes, post.replies);
  }

  // Enrich with target context (angles for priority accounts)
  const enriched = newPosts.map((post) => {
    const priority = targets.priority_accounts.find(
      (a) => a.handle.toLowerCase() === post.author_username.toLowerCase(),
    );
    return {
      ...post,
      is_priority: !!priority,
      context: priority?.context ?? "",
      angles: priority?.angles ?? [],
    };
  });

  console.log(JSON.stringify({ new_posts: enriched }));
}

main().catch((err) => {
  console.error(JSON.stringify({ error: String(err) }));
  process.exit(1);
});
