/**
 * PRIORITY WATCH loop — monitors watchlist accounts for new posts,
 * drafts replies, posts the best one, and sends iMessage notifications.
 *
 * Fastest loop. Targets posts under 5 minutes old from priority accounts.
 */

import type { TwitterApi } from "twitter-api-v2";

import { getWatchlist } from "../core/config-loader.js";
import { autoSelectBest, draftReplies } from "../core/drafter.js";
import { logError, logReply } from "../core/logger.js";
import { postReply } from "../core/poster.js";
import { canReply, recordReply } from "../core/rate-limiter.js";
import { isConfigured as isIMessageConfigured, sendMessage } from "../imessage.js";
import { isPostSeen, markPostSeen } from "../store.js";
import { searchPosts } from "../x-client.js";

const LOOP_NAME = "WATCH";
const MAX_POST_AGE_MINUTES = 5;

function processNewPost(post: {
  id: string;
  author_username: string;
  text: string;
  likes: number;
  replies: number;
  age_minutes: number;
}): void {
  markPostSeen(post.id, post.author_username, post.text, post.likes, post.replies);

  if (!canReply(post.author_username, LOOP_NAME)) return;

  const drafts = draftReplies({
    author: post.author_username,
    text: post.text,
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
      reason: `Priority watchlist account posted ${post.age_minutes}m ago`,
    });

    if (isIMessageConfigured()) {
      const msg = [
        `[${LOOP_NAME}] Replied to @${post.author_username}`,
        ``,
        `Post: "${post.text.slice(0, 200)}"`,
        `Reply: "${bestReply}"`,
        ``,
        postUrl,
      ].join("\n");
      sendMessage(msg);
    }
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
    const watchlist = getWatchlist();
    const accounts = watchlist.accounts;

    if (accounts.length === 0) {
      return;
    }

    // Build search query: (from:user1 OR from:user2 ...) -is:reply -is:retweet
    const fromClauses = accounts.map((a) => `from:${a}`).join(" OR ");
    const query = `(${fromClauses}) -is:reply -is:retweet`;

    const posts = await searchPosts(client, query, 30);

    // Filter for fresh, unseen posts
    const newPosts = posts.filter(
      (p) => p.age_minutes <= MAX_POST_AGE_MINUTES && !isPostSeen(p.id),
    );

    for (const post of newPosts) {
      try {
        processNewPost(post);
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
