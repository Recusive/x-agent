/**
 * Discovery engine — finds new accounts in your niche worth engaging with.
 * Searches keywords, filters by engagement thresholds, excludes known accounts.
 *
 * Usage: bun run src/discover.ts
 */
import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { isPostSeen, markPostSeen } from "./store.js";
import { createXClient, searchPosts } from "./x-client.js";

const CONFIG_PATH = new URL("../config/targets.yaml", import.meta.url).pathname;

interface DiscoveryConfig {
  discovery: {
    keywords: Array<string>;
    min_likes: number;
    min_followers: number;
    max_age_minutes: number;
    ignore_accounts: Array<string>;
  };
  priority_accounts: Array<{ handle: string }>;
  monitor_accounts: Array<{ handle: string }>;
}

function loadConfig(): DiscoveryConfig {
  const raw = readFileSync(CONFIG_PATH, "utf-8");
  return parse(raw) as DiscoveryConfig;
}

async function main(): Promise<void> {
  const config = loadConfig();
  const client = await createXClient();
  const discovery = config.discovery;

  // Build ignore list (all known accounts + explicit ignores)
  const ignoreSet = new Set([
    ...discovery.ignore_accounts.map((a) => a.toLowerCase()),
    ...config.priority_accounts.map((a) => a.handle.toLowerCase()),
    ...config.monitor_accounts.map((a) => a.handle.toLowerCase()),
  ]);

  // Search each keyword group
  const allKeywords = discovery.keywords;
  const query = allKeywords.map((k) => `"${k}"`).join(" OR ");

  const posts = await searchPosts(client, `(${query}) -is:reply -is:retweet lang:en`, 50);

  // Filter by thresholds
  const opportunities = posts.filter((p) => {
    if (ignoreSet.has(p.author_username.toLowerCase())) return false;
    if (p.likes < discovery.min_likes) return false;
    if (p.age_minutes > discovery.max_age_minutes) return false;
    if (isPostSeen(p.id)) return false;
    return true;
  });

  // Sort by opportunity score: likes × freshness
  const scored = opportunities
    .map((p) => ({
      ...p,
      opportunity_score: p.likes * Math.max(1, 120 - p.age_minutes),
    }))
    .sort((a, b) => b.opportunity_score - a.opportunity_score)
    .slice(0, 10);

  if (scored.length === 0) {
    console.log(JSON.stringify({ status: "no_discoveries" }));
    return;
  }

  // Mark as seen
  for (const post of scored) {
    markPostSeen(post.id, post.author_username, post.text, post.likes, post.replies);
  }

  console.log(
    JSON.stringify({
      discoveries: scored.map((p) => ({
        id: p.id,
        author_username: p.author_username,
        author_name: p.author_name,
        text: p.text,
        likes: p.likes,
        replies: p.replies,
        views: p.views,
        age_minutes: p.age_minutes,
        opportunity_score: p.opportunity_score,
        url: `https://x.com/${p.author_username}/status/${p.id}`,
      })),
    }),
  );
}

main().catch((err) => {
  console.error(JSON.stringify({ error: String(err) }));
  process.exit(1);
});
