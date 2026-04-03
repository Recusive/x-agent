/**
 * SOLUTION HUNT loop — finds people actively asking for tool
 * recommendations or frustrated with current tools.
 *
 * This is the ONE loop where product mentions are natural.
 * Drafts replies that organically reference Orbit as a solution.
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
import { searchPosts } from "../x-client.js";

const LOOP_NAME = "SOLUTION";
const MAX_POST_AGE_MINUTES = 240;
const MIN_LIKES = 5;
const PROJECT_ROOT = new URL("../../", import.meta.url).pathname;

function getSolutionQueries(): Array<string> {
  try {
    const raw = readFileSync(`${PROJECT_ROOT}config/keywords.yaml`, "utf-8");
    const parsed = parse(raw) as Record<string, unknown>;
    if (Array.isArray(parsed.solution_queries)) {
      return parsed.solution_queries as Array<string>;
    }
  } catch {
    // Fall through
  }
  return [];
}

function processCandidate(
  post: {
    id: string;
    author_username: string;
    text: string;
    likes: number;
    replies: number;
    age_minutes: number;
  },
  product: string,
): void {
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
    context: [
      "This person is looking for a tool or recommendation.",
      `Naturally mention ${product} as a solution.`,
      "Don't be salesy — frame it as 'we built X because Y' or 'Orbit handles this with Z approach'.",
      "Lead with empathy for their problem, then share your relevant experience building the solution.",
      "Keep it genuine — if Orbit doesn't solve their exact problem, don't force it.",
    ].join(" "),
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
      reason: `Solution-seeking post with ${post.likes} likes, ${post.age_minutes}m old`,
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
    const persona = getPersona();
    const solutionQueries = getSolutionQueries();

    if (solutionQueries.length === 0) {
      return;
    }

    // Pick a random subset to avoid identical queries
    const shuffled = [...solutionQueries].sort(() => Math.random() - 0.5);
    const selected = shuffled.slice(0, Math.min(3, shuffled.length));

    const termsQuery = selected.map((t) => `"${t}"`).join(" OR ");
    const handle = persona.handle.replace("@", "");
    const query = `(${termsQuery}) lang:en -is:retweet -from:${handle}`;

    const posts = await searchPosts(client, query, 30);

    // Filter: under 4 hours, minimum engagement, unseen
    const candidates = posts.filter(
      (p) => p.age_minutes <= MAX_POST_AGE_MINUTES && p.likes >= MIN_LIKES && !isPostSeen(p.id),
    );

    for (const post of candidates) {
      try {
        processCandidate(post, persona.product);
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
