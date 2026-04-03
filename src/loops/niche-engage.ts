/**
 * NICHE ENGAGE loop — searches niche keywords, engages with relevant
 * posts to build presence in the space.
 *
 * Does NOT mention the product. This is pure niche credibility building.
 * Picks top 1-2 posts by opportunity score (likes x freshness).
 */

import { readFileSync } from "node:fs";

import type { TwitterApi } from "twitter-api-v2";
import { parse } from "yaml";

import { getPersona } from "../core/config-loader.js";
import { autoSelectBest, draftReplies } from "../core/drafter.js";
import { logDiscovery, logError, logReply } from "../core/logger.js";
import { postReply } from "../core/poster.js";
import { canReply, recordReply } from "../core/rate-limiter.js";
import { isPostSeen, markPostSeen } from "../store.js";
import type { PostResult } from "../x-client.js";
import { searchPosts } from "../x-client.js";

const LOOP_NAME = "NICHE";
const MAX_POST_AGE_MINUTES = 120;
const MIN_LIKES = 10;
const MAX_PICKS = 2;
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

function opportunityScore(post: PostResult): number {
  // Higher likes = more visibility. Fresher = more opportunity.
  // Freshness: 1.0 at 0 minutes, decaying toward 0 at max age.
  const freshness = Math.max(0, 1 - post.age_minutes / MAX_POST_AGE_MINUTES);
  return post.likes * freshness;
}

function processCandidate(post: PostResult): void {
  markPostSeen(post.id, post.author_username, post.text, post.likes, post.replies);

  logDiscovery({
    author: post.author_username,
    postText: post.text,
    likes: post.likes,
    postUrl: `https://x.com/${post.author_username}/status/${post.id}`,
  });

  if (!canReply(post.author_username, LOOP_NAME)) return;

  const drafts = draftReplies({
    author: post.author_username,
    text: post.text,
    context:
      "This is a niche engagement reply. Do NOT mention any product. Focus on adding value to the conversation with technical insight or genuine perspective.",
  });

  if (drafts.length === 0) {
    logError({
      loop: LOOP_NAME,
      error: "Failed to generate drafts",
      context: `Post by @${post.author_username}: "${post.text.slice(0, 100)}"`,
    });
    return;
  }

  const bestReply = autoSelectBest(drafts);
  if (bestReply.length === 0) return;

  const postUrl = `https://x.com/${post.author_username}/status/${post.id}`;
  const posted = postReply(postUrl, bestReply);

  if (posted) {
    recordReply(post.author_username, LOOP_NAME);

    logReply({
      loop: LOOP_NAME,
      author: post.author_username,
      postText: post.text,
      replyText: bestReply,
      postUrl,
      reason: `Niche post with ${post.likes} likes, ${post.age_minutes}m old, score ${opportunityScore(post).toFixed(1)}`,
    });
  } else {
    logError({
      loop: LOOP_NAME,
      error: "Chrome post failed",
      context: `Reply to @${post.author_username}: "${bestReply.slice(0, 100)}"`,
    });
  }
}

export async function runCycle(client: TwitterApi): Promise<void> {
  try {
    const nicheTerms = getNicheKeywords();

    if (nicheTerms.length === 0) {
      return;
    }

    const persona = getPersona();

    // Pick a random subset of keywords to avoid identical queries every cycle
    const shuffled = [...nicheTerms].sort(() => Math.random() - 0.5);
    const selected = shuffled.slice(0, Math.min(3, shuffled.length));

    // Build query with OR between terms, filter to English, exclude own account
    const termsQuery = selected.map((t) => `"${t}"`).join(" OR ");
    const query = `(${termsQuery}) lang:en -is:retweet -from:${persona.handle.replace("@", "")}`;

    const posts = await searchPosts(client, query, 30);

    // Filter: under 2 hours, minimum likes, not already seen
    const candidates = posts.filter(
      (p) => p.age_minutes <= MAX_POST_AGE_MINUTES && p.likes >= MIN_LIKES && !isPostSeen(p.id),
    );

    if (candidates.length === 0) {
      return;
    }

    // Sort by opportunity score, pick top 1-2
    const ranked = candidates.sort((a, b) => opportunityScore(b) - opportunityScore(a));
    const picks = ranked.slice(0, MAX_PICKS);

    for (const post of picks) {
      try {
        processCandidate(post);
      } catch (err) {
        logError({
          loop: LOOP_NAME,
          error: err instanceof Error ? err.message : String(err),
          context: `Processing post ${post.id} by @${post.author_username}`,
        });
      }
    }
  } catch (err) {
    logError({
      loop: LOOP_NAME,
      error: err instanceof Error ? err.message : String(err),
      context: "Cycle-level failure",
    });
  }
}
