/**
 * CONVERSATION TRACK loop — monitors mentions of @Orbitbuild and
 * replies to our recent posts. Drafts follow-up responses to keep
 * conversations going.
 */

import type { TwitterApi } from "twitter-api-v2";

import { getPersona } from "../core/config-loader.js";
import { autoSelectBest, draftReplies } from "../core/drafter.js";
import { logDiscovery, logError, logReply } from "../core/logger.js";
import { postReply } from "../core/poster.js";
import { canReply, recordReply } from "../core/rate-limiter.js";
import { isConfigured as isIMessageConfigured, sendMessage } from "../imessage.js";
import { isPostSeen, markPostSeen } from "../store.js";
import type { PostResult } from "../x-client.js";
import { searchPosts } from "../x-client.js";

const LOOP_NAME = "CONVO";
const MAX_POST_AGE_MINUTES = 360; // Track conversations up to 6 hours

async function fetchMentions(client: TwitterApi, handle: string): Promise<Array<PostResult>> {
  try {
    return await searchPosts(client, `@${handle} -from:${handle}`, 20);
  } catch (err) {
    logError({
      loop: LOOP_NAME,
      error: err instanceof Error ? err.message : String(err),
      context: "Searching for mentions",
    });
    return [];
  }
}

async function fetchRepliesToUs(client: TwitterApi, handle: string): Promise<Array<PostResult>> {
  try {
    return await searchPosts(client, `to:${handle} -from:${handle}`, 20);
  } catch (err) {
    logError({
      loop: LOOP_NAME,
      error: err instanceof Error ? err.message : String(err),
      context: "Searching for replies to us",
    });
    return [];
  }
}

function processMention(post: PostResult): void {
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
      "This person mentioned us or replied to one of our posts.",
      "Draft a follow-up response that keeps the conversation going.",
      "Be helpful, genuine, and specific to what they said.",
      "If they asked a question, answer it directly.",
      "If they shared feedback, acknowledge it specifically.",
      "If they tagged us in a recommendation thread, thank them naturally without being over-the-top.",
      "Keep the conversational thread alive — end with something that invites further exchange.",
    ].join(" "),
  });

  if (drafts.length === 0) {
    logError({
      loop: LOOP_NAME,
      error: "Failed to generate follow-up drafts",
      context: `Mention by @${post.author_username}: "${post.text.slice(0, 100)}"`,
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
      reason: `Conversation follow-up — ${post.age_minutes}m old mention/reply`,
    });

    if (isIMessageConfigured()) {
      const msg = [
        `[${LOOP_NAME}] @${post.author_username} mentioned us`,
        ``,
        `"${post.text.slice(0, 200)}"`,
        ``,
        `Replied: "${bestReply}"`,
        ``,
        postUrl,
      ].join("\n");
      sendMessage(msg);
    }
  } else {
    logError({
      loop: LOOP_NAME,
      error: "Chrome post failed",
      context: `Follow-up to @${post.author_username}: "${bestReply.slice(0, 100)}"`,
    });
  }
}

export async function runCycle(client: TwitterApi): Promise<void> {
  try {
    const persona = getPersona();
    const handle = persona.handle.replace("@", "");

    const [mentions, repliesToUs] = await Promise.all([
      fetchMentions(client, handle),
      fetchRepliesToUs(client, handle),
    ]);

    // Combine and deduplicate
    const allPosts = new Map<string, PostResult>();
    for (const post of [...mentions, ...repliesToUs]) {
      if (!allPosts.has(post.id)) {
        allPosts.set(post.id, post);
      }
    }

    // Filter: unseen, within time window
    const newConversations = Array.from(allPosts.values()).filter(
      (p) => p.age_minutes <= MAX_POST_AGE_MINUTES && !isPostSeen(p.id),
    );

    for (const post of newConversations) {
      try {
        processMention(post);
      } catch (err) {
        logError({
          loop: LOOP_NAME,
          error: err instanceof Error ? err.message : String(err),
          context: `Processing mention ${post.id} by @${post.author_username}`,
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
