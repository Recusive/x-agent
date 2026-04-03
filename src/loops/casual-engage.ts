/**
 * CASUAL ENGAGE loop — likes posts and drops occasional light replies
 * to maintain feed presence and keep the algorithm fed.
 *
 * Likes 1-2 posts per cycle. Every ~4th cycle, drops a very short
 * casual reply (under 100 chars) on a random niche post.
 */

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

import type { TwitterApi } from "twitter-api-v2";
import { parse } from "yaml";

import { getPersona } from "../core/config-loader.js";
import { logError, logReply } from "../core/logger.js";
import { likePost, postReply } from "../core/poster.js";
import { canLike, canReply, recordLike, recordReply } from "../core/rate-limiter.js";
import { isPostSeen, markPostSeen } from "../store.js";
import type { PostResult } from "../x-client.js";
import { searchPosts } from "../x-client.js";

const LOOP_NAME = "CASUAL";
const MAX_POST_AGE_MINUTES = 180;
const MIN_LIKES_FOR_LIKING = 10;
const MAX_LIKES_PER_CYCLE = 2;
const LIGHT_REPLY_CHANCE = 0.25; // 1 in 4 cycles
const PROJECT_ROOT = new URL("../../", import.meta.url).pathname;

function getNicheKeywords(): Array<string> {
  try {
    const raw = readFileSync(`${PROJECT_ROOT}config/keywords.yaml`, "utf-8");
    const parsed = parse(raw) as Record<string, unknown>;
    if (Array.isArray(parsed.niche)) {
      return parsed.niche as Array<string>;
    }
  } catch {
    // Fall through
  }
  return [];
}

function generateLightReply(post: PostResult): string {
  try {
    const prompt = `Write a very short, casual X reply to this post. MUST be under 100 characters. Be genuinely conversational — not generic. One line only, no quotes.

POST by @${post.author_username}:
"${post.text}"

RULES:
- Under 100 characters total
- Casual/humor style — like texting a friend
- No product mentions
- No hashtags
- No generic phrases like "Love this!" or "Great post!"
- Can be a quick reaction, mild joke, or brief agreement with specificity
- Output ONLY the reply text, nothing else`;

    const result = execSync(`claude -p ${JSON.stringify(prompt)} 2>/dev/null`, {
      encoding: "utf-8",
      timeout: 60000,
    }).trim();

    // Take first non-empty line, enforce 100 char limit
    const lines = result.split("\n").filter((l) => l.trim().length > 0);
    const reply = lines[0]?.trim() ?? "";

    // Strip any surrounding quotes claude might add
    const cleaned = reply.replace(/^["']|["']$/g, "").trim();
    return cleaned.length <= 100 ? cleaned : `${cleaned.slice(0, 97)}...`;
  } catch {
    return "";
  }
}

function processLike(post: PostResult): boolean {
  try {
    const postUrl = `https://x.com/${post.author_username}/status/${post.id}`;
    const liked = likePost(postUrl);

    if (liked) {
      recordLike();
      markPostSeen(post.id, post.author_username, post.text, post.likes, post.replies);

      logReply({
        loop: LOOP_NAME,
        author: post.author_username,
        postText: post.text,
        replyText: "[LIKED]",
        postUrl,
        reason: `Casual like — ${post.likes} likes, ${post.age_minutes}m old`,
      });
      return true;
    }
  } catch (err) {
    logError({
      loop: LOOP_NAME,
      error: err instanceof Error ? err.message : String(err),
      context: `Liking post ${post.id} by @${post.author_username}`,
    });
  }
  return false;
}

function processLightReply(candidates: Array<PostResult>): void {
  const replyTargets = candidates.filter((p) => !isPostSeen(p.id));
  if (replyTargets.length === 0) return;

  const target = replyTargets[Math.floor(Math.random() * replyTargets.length)];
  if (!canReply(target.author_username, LOOP_NAME)) return;

  const lightReply = generateLightReply(target);
  if (lightReply.length === 0) return;

  const postUrl = `https://x.com/${target.author_username}/status/${target.id}`;
  const posted = postReply(postUrl, lightReply);

  if (posted) {
    recordReply(target.author_username, LOOP_NAME);
    markPostSeen(target.id, target.author_username, target.text, target.likes, target.replies);

    logReply({
      loop: LOOP_NAME,
      author: target.author_username,
      postText: target.text,
      replyText: lightReply,
      postUrl,
      reason: `Casual light reply — ${target.likes} likes`,
    });
  } else {
    logError({
      loop: LOOP_NAME,
      error: "Chrome post failed for light reply",
      context: `Reply to @${target.author_username}: "${lightReply}"`,
    });
  }
}

export async function runCycle(client: TwitterApi): Promise<void> {
  try {
    const nicheTerms = getNicheKeywords();
    const persona = getPersona();

    if (nicheTerms.length === 0) {
      return;
    }

    // Pick random keyword for this cycle's search
    const term = nicheTerms[Math.floor(Math.random() * nicheTerms.length)];
    const handle = persona.handle.replace("@", "");
    const query = `"${term}" lang:en -is:retweet -from:${handle}`;

    const posts = await searchPosts(client, query, 20);

    // Filter for likeable posts
    const candidates = posts.filter(
      (p) =>
        p.age_minutes <= MAX_POST_AGE_MINUTES &&
        p.likes >= MIN_LIKES_FOR_LIKING &&
        !isPostSeen(p.id),
    );

    if (candidates.length === 0) {
      return;
    }

    // Sort by engagement for liking
    const sorted = [...candidates].sort((a, b) => b.likes - a.likes);

    // Like 1-2 posts
    let likesThisCycle = 0;
    for (const post of sorted) {
      if (likesThisCycle >= MAX_LIKES_PER_CYCLE) break;
      if (!canLike()) break;

      if (processLike(post)) {
        likesThisCycle++;
      }
    }

    // Occasionally drop a light reply (1 in 4 cycles)
    if (Math.random() < LIGHT_REPLY_CHANCE) {
      processLightReply(candidates);
    }
  } catch (err) {
    logError({
      loop: LOOP_NAME,
      error: err instanceof Error ? err.message : String(err),
      context: "Cycle-level failure",
    });
  }
}
